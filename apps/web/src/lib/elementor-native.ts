import type {
  ElementorElement,
  ElementorTemplate,
} from "@figmapress/elementor-renderer";
import type { ConversionOutput } from "./converter";
import type { FigmaVisualReferences } from "./figma-api";
import { cssColorIsPainted } from "./text-integrity";

const SUPPORTED_WIDGETS = new Set([
  "heading",
  "text-editor",
  "button",
  "image",
  "accordion",
  "nested-accordion",
  "form",
  "nav-menu",
  "image-carousel",
  "figmapress-nav",
  "figmapress-contact-form",
  "figmapress-accordion",
  "figmapress-carousel",
  "figmapress-link",
]);

export interface NativeElementorAudit {
  valid: boolean;
  errors: string[];
  containers: number;
  widgets: number;
  textWidgets: number;
  imageWidgets: number;
  nativeButtons: number;
  clickableContainers: number;
  structuredLinks: number;
  nestedLinkViolations: number;
  desktopRoots: number;
  mobileRoots: number;
}

function cssClasses(element: ElementorElement): string[] {
  return String(element.settings.css_classes ?? "")
    .split(/\s+/)
    .filter(Boolean);
}

function textContent(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.replace(/<[^>]*>/g, " ").replace(/&nbsp;/gi, " ").trim();
}

function elementOpacityIsPainted(value: unknown): boolean {
  if (typeof value === "number") return value > 0;
  if (!value || typeof value !== "object") return true;
  const size = (value as Record<string, unknown>).size;
  return typeof size !== "number" || size > 0;
}

function textWidgetIsPainted(element: ElementorElement): boolean {
  if (!elementOpacityIsPainted(element.settings.opacity)) return false;
  const textColor = element.settings.text_color ?? element.settings.title_color;
  return typeof textColor !== "string" || cssColorIsPainted(textColor);
}

const URL_CONTROL_KEYS = ["url", "is_external", "nofollow", "custom_attributes"] as const;

function urlControlForElement(element: ElementorElement): Record<string, unknown> | null {
  const candidate = element.elType === "container" && element.settings.html_tag === "a"
    ? element.settings.link
    : element.widgetType === "button" || element.widgetType === "image"
      ? element.settings.link
      : element.widgetType === "figmapress-link"
        ? element.settings.link_url
        : null;
  return candidate && typeof candidate === "object"
    ? candidate as Record<string, unknown>
    : null;
}

function structuredUrlControlForElement(element: ElementorElement): Record<string, unknown> | null {
  if (
    !(element.elType === "container" && element.settings.html_tag === "a")
    && element.widgetType !== "button"
    && element.widgetType !== "image"
  ) {
    return null;
  }
  return urlControlForElement(element);
}

function elementHasLink(element: ElementorElement): boolean {
  const control = urlControlForElement(element);
  if (typeof control?.url === "string" && control.url.trim()) return true;
  if (element.widgetType === "text-editor" && typeof element.settings.editor === "string") {
    return /<a\b[^>]*\bhref=["'][^"']+["']/i.test(element.settings.editor);
  }
  return false;
}

/**
 * Record that the document is rendered by Elementor itself. Figma screenshots
 * stay in the API response as QA references and are never inserted into the
 * Elementor content tree.
 */
export function markNativeElementorTemplate(
  template: ElementorTemplate,
  references: FigmaVisualReferences = {},
): ElementorTemplate {
  const pageSettings = { ...template.page_settings };
  delete pageSettings.figmapress_exact_visual;
  delete pageSettings.figmapress_exact_visual_version;
  return {
    ...template,
    page_settings: {
      ...pageSettings,
      figmapress_native_layout: "yes",
      figmapress_native_layout_version: "1",
      ...(references.desktop
        ? { figmapress_reference_desktop_node_id: references.desktop.nodeId }
        : {}),
      ...(references.mobile
        ? { figmapress_reference_mobile_node_id: references.mobile.nodeId }
        : {}),
    },
  };
}

export function applyNativeElementorPresentation(
  output: ConversionOutput,
  references: FigmaVisualReferences = {},
): ConversionOutput {
  return {
    ...output,
    elementorTemplate: markNativeElementorTemplate(
      output.elementorTemplate,
      references,
    ),
    warnings: [...new Set([
      ...output.warnings,
      "公開表示とElementor編集画面は、同じネイティブのコンテナ・文字・画像・機能ウィジェットから描画します。Figma画像は比較にだけ使用します。",
    ])],
  };
}

