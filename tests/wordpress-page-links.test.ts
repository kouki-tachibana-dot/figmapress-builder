import assert from "node:assert/strict";
import test from "node:test";
import { resolveWordPressPageLinks, type WordPressSiteReceipt } from "../apps/web/src/lib/wordpress-page-links";

const base = "https://wp.example/subsite";
const siteKey = "figma:example";
function receipt(): WordPressSiteReceipt {
  return { baseUrl: base, result: {
    siteKey, title: "Site", status: "draft", menu: null, warnings: [],
    pages: ["home", "company"].map((key, index) => ({
      key, id: index + 41, slug: key, title: key, status: "draft",
      sourceKey: key === "home" ? siteKey : `${siteKey}:page:${key}`,
      created: true, updated: false,
      rawLink: `${base}/${key}/`,
      previewLink: `${base}/?page_id=${index + 41}&preview=true`,
    })),
  } };
}

test("draft navigation uses acknowledged post IDs, not guessed slugs", () => {
  assert.deepEqual(resolveWordPressPageLinks(base, siteKey, ["home", "company"], receipt()), [
    { key: "home", rawLink: `${base}/?page_id=41&preview=true` },
    { key: "company", rawLink: `${base}/?page_id=42&preview=true` },
  ]);
});

test("missing registry, another site or another subdirectory cannot supply page links", () => {
  assert.throws(() => resolveWordPressPageLinks(base, siteKey, ["home"], null));
  assert.throws(() => resolveWordPressPageLinks(base, "figma:other", ["home"], receipt()));
  assert.throws(() => resolveWordPressPageLinks("https://wp.example/other", siteKey, ["home"], receipt()));
  assert.throws(() => resolveWordPressPageLinks(base, siteKey, ["contact"], receipt()));
});

test("rejects wrong post ID, published pages, duplicate IDs and foreign source keys", () => {
  for (const mutate of [
    (r: WordPressSiteReceipt) => { r.result.pages[0].previewLink = `${base}/?page_id=999&preview=true`; },
    (r: WordPressSiteReceipt) => { r.result.pages[0].status = "publish"; },
    (r: WordPressSiteReceipt) => { r.result.pages[1].id = 41; },
    (r: WordPressSiteReceipt) => { r.result.pages[0].sourceKey = "figma:other"; },
  ]) {
    const value = receipt(); mutate(value);
    assert.throws(() => resolveWordPressPageLinks(base, siteKey, ["home", "company"], value));
  }
});

test("rejects off-site, guessed, non-preview and ambiguous destination URLs", () => {
  for (const url of [
    "https://another.example/?page_id=41&preview=true", `${base}/home/`,
    `${base}/?page_id=41`, `${base}/?page_id=41&page_id=99&preview=true`,
    `${base}/?page_id=41&p=99&preview=true`,
    "https://wp.example/another/?page_id=41&preview=true",
    "javascript:alert(1)", "https://user:secret@wp.example/subsite/?page_id=41&preview=true",
  ]) {
    const value = receipt(); value.result.pages[0].previewLink = url;
    assert.throws(() => resolveWordPressPageLinks(base, siteKey, ["home"], value));
  }
});
