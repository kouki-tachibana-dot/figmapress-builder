import assert from "node:assert/strict";
import test from "node:test";
import {
  WordPressDirectError,
  createWordPressDraftChunkedDirect,
  createWordPressDraftDirect,
  fetchWordPressElementorSnapshotDirect,
  localizeWordPressElementorMediaDirect,
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

test("browser pairing uses only the scoped Connector header", async (context) => {
  const connectorToken = `fp1.7.${"a".repeat(43)}`;
  const requests: Array<{
    url: string;
    authorization: string | null;
    pairing: string | null;
  }> = [];
  context.mock.method(globalThis, "fetch", async (input, init) => {
    const headers = new Headers(init?.headers);
    requests.push({
      url: String(input),
      authorization: headers.get("Authorization"),
      pairing: headers.get("X-FigmaPress-Token"),
    });
    return Response.json({
      connectorVersion: "0.15.0",
      wordpressVersion: "7.0.1",
      canEditPages: true,
      user: { id: 7, name: "Editor" },
      pairing: { supported: true, active: true },
      elementor: { active: true, version: "3.30.0" },
    });
  });

  const status = await probeWordPressDirect({
    ...config,
    applicationPassword: "",
    connectorToken,
  });
  assert.equal(status.user.id, 7);
  assert.deepEqual(status.pairing, { supported: true, active: true });
  assert.equal(requests.length, 1);
  assert.equal(requests[0]?.authorization, null);
  assert.equal(requests[0]?.pairing, connectorToken);
  assert.match(requests[0]?.url ?? "", /figmapress\/v1\/status$/);
});

test("browser pairing creates Gutenberg drafts through the Connector namespace", async (context) => {
  const connectorToken = `fp1.7.${"b".repeat(43)}`;
  const requests: Array<{ url: string; pairing: string | null }> = [];
  context.mock.method(globalThis, "fetch", async (input, init) => {
    const headers = new Headers(init?.headers);
    requests.push({
      url: String(input),
      pairing: headers.get("X-FigmaPress-Token"),
    });
    return Response.json({
      id: 51,
      slug: "home",
      status: "draft",
      editLink: "https://wordpress.example/wp-admin/post.php?post=51&action=edit",
    });
  });

  const result = await createWordPressDraftDirect({
    ...config,
    applicationPassword: "",
    connectorToken,
  }, {
    target: "gutenberg",
    title: "ホーム",
    slug: "/",
    content: "<!-- wp:paragraph --><p>本文</p><!-- /wp:paragraph -->",
  });
  assert.equal(result.status, "draft");
  assert.equal(requests.length, 1);
  assert.match(requests[0]?.url ?? "", /figmapress\/v1\/gutenberg\/pages$/);
  assert.equal(requests[0]?.pairing, connectorToken);
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
    sourceKey: "figma:Abcdef123:46:12",
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
  assert.match(requests[0]?.body ?? "", /"sourceKey":"figma:Abcdef123:46:12"/);
});

test("browser splits large Elementor creation into bounded authenticated uploads", async (context) => {
  const requests: Array<{ url: string; body: string }> = [];
  context.mock.method(globalThis, "fetch", async (input, init) => {
    const body = typeof init?.body === "string" ? init.body : "";
    requests.push({ url: String(input), body });
    const chunk = JSON.parse(body) as { index: number; total: number };
    return chunk.index === chunk.total - 1
      ? Response.json({ id: 42, slug: "home", status: "draft", remainingMedia: 0 })
      : Response.json({ complete: false, received: chunk.index + 1, total: chunk.total });
  });

  const result = await createWordPressDraftChunkedDirect(config, {
    target: "elementor",
    requestId: "22222222-2222-4222-8222-222222222222",
    sourceKey: "figma:Abcdef123:46:12",
    title: "ホーム",
    slug: "/",
    pageTemplate: "elementor_canvas",
    template: {
      title: "ホーム",
      type: "page",
      version: "0.4",
      page_settings: {},
      content: [{ id: "1234abcd", settings: { text: "明石".repeat(60_000) } }],
    },
  });

  assert.equal(result.status, "draft");
  assert.ok(requests.length > 2);
  assert.ok(requests.every((request) => request.body.length < 130_000));
  assert.ok(requests.every((request) => /elementor\/uploads\/22222222/.test(request.url)));
  const reconstructed = requests
    .map((request) => JSON.parse(request.body) as { index: number; chunk: string })
    .sort((left, right) => left.index - right.index)
    .map((part) => Buffer.from(part.chunk, "base64"))
    .reduce((joined, part) => Buffer.concat([joined, part]), Buffer.alloc(0))
    .toString("utf8");
  assert.match(reconstructed, /"status":"draft"/);
  assert.match(reconstructed, /明石明石明石/);
});

test("browser retries a transient non-final Elementor chunk", async (context) => {
  const receivedIndexes: number[] = [];
  let interrupted = false;
  context.mock.method(globalThis, "fetch", async (_input, init) => {
    const chunk = JSON.parse(String(init?.body)) as { index: number; total: number };
    receivedIndexes.push(chunk.index);
    if (chunk.index === 0 && !interrupted) {
      interrupted = true;
      throw new TypeError("Failed to fetch");
    }
    return chunk.index === chunk.total - 1
      ? Response.json({ id: 42, slug: "home", status: "draft", remainingMedia: 0 })
      : Response.json({ complete: false, received: chunk.index + 1, total: chunk.total });
  });

  const result = await createWordPressDraftChunkedDirect(config, {
    target: "elementor",
    requestId: "33333333-3333-4333-8333-333333333333",
    sourceKey: "figma:Abcdef123:46:12",
    title: "ホーム",
    slug: "/",
    pageTemplate: "elementor_canvas",
    template: {
      title: "ホーム",
      type: "page",
      version: "0.4",
      page_settings: {},
      content: [{ id: "1234abcd", settings: { text: "再送".repeat(60_000) } }],
    },
  });

  assert.equal(result.status, "draft");
  assert.equal(receivedIndexes.filter((index) => index === 0).length, 2);
});

test("browser restarts an Elementor upload when final storage is still locked", async (context) => {
  let round = 0;
  context.mock.method(globalThis, "fetch", async (_input, init) => {
    const chunk = JSON.parse(String(init?.body)) as { index: number; total: number };
    if (chunk.index === 0) {
      round += 1;
    }
    if (chunk.index === chunk.total - 1 && round === 1) {
      return Response.json(
        { code: "figmapress_request_in_progress", message: "保存中です。" },
        { status: 409 },
      );
    }
    return chunk.index === chunk.total - 1
      ? Response.json({ id: 42, slug: "home", status: "draft", remainingMedia: 0 })
      : Response.json({ complete: false, received: chunk.index + 1, total: chunk.total });
  });

  const result = await createWordPressDraftChunkedDirect(config, {
    target: "elementor",
    requestId: "44444444-4444-4444-8444-444444444444",
    sourceKey: "figma:Abcdef123:46:12",
    title: "ホーム",
    slug: "/",
    pageTemplate: "elementor_canvas",
    template: {
      title: "ホーム",
      type: "page",
      version: "0.4",
      page_settings: {},
      content: [{ id: "1234abcd", settings: { text: "再開".repeat(60_000) } }],
    },
  });

  assert.equal(result.status, "draft");
  assert.equal(round, 2);
});

test("browser resumes Elementor media without recreating the draft", async (context) => {
  const requests: Array<{ url: string; method?: string; body?: string }> = [];
  context.mock.method(globalThis, "fetch", async (input, init) => {
    requests.push({
      url: String(input),
      method: init?.method,
      body: typeof init?.body === "string" ? init.body : undefined,
    });
    return Response.json({
      postId: 42,
      status: "draft",
      importedMedia: 6,
      savedMedia: 14,
      totalMedia: 20,
      remainingMedia: 6,
      failedMedia: 0,
      mediaComplete: false,
      storedElements: 30,
    });
  });
  const requestId = "88888888-8888-4888-8888-888888888888";
  const progress = await localizeWordPressElementorMediaDirect(
    config,
    42,
    requestId,
  );
  assert.equal(progress.savedMedia, 14);
  assert.equal(requests.length, 1);
  assert.match(requests[0]?.url ?? "", /pages\/42\/media$/);
  assert.equal(requests[0]?.method, "POST");
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
