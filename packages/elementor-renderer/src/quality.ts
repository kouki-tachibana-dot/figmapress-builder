import type {
  FigmaNode,
  MockFigmaFile,
} from "@figmapress/figma-parser";
import { findFigmaResponsiveRoots } from "./figma-exporter";
import type { FigmaRenderAssets } from "./figma-exporter";
import type {
  ElementorElement,
  ElementorTemplate,
} from "./types";

export type QualityCheckStatus = "pass" | "info" | "warning";

export interface FigmaQualityCheck {
  id:
    | "structure"
    | "editable-text"
    | "typography"
    | "images"
    | "gradients"
    | "effects"
    | "auto-layout"
    | "responsive"
    | "interactions";
  label: string;
  status: QualityCheckStatus;
  detail: string;
}

export interface FigmaQualityReport {
  version: "1.0";
  score: number;
  grade: "A" | "B" | "C";
  readyForDraft: boolean;
  metrics: {
    responsiveVariants: 1 | 2;
    visibleNodes: number;
    boundedNodes: number;
    editableTextNodes: number;
    autoLayoutFrames: number;
    mappedAutoLayoutFrames: number;
    absoluteLayoutNodes: number;
    typography: {
      horizontalTextNodes: number;
      wrappingTextNodes: number;
      explicitLineBreakTextNodes: number;
      mixedStyleTextNodes: number;
      truncatedTextNodes: number;
    };
    images: {
      visible: number;
      mapped: number;
      exactRendered: number;
      nativeFit: number;
      adjusted: number;
      masks: number;
    };
    gradients: {
      visible: number;
      mapped: number;
      multiStop: number;
    };
    effects: {
      visible: number;
      mapped: number;
      opacityNodes: number;
      shadowEffects: number;
      blurEffects: number;
      multiShadowNodes: number;
    };
    functionalWidgets: {
      navigation: number;
      links: number;
      carousel: number;
      contactForm: number;
      accordion: number;
    };
  };
  checks: FigmaQualityCheck[];
}

