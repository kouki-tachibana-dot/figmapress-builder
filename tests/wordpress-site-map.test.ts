import assert from "node:assert/strict";
import test from "node:test";
import { execFileSync } from "node:child_process";
import { lookupWordPressSite } from "../packages/wp-connector/src/index";
import { validateWordPressSiteMap, type WordPressSiteMapResult } from "../packages/wp-connector/src/site-map";
import { lookupWordPressSiteDirect } from "../apps/web/src/lib/wordpress-browser";
import { receiptFromWordPressSiteMap, resolveWordPressPageLinks } from "../apps/web/src/lib/wordpress-page-links";
import { WordPressSiteLookupSchema } from "../apps/web/src/lib/wordpress-site-input";

const siteKey = "figma:Example123:root";
const baseUrl = "https://wp.example/subdir";
const config = { baseUrl, username: "editor", applicationPassword: "test-only-password" };
const input = { siteKey, pages: ["home", "company"].map(key => ({ key, sourceKey: key === "home" ? siteKey : `${siteKey}:page:${key}` })) };
function result(): WordPressSiteMapResult {
  return { siteKey, readOnly: true, status: "ready", unresolved: [], pages: input.pages.map((page, index) => ({
    ...page, id: index + 41, title: page.key, slug: page.key, status: "draft", created: false, updated: false,
    previewLink: `${baseUrl}/?page_id=${index + 41}&preview=true`,
  })) };
}

test("real PHP map callbacks resolve nine pages without page, menu or pairing usage writes", () => {
  assert.match(execFileSync("php", ["tests/fixtures/wordpress-site-map-harness.php"], { encoding: "utf8" }), /PASS: nine-page lookup/);
});

test("read-only map becomes an exact draft-ID receipt", () => {
  const receipt = receiptFromWordPressSiteMap(baseUrl, input, result());
  assert.equal(resolveWordPressPageLinks(baseUrl, siteKey, ["home"], receipt)[0].rawLink, `${baseUrl}/?page_id=41&preview=true`);
});

test("map response rejects missing, duplicate, foreign, mutated and conflicting acknowledgements", () => {
  for (const mutate of [
    (r: WordPressSiteMapResult) => { r.readOnly = false as true; },
    (r: WordPressSiteMapResult) => { r.siteKey = "figma:Other123:root"; },
    (r: WordPressSiteMapResult) => { r.pages.pop(); },
    (r: WordPressSiteMapResult) => { r.pages[1].id = r.pages[0].id; },
    (r: WordPressSiteMapResult) => { r.pages[1].key = "unknown"; },
    (r: WordPressSiteMapResult) => { r.pages[0].status = "publish"; },
    (r: WordPressSiteMapResult) => { r.pages[0].updated = true; },
    (r: WordPressSiteMapResult) => { r.unresolved.push({ key: "home", reason: "duplicate" }); r.status = "unresolved"; },
  ]) {
    const value = result(); mutate(value);
    assert.throws(() => validateWordPressSiteMap(input, value));
  }
  const value = result(); value.pages.shift(); value.unresolved.push({ key: "home", reason: "duplicate" }); value.status = "unresolved";
  assert.doesNotThrow(() => validateWordPressSiteMap(input, value));
  assert.throws(() => receiptFromWordPressSiteMap(baseUrl, input, value), /未解決/);
  const foreign = result(); foreign.pages[0].previewLink = "https://other.example/?page_id=41&preview=true";
  assert.throws(() => receiptFromWordPressSiteMap(baseUrl, input, foreign));
});

test("lookup input rejects duplicate and foreign identities before transport", () => {
  assert.equal(WordPressSiteLookupSchema.safeParse(input).success, true);
  assert.equal(WordPressSiteLookupSchema.safeParse({ ...input, pages: [...input.pages, input.pages[0]] }).success, false);
  assert.equal(WordPressSiteLookupSchema.safeParse({ ...input, siteKey: "figma:Other123:root" }).success, false);
});

test("direct and server lookup use only read-only REST routes", async context => {
  const requests: string[] = [];
  context.mock.method(globalThis, "fetch", async (url, init) => {
    requests.push(String(url));
    assert.equal(init?.method, "POST");
    assert.equal(new URL(String(url)).search, "", "credentials stay out of URL");
    return Response.json(result());
  });
  await lookupWordPressSiteDirect(config, input);
  await lookupWordPressSite(config, input);
  await lookupWordPressSiteDirect({ ...config, connectorToken: `fp1.7.${"a".repeat(43)}` }, input);
  assert.deepEqual(requests, [`${baseUrl}/wp-json/figmapress/v1/sites/lookup`, `${baseUrl}/wp-json/figmapress/v1/sites/lookup`, `${baseUrl}/wp-json/figmapress/v1/paired/site-map`]);
});

test("all blocked paired lookup fallbacks stay read-only, never site-prepare", async context => {
  const requests: string[] = [];
  context.mock.method(globalThis, "fetch", async (url, init) => {
    requests.push(String(url));
    const form = new URLSearchParams(String(init?.body));
    assert.equal(form.get("action"), "figmapress_site_lookup");
    return requests.length < 3 ? new Response("Forbidden", { status: 403 }) : Response.json(result());
  });
  await lookupWordPressSite({ ...config, connectorToken: `fp1.7.${"a".repeat(43)}` }, input);
  assert.deepEqual(requests, [`${baseUrl}/wp-admin/admin-post.php`, `${baseUrl}/wp-admin/admin-ajax.php`, `${baseUrl}/wp-json/figmapress/v1/paired/site-map`]);
  assert.ok(requests.every(url => !url.includes("prepare")));
});
