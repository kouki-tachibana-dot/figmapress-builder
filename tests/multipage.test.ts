import assert from "node:assert/strict";
import test from "node:test";
import type { FigmaNode, MockFigmaFile } from "@figmapress/figma-parser";
import {
  createFigmaMultiPagePlan,
  createFigmaSitePageTemplate,
  auditElementorTemplateLinks,
  figmaPageLinkPlaceholder,
  rewriteElementorTemplatePageLinks,
  type ElementorElement,
} from "@figmapress/elementor-renderer";

function text(id: string, name: string, characters: string, x: number, y: number): FigmaNode {
  return {
    id,
    name,
    type: "TEXT",
    characters,
    absoluteBoundingBox: { x, y, width: 180, height: 30 },
    style: { fontSize: 18, fontWeight: 600 },
  };
}

function root(id: string, name: string, width: number, suffix: string): FigmaNode {
  return {
    id,
    name,
    type: "FRAME",
    absoluteBoundingBox: { x: 0, y: 0, width, height: 2200 },
    children: [
      {
        id: `${id}:header`,
        name: "Header/Header Section",
        type: "FRAME",
        absoluteBoundingBox: { x: 0, y: 0, width, height: 120 },
        children: [
          text(`${id}:menu:1`, "Header/Menu-Item", "政策", width * 0.5, 40),
          text(`${id}:menu:2`, "Header/Menu-Item", "プロフィール", width * 0.7, 40),
        ],
      },
      {
        id: `${id}:policies`,
        name: "Sec/Policies Section",
        type: "FRAME",
        absoluteBoundingBox: { x: 0, y: 420, width, height: 620 },
        children: [text(`${id}:policies:title`, "Heading", `政策${suffix}`, 40, 470)],
      },
      {
        id: `${id}:profile`,
        name: "Sec/Profile Section",
        type: "FRAME",
        absoluteBoundingBox: { x: 0, y: 1120, width, height: 620 },
        children: [text(`${id}:profile:title`, "Heading", `プロフィール${suffix}`, 40, 1170)],
      },
      {
        id: `${id}:footer`,
        name: "Footer/Footer Section",
        type: "FRAME",
        absoluteBoundingBox: { x: 0, y: 1900, width, height: 300 },
        children: [text(`${id}:footer:text`, "Footer text", "Copyright", 40, 1960)],
      },
    ],
  };
}

const file: MockFigmaFile = {
  document: {
    id: "0:0",
    name: "Multi page test",
    type: "DOCUMENT",
    children: [{
      id: "1:0",
      name: "Page",
      type: "CANVAS",
      children: [
        root("10:0", "PC-page", 1920, "PC"),
        root("20:0", "SP-page", 440, "SP"),
      ],
    }],
  },
};

function flatten(elements: ElementorElement[]): ElementorElement[] {
  return elements.flatMap((element) => [element, ...flatten(element.elements)]);
}

test("multi-page plan detects semantic desktop and mobile pages", () => {
  const plan = createFigmaMultiPagePlan(file, "竹内きよ子様", "/");
  assert.deepEqual(plan.pages.map((page) => page.key), ["home", "policies", "profile"]);
  assert.equal(plan.pages[0]?.slug, "home");
  assert.equal(plan.pages[1]?.hasDesktop, true);
  assert.equal(plan.pages[1]?.hasMobile, true);
  assert.equal(plan.menuName, "竹内きよ子様｜FigmaPress");
});

test("section page keeps responsive header, target section, and footer only", () => {
  const page = createFigmaMultiPagePlan(file, "竹内きよ子様").pages
    .find((candidate) => candidate.key === "policies");
  assert.ok(page);
  const template = createFigmaSitePageTemplate(file, page);
  assert.equal(template.content.length, 2);
  const elements = flatten(template.content);
  assert.ok(elements.some((element) => element.widgetType === "figmapress-nav"));
  assert.ok(elements.some((element) => element.settings._element_id === "policies-desktop"));
  assert.ok(elements.some((element) => element.settings._element_id === "policies-mobile"));
  assert.equal(elements.some((element) => element.settings._element_id === "profile-desktop"), false);
  assert.equal(elements.some((element) => element.settings.figmapress_node_name === "Footer/Footer Section"), true);
});