export function createFigmaQualityReport(
  file: MockFigmaFile,
  template: ElementorTemplate,
  assets: FigmaRenderAssets = {},
): FigmaQualityReport {
  const roots = findFigmaResponsiveRoots(file);
  const designRoots = [roots.desktop, roots.mobile].filter((node): node is FigmaNode => Boolean(node));
  const entries = designRoots.flatMap((root) => flatten(root));
  const visibleEntries = entries.filter(({ node }) => node.visible !== false);
  const boundedEntries = visibleEntries.filter(({ node }) => validBounds(node));
  const visibleNodes = visibleEntries.map(({ node }) => node);
  const boundedNodes = boundedEntries.map(({ node }) => node);
  const unboundedNodes = visibleNodes.length - boundedNodes.length;
  const editableTextNodes = boundedNodes.filter((node) =>
    node.type === "TEXT" && typeof node.characters === "string",
  );
  const typography = {
    horizontalTextNodes: editableTextNodes.length,
    wrappingTextNodes: editableTextNodes.filter((node) =>
      node.textAutoResize === "HEIGHT"
      || node.textAutoResize === "NONE"
      || node.textAutoResize === "TRUNCATE",
    ).length,
    explicitLineBreakTextNodes: editableTextNodes.filter((node) =>
      node.characters?.includes("\n"),
    ).length,
    mixedStyleTextNodes: editableTextNodes.filter((node) =>
      Boolean(node.characterStyleOverrides?.length && node.styleOverrideTable),
    ).length,
    truncatedTextNodes: editableTextNodes.filter((node) =>
      node.textAutoResize === "TRUNCATE",
    ).length,
  };
  const renderedIds = new Set(Object.keys(assets.renderedNodeUrls ?? {}));
  const imageEntries = designRoots.flatMap((root) =>
    collectImageEntries(root, renderedIds, assets.imageUrls ?? {})
  );
  const images = {
    visible: imageEntries.length,
    mapped: imageEntries.filter((entry) => entry.mapped).length,
    exactRendered: imageEntries.filter((entry) => entry.exactRendered).length,
    nativeFit: imageEntries.filter((entry) => entry.mapped && !entry.exactRendered).length,
    adjusted: imageEntries.filter((entry) => adjustedImagePaint(entry.paint)).length,
    masks: boundedNodes.filter((node) =>
      node.isMask || /(?:^|\s)mask(?:\s|$)/i.test(node.name)
    ).length,
  };
  const autoLayoutFrames = boundedNodes.filter(isAutoLayout).length;
  const gradientNodes = boundedNodes.filter(hasVisibleGradient);
  const mappedGradientNodes = gradientNodes.filter(hasMappedGradient);
  const gradients = {
    visible: gradientNodes.length,
    mapped: mappedGradientNodes.length,
    multiStop: mappedGradientNodes.filter((node) =>
      (node.fills?.find((paint) =>
        paint.visible !== false && paint.type.toUpperCase().startsWith("GRADIENT_")
      )?.gradientStops?.length ?? 0) > 2,
    ).length,
  };
  const visibleEffectEntries = boundedNodes.flatMap((node) => visualEffectEntries(node));
  const mappedEffectEntries = visibleEffectEntries.filter((entry) => entry.mapped);
  const effects = {
    visible: visibleEffectEntries.length,
    mapped: mappedEffectEntries.length,
    opacityNodes: visibleEffectEntries.filter((entry) => entry.type === "opacity").length,
    shadowEffects: visibleEffectEntries.filter((entry) => entry.type === "shadow").length,
    blurEffects: visibleEffectEntries.filter((entry) => entry.type === "blur").length,
    multiShadowNodes: boundedNodes.filter((node) =>
      (node.effects?.filter((effect) =>
        effect.visible !== false
        && (effect.type === "DROP_SHADOW" || effect.type === "INNER_SHADOW")
      ).length ?? 0) > 1,
    ).length,
  };
  const absoluteLayoutNodes = boundedEntries.filter(({ node, parent }) =>
    node !== roots.desktop
    && node !== roots.mobile
    && !isAutoLayout(parent),
  ).length;
  const functionalWidgets = countFunctionalWidgets(template.content);
  const functionalWidgetTotal =
    functionalWidgets.navigation
    + functionalWidgets.links
    + functionalWidgets.carousel
    + functionalWidgets.contactForm
    + functionalWidgets.accordion;
  const boundedRatio = visibleNodes.length > 0 ? boundedNodes.length / visibleNodes.length : 0;
  const gradientRatio = gradients.visible > 0 ? gradients.mapped / gradients.visible : 1;
  const effectRatio = effects.visible > 0 ? effects.mapped / effects.visible : 1;
  const score = Math.max(
    0,
    Math.min(100, Math.round(60 + boundedRatio * 25 + gradientRatio * 8 + effectRatio * 7)),
  );
  const checks: FigmaQualityCheck[] = [
    {
      id: "structure",
      label: "レイヤー構造",
      status: unboundedNodes === 0 ? "pass" : "warning",
      detail: unboundedNodes === 0
        ? `${boundedNodes.length}レイヤーの座標を取得済み`
        : `${unboundedNodes}レイヤーは座標がなく変換対象外`,
    },
    {
      id: "editable-text",
      label: "編集可能テキスト",
      status: editableTextNodes.length > 0 ? "pass" : "info",
      detail: editableTextNodes.length > 0
        ? `${editableTextNodes.length}テキストをElementor上で編集可能`
        : "編集可能なテキストレイヤーはありません",
    },
    {
      id: "typography",
      label: "文字配置",
      status: editableTextNodes.length > 0 ? "pass" : "info",
      detail: editableTextNodes.length > 0
        ? `横書き${typography.horizontalTextNodes}・折返し${typography.wrappingTextNodes}・明示改行${typography.explicitLineBreakTextNodes}・混在スタイル${typography.mixedStyleTextNodes}を保持`
        : "文字配置の変換対象はありません",
    },
    {
      id: "images",
      label: "画像・マスク",
      status: images.visible === 0
        ? "info"
        : images.mapped === images.visible ? "pass" : "warning",
      detail: images.visible === 0
        ? "画像の変換対象はありません"
        : images.mapped === images.visible
          ? `${images.mapped}画像を再現（正確な切り抜き${images.exactRendered}・標準フィット${images.nativeFit}・マスク${images.masks}）`
          : `${images.visible - images.mapped}画像は切り抜き・フィルターの正確な描画を取得できませんでした`,
    },
    {
      id: "gradients",
      label: "グラデーション",
      status: gradients.visible === 0
        ? "info"
        : gradients.mapped === gradients.visible ? "pass" : "warning",
      detail: gradients.visible === 0
        ? "グラデーションの変換対象はありません"
        : gradients.mapped === gradients.visible
          ? `${gradients.mapped}グラデーションを再現（複数色${gradients.multiStop}）`
          : `${gradients.visible - gradients.mapped}グラデーションは未対応形式`,
    },
    {
      id: "effects",
      label: "透明度・影・ぼかし",
      status: effects.visible === 0
        ? "info"
        : effects.mapped === effects.visible ? "pass" : "warning",
      detail: effects.visible === 0
        ? "効果の変換対象はありません"
        : effects.mapped === effects.visible
          ? `${effects.mapped}効果を再現（透明度${effects.opacityNodes}・影${effects.shadowEffects}・ぼかし${effects.blurEffects}）`
          : `${effects.visible - effects.mapped}効果は未対応形式`,
    },
    {
      id: "auto-layout",
      label: "Auto Layout",
      status: autoLayoutFrames > 0 ? "pass" : "info",
      detail: autoLayoutFrames > 0
        ? `${autoLayoutFrames}フレームをFlexboxへ変換`
        : "このデザインは絶対配置を主体に変換",
    },
    {
      id: "responsive",
      label: "レスポンシブ",
      status: roots.mobile ? "pass" : "info",
      detail: roots.mobile
        ? "PC版・スマホ版を端末別に統合"
        : "単一レイアウトとして変換",
    },
    {
      id: "interactions",
      label: "実動パーツ",
      status: functionalWidgetTotal > 0 ? "pass" : "info",
      detail: functionalWidgetTotal > 0
        ? `メニュー${functionalWidgets.navigation}・リンク${functionalWidgets.links}・カルーセル${functionalWidgets.carousel}・フォーム${functionalWidgets.contactForm}・アコーディオン${functionalWidgets.accordion}`
        : "自動認識できる実動パーツはありません",
    },
  ];

  return {
    version: "1.0",
    score,
    grade: score >= 95 ? "A" : score >= 85 ? "B" : "C",
    readyForDraft: checks.every((check) => check.status !== "warning"),
    metrics: {
      responsiveVariants: roots.mobile ? 2 : 1,
      visibleNodes: visibleNodes.length,
      boundedNodes: boundedNodes.length,
      editableTextNodes: editableTextNodes.length,
      autoLayoutFrames,
      mappedAutoLayoutFrames: autoLayoutFrames,
      absoluteLayoutNodes,
      typography,
      images,
      gradients,
      effects,
      functionalWidgets,
    },
    checks,
  };
}

