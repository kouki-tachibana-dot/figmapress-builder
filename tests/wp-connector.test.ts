import assert from "node:assert/strict";
import test from "node:test";
import {
  createElementorDraftPage,
  fetchElementorSnapshot,
  localizeElementorDraftMedia,
  prepareWordPressSite,
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

  const status = await probeWordPressConnection(config);
  assert.equal(status.authenticated, true);
  assert.equal(status.connectorInstalled, true);
  assert.equal(status.elementor.active, true);
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

test("server pairing sends no Basic credentials and reports the paired user", async (context) => {
  const connectorToken = `fp1.7.${"c".repeat(43)}`;
  const headersSeen: Array<{
    authorization: string | null;
    pairing: string | null;
  }> = [];
  context.mock.method(globalThis, "fetch", async (_input, init) => {
    const headers = new Headers(init?.headers);
    headersSeen.push({
      authorization: headers.get("Authorization"),
      pairing: headers.get("X-FigmaPress-Token"),
    });
    return Response.json({
      connectorVersion: "0.15.0",
      wordpressVersion: "7.0.1",
      canEditPages: true,
      user: { id: 7, name: "Paired editor" },
      pairing: { supported: true, active: true },
      elementor: { active: true, version: "3.30.0" },
    });
  });

  const status = await probeWordPressConnection({
    baseUrl: "https://wordpress.example",
    username: "editor",
    applicationPassword: "",
    connectorToken,
  });
  assert.equal(status.user.name, "Paired editor");
  assert.deepEqual(status.pairing, { supported: true, active: true });
  assert.equal(headersSeen.length, 1);
  assert.equal(headersSeen[0]?.authorization, null);
  assert.equal(headersSeen[0]?.pairing, connectorToken);
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
    sourceKey: "figma:Abcdef123:46:12",
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
  assert.match(requests[0]?.body ?? "", /"sourceKey":"figma:Abcdef123:46:12"/);
});

test("server transport prepares stable multi-page drafts and an unassigned menu", async (context) => {
  const requests: Array<{ url: string; body: string }> = [];
  context.mock.method(globalThis, "fetch", async (input, init) => {
    requests.push({ url: String(input), body: String(init?.body ?? "") });
    return Response.json({
      siteKey: "figma:Abcdef123:46:12",
      title: "竹内きよ子様",
      status: "draft",
      pages: [
        { id: 91, key: "home", title: "竹内きよ子様", slug: "home", status: "draft", sourceKey: "figma:Abcdef123:46:12", created: false, updated: true, rawLink: "https://wordpress.example/home/" },
        { id: 92, key: "profile", title: "プロフィール", slug: "profile", status: "draft", sourceKey: "figma:Abcdef123:46:12:page:profile", created: true, updated: false, rawLink: "https://wordpress.example/profile/" },
      ],
      menu: {
        id: 7,
        name: "竹内きよ子様｜FigmaPress",
        editLink: "https://wordpress.example/wp-admin/nav-menus.php?action=edit&menu=7",
        assigned: false,
        assignedLocations: [],
        items: [],
      },
      warnings: [],
    });
  });

  const result = await prepareWordPressSite(config, {
    siteKey: "figma:Abcdef123:46:12",
    title: "竹内きよ子様",
    menuName: "竹内きよ子様｜FigmaPress",
    pages: [
      { key: "home", title: "竹内きよ子様", slug: "/", sourceKey: "figma:Abcdef123:46:12" },
      { key: "profile", title: "プロフィール", slug: "profile", sourceKey: "figma:Abcdef123:46:12:page:profile" },
    ],
  });

  assert.equal(result.status, "draft");
  assert.equal(result.pages.every((page) => page.status === "draft"), true);
  assert.equal(result.menu?.assigned, false);
  assert.equal(requests.length, 1);
  assert.match(requests[0]?.url ?? "", /figmapress\/v1\/elementor\/site-prepare$/);
  assert.match(requests[0]?.body ?? "", /"slug":"home"/);
  assert.doesNotMatch(requests[0]?.body ?? "", /"status":"publish"/);
});

test("server paired transport uses the scoped admin-post fallback", async (context) => {
  const connectorToken = `fp1.42.${"d".repeat(48)}`;
  const requests: Array<{ url: string; body: string; tokenHeader: string | null; contentType: string | null }> = [];
  context.mock.method(globalThis, "fetch", async (input, init) => {
    const headers = new Headers(init?.headers);
    requests.push({
      url: String(input),
      body: String(init?.body ?? ""),
      tokenHeader: headers.get("X-FigmaPress-Token"),
      contentType: headers.get("Content-Type"),
    });
    return Response.json({
      siteKey: "figma:Abcdef123:46:12",
      title: "竹内きよ子様",
      status: "draft",
      pages: [
        { id: 91, key: "home", title: "竹内きよ子様", slug: "home", status: "draft", sourceKey: "figma:Abcdef123:46:12", created: false, updated: true },
        { id: 92, key: "profile", title: "プロフィール", slug: "profile", status: "draft", sourceKey: "figma:Abcdef123:46:12:page:profile", created: false, updated: true },
      ],
      menu: null,
      warnings: [],
    });
  });

  await prepareWordPressSite({ ...config, connectorToken }, {
    siteKey: "figma:Abcdef123:46:12",
    title: "竹内きよ子様",
    menuName: "竹内きよ子様｜FigmaPress",
    pages: [
      { key: "home", title: "竹内きよ子様", slug: "/", sourceKey: "figma:Abcdef123:46:12" },
      { key: "profile", title: "プロフィール", slug: "profile", sourceKey: "figma:Abcdef123:46:12:page:profile" },
    ],
  });

  assert.equal(requests.length, 1);
  assert.match(requests[0]?.url ?? "", /wp-admin\/admin-post\.php$/);
  assert.equal(requests[0]?.tokenHeader, null);
  assert.equal(requests[0]?.contentType, null);
  const form = new URLSearchParams(requests[0]?.body);
  assert.equal(form.get("action"), "figmapress_site_prepare");
  assert.equal(form.get("figmapress_token"), null);
  assert.equal(
    form.get("figmapress_token_hex"),
    Buffer.from(connectorToken, "utf8").toString("hex"),
  );
  assert.match(form.get("payload") ?? "", /"slug":"home"/);
});

test("server paired transport retries blocked admin-post through admin-ajax", async (context) => {
  const connectorToken = `fp1.42.${"e".repeat(48)}`;
  const requests: string[] = [];
  context.mock.method(globalThis, "fetch", async (input) => {
    requests.push(String(input));
    if (requests.length === 1) {
      return new Response("blocked by shared-host security", { status: 403 });
    }
    return Response.json({
      siteKey: "figma:Abcdef123:46:12",
      title: "竹内きよ子様",
      status: "draft",
      pages: [
        { id: 91, key: "home", title: "竹内きよ子様", slug: "home", status: "draft", sourceKey: "figma:Abcdef123:46:12", created: false, updated: true },
        { id: 92, key: "profile", title: "プロフィール", slug: "profile", status: "draft", sourceKey: "figma:Abcdef123:46:12:page:profile", created: false, updated: true },
      ],
      menu: null,
      warnings: [],
    });
  });

  const result = await prepareWordPressSite({ ...config, connectorToken }, {
    siteKey: "figma:Abcdef123:46:12",
    title: "竹内きよ子様",
    menuName: "竹内きよ子様｜FigmaPress",
    pages: [
      { key: "home", title: "竹内きよ子様", slug: "/", sourceKey: "figma:Abcdef123:46:12" },
      { key: "profile", title: "プロフィール", slug: "profile", sourceKey: "figma:Abcdef123:46:12:page:profile" },
    ],
  });

  assert.equal(result.status, "draft");
  assert.deepEqual(requests, [
    "https://wordpress.example/wp-admin/admin-post.php",
    "https://wordpress.example/wp-admin/admin-ajax.php",
  ]);
});

test("server transport rejects any non-draft page in a prepared site", async (context) => {
  context.mock.method(globalThis, "fetch", async () => Response.json({
    siteKey: "figma:Abcdef123:46:12",
    title: "Unsafe",
    status: "draft",
    pages: [{ id: 91, key: "home", title: "Unsafe", slug: "home", status: "publish", sourceKey: "figma:Abcdef123:46:12", created: false, updated: true }],
    menu: null,
    warnings: [],
  }));
  await assert.rejects(
    prepareWordPressSite(config, {
      siteKey: "figma:Abcdef123:46:12",
      title: "Unsafe",
      menuName: "Unsafe｜FigmaPress",
      pages: [
        { key: "home", title: "Unsafe", slug: "home", sourceKey: "figma:Abcdef123:46:12" },
        { key: "profile", title: "Profile", slug: "profile", sourceKey: "figma:Abcdef123:46:12:page:profile" },
      ],
    }),
    (error: unknown) => error instanceof WpRequestError && error.status === 502,
  );
});

test("server transport resumes Elementor media in a bounded request", async (context) => {
  const requests: Array<{ url: string; method?: string; body?: string }> = [];
  context.mock.method(globalThis, "fetch", async (input, init) => {
    requests.push({
      url: String(input),
      method: init?.method,
      body: String(init?.body ?? ""),
    });
    return Response.json({
      postId: 91,
      status: "draft",
      importedMedia: 10,
      savedMedia: 18,
      totalMedia: 24,
      remainingMedia: 6,
      failedMedia: 0,
      mediaComplete: false,
      storedElements: 42,
    });
  });
  const requestId = "77777777-7777-4777-8777-777777777777";
  const progress = await localizeElementorDraftMedia(config, 91, requestId);
  assert.equal(progress.savedMedia, 18);
  assert.equal(progress.remainingMedia, 6);
  assert.match(requests[0]?.url ?? "", /pages\/91\/media$/);
  assert.equal(requests[0]?.method, "POST");
  assert.match(requests[0]?.body ?? "", new RegExp(requestId));
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
