import assert from "node:assert/strict";
import test from "node:test";
import {
  adaptElementorTemplateToNativeWidgets,
  FigmaElementorExporter,
  figmaNodeHasAccordionPlan,
  type ElementorElement,
  type ElementorTemplate,
} from "@figmapress/elementor-renderer";
import type { FigmaNode, MockFigmaFile } from "@figmapress/figma-parser";
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

test("fiscal-year columns do not depend on editable Figma layer names", () => {
  const year = (id: string, value: string, x: number, y: number): FigmaNode => ({
    id,
    name: value,
    type: "TEXT",
    characters: value,
    absoluteBoundingBox: { x, y, width: 150, height: 28 },
  });
  const arbitraryFrame: FigmaNode = {
    id: "company-desktop",
    name: "Desktop 1440 / Section 06",
    type: "FRAME",
    absoluteBoundingBox: { x: 0, y: 0, width: 1440, height: 900 },
    children: [
      year("y7", "令和7年度", 280, 180),
      year("y6", "令和6年度", 280, 300),
      year("y5", "令和5年度", 280, 420),
      year("y4", "令和4年度", 280, 540),
      year("y3", "令和3年度", 280, 660),
    ],
  };
  assert.equal(figmaNodeHasAccordionPlan(arbitraryFrame), true);
  assert.equal(figmaNodeHasAccordionPlan({
    ...arbitraryFrame,
    id: "horizontal-history",
    children: [
      year("h7", "令和7年度", 100, 300),
      year("h6", "令和6年度", 540, 300),
      year("h5", "令和5年度", 980, 300),
    ],
  }), false);
});

test("a fiscal-year column on the responsive root becomes a native accordion", () => {
  const year = (id: string, value: string, y: number): FigmaNode => ({
    id,
    name: value,
    type: "TEXT",
    characters: value,
    absoluteBoundingBox: { x: 280, y, width: 160, height: 30 },
  });
  const file: MockFigmaFile = {
    name: "Company",
    document: {
      id: "document",
      name: "Document",
      type: "DOCUMENT",
      children: [{
        id: "canvas",
        name: "Page 02",
        type: "CANVAS",
        children: [{
          id: "desktop",
          name: "Desktop 1440 / Company",
          type: "FRAME",
          absoluteBoundingBox: { x: 0, y: 0, width: 1440, height: 1000 },
          children: [
            year("y7", "令和7年度", 180),
            year("y6", "令和6年度", 300),
            year("y5", "令和5年度", 420),
            year("y4", "令和4年度", 540),
            year("y3", "令和3年度", 660),
            {
              id: "pdf",
              name: "Invoice PDF",
              type: "TEXT",
              characters: "令和7年度 ご請求書フォーマット.pdf",
              absoluteBoundingBox: { x: 500, y: 220, width: 360, height: 30 },
            },
          ],
        }],
      }],
    },
  };
  const fallback = new FigmaElementorExporter().toTemplate(file, "Company");
  const result = adaptElementorTemplateToNativeWidgets(fallback, {
    capabilities: allCapabilities,
  });
  const widgets: ElementorElement[] = [];
  const visit = (elements: ElementorElement[]): void => {
    for (const element of elements) {
      if (element.elType === "widget") widgets.push(element);
      visit(element.elements);
    }
  };
  visit(result.content);
  const accordion = widgets.find((widget) => widget.widgetType === "nested-accordion");
  assert.ok(accordion);
  assert.equal((accordion.settings.items as unknown[]).length, 5);
  assert.equal(accordion.elements.length, 5);
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
  assert.match(String(form?.settings.css_classes), /figmapress-native-form/);
  assert.match(String(form?.settings._css_classes), /figmapress-native-form/);
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
  assert.equal(navigation?.settings.html_tag, "header");
  assert.match(String(menu?.settings.css_classes), /figmapress-native-nav-menu/);
  assert.match(String(menu?.settings._css_classes), /figmapress-native-nav-menu/);
});

test("mobile native menu expands the Figma icon to a centered 44px touch target", () => {
  const result = adaptElementorTemplateToNativeWidgets(template(widget(
    "n7654321",
    "figmapress-nav",
    {
      layout_variant: "mobile",
      design_geometry: JSON.stringify({
        root: { width: 440, height: 100 },
        toggle: { x: 91, y: 18, width: 4, height: 20 },
      }),
    },
  )), { capabilities: allCapabilities, menuId: 137 });
  const menu = result.content[0]?.elements.find((item) => item.widgetType === "nav-menu");
  assert.deepEqual(menu?.settings._element_custom_width, { unit: "%", size: 10, sizes: [] });
  assert.deepEqual(menu?.settings._offset_x, { unit: "%", size: 88, sizes: [] });
  assert.deepEqual(menu?.settings.min_height, { unit: "%", size: 44, sizes: [] });
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
