import assert from "node:assert/strict";
import test from "node:test";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { prepareWordPressReviewSite } from "../packages/wp-connector/src/index";
import { validateReviewSiteResult, validateReviewPageSave, type PrepareReviewSiteInput, type PrepareReviewSiteResult } from "../packages/wp-connector/src/review-site";
import { prepareWordPressReviewSiteDirect } from "../apps/web/src/lib/wordpress-browser";
import { WordPressReviewSiteSchema } from "../apps/web/src/lib/wordpress-site-input";
import { resolveWordPressPageLinks } from "../apps/web/src/lib/wordpress-page-links";

const fixture = JSON.parse(execFileSync("php", ["tests/fixtures/wordpress-review-site-harness.php"], { encoding: "utf8" })) as {
  pass: boolean; input: PrepareReviewSiteInput; result: PrepareReviewSiteResult;
};
const { input } = fixture;
const result = () => structuredClone(fixture.result);
const baseUrl = "https://wp.example/subdir";
const config = { baseUrl, username: "fixture", applicationPassword: "test-only-password" };

test("actual PHP creates nine isolated drafts, resumes partial creation, protects originals and rejects hand-edit conflicts", () => {
  assert.equal(fixture.pass, true);
  assert.equal(validateReviewSiteResult(input, result()).pages.length, 9);
  const links = resolveWordPressPageLinks(baseUrl, fixture.result.siteKey, input.pages.map(page => page.key), { baseUrl, result: result() });
  assert.ok(links.every(link => /preview=true/.test(link.rawLink)));
  assert.ok(!links.some(link => input.pages.some(page => link.rawLink.includes(`page_id=${page.originalId}&`))));
});

test("review receipt rejects original IDs, foreign run/site, published copies, reused menus and bad partitions", () => {
  for (const mutate of [
    (r: PrepareReviewSiteResult) => { r.pages[0].id = input.pages[1].originalId; },
    (r: PrepareReviewSiteResult) => { r.pages[0].originalId++; },
    (r: PrepareReviewSiteResult) => { r.siteKey = input.siteKey; },
    (r: PrepareReviewSiteResult) => { r.originalSiteKey = "figma:Other123:root"; },
    (r: PrepareReviewSiteResult) => { r.reviewId = "b".repeat(32); },
    (r: PrepareReviewSiteResult) => { r.pages[0].updated = true; },
    (r: PrepareReviewSiteResult) => { r.pages[0].status = "publish"; },
    (r: PrepareReviewSiteResult) => { r.pages[0].requestId = ""; },
    (r: PrepareReviewSiteResult) => { r.pages[1] = r.pages[0]; },
    (r: PrepareReviewSiteResult) => { r.menu = null; },
    (r: PrepareReviewSiteResult) => { r.menu!.assigned = true; },
    (r: PrepareReviewSiteResult) => { r.menu!.items[0].pageId = input.pages[0].originalId; },
    (r: PrepareReviewSiteResult) => { r.menu!.items[0].rawLink = "https://other.example/"; },
    (r: PrepareReviewSiteResult) => { r.menu!.items.pop(); },
  ]) { const r = result(); mutate(r); assert.throws(() => validateReviewSiteResult(input, r)); }
  const foreign = result(); foreign.pages[0].previewLink = "https://other.example/?page_id=101&preview=true";
  foreign.menu!.items[0].rawLink = foreign.pages[0].previewLink;
  assert.throws(() => resolveWordPressPageLinks(baseUrl, foreign.siteKey, input.pages.map(page => page.key), { baseUrl, result: validateReviewSiteResult(input, foreign) }));
});

test("review schema requires non-duplicate source IDs, home and a separate review ID", () => {
  assert.equal(WordPressReviewSiteSchema.safeParse(input).success, true);
  for (const bad of [
    { ...input, reviewId: "invalid" }, { ...input, siteKey: fixture.result.siteKey },
    { ...input, pages: input.pages.slice(1) }, { ...input, pages: [...input.pages, input.pages[0]] },
    { ...input, pages: input.pages.map(page => ({ ...page, originalId: 41 })) },
    { ...input, pages: input.pages.map(page => ({ ...page, sourceKey: input.siteKey })) },
  ]) assert.equal(WordPressReviewSiteSchema.safeParse(bad).success, false);
});

