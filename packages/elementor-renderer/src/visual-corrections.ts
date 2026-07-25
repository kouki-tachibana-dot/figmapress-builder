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

export interface ElementorTextGeometryCorrection
  extends ElementorVisualCorrection {
  nodeId: string;
  nodeName: string;
  scaleX: number;
  scaleY: number;
}

export interface AppliedElementorTextGeometryCorrection
  extends ElementorTextGeometryCorrection {
  translateX: string;
  translateY: string;
}

const MAX_CAPTURE_OFFSET = 16;
const MAX_SECTION_CAPTURE_OFFSET = 10;
const MAX_TEXT_CAPTURE_OFFSET = 6;
const MIN_TEXT_SCALE = 0.95;
const MAX_TEXT_SCALE = 1.05;
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

function numericSize(value: number): Record<string, unknown> {
  return { unit: "px", size: round(value, 4), sizes: [] };
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

export function normalizeElementorTextGeometryCorrections(
  corrections: ElementorTextGeometryCorrection[],
): AppliedElementorTextGeometryCorrection[] {
  const byTarget = new Map<string, AppliedElementorTextGeometryCorrection>();
  for (const correction of corrections) {
    if (
      !SAFE_NODE_ID.test(correction.nodeId)
      || !Number.isFinite(correction.offsetX)
      || !Number.isFinite(correction.offsetY)
      || !Number.isFinite(correction.scaleX)
      || !Number.isFinite(correction.scaleY)
      || !Number.isFinite(correction.captureWidth)
      || !Number.isFinite(correction.errorReductionRatio)
      || correction.captureWidth < MIN_CAPTURE_WIDTH
      || correction.captureWidth > MAX_CAPTURE_WIDTH
      || Math.abs(correction.offsetX) > MAX_TEXT_CAPTURE_OFFSET
      || Math.abs(correction.offsetY) > MAX_TEXT_CAPTURE_OFFSET
      || correction.scaleX < MIN_TEXT_SCALE
      || correction.scaleX > MAX_TEXT_SCALE
      || correction.scaleY < MIN_TEXT_SCALE
      || correction.scaleY > MAX_TEXT_SCALE
      || (
        Math.abs(correction.offsetX) < 0.001
        && Math.abs(correction.offsetY) < 0.001
        && Math.abs(correction.scaleX - 1) < 0.008
        && Math.abs(correction.scaleY - 1) < 0.008
      )
      || correction.errorReductionRatio < 18
      || !["high", "medium"].includes(correction.confidence)
    ) {
      continue;
    }
    byTarget.set(`${correction.variant}:${correction.nodeId}`, {
      ...correction,
      nodeName: correction.nodeName.slice(0, 200),
      offsetX: round(correction.offsetX),
      offsetY: round(correction.offsetY),
      scaleX: round(correction.scaleX, 3),
      scaleY: round(correction.scaleY, 3),
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

function scaleElementGeometry(
  element: ElementorElement,
  correction: AppliedElementorTextGeometryCorrection,
): ElementorElement {
  const translateX = round(
    numericSetting(element.settings.figmapress_visual_translate_x_vw)
      + toViewportWidthNumber(correction.offsetX, correction.captureWidth),
  );
  const translateY = round(
    numericSetting(element.settings.figmapress_visual_translate_y_vw)
      + toViewportWidthNumber(correction.offsetY, correction.captureWidth),
  );
  const scaleX = round(
    (numericScaleSetting(element.settings.figmapress_visual_scale_x) || 1)
      * correction.scaleX,
    4,
  );
  const scaleY = round(
    (numericScaleSetting(element.settings.figmapress_visual_scale_y) || 1)
      * correction.scaleY,
    4,
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
      _transform_scale_popover: "transform",
      _transform_keep_proportions: "",
      _transform_scaleX_effect: numericSize(scaleX),
      _transform_scaleY_effect: numericSize(scaleY),
      figmapress_visual_translate_x_vw: translateX,
      figmapress_visual_translate_y_vw: translateY,
      figmapress_visual_scale_x: scaleX,
      figmapress_visual_scale_y: scaleY,
    },
  };
}

function numericScaleSetting(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 1;
}

function applyTextGeometryCorrectionToTree(
  element: ElementorElement,
  correction: AppliedElementorTextGeometryCorrection,
): ElementorElement {
  const corrected =
    element.settings.figmapress_node_id === correction.nodeId
      ? scaleElementGeometry(element, correction)
      : element;
  if (!corrected.elements.length) return corrected;
  const elements = corrected.elements.map((child) =>
    applyTextGeometryCorrectionToTree(child, correction)
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

export function applyElementorTextGeometryCorrections(
  template: ElementorTemplate,
  corrections: ElementorTextGeometryCorrection[],
): ElementorTemplate {
  const normalized = normalizeElementorTextGeometryCorrections(corrections);
  if (!normalized.length) return template;

  return {
    ...template,
    page_settings: {
      ...template.page_settings,
      figmapress_text_geometry_corrections: normalized,
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
        .reduce(applyTextGeometryCorrectionToTree, root);
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

export function applyPreviewTextGeometryCorrections(
  previewHtml: string,
  corrections: ElementorTextGeometryCorrection[],
  channel: "primary" | "runtime" = "primary",
): string {
  const normalized = normalizeElementorTextGeometryCorrections(corrections);
  if (!normalized.length) return previewHtml;
  const property = channel === "runtime"
    ? "--figmapress-qa-runtime-geometry-transform"
    : "--figmapress-qa-geometry-transform";
  const rules = normalized
    .map((correction) =>
      `${previewSelector(correction.variant)} [data-figmapress-kind="text"][data-figmapress-node-id="${correction.nodeId}"]{${property}:translate(${correction.translateX},${correction.translateY}) scale(${correction.scaleX},${correction.scaleY})!important}`,
    )
    .join("");
  return `<style data-figmapress-text-geometry-corrections>${rules}</style>${previewHtml}`;
}
