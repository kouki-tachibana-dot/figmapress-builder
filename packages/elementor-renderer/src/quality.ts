import type {
  FigmaNode,
  MockFigmaFile,
} from "@figmapress/figma-parser";
import {
  figmaTextShouldWrap,
  findFigmaNavigationMenuTexts,
  findFigmaNavigationNode,
  findFigmaResponsiveRoots,
} from "./figma-exporter";
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
    | "interactions"
    | "navigation-integrity"
    | "component-geometry";
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
      structuredAdjusted: number;
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
    expectedFunctionalWidgets: {
      navigation: number;
      carousel: number;
      contactForm: number;
      accordion: number;
    };
    navigationIntegrity: {
      anchors: number;
      duplicateAnchors: number;
      navigationLinks: number;
      missingTargets: number;
    };
    componentGeometry: {
      contactForms: number;
      validContactForms: number;
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
    wrappingTextNodes: editableTextNodes.filter(figmaTextShouldWrap).length,
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
    nativeFit: imageEntries.filter((entry) =>
      entry.mapped && !entry.exactRendered && !adjustedImagePaint(entry.paint)
    ).length,
    structuredAdjusted: imageEntries.filter((entry) =>
      entry.mapped && !entry.exactRendered && adjustedImagePaint(entry.paint)
    ).length,
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
  const expectedFunctionalWidgets = countExpectedFunctionalWidgets(designRoots);
  const missingFunctionalWidgets = [
    ["メニュー", expectedFunctionalWidgets.navigation - functionalWidgets.navigation],
    ["カルーセル", expectedFunctionalWidgets.carousel - functionalWidgets.carousel],
    ["フォーム", expectedFunctionalWidgets.contactForm - functionalWidgets.contactForm],
    ["アコーディオン", expectedFunctionalWidgets.accordion - functionalWidgets.accordion],
  ].filter((entry): entry is [string, number] => Number(entry[1]) > 0);
  const functionalWidgetTotal =
    functionalWidgets.navigation
    + functionalWidgets.links
    + functionalWidgets.carousel
    + functionalWidgets.contactForm
    + functionalWidgets.accordion;
  const componentGeometry = inspectComponentGeometry(template.content);
  const navigationIntegrity = inspectNavigationIntegrity(template.content);
  const boundedRatio = visibleNodes.length > 0 ? boundedNodes.length / visibleNodes.length : 0;
  const gradientRatio = gradients.visible > 0 ? gradients.mapped / gradients.visible : 1;
  const effectRatio = effects.visible > 0 ? effects.mapped / effects.visible : 1;
  const geometryPenalty = componentGeometry.contactForms - componentGeometry.validContactForms;
  const navigationPenalty = Math.min(
    30,
    (navigationIntegrity.duplicateAnchors + navigationIntegrity.missingTargets) * 6,
  );
  const interactionPenalty = Math.min(
    24,
    missingFunctionalWidgets.reduce((total, [, missing]) => total + missing * 8, 0),
  );
  const score = Math.max(
    0,
    Math.min(
      100,
      Math.round(60 + boundedRatio * 25 + gradientRatio * 8 + effectRatio * 7)
        - geometryPenalty * 15
        - navigationPenalty
        - interactionPenalty,
    ),
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
          ? `${images.mapped}画像を再現（正確な切り抜き${images.exactRendered}・構造化変形${images.structuredAdjusted}・標準フィット${images.nativeFit}・マスク${images.masks}）`
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
      status: missingFunctionalWidgets.length > 0
        ? "warning"
        : functionalWidgetTotal > 0 ? "pass" : "info",
      detail: missingFunctionalWidgets.length > 0
        ? `${missingFunctionalWidgets.map(([label, count]) => `${label}${count}`).join("・")}件を機能化できませんでした`
        : functionalWidgetTotal > 0
        ? `メニュー${functionalWidgets.navigation}・リンク${functionalWidgets.links}・カルーセル${functionalWidgets.carousel}・フォーム${functionalWidgets.contactForm}・アコーディオン${functionalWidgets.accordion}`
        : "自動認識できる実動パーツはありません",
    },
    {
      id: "navigation-integrity",
      label: "ナビゲーション整合性",
      status: navigationIntegrity.duplicateAnchors === 0 && navigationIntegrity.missingTargets === 0
        ? navigationIntegrity.navigationLinks > 0 ? "pass" : "info"
        : "warning",
      detail: navigationIntegrity.duplicateAnchors > 0 || navigationIntegrity.missingTargets > 0
        ? `重複アンカー${navigationIntegrity.duplicateAnchors}・移動先なし${navigationIntegrity.missingTargets}`
        : navigationIntegrity.navigationLinks > 0
          ? `${navigationIntegrity.navigationLinks}リンクの移動先を検証済み（アンカー${navigationIntegrity.anchors}）`
          : "ページ内ナビゲーションはありません",
    },
    {
      id: "component-geometry",
      label: "実動パーツの配置",
      status: componentGeometry.contactForms === 0
        ? "info"
        : componentGeometry.validContactForms === componentGeometry.contactForms ? "pass" : "warning",
      detail: componentGeometry.contactForms === 0
        ? "フォームの配置検査対象はありません"
        : componentGeometry.validContactForms === componentGeometry.contactForms
          ? `${componentGeometry.validContactForms}フォームの入力欄を個別座標へ配置`
          : `${componentGeometry.contactForms - componentGeometry.validContactForms}フォームで入力欄の配置情報が不足`,
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
      expectedFunctionalWidgets,
      navigationIntegrity,
      componentGeometry,
    },
    checks,
  };
}