function flatten(root: FigmaNode): Array<{ node: FigmaNode; parent: FigmaNode | null }> {
  const result: Array<{ node: FigmaNode; parent: FigmaNode | null }> = [];
  const visit = (node: FigmaNode, parent: FigmaNode | null): void => {
    result.push({ node, parent });
    for (const child of node.children ?? []) visit(child, node);
  };
  visit(root, null);
  return result;
}

function validBounds(node: FigmaNode): boolean {
  const bounds = node.absoluteBoundingBox;
  return Boolean(bounds && bounds.width > 0 && bounds.height > 0);
}

interface ImageQualityEntry {
  paint: NonNullable<FigmaNode["fills"]>[number];
  exactRendered: boolean;
  mapped: boolean;
}

function collectImageEntries(
  root: FigmaNode,
  renderedIds: Set<string>,
  imageUrls: Record<string, string>,
): ImageQualityEntry[] {
  const result: ImageQualityEntry[] = [];
  const visit = (node: FigmaNode, renderedAncestor: boolean): void => {
    if (node.visible === false) return;
    const exactRendered = renderedAncestor || renderedIds.has(node.id);
    for (const paint of node.fills ?? []) {
      if (paint.visible === false || paint.type !== "IMAGE") continue;
      const hasNativeImage = Boolean(paint.imageRef && imageUrls[paint.imageRef]);
      result.push({
        paint,
        exactRendered,
        mapped: exactRendered || (hasNativeImage && nativeImageFitSupported(paint)),
      });
    }
    for (const child of node.children ?? []) visit(child, exactRendered);
  };
  visit(root, false);
  return result;
}