export function auditNativeElementorTemplate(
  template: ElementorTemplate,
): NativeElementorAudit {
  const errors: string[] = [];
  const ids = new Set<string>();
  let containers = 0;
  let widgets = 0;
  let textWidgets = 0;
  let imageWidgets = 0;
  let nativeButtons = 0;
  let clickableContainers = 0;
  let structuredLinks = 0;
  let nestedLinkViolations = 0;
  let desktopRoots = 0;
  let mobileRoots = 0;

  if (template.version !== "0.4") {
    errors.push("Elementorテンプレートのバージョンが0.4ではありません。");
  }
  if (template.page_settings.figmapress_native_layout !== "yes") {
    errors.push("Elementorネイティブ構造の識別情報がありません。");
  }
  if (template.page_settings.figmapress_exact_visual === "yes") {
    errors.push("旧式のFigma全画面画像モードが残っています。");
  }

  const visit = (
    elements: ElementorElement[],
    topLevel = false,
    linkedAncestorId = "",
  ): void => {
    for (const element of elements) {
      if (!element.id || ids.has(element.id)) {
        errors.push(
          element.id
            ? `Elementor要素ID「${element.id}」が重複しています。`
            : "Elementor要素IDが空です。",
        );
      } else {
        ids.add(element.id);
      }

      const classes = cssClasses(element);
      if (classes.some((className) => className.startsWith("figmapress-exact-"))) {
        errors.push(`全画面画像レイヤー「${element.id}」が残っています。`);
      }
      if (topLevel && element.elType !== "container") {
        errors.push(`最上位要素「${element.id}」がElementorコンテナではありません。`);
      }

      if (element.elType === "container") {
        containers += 1;
        if (element.widgetType) {
          errors.push(`コンテナ「${element.id}」にwidgetTypeが設定されています。`);
        }
        if (classes.includes("figmapress-layout--desktop")
          || classes.includes("figmapress-layout--single")) {
          desktopRoots += 1;
        }
        if (classes.includes("figmapress-layout--mobile")) mobileRoots += 1;
        if (element.settings.html_tag === "a") {
          clickableContainers += 1;
          const control = structuredUrlControlForElement(element);
          if (!control || typeof control.url !== "string" || !control.url.trim()) {
            errors.push(`クリック可能Container「${element.id}」のリンク先が空です。`);
          }
        }
      } else {
        widgets += 1;
        if (!element.widgetType || !SUPPORTED_WIDGETS.has(element.widgetType)) {
          errors.push(`未対応のElementorウィジェット「${element.widgetType ?? "なし"}」があります。`);
        }
        if (element.elements.length > 0 && element.widgetType !== "nested-accordion") {
          errors.push(`ウィジェット「${element.id}」に未対応の子要素があります。`);
        }
        if (element.widgetType === "text-editor" || element.widgetType === "heading") {
          const content = element.widgetType === "heading"
            ? textContent(element.settings.title)
            : textContent(element.settings.editor);
          if (!content) {
            errors.push(`文字ウィジェット「${element.id}」が空です。`);
          } else if (!textWidgetIsPainted(element)) {
            errors.push(`文字ウィジェット「${element.id}」が透明です。`);
          } else {
            textWidgets += 1;
          }
        }
        if (element.widgetType === "image") {
          const image = element.settings.image;
          const imageUrl = image && typeof image === "object"
            ? (image as Record<string, unknown>).url
            : "";
          if (typeof imageUrl !== "string" || !imageUrl.trim()) {
            errors.push(`画像ウィジェット「${element.id}」のURLが空です。`);
          } else {
            imageWidgets += 1;
          }
        }
        if (element.widgetType === "button") nativeButtons += 1;
      }

      const control = structuredUrlControlForElement(element);
      if (control && typeof control.url === "string" && control.url.trim()) {
        structuredLinks += 1;
        const missingKeys = URL_CONTROL_KEYS.filter((key) => !(key in control));
        if (missingKeys.length) {
          errors.push(
            `リンク「${element.id}」のElementor URL Controlに${missingKeys.join("・")}がありません。`,
          );
        }
      }
      const hasLink = elementHasLink(element);
      if (linkedAncestorId && hasLink) {
        nestedLinkViolations += 1;
        errors.push(
          `リンク「${element.id}」がクリック可能Container「${linkedAncestorId}」の内側に入っています。`,
        );
      }
      const nextLinkedAncestor = element.elType === "container"
        && element.settings.html_tag === "a"
        && hasLink
        ? element.id
        : linkedAncestorId;
      visit(element.elements, false, nextLinkedAncestor);
    }
  };
  visit(template.content, true);

  if (containers < 1) errors.push("Elementorコンテナがありません。");
  if (widgets < 1) errors.push("Elementorウィジェットがありません。");
  if (textWidgets < 1) errors.push("編集可能な実テキストがありません。");
  if (desktopRoots < 1) errors.push("PC用のElementorレイアウトがありません。");

  return {
    valid: errors.length === 0,
    errors: [...new Set(errors)],
    containers,
    widgets,
    textWidgets,
    imageWidgets,
    nativeButtons,
    clickableContainers,
    structuredLinks,
    nestedLinkViolations,
    desktopRoots,
    mobileRoots,
  };
}
