import assert from "node:assert/strict";
import test from "node:test";
import {
  WordPressDirectError,
  createWordPressDraftDirect,
  probeWordPressDirect,
} from "../apps/web/src/lib/wordpress-browser.ts";

const config = {
  baseUrl: "https://wordpress.example/",
  username: "編集者",
  applicationPassword: "test application password",
};

test("browser connection probes the Connector directly with Basic auth", async (context) => {
  const requests: Array<{ url: string; authorization: string | null; cache?: RequestCache }> = [];
  context.mock.method(globalThis, "fetch", async (input, init) => {
    const headers = new Headers(init?.headers);
    requests.push({
      url: String(input),
      authorization: headers.get("Authorization"),
      cache: init?.cache,
    });
    return Response.json({
      connectorVersion: "0.4.1",
      wordpressVersion: "7.0.1",
      canEditPages: true,
      elementor: { active: true, version: "3.30.0" },
    });
  });

  const status = await probeWordPressDirect(config);
  assert.equal(status.connectorInstalled, true);
  assert.equal(status.canEditPages, true);
  assert.match(requests[0]?.url ?? "", /figmapress\/v1\/status$/);
  assert.match(requests[0]?.authorization ?? "", /^Basic /);
  assert.equal(requests[0]?.cache, undefined);
});

test("browser connection keeps authentication failures out of the server fallback", async (context) => {
  context.mock.method(globalThis, "fetch", async () =>
    Response.json({ code: "rest_not_logged_in" }, { status: 401 }),
  );

  await assert.rejects(
    probeWordPressDirect(config),
    (error: unknown) =>
      error instanceof WordPressDirectError && error.kind === "auth" && error.status === 401,
  );
});

test("browser network failures are logged without WordPress credentials", async (context) => {
  const logs: unknown[][] = [];
  context.mock.method(globalThis, "fetch", async () => {
    throw new TypeError("Failed to fetch");
  });
  context.mock.method(console, "error", (...args: unknown[]) => {
    logs.push(args);
  });

  await assert.rejects(
    probeWordPressDirect(config),
    (error: unknown) => error instanceof WordPressDirectError && error.kind === "network",
  );

  assert.deepEqual(logs, [[
    "[wordpress-direct] Browser request failed",
    { name: "TypeError", message: "Failed to fetch" },
  ]]);
  assert.doesNotMatch(JSON.stringify(logs), /test application password/);
});

test("browser Elementor creation checks the slug and creates only a draft", async (context) => {
  const requests: Array<{ url: string; body?: string }> = [];
  context.mock.method(globalThis, "fetch", async (input, init) => {
    const url = String(input);
    requests.push({ url, body: typeof init?.body === "string" ? init.body : undefined });
    if (url.includes("/wp/v2/pages?")) return Response.json([]);
    return Response.json({ id: 42, slug: "home", status: "draft", importedMedia: 2 });
  });

  const result = await createWordPressDraftDirect(config, {
    target: "elementor",
    title: "ホーム",
    slug: "/",
    pageTemplate: "elementor_canvas",
    template: {
      title: "ホーム",
      type: "page",
      version: "0.4",
      page_settings: {},
      content: [{ id: "1234abcd" }],
    },
  });

  assert.equal(result.status, "draft");
  assert.equal(result.target, "elementor");
  assert.match(requests[1]?.url ?? "", /figmapress\/v1\/elementor\/pages$/);
  assert.match(requests[1]?.body ?? "", /"status":"draft"/);
});
