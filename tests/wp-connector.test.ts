import assert from "node:assert/strict";
import test from "node:test";
import {
  createElementorDraftPage,
  fetchElementorSnapshot,
  probeWordPressConnection,
  updateElementorDraftPage,
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
    return Response.json({
      connectorVersion: "0.4.0",
      wordpressVersion: "7.0.1",
      canEditPages: true,
      elementor: { active: true, version: "3.30.0" },
      functionalWidgets: { navigation: true, contactForm: true, accordion: true },
      visualQa: {
        snapshot: true,
        documentUpdate: true,
        revisions: true,
        webfonts: true,
        gradients: true,
      },
    });
  });

  const status = await probeWordPressConnection(config);
  assert.equal(status.authenticated, true);
  assert.equal(status.connectorInstalled, true);
  assert.equal(status.elementor.active, true);
  assert.deepEqual(status.functionalWidgets, {
    navigation: true,
    contactForm: true,
    accordion: true,
  });
  assert.deepEqual(status.visualQa, {
    snapshot: true,
    documentUpdate: true,
    revisions: true,
    webfonts: true,
    gradients: true,
  });
  assert.equal(status.user.name, "editor");
  assert.equal(requests.length, 1);
  assert.match(requests[0] ?? "", /figmapress\/v1\/status/);
});

test("WordPress connection probe falls back to the core user endpoint when Connector is missing", async (context) => {
  const requests: string[] = [];
  context.mock.method(globalThis, "fetch", async (input) => {
    const url = String(input);
    requests.push(url);
    if (url.includes("/figmapress/v1/status")) {
      return Response.json(
        { code: "rest_no_route", message: "No route." },
        { status: 404 },
      );
    }
    return Response.json({ id: 7, name: "Editor" });
  });

  const status = await probeWordPressConnection(config);
  assert.equal(status.authenticated, true);
  assert.equal(status.connectorInstalled, false);
  assert.equal(status.user.name, "Editor");
  assert.equal(status.canEditPages, false);
  assert.equal(requests.length, 2);
  assert.match(requests[1] ?? "", /wp\/v2\/users\/me$/);
});

test("server connection retries with the Connector header after HTTP 401", async (context) => {
  const fallbackHeaders: Array<string | null> = [];
  context.mock.method(globalThis, "fetch", async (_input, init) => {
    const headers = new Headers(init?.headers);
    fallbackHeaders.push(headers.get("X-FigmaPress-Authorization"));
    if (fallbackHeaders.length === 1) {
      return Response.json({ code: "rest_not_logged_in" }, { status: 401 });
    }
    return Response.json({
      connectorVersion: "0.4.2",
      wordpressVersion: "7.0.2",
      canEditPages: true,
      elementor: { active: true, version: "3.30.0" },
    });
  });

  const status = await probeWordPressConnection(config);
  assert.equal(status.authenticated, true);
  assert.equal(fallbackHeaders.length, 2);
  assert.equal(fallbackHeaders[0], null);
  assert.match(fallbackHeaders[1] ?? "", /^Basic /);
});

test("Elementor draft creation uses one Connector request and remains draft", async (context) => {
  const requests: Array<{ url: string; method?: string; body?: string }> = [];
  context.mock.method(globalThis, "fetch", async (input, init) => {
    const url = String(input);
    requests.push({ url, method: init?.method, body: String(init?.body ?? "") });
    return Response.json({
      id: 91,
      slug: "home",
      status: "draft",
      editLink: "https://wordpress.example/wp-admin/post.php?post=91&action=elementor",
      importedMedia: 1,
    });
  });

  const result = await createElementorDraftPage(config, {
    requestId: "33333333-3333-4333-8333-333333333333",
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
  assert.equal(requests.length, 1);
  assert.match(requests[0]?.url ?? "", /figmapress\/v1\/elementor\/pages/);
  assert.match(requests[0]?.body ?? "", /"status":"draft"/);
});

test("permission errors are not mislabeled as invalid credentials", async (context) => {
  context.mock.method(globalThis, "fetch", async () =>
    new Response(JSON.stringify({ message: "You cannot edit pages." }), { status: 403 }),
  );

  await assert.rejects(
    createElementorDraftPage(config, {
      requestId: "44444444-4444-4444-8444-444444444444",
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

test("server transport supports Elementor snapshot and revision update routes", async (context) => {
  const requests: Array<{ url: string; method?: string; body?: string }> = [];
  context.mock.method(globalThis, "fetch", async (input, init) => {
    const url = String(input);
    requests.push({
      url,
      method: init?.method,
      body: String(init?.body ?? ""),
    });
    if (url.endsWith("/snapshot")) {
      return Response.json({
        postId: 91,
        html: "<main></main>",
        styles: "",
        storedElements: 4,
        generatedAt: "2026-07-24T00:00:00Z",
      });
    }
    return Response.json({
      postId: 91,
      status: "draft",
      storedElements: 4,
      revisionId: 92,
    });
  });

  const requestId = "66666666-6666-4666-8666-666666666666";
  const snapshot = await fetchElementorSnapshot(config, 91, requestId);
  assert.equal(snapshot.postId, 91);
  const update = await updateElementorDraftPage(config, {
    postId: 91,
    requestId,
    template: {
      title: "Elementor Page",
      type: "page",
      version: "0.4",
      page_settings: {},
      content: [{
        id: "1234abcd",
        elType: "container",
        isInner: false,
        settings: {},
        elements: [],
      }],
    },
  });
  assert.equal(update.revisionId, 92);
  assert.equal(requests.length, 2);
  assert.match(requests[0]?.url ?? "", /pages\/91\/snapshot$/);
  assert.match(requests[1]?.url ?? "", /pages\/91\/document$/);
  assert.equal(requests[1]?.method, "PUT");
});
