import assert from "node:assert/strict";
import test from "node:test";
import type { FigmaMultiPagePlan } from "@figmapress/elementor-renderer";
import {
  expectedSiteVisualQaChecks,
  resolveSiteVisualQaGate,
} from "../apps/web/src/lib/site-visual-qa.ts";

const plan: FigmaMultiPagePlan = {
  title: "建工101",
  menuName: "建工101｜FigmaPress",
  pages: [
    { key: "home", title: "ホーム", slug: "home", hasDesktop: true, hasMobile: true },
    { key: "company", title: "会社案内", slug: "company", hasDesktop: true, hasMobile: true },
  ],
};

test("site visual QA expects every desktop and mobile page", () => {
  assert.deepEqual(expectedSiteVisualQaChecks(plan), [
    { pageKey: "home", variant: "desktop" },
    { pageKey: "home", variant: "mobile" },
    { pageKey: "company", variant: "desktop" },
    { pageKey: "company", variant: "mobile" },
  ]);
});

test("site visual QA clears only when all screens pass 99.9 gate", () => {
  const clear = resolveSiteVisualQaGate(plan, [
    { pageKey: "home", variant: "desktop", status: "pass", score: 100 },
    { pageKey: "home", variant: "mobile", status: "pass", score: 99.9 },
    { pageKey: "company", variant: "desktop", status: "pass", score: 99.95 },
    { pageKey: "company", variant: "mobile", status: "pass", score: 99.91 },
  ]);
  assert.equal(clear.blocked, false);
  assert.equal(clear.complete, true);
  assert.equal(clear.passed, 4);
  assert.equal(clear.worstScore, 99.9);

  const incomplete = resolveSiteVisualQaGate(plan, [
    { pageKey: "home", variant: "desktop", status: "pass", score: 100 },
  ]);
  assert.equal(incomplete.blocked, true);
  assert.equal(incomplete.missing.length, 3);

  const failed = resolveSiteVisualQaGate(plan, [
    { pageKey: "home", variant: "desktop", status: "pass", score: 100 },
    { pageKey: "home", variant: "mobile", status: "review", score: 99.8 },
    { pageKey: "company", variant: "desktop", status: "pass", score: 100 },
    { pageKey: "company", variant: "mobile", status: "pass", score: 100 },
  ]);
  assert.equal(failed.blocked, true);
  assert.equal(failed.failures.length, 1);
  assert.equal(failed.worstScore, 99.8);
});

test("site visual QA adds a tablet screen only when the page has a tablet source", () => {
  const responsivePlan: FigmaMultiPagePlan = {
    ...plan,
    pages: plan.pages.map((page, index) => ({
      ...page,
      hasTablet: index === 0,
    })),
  };
  assert.deepEqual(expectedSiteVisualQaChecks(responsivePlan), [
    { pageKey: "home", variant: "desktop" },
    { pageKey: "home", variant: "tablet" },
    { pageKey: "home", variant: "mobile" },
    { pageKey: "company", variant: "desktop" },
    { pageKey: "company", variant: "mobile" },
  ]);
});
