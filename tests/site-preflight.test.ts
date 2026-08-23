import assert from "node:assert/strict";
import test from "node:test";
import {
  figmaPageLinkPlaceholder,
  type ElementorTemplate,
  type FigmaMultiPagePlan,
  type FigmaSitePageKey,
} from "@figmapress/elementor-renderer";
import { inspectFigmaSiteTemplates } from "../apps/web/src/lib/site-preflight.ts";

const plan: FigmaMultiPagePlan = {
  title: "建工101",
  menuName: "建工101｜FigmaPress",
  pages: [
    { key: "home", title: "ホーム", slug: "home", hasDesktop: true, hasMobile: true, frameId: "1:1" },
    { key: "company", title: "会社案内", slug: "company", hasDesktop: true, hasMobile: true, frameId: "2:1" },
    { key: "contact", title: "お問い合わせ", slug: "contact", hasDesktop: true, hasMobile: true, frameId: "3:1" },
  ],
};

function exactTemplate(
  key: FigmaSitePageKey,
  destinations: FigmaSitePageKey[],
): ElementorTemplate {
  return {
    title: key,
    type: "page",
    version: "0.4",
    page_settings: { figmapress_exact_visual: "yes" },
    content: destinations.map((destination, index) => ({
      id: `${key}-${index}`,
      elType: "widget",
      widgetType: "figmapress-link",
      isInner: false,
      settings: {
        link_label: destination,
        link_url: { url: figmaPageLinkPlaceholder(destination) },
      },
      elements: [],
    })),
  };
}

test("all exact pages and every logical destination pass the preflight", () => {
  const templates = new Map<FigmaSitePageKey, ElementorTemplate>([
    ["home", exactTemplate("home", ["company", "contact"])],
    ["company", exactTemplate("company", ["home", "contact"])],
    ["contact", exactTemplate("contact", ["home", "company"])],
  ]);
  assert.deepEqual(inspectFigmaSiteTemplates(plan, templates), {
    pages: 3,
    exactPages: 3,
    links: 6,
    destinations: 3,
  });
});

test("a candidate page without its exact PC/SP template is rejected", () => {
  const templates = new Map<FigmaSitePageKey, ElementorTemplate>([
    ["home", exactTemplate("home", ["company", "contact"])],
    ["company", {
      ...exactTemplate("company", ["home", "contact"]),
      page_settings: {},
    }],
    ["contact", exactTemplate("contact", ["home", "company"])],
  ]);
  assert.throws(
    () => inspectFigmaSiteTemplates(plan, templates),
    /会社案内.*PC\/SP精密表示/,
  );
});

test("unknown and unreachable page destinations are rejected", () => {
  const unknown = new Map<FigmaSitePageKey, ElementorTemplate>([
    ["home", exactTemplate("home", ["company", "unknown"])],
    ["company", exactTemplate("company", ["home"])],
    ["contact", exactTemplate("contact", ["home"])],
  ]);
  assert.throws(
    () => inspectFigmaSiteTemplates(plan, unknown),
    /ホーム.*不明な移動先1/,
  );

  const unreachable = new Map<FigmaSitePageKey, ElementorTemplate>([
    ["home", exactTemplate("home", ["company"])],
    ["company", exactTemplate("company", ["home"])],
    ["contact", exactTemplate("contact", ["home", "company"])],
  ]);
  assert.throws(
    () => inspectFigmaSiteTemplates(plan, unreachable),
    /リンクされていないページ.*お問い合わせ/,
  );
});