test("page-link rewrite connects desktop, mobile, CTA, and text links to WordPress URLs", () => {
  const page = createFigmaMultiPagePlan(file, "竹内きよ子様").pages
    .find((candidate) => candidate.key === "policies");
  assert.ok(page);
  const template = createFigmaSitePageTemplate(file, page);
  const linked = rewriteElementorTemplatePageLinks(template, [
    { key: "home", rawLink: "https://example.com/home/" },
    { key: "policies", rawLink: "https://example.com/seisaku/" },
    { key: "profile", rawLink: "https://example.com/profile/" },
  ]);
  const navigations = flatten(linked.content)
    .filter((element) => element.widgetType === "figmapress-nav");
  assert.equal(navigations.length, 2);
  for (const navigation of navigations) {
    const items = navigation.settings.items as Array<{ label: string; url: { url: string } }>;
    assert.equal(items.find((item) => item.label === "政策")?.url.url, "https://example.com/seisaku/");
    assert.equal(items.find((item) => item.label === "プロフィール")?.url.url, "https://example.com/profile/");
    assert.equal((navigation.settings.home_url as { url: string }).url, "https://example.com/home/");
  }
  assert.notDeepEqual(linked, template);
});

test("arbitrary Figma page keys and prototype placeholders rewrite idempotently", () => {
  const template = createFigmaSitePageTemplate(
    file,
    createFigmaMultiPagePlan(file, "竹内きよ子様").pages[0],
  );
  template.content.push({
    id: "custom1",
    elType: "widget",
    widgetType: "figmapress-link",
    isInner: false,
    settings: {
      link_label: "採用情報",
      link_url: { url: figmaPageLinkPlaceholder("recruit-2027") },
    },
    elements: [],
  });
  const pageLinks = [
    { key: "home", rawLink: "https://example.com/home/" },
    { key: "policies", rawLink: "https://example.com/seisaku/" },
    { key: "profile", rawLink: "https://example.com/profile/" },
    { key: "contact", rawLink: "https://example.com/contact/" },
    { key: "recruit-2027", rawLink: "https://example.com/recruit-2027/" },
  ];
  const once = rewriteElementorTemplatePageLinks(template, pageLinks);
  const twice = rewriteElementorTemplatePageLinks(once, pageLinks);
  assert.deepEqual(twice, once);
  const custom = flatten(once.content).find((element) => element.id === "custom1");
  assert.equal(
    (custom?.settings.link_url as { url: string }).url,
    "https://example.com/recruit-2027/",
  );
  const audit = auditElementorTemplateLinks(once, pageLinks);
  assert.equal(audit.valid, true);
  assert.equal(audit.unresolvedPlaceholders.length, 0);
  assert.ok(audit.pageLinks >= 1);
});

test("link audit rejects unresolved, missing, and unsafe destinations", () => {
  const template = {
    title: "Broken links",
    type: "page" as const,
    version: "0.4" as const,
    page_settings: {},
    content: [{
    id: "broken1",
    elType: "widget",
    widgetType: "figmapress-link",
    isInner: false,
    settings: { link_url: { url: figmaPageLinkPlaceholder("unknown") } },
    elements: [],
  }, {
    id: "broken2",
    elType: "widget",
    widgetType: "button",
    isInner: false,
    settings: { link: { url: "javascript:alert(1)" } },
    elements: [],
  }, {
    id: "broken3",
    elType: "widget",
    widgetType: "figmapress-link",
    isInner: false,
    settings: { link_url: { url: "#not-created" } },
    elements: [],
    }],
  };
  const audit = auditElementorTemplateLinks(template);
  assert.equal(audit.valid, false);
  assert.deepEqual(audit.unresolvedPlaceholders, ["#figmapress-page-unknown"]);
  assert.deepEqual(audit.missingAnchors, ["not-created"]);
  assert.deepEqual(audit.unsafe, ["javascript:alert(1)"]);
});
