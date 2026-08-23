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
  navigationDestinations: FigmaSitePageKey[] = plan.pages.map((page) => page.key),
): ElementorTemplate {
  const navigation = (variant: "desktop" | "mobile") => ({
    id: `${key}-navigation-${variant}`,
    elType: "widget" as const,
    widgetType: "figmapress-nav",
    isInner: false,
    settings: {
      layout_variant: variant,
      items: navigationDestinations.map((destination, itemIndex) => ({
        _id: `${key}-${variant}-${itemIndex}`,
        label: destination,
        url: { url: figmaPageLinkPlaceholder(destination) },
      })),
    },
    elements: [],
  });
  return {
    title: key,
    type: "page",
    version: "0.4",
    page_settings: { figmapress_exact_visual: "yes" },
    content: [
      navigation("desktop"),
      navigation("mobile"),
      ...destinations.map((destination, index) => ({
        id: `${key}-${index}`,
        elType: "widget" as const,
        widgetType: "figmapress-link",
        isInner: false,
        settings: {
          link_label: destination,
          link_url: { url: figmaPageLinkPlaceholder(destination) },
        },
        elements: [],
      })),
      ...(key === "contact" ? [{
        id: `${key}-form`,
        elType: "widget" as const,
        widgetType: "figmapress-contact-form",
        isInner: false,
        settings: {},
        elements: [],
      }] : []),
    ],
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
    links: 24,
    destinations: 3,
    navigationPages: 3,
    navigationWidgets: 6,
    contactForms: 1,
    carousels: 0,
    accordions: 0,
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

test("unknown and incomplete menu destinations are rejected", () => {
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
    ["home", exactTemplate("home", ["company"], ["home", "company"])],
    ["company", exactTemplate("company", ["home"])],
    ["contact", exactTemplate("contact", ["home", "company"])],
  ]);
  assert.throws(
    () => inspectFigmaSiteTemplates(plan, unreachable),
    /ホーム.*メニューに移動先が不足.*お問い合わせ/,
  );
});

test("missing responsive navigation or the contact form is rejected", () => {
  const missingMobileNavigation = exactTemplate("home", ["company", "contact"]);
  missingMobileNavigation.content = missingMobileNavigation.content.filter(
    (element) => !(element.widgetType === "figmapress-nav"
      && element.settings.layout_variant === "mobile"),
  );
  assert.throws(
    () => inspectFigmaSiteTemplates(plan, new Map([
      ["home", missingMobileNavigation],
      ["company", exactTemplate("company", ["home", "contact"])],
      ["contact", exactTemplate("contact", ["home", "company"])],
    ])),
    /ホーム.*PC\/SP実動メニューが不足.*1\/2/,
  );

  const contactWithoutForm = exactTemplate("contact", ["home", "company"]);
  contactWithoutForm.content = contactWithoutForm.content.filter(
    (element) => element.widgetType !== "figmapress-contact-form",
  );
  assert.throws(
    () => inspectFigmaSiteTemplates(plan, new Map([
      ["home", exactTemplate("home", ["company", "contact"])],
      ["company", exactTemplate("company", ["home", "contact"])],
      ["contact", contactWithoutForm],
    ])),
    /お問い合わせ.*送信できるフォームがありません/,
  );
});
