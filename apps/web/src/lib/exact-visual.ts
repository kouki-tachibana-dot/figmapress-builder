import type { ElementorElement, ElementorSettings } from "@figmapress/elementor-renderer";
import type { ConversionOutput } from "./converter";
import type { FigmaVisualReference, FigmaVisualReferences } from "./figma-api";

function escapeAttribute(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function appendClass(settings: ElementorSettings, className: string): ElementorSettings {
  const classes = String(settings.css_classes ?? "")
    .split(/\s+/)
    .filter(Boolean);
  if (!classes.includes(className)) classes.push(className);
  return { ...settings, css_classes: classes.join(" ") };
}

function exactPreviewRoot(
  reference: FigmaVisualReference,
  variant: "desktop" | "mobile",
): string {
  const modifier = variant === "mobile"
    ? " figmapress-figma-preview--mobile"
    : " figmapress-figma-preview--desktop";
  return `<div class="figmapress-figma-preview figmapress-exact-preview${modifier}" data-figmapress-layout="${variant}" style="aspect-ratio:${reference.width}/${reference.height};background:#fff"><img alt="" aria-hidden="true" data-figmapress-kind="visual" data-figmapress-exact-snapshot="true" data-figmapress-reference-node-id="${escapeAttribute(reference.nodeId)}" src="${escapeAttribute(reference.url)}" style="display:block;height:100%;object-fit:fill;width:100%" /></div>`;
}

function exactImageWidget(
  reference: FigmaVisualReference,
  variant: "desktop" | "mobile",
): ElementorElement {
  return {
    id: variant === "desktop" ? "fxdimg1" : "fxmimg1",
    elType: "widget",
    widgetType: "image",
    isInner: false,
    settings: {
      figmapress_node_id: `exact-${variant}-${reference.nodeId.replace(/[^A-Za-z0-9:_-]/g, "")}`,
      figmapress_node_name: `${reference.name} / exact ${variant}`,
      css_classes: "figmapress-exact-image",
      image: {
        url: reference.url,
        id: "",
        alt: `${reference.name} ${variant === "mobile" ? "スマホ" : "PC"}精密表示`,
        source: "library",
        figmapress_key: `exact:${reference.nodeId}:${variant}`,
      },
      image_size: "full",
      space: { unit: "%", size: 100, sizes: [] },
      _element_width: "initial",
      _element_custom_width: { unit: "%", size: 100, sizes: [] },
      _element_custom_width_tablet: { unit: "%", size: 100, sizes: [] },
      _element_custom_width_mobile: { unit: "%", size: 100, sizes: [] },
    },
    elements: [],
  };
}

function exactElementorRoot(
  reference: FigmaVisualReference,
  variant: "desktop" | "mobile",
): ElementorElement {
  return {
    id: variant === "desktop" ? "fxdesk1" : "fxmobi1",
    elType: "container",
    isInner: true,
    settings: {
      css_classes: `figmapress-exact-layout figmapress-exact-layout--${variant}`,
      figmapress_node_id: `exact-${variant}-${reference.nodeId.replace(/[^A-Za-z0-9:_-]/g, "")}`,
      figmapress_node_name: `${reference.name} / exact ${variant}`,
      figmapress_section: "yes",
      content_width: "full",
      width: { unit: "%", size: 100, sizes: [] },
      flex_direction: "column",
      flex_gap: { unit: "px", size: 0, sizes: [] },
      padding: {
        unit: "px",
        top: "0",
        right: "0",
        bottom: "0",
        left: "0",
        isLinked: true,
      },
      ...(variant === "desktop"
        ? { hide_mobile: "hidden-mobile" }
        : {
            hide_desktop: "hidden-desktop",
            hide_tablet: "hidden-tablet",
          }),
    },
    elements: [exactImageWidget(reference, variant)],
  };
}

/**
 * Add a pixel-locked public presentation while retaining the complete native
 * Elementor tree as an overlaid editing and interaction layer. The Connector
 * stylesheet reveals the native tree inside Elementor and keeps it transparent
 * on the public page, so links/widgets remain operable without duplicating the
 * Figma artwork visually.
 */
export function applyExactVisualPresentation(
  output: ConversionOutput,
  references: FigmaVisualReferences,
): ConversionOutput {
  const available = ([
    ["desktop", references.desktop],
    ["mobile", references.mobile],
  ] as const).filter(
    (entry): entry is readonly ["desktop" | "mobile", FigmaVisualReference] =>
      Boolean(entry[1]),
  );
  if (!available.length || !output.qualityReport) return output;

  const nativePreview = output.previewHtml;
  const exactPreview = available
    .map(([variant, reference]) => exactPreviewRoot(reference, variant))
    .join("");
  const nativeContent = output.elementorTemplate.content.map((element) => ({
    ...element,
    settings: appendClass(element.settings, "figmapress-native-layout"),
  }));
  const exactContent = available.map(([variant, reference]) =>
    exactElementorRoot(reference, variant)
  );

  return {
    ...output,
    previewHtml: `<div class="figmapress-exact-stack">${exactPreview}<div class="figmapress-exact-interaction-layer">${nativePreview}</div></div>`,
    elementorTemplate: {
      ...output.elementorTemplate,
      page_settings: {
        ...output.elementorTemplate.page_settings,
        figmapress_exact_visual: "yes",
        figmapress_exact_visual_version: "1",
      },
      content: [{
        id: "fxstack",
        elType: "container",
        isInner: false,
        settings: {
          css_classes: "figmapress-exact-stack",
          content_width: "full",
          width: { unit: "%", size: 100, sizes: [] },
          flex_direction: "column",
          flex_gap: { unit: "px", size: 0, sizes: [] },
          padding: {
            unit: "px",
            top: "0",
            right: "0",
            bottom: "0",
            left: "0",
            isLinked: true,
          },
          overflow: "hidden",
        },
        elements: [...exactContent, ...nativeContent],
      }],
    },
    warnings: [...new Set([
      ...output.warnings,
      "公開表示はFigma原本の精密表示レイヤーを使用し、Elementor編集画面には編集可能なネイティブ構造を保持します。",
    ])],
  };
}
