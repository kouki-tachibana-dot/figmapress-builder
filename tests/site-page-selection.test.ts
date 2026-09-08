import assert from "node:assert/strict";
import test from "node:test";
import type { FigmaMultiPagePlan } from "@figmapress/elementor-renderer";
import { assertSitePageBatch, selectFigmaSitePages } from "../apps/web/src/lib/site-page-selection";

const plan: FigmaMultiPagePlan = { title: "建工101", menuName: "検証用", pages:
  ["home", "company", "reasons", "services", "works", "demolition", "news", "contact", "officers", "company-2", "contact-2"]
    .map((key, index) => ({ key, title: key, slug: key, frameId: `${index + 1}:1`, hasDesktop: true, hasMobile: true })) };

test("explicit selection excludes old designs without renaming or reordering source keys", () => {
  const keys = plan.pages.slice(0, 9).map(page => page.key).reverse();
  const selected = selectFigmaSitePages(plan, keys);
  assert.deepEqual(selected.pages, plan.pages.slice(0, 9));
  assert.equal(selected.pages.length, 9);
  assert.equal(plan.pages.length, 11);
  selected.pages[0].title = "edited";
  assert.equal(plan.pages[0].title, "home");
});

test("unconfirmed, unknown, duplicate and shared-frame selections are rejected", () => {
  for (const keys of [[], ["home"], ["home", "unknown"], ["home", "home"], ["company", "contact"]]) {
    assert.throws(() => selectFigmaSitePages(plan, keys));
  }
  assert.throws(() => selectFigmaSitePages({ ...plan, pages: [plan.pages[0], plan.pages[0]] }, ["home", "company"]));
  assert.throws(() => selectFigmaSitePages({ ...plan, pages: [plan.pages[0], { ...plan.pages[1], frameId: "1:1" }] }, ["home", "company"]));
});

test("page batches must match the frozen frame, slug, label and all device variants", () => {
  const selected = selectFigmaSitePages(plan, ["home", "company"]);
  assert.doesNotThrow(() => assertSitePageBatch(selected, [selected.pages[1]]));
  for (const patch of [{ key: "company-2" }, { frameId: "99:1" }, { slug: "old-company" }, { title: "old" }, { hasMobile: false }, { hasTablet: true }]) {
    assert.throws(() => assertSitePageBatch(selected, [{ ...selected.pages[1], ...patch }]));
  }
  assert.throws(() => assertSitePageBatch(selected, []));
  assert.throws(() => assertSitePageBatch(selected, [selected.pages[0], selected.pages[0]]));
  assert.throws(() => assertSitePageBatch(selected, [plan.pages[9]]));
});
