import assert from "node:assert/strict";
import test from "node:test";
import {
  createCandidateFigmaMultiPagePlan,
  createCandidatePageLinkTargets,
} from "../apps/web/src/lib/figma-site-plan";
import type { FigmaPageCandidate } from "../apps/web/src/lib/figma-frame-selection";

function paired(id: number, title: string): FigmaPageCandidate {
  return {
    id: `${id}:1`,
    title,
    confidence: "content",
    desktop: {
      id: `${id}:1`,
      name: `PC ${title}`,
      label: title,
      width: 1440,
      height: 4000,
      variant: "desktop",
    },
    mobile: {
      id: `${id}:2`,
      name: `SP ${title}`,
      label: title,
      width: 440,
      height: 3200,
      variant: "mobile",
    },
  };
}

test("candidate page pairs become a stable business-site plan", () => {
  const candidates = [
    paired(10, "1からはじまる信頼の道"),
    paired(20, "会社案内"),
    paired(30, "選ばれる理由"),
    paired(40, "事業内容"),
    paired(50, "施工事例"),
    paired(60, "解体工事"),
    paired(70, "お知らせ"),
    paired(80, "お問い合わせ"),
    paired(90, "役員一覧"),
  ];
  const plan = createCandidateFigmaMultiPagePlan(candidates, "10:1", "株式会社建工101");
  assert.ok(plan);
  assert.deepEqual(plan.pages.map((page) => page.key), [
    "home",
    "company",
    "reasons",
    "services",
    "works",
    "demolition",
    "news",
    "contact",
    "officers",
  ]);
  assert.equal(plan.pages[0]?.title, "ホーム");
  assert.equal(plan.pages[1]?.frameId, "20:1");
  assert.equal(plan.pages.every((page) => page.hasDesktop && page.hasMobile), true);
});

test("previewing contact never replaces the stable Figma home page", () => {
  const candidates = [
    paired(10, "1からはじまる信頼の道"),
    paired(20, "会社案内"),
    paired(30, "お問い合わせ"),
  ];
  const plan = createCandidateFigmaMultiPagePlan(candidates, "30:2", "株式会社建工101");
  assert.ok(plan);
  assert.deepEqual(plan.pages.map((page) => page.key), ["home", "company", "contact"]);
  assert.deepEqual(plan.pages.map((page) => page.frameId), ["10:1", "20:1", "30:1"]);
  assert.deepEqual(plan.pages.map((page) => page.title), ["ホーム", "会社案内", "お問い合わせ"]);
});

test("unpaired component scraps are excluded when complete page pairs exist", () => {
  const candidates: FigmaPageCandidate[] = [
    paired(10, "ホーム"),
    paired(20, "会社案内"),
    {
      id: "30:1",
      title: "提案力",
      confidence: "single",
      desktop: {
        id: "30:1",
        name: "提案力",
        label: "提案力",
        width: 1440,
        height: 900,
        variant: "desktop",
      },
    },
  ];
  const plan = createCandidateFigmaMultiPagePlan(candidates, "10:1", "建工101");
  assert.deepEqual(plan?.pages.map((page) => page.key), ["home", "company"]);
});

test("prototype destinations keep stable logical links for every PC and SP frame", () => {
  const candidates = [
    paired(10, "ホーム"),
    paired(20, "会社案内"),
    paired(30, "お問い合わせ"),
  ];
  const plan = createCandidateFigmaMultiPagePlan(candidates, "10:2", "建工101");
  const targets = createCandidatePageLinkTargets(candidates, plan);
  assert.equal(targets["10:1"], "#figmapress-page-home");
  assert.equal(targets["10:2"], "#figmapress-page-home");
  assert.equal(targets["20:1"], "#figmapress-page-company");
  assert.equal(targets["20:2"], "#figmapress-page-company");
  assert.equal(targets["30:1"], "#figmapress-page-contact");
  assert.equal(targets["30:2"], "#figmapress-page-contact");
});
