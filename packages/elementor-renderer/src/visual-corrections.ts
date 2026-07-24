import type { ElementorElement, ElementorTemplate } from "./types";

export type VisualCorrectionVariant = "desktop" | "mobile";
export type VisualCorrectionConfidence = "high" | "medium";

export interface ElementorVisualCorrection {
  variant: VisualCorrectionVariant;
  offsetX: number;
  offsetY: number;
  captureWidth: number;
  confidence: VisualCorrectionConfidence;
  errorReductionRatio: number;
}

export interface AppliedElementorVisualCorrection
  extends ElementorVisualCorrection {
  translateX: string;
  translateY: string;
}

export interface ElementorSectionVisualCorrection
  extends ElementorVisualCorrection {
  nodeId: string;
  nodeName: string;
}

export interface AppliedElementorSectionVisualCorrection
  extends ElementorSectionVisualCorrection {
  translateX: string;
  translateY: string;
}

const MAX_CAPTURE_OFFSET = 16;
const MAX_SECTION_CAPTURE_OFFSET = 10;
const MIN_CAPTURE_WIDTH = 200;
const MAX_CAPTURE_WIDTH = 2_000;
const SAFE_NODE_ID = /^[A-Za-z0-9:_-]{1,160}$/;

function round(value: number, digits = 4): number {
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

function customSize(value: string): Record<string, unknown> {
  return { unit: "custom", size: value, sizes: [] };
}

function toViewportWidth(offset: number, captureWidth: number): string {
  if (Math.abs(offset) < 0.001) return "0px";
  return `${round((offset / captureWidth) * 100)}vw`;
}

function toViewportWidthNumber(offset: number, captureWidth: number): number {
  return round((offset / captureWidth) * 100);
}

export function normalizeElementorVisualCorrections(
  corrections: ElementorVisualCorrection[],
): AppliedElementorVisualCorrection[] {
  const byVariant = new Map<
    VisualCorrectionVariant,
    AppliedElementorVisualCorrection
  >();
  for (const correction of corrections) {
    if (
      !Number.isFinite(correction.offsetX)
      || !Number.isFinite(correction.offsetY)
      || !Number.isFinite(correction.captureWidth)
      || !Number.isFinite(correction.errorReductionRatio)
      || correction.captureWidth < MIN_CAPTURE_WIDTH
      || correction.captureWidth > MAX_CAPTURE_WIDTH
      || Math.abs(correction.offsetX) > MAX_CAPTURE_OFFSET
      || Math.abs(correction.offsetY) > MAX_CAPTURE_OFFSET
      || (Math.abs(correction.offsetX) < 0.001 && Math.abs(correction.offsetY) < 0.001)
      || correction.errorReductionRatio < 10
      || !["high", "medium"].includes(correction.confidence)
    ) {
      continue;
    }
    byVariant.set(correction.variant, {
      ...correction,
      offsetX: round(correction.offsetX),
      offsetY: round(correction.offsetY),
      captureWidth: Math.round(correction.captureWidth),
      errorReductionRatio: round(correction.errorReductionRatio, 1),
      translateX: toViewportWidth(correction.offsetX, correction.captureWidth),
      translateY: toViewportWidth(correction.offsetY, correction.captureWidth),
    });
  }
  return Array.from(byVariant.values());
}

export function normalizeElementorSectionVisualCorrections(
  corrections: ElementorSectionVisualCorrection[],
): AppliedElementorSectionVisualCorrection[] {
  const byTarget = new Map<string, AppliedElementorSectionVisualCorrection>();
  for (const correction of corrections) {
    if (
      !SAFE_NODE_ID.test(correction.nodeId)
      || !Number.isFinite(correction.offsetX)
      || !Number.isFinite(correction.offsetY)
      || !Number.isFinite(correction.captureWidth)
      || !Number.isFinite(correction.errorReductionRatio)
      || correction.captureWidth < MIN_CAPTURE_WIDTH
      || correction.captureWidth > MAX_CAPTURE_WIDTH
      || Math.abs(correction.offsetX) > MAX_SECTION_CAPTURE_OFFSET
      || Math.abs(correction.offsetY) > MAX_SECTION_CAPTURE_OFFSET
      || (Math.abs(correction.offsetX) < 0.001 && Math.abs(correction.offsetY) < 0.001)
      || correction.errorReductionRatio < 15
      || !["high", "medium"].includes(correction.confidence)
    ) {
      continue;
    }
    byTarget.set(`${correction.variant}:${correction.nodeId}`, {
      ...correction,
      nodeName: correction.nodeName.slice(0, 200),
      offsetX: round(correction.offsetX),
      offsetY: round(correction.offsetY),
      captureWidth: Math.round(correction.captureWidth),
      errorReductionRatio: round(correction.errorReductionRatio, 1),
      translateX: toViewportWidth(correction.offsetX, correction.captureWidth),
      translateY: toViewportWidth(correction.offsetY, correction.captureWidth),
    });
  }
  return Array.from(byTarget.values()).slice(0, 4);
}

function rootVariant(
  element: ElementorElement,
): VisualCorrectionVariant | "single" | null {
  const classes = String(element.settings.css_classes ?? "");
  if (classes.includes("figmapress-layout--mobile")) return "mobile";
  if (classes.includes("figmapress-layout--desktop")) return "desktop";
  if (classes.includes("figmapress-layout--single")) return "single";
  return null;
}

function translateElement(
  element: ElementorElement,
  correction: AppliedElementorVisualCorrection,
): ElementorElement {
  const translateX = round(
    numericSetting(element.settings.figmapress_visual_translate_x_vw)
      + toViewportWidthNumber(correction.offsetX, correction.captureWidth),
  );
  const translateY = round(
    numericSetting(element.settings.figmapress_visual_translate_y_vw)
      + toViewportWidthNumber(correction.offsetY, correction.captureWidth),
  );
  return {
    ...element,
    settings: {
      ...element.settings,
      _transform_translate_popover: "transform",
      _transform_translateX_effect: customSize(
        Math.abs(translateX) < 0.0001 ? "0px" : `${translateX}vw`,
      ),
      _transform_translateY_effect: customSize(
        Math.abs(translateY) < 0.0001 ? "0px" : `${translateY}vw`,
      ),
      figmapress_visual_translate_x_vw: translateX,
      figmapress_visual_translate_y_vw: translateY,
    },
  };
}

function numericSetting(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function translateElementLocally(
  element: ElementorElement,
  correction: AppliedElementorSectionVisualCorrection,
): ElementorElement {
  const translateX = round(
    numericSetting(element.settings.figmapress_visual_translate_x_vw)
      + toViewportWidthNumber(correction.offsetX, correction.captureWidth),
  );
  const translateY = round(
    numericSetting(element.settings.figmapress_visual_translate_y_vw)
      + toViewportWidthNumber(correction.offsetY, correction.captureWidth),
  );
  return {
    ...element,
    settings: {
      ...element.settings,
      _transform_translate_popover: "transform",
      _transform_translateX_effect: customSize(
        Math.abs(translateX) < 0.0001 ? "0px" : `${translateX}vw`,
      ),
      _transform_translateY_effect: customSize(
        Math.abs(translateY) < 0.0001 ? "0px" : `${translateY}vw`,
      ),
      figmapress_visual_translate_x_vw: translateX,
      figmapress_visual_translate_y_vw: translateY,
    },
  };
}

function applyCorrectionToTree(
  element: ElementorElement,
  correction: AppliedElementorSectionVisualCorrection,
): ElementorElement {
  const corrected =
    element.settings.figmapress_node_id === correction.nodeId
      ? translateElementLocally(element, correction)
      : element;
  if (!corrected.elements.length) return corrected;
  const elements = corrected.elements.map((child) =>
    applyCorrectionToTree(child, correction)
  );
  return elements.every((child, index) => child === corrected.elements[index])
    ? corrected
    : { ...corrected, elements };
}

export function applyElementorVisualCorrections(
  template: ElementorTemplate,
  corrections: ElementorVisualCorrection[],
): ElementorTemplate {
  const normalized = normalizeElementorVisualCorrections(corrections);
  if (!normalized.length) return template;
  const byVariant = new Map(
    normalized.map((correction) => [correction.variant, correction]),
  );

  return {
    ...template,
    page_settings: {
      ...template.page_settings,
      figmapress_visual_corrections: normalized,
    },
    content: template.content.map((root) => {
      const variant = rootVariant(root);
      const correction =
        variant === "mobile"
          ? byVariant.get("mobile")
          : variant === "desktop" || variant === "single"
            ? byVariant.get("desktop")
            : undefined;
      if (!correction) return root;
      return {
        ...root,
        elements: root.elements.map((element) =>
          translateElement(element, correction),
        ),
      };
    }),
  };
}

export function applyElementorSectionVisualCorrections(
  template: ElementorTemplate,
  corrections: ElementorSectionVisualCorrection[],
): ElementorTemplate {
  const normalized = normalizeElementorSectionVisualCorrections(corrections);
  if (!normalized.length) return template;

  return {
    ...template,
    page_settings: {
      ...template.page_settings,
      figmapress_section_visual_corrections: normalized,
    },
    content: template.content.map((root) => {
      const variant = rootVariant(root);
      const targetVariant =
        variant === "mobile"
          ? "mobile"
          : variant === "desktop" || variant === "single"
            ? "desktop"
            : null;
      if (!targetVariant) return root;
      return normalized
        .filter((correction) => correction.variant === targetVariant)
        .reduce(applyCorrectionToTree, root);
    }),
  };
}

function previewSelector(variant: VisualCorrectionVariant): string {
  return variant === "mobile"
    ? '.figmapress-figma-preview[data-figmapress-layout="mobile"]'
    : ':is(.figmapress-figma-preview[data-figmapress-layout="desktop"],.figmapress-figma-preview[data-figmapress-layout="single"])';
}

export function applyPreviewVisualCorrections(
  previewHtml: string,
  corrections: ElementorVisualCorrection[],
  channel: "primary" | "runtime" = "primary",
): string {
  const normalized = normalizeElementorVisualCorrections(corrections);
  if (!normalized.length) return previewHtml;
  const property = channel === "runtime"
    ? "--figmapress-qa-runtime-global-transform"
    : "--figmapress-qa-global-transform";
  const rules = normalized
    .map((correction) =>
      `${previewSelector(correction.variant)} > *{${property}:translate(${correction.translateX},${correction.translateY})!important}`,
    )
    .join("");
  return `<style data-figmapress-visual-corrections>${rules}</style>${previewHtml}`;
}

export function applyPreviewSectionVisualCorrections(
  previewHtml: string,
  corrections: ElementorSectionVisualCorrection[],
  channel: "primary" | "runtime" = "primary",
): string {
  const normalized = normalizeElementorSectionVisualCorrections(corrections);
  if (!normalized.length) return previewHtml;
  const property = channel === "runtime"
    ? "--figmapress-qa-runtime-local-transform"
    : "--figmapress-qa-local-transform";
  const rules = normalized
    .map((correction) =>
      `${previewSelector(correction.variant)} [data-figmapress-node-id="${correction.nodeId}"]{${property}:translate(${correction.translateX},${correction.translateY})!important}`,
    )
    .join("");
  return `<style data-figmapress-section-visual-corrections>${rules}</style>${previewHtml}`;
}
