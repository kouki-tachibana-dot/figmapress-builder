import type {
  FigmaNode,
  MockFigmaFile,
} from "@figmapress/figma-parser";
import { findFigmaResponsiveRoots } from "./figma-exporter";
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
    functionalWidgets: {
      navigation: number;
      contactForm: number;
      accordion: number;
    };
  };
  checks: FigmaQualityCheck[];
}

export function createFigmaQualityReport(
  file: MockFigmaFile,
  template: ElementorTemplate,
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
  const autoLayoutFrames = boundedNodes.filter(isAutoLayout).length;
  const absoluteLayoutNodes = boundedEntries.filter(({ node, parent }) =>
    node !== roots.desktop
    && node !== roots.mobile
    && !isAutoLayout(parent),
  ).length;
  const functionalWidgets = countFunctionalWidgets(template.content);
  const functionalWidgetTotal =
    functionalWidgets.navigation + functionalWidgets.contactForm + functionalWidgets.accordion;
  const boundedRatio = visibleNodes.length > 0 ? boundedNodes.length / visibleNodes.length : 0;
  const score = Math.max(0, Math.min(100, Math.round(70 + boundedRatio * 30)));
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
        ? `メニュー${functionalWidgets.navigation}・フォーム${functionalWidgets.contactForm}・アコーディオン${functionalWidgets.accordion}`
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

function isAutoLayout(node: FigmaNode | null): boolean {
  return node?.layoutMode === "HORIZONTAL" || node?.layoutMode === "VERTICAL";
}

function countFunctionalWidgets(elements: ElementorElement[]): {
  navigation: number;
  contactForm: number;
  accordion: number;
} {
  const result = { navigation: 0, contactForm: 0, accordion: 0 };
  const visit = (items: ElementorElement[]): void => {
    for (const item of items) {
      if (item.widgetType === "figmapress-nav") result.navigation += 1;
      if (item.widgetType === "figmapress-contact-form") result.contactForm += 1;
      if (item.widgetType === "figmapress-accordion") result.accordion += 1;
      visit(item.elements);
    }
  };
  visit(elements);
  return result;
}
