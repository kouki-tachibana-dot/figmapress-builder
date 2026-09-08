import type { ElementorElement, ElementorTemplate } from "@figmapress/elementor-renderer";

export interface UnlinkedElementorAction { elementId: string; label: string; kind: "download" }

function hasDestination(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const url = (value as Record<string, unknown>).url;
  return typeof url === "string" && /^(?:https?:\/\/|\/[^/]|#[a-z][\w:-]+)/i.test(url.trim());
}

function unlinkedCopy(html: string): string {
  return html
    .replace(/<h[1-6]\b[^>]*>[\s\S]*?<\/h[1-6]>/gi, "")
    .replace(/<a\b[^>]*\bhref\s*=\s*(["'])(https?:\/\/|\/[^/]|#[a-z])[\s\S]*?\1[^>]*>[\s\S]*?<\/a>/gi, "")
    .replace(/<[^>]*>/g, " ").replace(/&nbsp;|&#160;/gi, " ").replace(/\s+/g, " ").trim();
}

/** Detect high-confidence download intents without inventing missing assets. */
export function inspectUnlinkedElementorActions(template: ElementorTemplate): UnlinkedElementorAction[] {
  const issues: UnlinkedElementorAction[] = [];
  const record = (element: ElementorElement, value: unknown, button = false) => {
    if (typeof value !== "string") return;
    const label = unlinkedCopy(value);
    if (/(?:こちら.{0,16}ダウンロード|ダウンロード.{0,16}こちら|[\w\u3000-\u9fff].*\.pdf(?:\s|$))/i.test(label)
      || (button && /ダウンロード|\bdownload\b/i.test(label))) {
      issues.push({ elementId: element.id, label: label.slice(0, 160), kind: "download" });
    }
  };
  const visit = (elements: ElementorElement[], parentLinked = false) => {
    for (const element of elements) {
      const supportsLink = element.widgetType === "button" || element.widgetType === "image"
        || (element.elType === "container" && element.settings.html_tag === "a");
      const linked = parentLinked || (supportsLink && hasDestination(element.settings.link));
      if (!linked) {
        if (element.widgetType === "text-editor") record(element, element.settings.editor);
        if (element.widgetType === "button") record(element, element.settings.text, true);
        if (element.widgetType === "figmapress-accordion" || element.widgetType === "accordion") {
          const entries = element.settings.items ?? element.settings.tabs;
          if (Array.isArray(entries)) for (const entry of entries) {
            if (entry && typeof entry === "object") record(element, entry.content ?? entry.tab_content);
          }
        }
      }
      visit(element.elements, linked);
    }
  };
  visit(template.content);
  return issues;
}

export function assertElementorActionsConnected(template: ElementorTemplate): void {
  const issues = inspectUnlinkedElementorActions(template);
  if (issues.length) throw new Error(`資料ダウンロードが${issues.length}件未接続です（${issues.slice(0, 3).map(issue => `${issue.label} [${issue.elementId}]`).join("／")}）。Figmaに正式URLを設定するか資料を提供してください。未接続のまま保存しません。`);
}
