import assert from "node:assert/strict";
import test from "node:test";
import type { ElementorTemplate, ElementorElement } from "@figmapress/elementor-renderer";
import { assertElementorActionsConnected, inspectUnlinkedElementorActions } from "../apps/web/src/lib/elementor-actions";

const widget = (editor: string): ElementorElement => ({ id: "pdf", elType: "widget", isInner: false, widgetType: "text-editor", settings: { editor }, elements: [] });
const template = (element: ElementorElement): ElementorTemplate => ({ title: "test", type: "page", version: "0.4", page_settings: {}, content: [element] });

test("detects unlinked download CTAs and invoice files but ignores section headings", () => {
  for (const text of ["Web資料のダウンロードはこちら", "こちらからダウンロード", "令和7年度 ご請求書フォーマット.pdf"]) {
    const result = template(widget(text));
    assert.equal(inspectUnlinkedElementorActions(result).length, 1);
    assert.throws(() => assertElementorActionsConnected(result), /未接続/);
  }
  assert.deepEqual(inspectUnlinkedElementorActions(template(widget("<h2>資料ダウンロード</h2><p>資料についてのご案内です。</p>"))), []);
});

test("links must be attached to the action, not another item in the same widget", () => {
  const html = '<a href="https://files.example/one.pdf">one.pdf</a> two.pdf';
  assert.equal(inspectUnlinkedElementorActions(template(widget(html))).length, 1);
  assert.deepEqual(inspectUnlinkedElementorActions(template(widget('<a href="https://files.example/one.pdf">one.pdf</a>'))), []);
  assert.equal(inspectUnlinkedElementorActions(template(widget('<a href="#">one.pdf</a>'))).length, 1);
});

test("native button and clickable container destinations count as connected", () => {
  const button: ElementorElement = { ...widget(""), widgetType: "button", settings: { text: "ダウンロード" } };
  assert.equal(inspectUnlinkedElementorActions(template(button)).length, 1);
  button.settings.link = { url: "https://files.example/document.pdf" };
  assert.deepEqual(inspectUnlinkedElementorActions(template(button)), []);
  const container: ElementorElement = { id: "container", elType: "container", isInner: false, settings: { html_tag: "a", link: { url: "https://files.example/invoice.pdf" } }, elements: [widget("請求書.pdf")] };
  assert.deepEqual(inspectUnlinkedElementorActions(template(container)), []);
});

test("detects missing files in both fallback and native accordion content", () => {
  const accordion: ElementorElement = { ...widget(""), widgetType: "figmapress-accordion", settings: { items: [{ content: "請求書.pdf" }] } };
  assert.equal(inspectUnlinkedElementorActions(template(accordion)).length, 1);
  const native: ElementorElement = { ...accordion, widgetType: "nested-accordion", settings: {}, elements: [widget("請求書.pdf")] };
  assert.equal(inspectUnlinkedElementorActions(template(native)).length, 1);
});
