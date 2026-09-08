import assert from "node:assert/strict";
import test from "node:test";
import { WordPressSiteInputSchema } from "../apps/web/src/lib/wordpress-site-input";

const siteKey = "figma:PaNNOGcUo5Uyg5UrEsYeyd:root";
const keys = ["home", "company", "reasons", "services", "works", "demolition", "news", "contact", "officers"];
const input = (pageKeys = keys) => ({ siteKey, title: "建工101", menuName: "検証用",
  pages: pageKeys.map(key => ({ key, title: key, slug: key, sourceKey: key === "home" ? siteKey : `${siteKey}:page:${key}` })),
});

test("proxy accepts the same nine business pages and twenty-page maximum as Connector", () => {
  assert.equal(WordPressSiteInputSchema.safeParse(input()).success, true);
  const twenty = ["home", ...Array.from({ length: 19 }, (_, index) => `page-${index + 1}`)];
  assert.equal(WordPressSiteInputSchema.safeParse(input(twenty)).success, true);
  assert.equal(WordPressSiteInputSchema.safeParse(input([...twenty, "overflow"])).success, false);
});

test("proxy rejects duplicate keys and missing home before any WordPress write", () => {
  for (const pageKeys of [["home"], ["home", "home"], ["company", "contact"]]) {
    assert.equal(WordPressSiteInputSchema.safeParse(input(pageKeys)).success, false);
  }
});

test("proxy rejects foreign-site or mismatched page source identifiers", () => {
  for (const sourceKey of ["figma:OtherFile123:root:page:company", `${siteKey}:page:contact`, siteKey]) {
    const value = input();
    value.pages[1].sourceKey = sourceKey;
    assert.equal(WordPressSiteInputSchema.safeParse(value).success, false);
  }
});

test("proxy rejects unsafe page keys and unrecognized nested page fields", () => {
  assert.equal(WordPressSiteInputSchema.safeParse(input(["home", "../company"])).success, false);
  const value = input();
  Object.assign(value.pages[1], { status: "publish" });
  assert.equal(WordPressSiteInputSchema.safeParse(value).success, false);
});
