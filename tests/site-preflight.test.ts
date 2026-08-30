import assert from "node:assert/strict";
import test from "node:test";
import {
  figmaPageLinkPlaceholder,
  type ElementorTemplate,
  type FigmaMultiPagePlan,
  type FigmaSitePageKey,
} from "@figmapress/elementor-renderer";
import {
  FigmaSitePlaceholderError,
  inspectFigmaSiteTemplates,
} from "../apps/web/src/lib/site-preflight.ts";

const plan: FigmaMultiPagePlan = {
  title: "建工101",
  menuName: "建工101｜FigmaPress",
  pages: [
    { key: "home", title: "ホーム", slug: "home", hasDesktop: true, hasMobile: true, frameId: "1:1" },
    { key: "company", title: "会社案内", slug: "company", hasDesktop: true, hasMobile: true, frameId: "2:1" },
    { key: "contact", title: "お問い合わせ", slug: "contact", hasDesktop: true, hasMobile: true, frameId: "3:1" },
  ],
};

function nativeTemplate(
  key: FigmaSitePageKey,
  destinations: FigmaSitePageKey[],
  navigationDestinations: FigmaSitePageKey[] = plan.pages.map((page) => page.key),
): ElementorTemplate {
  const navigation = (variant: "desktop" | "mobile") => ({
    id: `${key}-navigation-${variant}`,
    elType: "widget" as const,
    widgetType: "figmapress-nav" as const,
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
  const heading = (variant: "desktop" | "mobile") => ({
    id: `${key}-heading-${variant}`,
    elType: "widget" as const,
    widgetType: "text-editor" as const,
    isInner: false,
    settings: { editor: `<h1>${key}</h1>` },
    elements: [],
  });
  const footer = (variant: "desktop" | "mobile") => ({
    id: `${key}-footer-${variant}`,
    elType: "container" as const,
    isInner: true,
    settings: { html_tag: "footer" },
    elements: [],
  });
  return {
    title: key,
    type: "page",
    version: "0.4",
    page_settings: {
      figmapress_native_layout: "yes",
      figmapress_native_layout_version: "1",
      figmapress_reference_desktop_node_id: `${key}:desktop`,
      figmapress_reference_mobile_node_id: `${key}:mobile`,
    },
    content: [
      {
        id: `${key}-desktop-root`,
        elType: "container",
        isInner: false,
        settings: { css_classes: "figmapress-layout figmapress-layout--desktop", html_tag: "main" },
        elements: [
          navigation("desktop"),
          heading("desktop"),
          ...destinations.map((destination, index) => ({
            id: `${key}-link-${index}`,
            elType: "widget" as const,
            widgetType: "figmapress-link" as const,
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
            widgetType: "figmapress-contact-form" as const,
            isInner: false,
            settings: {},
            elements: [],
          }] : []),
          footer("desktop"),
        ],
      },
      {
        id: `${key}-mobile-root`,
        elType: "container",
        isInner: false,
        settings: { css_classes: "figmapress-layout figmapress-layout--mobile", html_tag: "main" },
        elements: [navigation("mobile"), heading("mobile"), footer("mobile")],
      },
    ],
  };
}

test("all native pages and every logical destination pass the preflight", () => {
  const templates = new Map<FigmaSitePageKey, ElementorTemplate>([
    ["home", nativeTemplate("home", ["company", "contact"])],
    ["company", nativeTemplate("company", ["home", "contact"])],
    ["contact", nativeTemplate("contact", ["home", "company"])],
  ]);
  assert.deepEqual(inspectFigmaSiteTemplates(plan, templates), {
    pages: 3,
    nativePages: 3,
    containers: 12,
    widgets: 19,
    textWidgets: 6,
    imageWidgets: 0,
    nativeButtons: 0,
    clickableContainers: 0,
    structuredLinks: 0,
    semanticMains: 6,
    semanticHeaders: 6,
    semanticFooters: 6,
    h1Headings: 6,
    placeholderTextWidgets: 0,
    links: 24,
    destinations: 3,
    navigationPages: 3,
    navigationWidgets: 6,
    contactForms: 1,
    carousels: 0,
    accordions: 0,
  });
});

test("placeholder copy blocks the entire site before WordPress receives it", () => {
  const home = nativeTemplate("home", ["company", "contact"]);
  const heading = home.content[0]?.elements.find(
    (element) => element.id === "home-heading-desktop",
  );
  if (heading) heading.settings.editor = "<h1>SampleSampleSample</h1>";

  assert.throws(
    () => inspectFigmaSiteTemplates(plan, new Map([
      ["home", home],
      ["company", nativeTemplate("company", ["home", "contact"])],
      ["contact", nativeTemplate("contact", ["home", "company"])],
    ])),
    (error) => error instanceof FigmaSitePlaceholderError
      && /ホーム.*仮テキスト.*WordPressには送信しません/.test(error.message),
  );
});

test("each responsive layout requires exactly one H1", () => {
  const company = nativeTemplate("company", ["home", "contact"]);
  const mobileHeading = company.content[1]?.elements.find(
    (element) => element.id === "company-heading-mobile",
  );
  if (mobileHeading) mobileHeading.settings.editor = "<div>会社案内</div>";

  assert.throws(
    () => inspectFigmaSiteTemplates(plan, new Map([
      ["home", nativeTemplate("home", ["company", "contact"])],
      ["company", company],
      ["contact", nativeTemplate("contact", ["home", "company"])],
    ])),
    /会社案内.*スマホ版のH1は1つ必要.*現在0/,
  );
});

test("a candidate page without its native Elementor marker is rejected", () => {
  const templates = new Map<FigmaSitePageKey, ElementorTemplate>([
    ["home", nativeTemplate("home", ["company", "contact"])],
    ["company", {
      ...nativeTemplate("company", ["home", "contact"]),
      page_settings: {},
    }],
    ["contact", nativeTemplate("contact", ["home", "company"])],
  ]);
  assert.throws(
    () => inspectFigmaSiteTemplates(plan, templates),
    /会社案内.*Elementorネイティブ構造/,
  );
});

test("unknown and incomplete menu destinations are rejected", () => {
  const unknown = new Map<FigmaSitePageKey, ElementorTemplate>([
    ["home", nativeTemplate("home", ["company", "unknown"])],
    ["company", nativeTemplate("company", ["home"])],
    ["contact", nativeTemplate("contact", ["home"])],
  ]);
  assert.throws(
    () => inspectFigmaSiteTemplates(plan, unknown),
    /ホーム.*不明な移動先1/,
  );

  const unreachable = new Map<FigmaSitePageKey, ElementorTemplate>([
    ["home", nativeTemplate("home", ["company"], ["home", "company"])],
    ["company", nativeTemplate("company", ["home"])],
    ["contact", nativeTemplate("contact", ["home", "company"])],
  ]);
  assert.throws(
    () => inspectFigmaSiteTemplates(plan, unreachable),
    /ホーム.*メニューに移動先が不足.*お問い合わせ/,
  );
});

test("a duplicated semantic label cannot hide a wrong menu or CTA destination", () => {
  const home = nativeTemplate("home", ["company", "contact"]);
  home.content[0]?.elements.push({
    id: "stale-contact-wire",
    elType: "widget",
    widgetType: "figmapress-link",
    isInner: false,
    settings: {
      link_label: "お問い合わせ ▷",
      link_url: { url: figmaPageLinkPlaceholder("home") },
    },
    elements: [],
  });
  assert.throws(
    () => inspectFigmaSiteTemplates(plan, new Map([
      ["home", home],
      ["company", nativeTemplate("company", ["home", "contact"])],
      ["contact", nativeTemplate("contact", ["home", "company"])],
    ])),
    /ホーム.*リンク名と移動先が一致しません.*お問い合わせ.*figmapress-page-home.*figmapress-page-contact/,
  );
});

test("missing responsive navigation or the contact form is rejected", () => {
  const missingMobileNavigation = nativeTemplate("home", ["company", "contact"]);
  const mobileRoot = missingMobileNavigation.content[1];
  if (mobileRoot) mobileRoot.elements = mobileRoot.elements.filter(
    (element) => !(element.widgetType === "figmapress-nav"
      && element.settings.layout_variant === "mobile"),
  );
  assert.throws(
    () => inspectFigmaSiteTemplates(plan, new Map([
      ["home", missingMobileNavigation],
      ["company", nativeTemplate("company", ["home", "contact"])],
      ["contact", nativeTemplate("contact", ["home", "company"])],
    ])),
    /ホーム.*スマホ版に実動メニュー相当のheaderがありません/,
  );

  const contactWithoutForm = nativeTemplate("contact", ["home", "company"]);
  const contactDesktop = contactWithoutForm.content[0];
  if (contactDesktop) contactDesktop.elements = contactDesktop.elements.filter(
    (element) => element.widgetType !== "figmapress-contact-form",
  );
  assert.throws(
    () => inspectFigmaSiteTemplates(plan, new Map([
      ["home", nativeTemplate("home", ["company", "contact"])],
      ["company", nativeTemplate("company", ["home", "contact"])],
      ["contact", contactWithoutForm],
    ])),
    /お問い合わせ.*送信できるフォームがありません/,
  );
});