test("review save acknowledgement must name the exact copy and a non-empty native document", () => {
  const target = result().pages[0];
  const saved = { id: target.id, status: "draft", target: "elementor", storedElements: 2 };
  assert.doesNotThrow(() => validateReviewPageSave(target, saved));
  for (const change of [{ id: input.pages[0].originalId }, { status: "publish" }, { storedElements: 0 }, { storedElements: null }, { target: "gutenberg" }]) {
    assert.throws(() => validateReviewPageSave(target, { ...saved, ...change }));
  }
});

test("direct/basic/paired review transports never call normal site preparation", async context => {
  const urls: string[] = [];
  context.mock.method(globalThis, "fetch", async (url, init) => {
    urls.push(String(url));
    assert.equal(init?.method, "POST"); assert.equal(new URL(String(url)).search, "");
    return Response.json(result());
  });
  await prepareWordPressReviewSite(config, input);
  await prepareWordPressReviewSiteDirect(config, input);
  await prepareWordPressReviewSiteDirect({ ...config, connectorToken: `fp1.7.${"a".repeat(43)}` }, input);
  assert.deepEqual(urls, [`${baseUrl}/wp-json/figmapress/v1/sites/review-prepare`, `${baseUrl}/wp-json/figmapress/v1/sites/review-prepare`, `${baseUrl}/wp-json/figmapress/v1/paired/review-prepare`]);
});

test("all 403 review fallbacks retain the separate review action", async context => {
  const urls: string[] = [];
  context.mock.method(globalThis, "fetch", async (url, init) => {
    urls.push(String(url));
    assert.equal(new URLSearchParams(String(init?.body)).get("action"), "figmapress_review_prepare");
    return urls.length < 3 ? new Response("Forbidden", { status: 403 }) : Response.json(result());
  });
  await prepareWordPressReviewSite({ ...config, connectorToken: `fp1.7.${"a".repeat(43)}` }, input);
  assert.deepEqual(urls, [`${baseUrl}/wp-admin/admin-post.php`, `${baseUrl}/wp-admin/admin-ajax.php`, `${baseUrl}/wp-json/figmapress/v1/paired/review-prepare`]);
});

test("actual destination bridge routes review prepare separately and never claims body completion", async () => {
  const php = readFileSync("wordpress-plugin/figmapress-connector/includes/pairing.php", "utf8");
  const literals: Record<string, string> = { builder_origin: "https://figmapress-builder.vercel.app", prepare_url: `${baseUrl}/site-prepare`, lookup_url: `${baseUrl}/site-map`, review_url: `${baseUrl}/review-prepare`, elementor_upload_url: `${baseUrl}/uploads`, elementor_page_url: `${baseUrl}/pages` };
  const script = php.split("<script>")[1].split("</script>")[0].replace(/<\?php echo \$(\w+);[^\n]*?\?>/g, (_, name) => JSON.stringify(literals[name]));
  const urls: string[] = []; const messages: Array<{ type: string; ok?: boolean }> = []; const status = { textContent: "" };
  const peer = { postMessage: (message: typeof messages[number]) => messages.push(message) };
  let onMessage: (event: unknown) => Promise<void> = async () => {};
  runInNewContext(script, { window: { parent: peer, setInterval: () => 1, setTimeout: (callback: () => void) => callback(), addEventListener: (_: string, cb: typeof onMessage) => { onMessage = cb; } },
    document: { getElementById: () => status }, TextEncoder, URLSearchParams, AbortSignal, setTimeout,
    fetch: async (url: string) => { urls.push(url); return Response.json(result()); } });
  const event = { origin: literals.builder_origin, source: peer, data: { type: "figmapress:prepare-review", requestId: "12345678-1234-1234-1234-123456789abc", connectorToken: `fp1.7.${"a".repeat(43)}`, payload: input } };
  await onMessage({ ...event, origin: "https://foreign.example" }); await onMessage({ ...event, source: {} }); assert.deepEqual(urls, []);
  await onMessage(event); assert.deepEqual(urls, [literals.review_url]);
  assert.ok(messages.some(m => m.type === "figmapress:review-prepared" && m.ok));
  assert.match(status.textContent, /本文保存はまだ完了していません/);
});