function inspectComponentGeometry(elements: ElementorElement[]): {
  contactForms: number;
  validContactForms: number;
} {
  const result = { contactForms: 0, validContactForms: 0 };
  const validBox = (box: unknown): boolean => {
    if (!box || typeof box !== "object") return false;
    const candidate = box as Record<string, unknown>;
    return ["x", "y", "width", "height"].every((key) =>
      typeof candidate[key] === "number" && Number.isFinite(candidate[key])
    ) && Number(candidate.width) > 0 && Number(candidate.height) > 0;
  };
  const visit = (items: ElementorElement[]): void => {
    for (const item of items) {
      if (item.widgetType === "figmapress-contact-form") {
        result.contactForms += 1;
        try {
          const rawGeometry = item.settings.design_geometry;
          const geometry = typeof rawGeometry === "string"
            ? JSON.parse(rawGeometry) as Record<string, unknown>
            : rawGeometry as Record<string, unknown> | undefined;
          const fields = geometry?.fields as Record<string, { control?: unknown }> | undefined;
          if (["name", "email", "region", "message"].every((name) =>
            validBox(fields?.[name]?.control)
          )) {
            result.validContactForms += 1;
          }
        } catch {
          // Invalid geometry is reported as a warning instead of aborting conversion.
        }
      }
      visit(item.elements);
    }
  };
  visit(elements);
  return result;
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
        mapped: exactRendered || (hasNativeImage && nativeImageSupported(paint)),
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

function nativeImageSupported(paint: NonNullable<FigmaNode["fills"]>[number]): boolean {
  const mode = paint.scaleMode?.toUpperCase();
  if (mode && !["FILL", "FIT", "STRETCH", "TILE"].includes(mode)) return false;
  if (
    paint.imageTransform
    && (
      paint.imageTransform.length !== 2
      || paint.imageTransform[0].length !== 3
      || paint.imageTransform[1].length !== 3
      || !paint.imageTransform.flat().every(Number.isFinite)
    )
  ) {
    return false;
  }
  if (mode === "TILE" && paint.scalingFactor !== undefined && !Number.isFinite(paint.scalingFactor)) {
    return false;
  }
  if (paint.rotation !== undefined && !Number.isFinite(paint.rotation)) return false;
  return Object.entries(paint.filters ?? {}).every(([name, value]) =>
    ["exposure", "contrast", "saturation"].includes(name)
    && Number.isFinite(value)
  );
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
      if (
        item.widgetType === "image"
        && item.settings.link
        && typeof item.settings.link === "object"
        && typeof (item.settings.link as Record<string, unknown>).url === "string"
        && String((item.settings.link as Record<string, unknown>).url).trim()
      ) {
        result.links += 1;
      }
      if (item.widgetType === "text-editor" && typeof item.settings.editor === "string") {
        result.links += (item.settings.editor.match(/data-figmapress-functional-link/g) ?? []).length;
      }
      if (item.widgetType === "figmapress-carousel") result.carousel += 1;
      if (item.widgetType === "figmapress-contact-form") result.contactForm += 1;
      if (item.widgetType === "figmapress-accordion") result.accordion += 1;
      visit(item.elements);
    }
  };
  visit(elements);
  return result;
}

