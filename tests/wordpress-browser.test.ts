import assert from "node:assert/strict";
import test from "node:test";
import {
  WordPressDirectError,
  createWordPressDraftDirect,
  fetchWordPressElementorSnapshotDirect,
  probeWordPressDirect,
  updateWordPressElementorDocumentDirect,
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
      functionalWidgets: {
        navigation: true,
        links: true,
        carousel: true,
        contactForm: true,
        accordion: true,
      },
      visualQa: {
        snapshot: true,
        documentUpdate: true,
        revisions: true,
        webfonts: true,
        gradients: true,
        effects: true,
        imageTransforms: true,
      },
    });
  });

  const status = await probeWordPressDirect(config);
  assert.equal(status.connectorInstalled, true);
  assert.equal(status.canEditPages, true);
  assert.deepEqual(status.functionalWidgets, {
    navigation: true,
    links: true,
    carousel: true,
    contactForm: true,
    accordion: true,
  });
  assert.deepEqual(status.visualQa, {
    snapshot: true,
    documentUpdate: true,
    revisions: true,
    webfonts: true,
    gradients: true,
    effects: true,
    imageTransforms: true,
  });
  assert.match(requests[0]?.url ?? "", /figmapress\/v1\/status$/);
  assert.match(requests[0]?.authorization ?? "", /^Basic /);
  assert.equal(requests[0]?.cache, undefined);
});

test("browser connection keeps authentication failures out of the server fallback", async (context) => {
  const warnings: unknown[][] = [];
  context.mock.method(globalThis, "fetch", async () =>
    Response.json({ code: "rest_not_logged_in" }, { status: 401 }),
  );
  context.mock.method(console, "warn", (...args: unknown[]) => {
    warnings.push(args);
  });

  await assert.rejects(
    probeWordPressDirect(config),
    (error: unknown) =>
      error instanceof WordPressDirectError && error.kind === "auth" && error.status === 401,
  );
  assert.equal(warnings.length, 1);
  assert.match(JSON.stringify(warnings), /"status":401/);
  assert.doesNotMatch(JSON.stringify(warnings), /test application password/);
});

test("browser connection retries with the Connector header when a host strips Authorization", async (context) => {
  const requests: Array<{ authorization: string | null; fallback: string | null; signal?: AbortSignal | null }> = [];
  context.mock.method(globalThis, "fetch", async (_input, init) => {
    const headers = new Headers(init?.headers);
    requests.push({
      authorization: headers.get("Authorization"),
      fallback: headers.get("X-FigmaPress-Authorization"),
      signal: init?.signal,
    });
    if (requests.length === 1) {
      return Response.json({ code: "rest_not_logged_in" }, { status: 401 });
    }
    return Response.json({
      connectorVersion: "0.4.2",
      wordpressVersion: "7.0.2",
      canEditPages: true,
      elementor: { active: true, version: "3.30.0" },
    });
  });

  const status = await probeWordPressDirect(config);
  assert.equal(status.authenticated, true);
  assert.equal(requests.length, 2);
  assert.equal(requests[0]?.fallback, null);
  assert.match(requests[1]?.fallback ?? "", /^Basic /);
  assert.equal(requests[1]?.fallback, requests[1]?.authorization);
  assert.notEqual(requests[0]?.signal, requests[1]?.signal);
});

test("browser fallback transport failures are not mislabeled as invalid credentials", async (context) => {
  let requestCount = 0;
  const warnings: unknown[][] = [];
  const errors: unknown[][] = [];
  context.mock.method(globalThis, "fetch", async () => {
    requestCount += 1;
    if (requestCount === 1) {
      return Response.json({ code: "rest_not_logged_in" }, { status: 401 });
    }
    throw new DOMException("The operation timed out", "TimeoutError");
  });
  context.mock.method(console, "warn", (...args: unknown[]) => warnings.push(args));
  context.mock.method(console, "error", (...args: unknown[]) => errors.push(args));

  await assert.rejects(
    createWordPressDraftDirect(config, {
      target: "elementor",
      requestId: "11111111-1111-4111-8111-111111111111",
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
    }),
    (error: unknown) =>
      error instanceof WordPressDirectError &&
      error.kind === "network" &&
      error.message.includes("タイムアウト"),
  );
  assert.equal(requestCount, 2);
  assert.match(JSON.stringify(warnings), /TimeoutError/);
  assert.match(JSON.stringify(errors), /TimeoutError/);
  assert.doesNotMatch(JSON.stringify([warnings, errors]), /test application password/);
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
    "[wordpress-direct] Browser request failed: TypeError: Failed to fetch",
  ]]);
  assert.doesNotMatch(JSON.stringify(logs), /test application password/);
});

test("browser Elementor creation sends one draft request without a status preflight", async (context) => {
  const requests: Array<{ url: string; body?: string }> = [];
  context.mock.method(globalThis, "fetch", async (input, init) => {
    const url = String(input);
    requests.push({ url, body: typeof init?.body === "string" ? init.body : undefined });
    return Response.json({ id: 42, slug: "home", status: "draft", importedMedia: 2 });
  });

  const result = await createWordPressDraftDirect(config, {
    target: "elementor",
    requestId: "22222222-2222-4222-8222-222222222222",
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
  assert.equal(requests.length, 1);
  assert.match(requests[0]?.url ?? "", /figmapress\/v1\/elementor\/pages$/);
  assert.match(requests[0]?.body ?? "", /"status":"draft"/);
  assert.match(requests[0]?.body ?? "", /"requestId":"22222222-2222-4222-8222-222222222222"/);
});

test("browser retrieves and updates only the matching Elementor draft", async (context) => {
  const requests: Array<{ url: string; method?: string; body?: string }> = [];
  context.mock.method(globalThis, "fetch", async (input, init) => {
    const url = String(input);
    requests.push({
      url,
      method: init?.method,
      body: typeof init?.body === "string" ? init.body : undefined,
    });
    if (url.endsWith("/snapshot")) {
      return Response.json({
        postId: 42,
        html: '<main class="figmapress-figma-preview"></main>',
        styles: "<style>body{margin:0}</style>",
        storedElements: 8,
        generatedAt: "2026-07-24T00:00:00Z",
      });
    }
    return Response.json({
      postId: 42,
      status: "draft",
      storedElements: 8,
      revisionId: 44,
    });
  });

  const requestId = "55555555-5555-4555-8555-555555555555";
  const snapshot = await fetchWordPressElementorSnapshotDirect(
    config,
    42,
    requestId,
  );
  assert.equal(snapshot.storedElements, 8);
  assert.match(snapshot.html, /figmapress-figma-preview/);

  const updated = await updateWordPressElementorDocumentDirect(config, {
    postId: 42,
    requestId,
    pageTemplate: "elementor_canvas",
    template: {
      title: "ホーム",
      type: "page",
      version: "0.4",
      page_settings: {},
      content: [{ id: "1234abcd" }],
    },
  });
  assert.equal(updated.status, "draft");
  assert.equal(updated.revisionId, 44);
  assert.equal(requests.length, 2);
  assert.match(requests[0]?.url ?? "", /pages\/42\/snapshot$/);
  assert.equal(requests[0]?.method, "POST");
  assert.match(requests[0]?.body ?? "", new RegExp(requestId));
  assert.match(requests[1]?.url ?? "", /pages\/42\/document$/);
  assert.equal(requests[1]?.method, "PUT");
  assert.match(requests[1]?.body ?? "", /"pageTemplate":"elementor_canvas"/);
});
