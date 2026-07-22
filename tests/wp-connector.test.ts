import assert from "node:assert/strict";
import test from "node:test";
import {
  createElementorDraftPage,
  probeWordPressConnection,
  WpRequestError,
  type WpConfig,
} from "@figmapress/wp-connector";

const config: WpConfig = {
  baseUrl: "https://wordpress.example",
  username: "editor",
  applicationPassword: "test application password",
};

test("WordPress connection probe reports Connector and Elementor versions", async (context) => {
  const requests: string[] = [];
  context.mock.method(globalThis, "fetch", async (input) => {
    const url = String(input);
    requests.push(url);
    if (url.includes("/wp/v2/users/me")) {
      return Response.json({ id: 7, name: "Editor", capabilities: { edit_pages: true } });
    }
    return Response.json({
      connectorVersion: "0.4.0",
      wordpressVersion: "7.0.1",
      canEditPages: true,
      elementor: { active: true, version: "3.30.0" },
    });
  });

  const status = await probeWordPressConnection(config);
  assert.equal(status.authenticated, true);
  assert.equal(status.connectorInstalled, true);
  assert.equal(status.elementor.active, true);
  assert.equal(requests.length, 2);
});

test("Elementor draft creation uses the Connector endpoint and remains draft", async (context) => {
  const requests: Array<{ url: string; method?: string; body?: string }> = [];
  context.mock.method(globalThis, "fetch", async (input, init) => {
    const url = String(input);
    requests.push({ url, method: init?.method, body: String(init?.body ?? "") });
    if (url.includes("/wp/v2/pages?")) return Response.json([]);
    return Response.json({
      id: 91,
      slug: "home",
      status: "draft",
      editLink: "https://wordpress.example/wp-admin/post.php?post=91&action=elementor",
      importedMedia: 1,
    });
  });

  const result = await createElementorDraftPage(config, {
    title: "Elementor Page",
    slug: "/",
    template: {
      title: "Elementor Page",
      type: "page",
      version: "0.4",
      page_settings: {},
      content: [{ id: "1234abcd", elType: "container", isInner: false, settings: {}, elements: [] }],
    },
  });

  assert.equal(result.status, "draft");
  assert.equal(result.target, "elementor");
  assert.equal(result.importedMedia, 1);
  assert.match(requests[1]?.url ?? "", /figmapress\/v1\/elementor\/pages/);
  assert.match(requests[1]?.body ?? "", /"status":"draft"/);
});

test("permission errors are not mislabeled as invalid credentials", async (context) => {
  context.mock.method(globalThis, "fetch", async () =>
    new Response(JSON.stringify({ message: "You cannot edit pages." }), { status: 403 }),
  );

  await assert.rejects(
    createElementorDraftPage(config, {
      title: "Forbidden",
      slug: "/",
      template: {
        title: "Forbidden",
        type: "page",
        version: "0.4",
        page_settings: {},
        content: [{ id: "1234abcd", elType: "container", isInner: false, settings: {}, elements: [] }],
      },
    }),
    (error: unknown) => error instanceof WpRequestError && error.status === 403,
  );
});
