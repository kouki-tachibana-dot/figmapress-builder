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

const MAX_CAPTURE_OFFSET = 16;
const MIN_CAPTURE_WIDTH = 200;
const MAX_CAPTURE_WIDTH = 2_000;

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
  return {
    ...element,
    settings: {
      ...element.settings,
      _transform_translate_popover: "transform",
      _transform_translateX_effect: customSize(correction.translateX),
      _transform_translateY_effect: customSize(correction.translateY),
    },
  };
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

function previewSelector(variant: VisualCorrectionVariant): string {
  return variant === "mobile"
    ? '.figmapress-figma-preview[data-figmapress-layout="mobile"]'
    : ':is(.figmapress-figma-preview[data-figmapress-layout="desktop"],.figmapress-figma-preview[data-figmapress-layout="single"])';
}

export function applyPreviewVisualCorrections(
  previewHtml: string,
  corrections: ElementorVisualCorrection[],
): string {
  const normalized = normalizeElementorVisualCorrections(corrections);
  if (!normalized.length) return previewHtml;
  const rules = normalized
    .map((correction) =>
      `${previewSelector(correction.variant)} > *{--figmapress-qa-transform:translate(${correction.translateX},${correction.translateY})!important}`,
    )
    .join("");
  return `<style data-figmapress-visual-corrections>${rules}</style>${previewHtml}`;
}