function adjustedImagePaint(paint: NonNullable<FigmaNode["fills"]>[number]): boolean {
  const filters = Object.values(paint.filters ?? {}).some((value) =>
    typeof value === "number" && Math.abs(value) > 0.0001
  );
  return paint.scaleMode === "STRETCH"
    || paint.scaleMode === "TILE"
    || Boolean(paint.imageTransform)
    || Boolean(paint.rotation)
    || filters;
}

function nativeImageFitSupported(paint: NonNullable<FigmaNode["fills"]>[number]): boolean {
  if (adjustedImagePaint(paint)) return false;
  const mode = paint.scaleMode?.toUpperCase();
  return !mode || mode === "FILL" || mode === "FIT";
}

function isAutoLayout(node: FigmaNode | null): boolean {
  return node?.layoutMode === "HORIZONTAL" || node?.layoutMode === "VERTICAL";
}

function hasVisibleGradient(node: FigmaNode): boolean {
  return node.fills?.some((paint) =>
    paint.visible !== false && paint.type.toUpperCase().startsWith("GRADIENT_")
  ) === true;
}

function hasMappedGradient(node: FigmaNode): boolean {
  if (node.type === "TEXT") return false;
  const paint = node.fills?.find((candidate) =>
    candidate.visible !== false
    && ["GRADIENT_LINEAR", "GRADIENT_RADIAL"].includes(candidate.type.toUpperCase()),
  );
  return Boolean(
    paint?.gradientHandlePositions?.length === 3
    && (paint.gradientStops?.length ?? 0) >= 2,
  );
}

function visualEffectEntries(
  node: FigmaNode,
): Array<{ type: "opacity" | "shadow" | "blur" | "unsupported"; mapped: boolean }> {
  const entries: Array<{
    type: "opacity" | "shadow" | "blur" | "unsupported";
    mapped: boolean;
  }> = [];
  if (typeof node.opacity === "number" && node.opacity < 0.999) {
    entries.push({
      type: "opacity",
      mapped: Number.isFinite(node.opacity) && node.opacity >= 0 && node.opacity <= 1,
    });
  }
  for (const effect of node.effects ?? []) {
    if (effect.visible === false) continue;
    if (effect.type === "DROP_SHADOW" || effect.type === "INNER_SHADOW") {
      const color = effect.color;
      entries.push({
        type: "shadow",
        mapped:
          Number.isFinite(effect.radius ?? 0)
          && Number.isFinite(effect.spread ?? 0)
          && Number.isFinite(effect.offset?.x ?? 0)
          && Number.isFinite(effect.offset?.y ?? 0)
          && (!color || [color.r, color.g, color.b, color.a ?? 1].every(Number.isFinite)),
      });
      continue;
    }
    if (effect.type === "LAYER_BLUR" || effect.type === "BACKGROUND_BLUR") {
      entries.push({
        type: "blur",
        mapped: Number.isFinite(effect.radius) && (effect.radius ?? -1) >= 0,
      });
      continue;
    }
    entries.push({ type: "unsupported", mapped: false });
  }
  return entries;
}

function countFunctionalWidgets(elements: ElementorElement[]): {
  navigation: number;
  links: number;
  carousel: number;
  contactForm: number;
  accordion: number;
} {
  const result = { navigation: 0, links: 0, carousel: 0, contactForm: 0, accordion: 0 };
  const visit = (items: ElementorElement[]): void => {
    for (const item of items) {
      if (item.widgetType === "figmapress-nav") result.navigation += 1;
      if (item.widgetType === "figmapress-link") result.links += 1;
      if (item.widgetType === "figmapress-carousel") result.carousel += 1;
      if (item.widgetType === "figmapress-contact-form") result.contactForm += 1;
      if (item.widgetType === "figmapress-accordion") result.accordion += 1;
      visit(item.elements);
    }
  };
  visit(elements);
  return result;
}
