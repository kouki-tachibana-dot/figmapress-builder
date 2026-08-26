import assert from "node:assert/strict";
import test from "node:test";
import {
  adaptElementorTemplateToNativeWidgets,
  figmaNodeHasAccordionPlan,
  type ElementorElement,
  type ElementorTemplate,
} from "@figmapress/elementor-renderer";
import type { FigmaNode } from "@figmapress/figma-parser";
import { auditNativeElementorTemplate } from "../apps/web/src/lib/elementor-native.ts";

function widget(
  id: string,
  widgetType: NonNullable<ElementorElement["widgetType"]>,
  settings: Record<string, unknown>,
): ElementorElement {
  return { id, elType: "widget", widgetType, isInner: false, settings, elements: [] };
}

function template(...content: ElementorElement[]): ElementorTemplate {
  return {
    title: "Pro native test",
    type: "page",
    version: "0.4",
    page_settings: { figmapress_native_layout: "yes" },
    content,
  };
}

const allCapabilities = {
  accordion: true,
  form: true,
  navMenu: true,
  imageCarousel: true,
};

test("generic Japanese fiscal-year group is recognized as an accordion", () => {
  const text = (id: string, value: string, y: number): FigmaNode => ({
    id,
    name: value,
    type: "TEXT",
    characters: value,
    absoluteBoundingBox: { x: 120, y, width: 180, height: 30 },
  });
  const node: FigmaNode = {
    id: "46:12",
    name: "Group 152",
    type: "GROUP",
    absoluteBoundingBox: { x: 100, y: 100, width: 900, height: 600 },
    children: [
      text("a", "令和7年度", 140),
      text("b", "令和6年度", 240),
      text("c", "令和5年度", 340),
      text("d", "令和4年度", 440),
      text("e", "令和3年度", 540),
    ],
  };
  assert.equal(figmaNodeHasAccordionPlan(node), true);
  assert.equal(figmaNodeHasAccordionPlan({
    ...node,
    id: "parent",
    name: "INVOICE FORMAT",
    children: [node],
  }), false);
});

test("fallback accordion becomes an editable Elementor Accordion widget", () => {
  const result = adaptElementorTemplateToNativeWidgets(template(widget(
    "a1234567",
    "figmapress-accordion",
    {
      items: [
        { _id: "one", title: "令和7年度", content: "請求書.pdf" },
        { _id: "two", title: "令和6年度", content: "" },
        { _id: "three", title: "令和5年度", content: "" },
      ],
      open_first: "yes",
      accent_color: "#c9002b",
    },
  )), { capabilities: allCapabilities });
  const accordion = result.content[0];
  assert.equal(accordion?.widgetType, "nested-accordion");
  assert.equal((accordion?.settings.items as unknown[])?.length, 3);
  assert.equal((accordion?.settings.items as Array<Record<string, unknown>>)[0]?.item_title, "令和7年度");
  assert.equal(accordion?.settings.default_state, "expanded");
  assert.equal(accordion?.settings.max_items_expended, "one");
  assert.equal(accordion?.elements.length, 3);
  assert.equal(accordion?.elements[0]?.elements[0]?.widgetType, "text-editor");
  assert.equal(accordion?.elements[0]?.elements[0]?.settings.editor, "請求書.pdf");
});

test("fallback form becomes Elementor Pro Form with Submissions enabled", () => {
  const result = adaptElementorTemplateToNativeWidgets(template(widget(
    "f1234567",
    "figmapress-contact-form",
    {
      title: "お問い合わせ",
      fields: [
        { _id: "name", name: "name", label: "お名前", type: "text", required: "yes" },
        { _id: "mail", name: "email", label: "メール", type: "email", required: "yes" },
        { _id: "privacy", name: "privacy", label: "同意", type: "checkbox", required: "yes" },
      ],
      button_text: "送信する",
    },
  )), { capabilities: allCapabilities });
  const form = result.content[0];
  const fields = form?.settings.form_fields as Array<Record<string, unknown>>;
  assert.equal(form?.widgetType, "form");
  assert.deepEqual(form?.settings.submit_actions, ["save-to-database"]);
  assert.equal(fields[0]?.custom_id, "name");
  assert.equal(fields[0]?.required, "true");
  assert.equal(fields[2]?.field_type, "acceptance");
  assert.equal("email_to" in (form?.settings ?? {}), false);
});

test("fallback navigation becomes a native Pro menu with logo and CTA", () => {
  const result = adaptElementorTemplateToNativeWidgets(template(widget(
    "n1234567",
    "figmapress-nav",
    {
      layout_variant: "desktop",
      logo: { url: "https://example.com/logo.png", id: "", source: "library" },
      home_url: { url: "https://example.com/" },
      cta_label: "お問い合わせ",
      cta_url: { url: "https://example.com/contact/" },
      design_geometry: JSON.stringify({
        logo: { x: 2, y: 10, width: 15, height: 70 },
        cta: { x: 82, y: 10, width: 16, height: 70 },
      }),
    },
  )), { capabilities: allCapabilities, menuId: 137 });
  const navigation = result.content[0];
  assert.equal(navigation?.elType, "container");
  assert.equal(navigation?.widgetType, undefined);
  assert.deepEqual(
    navigation?.elements.map((item) => item.widgetType),
    ["image", "nav-menu", "button"],
  );
  const menu = navigation?.elements.find((item) => item.widgetType === "nav-menu");
  assert.equal(menu?.settings.menu, "137");
});

test("unsupported destination keeps safe fallback widgets", () => {
  const source = template(widget("a1234567", "figmapress-accordion", { items: [] }));
  const result = adaptElementorTemplateToNativeWidgets(source, {
    capabilities: { accordion: false, form: false, navMenu: false },
  });
  assert.equal(result.content[0]?.widgetType, "figmapress-accordion");
});

test("native audit accepts Elementor nested accordion child containers", () => {
  const source = template({
    id: "c1234567",
    elType: "container",
    isInner: false,
    settings: { css_classes: "figmapress-layout--desktop" },
    elements: [
      widget("h1234567", "heading", { title: "請求書フォーマット" }),
      widget("a1234567", "figmapress-accordion", {
        items: [
          { title: "令和7年度", content: "請求書.pdf" },
          { title: "令和6年度", content: "" },
          { title: "令和5年度", content: "" },
        ],
      }),
    ],
  });
  const result = adaptElementorTemplateToNativeWidgets(source, {
    capabilities: allCapabilities,
  });
  assert.deepEqual(auditNativeElementorTemplate(result).errors, []);
});