function countExpectedFunctionalWidgets(roots: FigmaNode[]): {
  navigation: number;
  carousel: number;
  contactForm: number;
  accordion: number;
} {
  const result = { navigation: 0, carousel: 0, contactForm: 0, accordion: 0 };
  const fallbackMenuTexts = roots[0] ? findFigmaNavigationMenuTexts(roots[0]) : [];
  const countOutermostMatches = (
    root: FigmaNode,
    matches: (node: FigmaNode) => boolean,
  ): number => {
    let count = 0;
    const visit = (node: FigmaNode): void => {
      if (node.visible === false) return;
      if (matches(node)) {
        count += 1;
        return;
      }
      for (const child of node.children ?? []) visit(child);
    };
    visit(root);
    return count;
  };
  for (const root of roots) {
    result.navigation += findFigmaNavigationNode(root, fallbackMenuTexts) ? 1 : 0;
    result.carousel += countOutermostMatches(root, (node) =>
      /(?:\{wp:carousel\}|carousel|slider|スライダー|カルーセル)/i.test(node.name)
      && !/(?:item|prev|previous|next|arrow|dot|項目|前へ|次へ)/i.test(node.name)
    );
    result.contactForm += countOutermostMatches(root, (node) => {
      if (!/(?:\{wp:form\}|contact.?form|button.?cta|お問い合わせ)/i.test(node.name)) return false;
      const copy = nodeDescendants(node)
        .filter((child) => child.type === "TEXT" && child.characters?.trim())
        .map((child) => child.characters ?? "")
        .join(" ");
      return /メールアドレス|e-?mail/i.test(copy)
        && /ご相談|ご意見|message|お問い合わせ内容/i.test(copy)
        && /お名前|氏名|name/i.test(copy);
    });
    result.accordion += countOutermostMatches(root, (node) =>
      /(?:\{wp:accordion\}|profile|プロフィール|faq|よくある質問)/i.test(node.name)
      && nodeDescendants(node).filter((child) =>
        child.type === "TEXT" && /^\s*\d{4}年度\s*$/.test(child.characters ?? "")
      ).length >= 3
    );
  }
  return result;
}

function inspectNavigationIntegrity(elements: ElementorElement[]): {
  anchors: number;
  duplicateAnchors: number;
  navigationLinks: number;
  missingTargets: number;
} {
  const anchorCounts = new Map<string, number>();
  const targets: string[] = [];
  let navigationLinks = 0;
  const recordHref = (url: string): void => {
    const normalized = url.trim();
    if (!normalized) return;
    navigationLinks += 1;
    if (
      /^#[A-Za-z][\w:-]*$/.test(normalized)
      && !normalized.startsWith("#figmapress-page-")
    ) {
      targets.push(normalized.slice(1));
    }
  };
  const recordUrl = (value: unknown): void => {
    if (!value || typeof value !== "object") return;
    const url = (value as Record<string, unknown>).url;
    if (typeof url === "string") recordHref(url);
  };
  const visit = (items: ElementorElement[]): void => {
    for (const item of items) {
      const id = item.settings._element_id;
      if (typeof id === "string" && id) {
        anchorCounts.set(id, (anchorCounts.get(id) ?? 0) + 1);
      }
      if (item.widgetType === "figmapress-nav") {
        const menuItems = Array.isArray(item.settings.items) ? item.settings.items : [];
        for (const menuItem of menuItems) {
          if (menuItem && typeof menuItem === "object") {
            recordUrl((menuItem as Record<string, unknown>).url);
          }
        }
        recordUrl(item.settings.cta_url);
        recordUrl(item.settings.home_url);
      }
      if (item.widgetType === "figmapress-link") {
        recordUrl(item.settings.link_url);
      }
      if (item.widgetType === "image") {
        recordUrl(item.settings.link);
      }
      if (item.widgetType === "text-editor" && typeof item.settings.editor === "string") {
        for (const match of item.settings.editor.matchAll(/href=["']([^"']+)["']/g)) {
          recordHref(match[1]);
        }
      }
      visit(item.elements);
    }
  };
  visit(elements);
  const duplicateAnchors = [...anchorCounts.values()]
    .reduce((total, count) => total + Math.max(0, count - 1), 0);
  const missingTargets = targets.filter((target) => !anchorCounts.has(target)).length;
  return {
    anchors: anchorCounts.size,
    duplicateAnchors,
    navigationLinks,
    missingTargets,
  };
}

function nodeDescendants(node: FigmaNode): FigmaNode[] {
  const result: FigmaNode[] = [];
  const visit = (current: FigmaNode): void => {
    for (const child of current.children ?? []) {
      result.push(child);
      visit(child);
    }
  };
  visit(node);
  return result;
}
