import type { FigmaBounds, FigmaNode } from "@figmapress/figma-parser";

export type FigmaFrameVariant = "desktop" | "tablet" | "mobile" | "unknown";

export interface FigmaFrameSummary {
  id: string;
  name: string;
  label: string;
  width: number;
  height: number;
  variant: FigmaFrameVariant;
}

export interface FigmaPageCandidate {
  id: string;
  title: string;
  desktop?: FigmaFrameSummary;
  tablet?: FigmaFrameSummary;
  mobile?: FigmaFrameSummary;
  confidence: "named" | "content" | "nearby" | "single";
}

interface FrameCandidate extends FigmaFrameSummary {
  bounds: FigmaBounds;
  canvasIndex: number;
  order: number;
  pairingKey: string;
  node: FigmaNode;
}

const PAGE_ROOT_TYPES = new Set(["FRAME", "COMPONENT", "INSTANCE", "SECTION"]);
const GENERIC_FRAME_NAME = /^(?:frame|page|pc|sp|desktop|tablet|tab|ipad|mobile|phone|pcpage|tabletpage|sppage|design|screen|artboard|ホーム|トップ)(?:copy)?\d*$/i;
const DEVICE_WORDS = /(?:^|[\s/_-])(?:pc|sp|desktop|tablet|tab|ipad|mobile|phone)(?=$|[\s/_-])/gi;
const NAVIGATION_COPY = /^(?:home|menu|top|news|service|company|contact|about|blog|ホーム|トップ|メニュー|お知らせ|事業案内|会社案内|お問い合わせ)$/i;

function validBounds(bounds: FigmaNode["absoluteBoundingBox"]): bounds is FigmaBounds {
  return Boolean(
    bounds
    && Number.isFinite(bounds.x)
    && Number.isFinite(bounds.y)
    && Number.isFinite(bounds.width)
    && Number.isFinite(bounds.height)
    && bounds.width > 0
    && bounds.height > 0,
  );
}

function normalize(value: string): string {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(DEVICE_WORDS, " ")
    .replace(/(?:copy|コピー|複製)\s*\d*$/i, "")
    .replace(/[\s/_\-–—・（）()\[\]]+/g, "")
    .replace(/\d+$/g, "");
}

function frameVariant(node: FigmaNode): FigmaFrameVariant {
  const bounds = node.absoluteBoundingBox;
  if (!validBounds(bounds)) return "unknown";
  const name = node.name.toLowerCase();
  if (/(?:^|[\s/_-])(?:sp|mobile|phone)(?=$|[\s/_-])|スマホ/.test(name)) {
    return "mobile";
  }
  if (/(?:^|[\s/_-])(?:tablet|tab|ipad)(?=$|[\s/_-])|タブレット/.test(name)) {
    return "tablet";
  }
  if (/(?:^|[\s/_-])(?:pc|desktop)(?=$|[\s/_-])|デスクトップ/.test(name)) {
    return "desktop";
  }
  if (bounds.width <= 767) return "mobile";
  if (bounds.width >= 1_100) return "desktop";
  if (bounds.width >= 768) return "tablet";
  return "unknown";
}

function descendantTextNodes(node: FigmaNode): FigmaNode[] {
  const result: FigmaNode[] = [];
  const visit = (current: FigmaNode): void => {
    if (
      current.visible !== false
      && current.type === "TEXT"
      && typeof current.characters === "string"
      && current.characters.trim()
      && validBounds(current.absoluteBoundingBox)
    ) {
      result.push(current);
    }
    for (const child of current.children ?? []) visit(child);
  };
  visit(node);
  return result;
}

function semanticLabel(node: FigmaNode): string {
  const bounds = node.absoluteBoundingBox;
  if (!validBounds(bounds)) return "";
  const maxY = bounds.y + Math.min(bounds.height * 0.38, 1_800);
  const candidates = descendantTextNodes(node)
    .filter((text) => {
      const copy = text.characters?.replace(/\s+/g, " ").trim() ?? "";
      const textBounds = text.absoluteBoundingBox;
      return validBounds(textBounds)
        && textBounds.y <= maxY
        && copy.length >= 2
        && copy.length <= 80
        && !(NAVIGATION_COPY.test(copy) && (text.style?.fontSize ?? 0) < 24);
    })
    .sort((left, right) => {
      const fontDifference = (right.style?.fontSize ?? 0) - (left.style?.fontSize ?? 0);
      if (Math.abs(fontDifference) >= 4) return fontDifference;
      const leftBounds = left.absoluteBoundingBox as FigmaBounds;
      const rightBounds = right.absoluteBoundingBox as FigmaBounds;
      return leftBounds.y - rightBounds.y || leftBounds.x - rightBounds.x;
    });
  return candidates[0]?.characters?.replace(/\s+/g, " ").trim() ?? "";
}

function likelyWebsiteFrame(node: FigmaNode): boolean {
  const bounds = node.absoluteBoundingBox;
  if (
    node.visible === false
    || !PAGE_ROOT_TYPES.has(node.type)
    || !validBounds(bounds)
    || bounds.width < 280
    || bounds.width > 3_200
    || bounds.height < 560
  ) {
    return false;
  }
  const deviceNamed = frameVariant(node) !== "unknown";
  const tallEnough = bounds.height >= bounds.width * 0.72;
  return deviceNamed || tallEnough || descendantTextNodes(node).length >= 4;
}

function frameCandidates(document: FigmaNode): FrameCandidate[] {
  const result: FrameCandidate[] = [];
  const canvases = (document.children ?? []).filter((node) => node.type === "CANVAS");
  canvases.forEach((canvas, canvasIndex) => {
    (canvas.children ?? []).forEach((node, order) => {
      if (!likelyWebsiteFrame(node)) return;
      const bounds = node.absoluteBoundingBox as FigmaBounds;
      const semantic = semanticLabel(node);
      const normalizedName = normalize(node.name);
      const label = semantic
        || (GENERIC_FRAME_NAME.test(normalizedName) ? "" : node.name.trim())
        || node.name.trim()
        || `Frame ${order + 1}`;
      const semanticKey = normalize(semantic);
      result.push({
        id: node.id,
        name: node.name,
        label,
        width: Math.round(bounds.width),
        height: Math.round(bounds.height),
        variant: frameVariant(node),
        bounds,
        canvasIndex,
        order,
        pairingKey: semanticKey || (GENERIC_FRAME_NAME.test(normalizedName) ? "" : normalizedName),
        node,
      });
    });
  });
  return result.sort((left, right) =>
    left.canvasIndex - right.canvasIndex
    || left.bounds.y - right.bounds.y
    || left.bounds.x - right.bounds.x
    || left.order - right.order
  );
}

function distanceScore(left: FrameCandidate, right: FrameCandidate): number {
  const leftCenterX = left.bounds.x + left.bounds.width / 2;
  const rightCenterX = right.bounds.x + right.bounds.width / 2;
  const leftCenterY = left.bounds.y + left.bounds.height / 2;
  const rightCenterY = right.bounds.y + right.bounds.height / 2;
  const xDistance = Math.abs(leftCenterX - rightCenterX) / Math.max(left.bounds.width, right.bounds.width);
  const yDistance = Math.abs(leftCenterY - rightCenterY) / Math.max(left.bounds.height, right.bounds.height);
  const normalizedHeightLeft = left.bounds.height / left.bounds.width;
  const normalizedHeightRight = right.bounds.height / right.bounds.width;
  const lengthDifference = Math.abs(normalizedHeightLeft - normalizedHeightRight);
  return xDistance + yDistance * 2.5 + lengthDifference * 0.25;
}

function companionScore(left: FrameCandidate, right: FrameCandidate): {
  score: number;
  confidence: FigmaPageCandidate["confidence"];
} | null {
  if (
    left.canvasIndex !== right.canvasIndex
    || left.variant === right.variant
    || left.variant === "unknown"
    || right.variant === "unknown"
  ) {
    return null;
  }
  const sameContent = Boolean(left.pairingKey && left.pairingKey === right.pairingKey);
  const normalizedNameLeft = normalize(left.name);
  const normalizedNameRight = normalize(right.name);
  const sameName = Boolean(
    normalizedNameLeft
    && normalizedNameLeft === normalizedNameRight
    && !GENERIC_FRAME_NAME.test(normalizedNameLeft),
  );
  const distance = distanceScore(left, right);
  if (sameContent) return { score: 2_000 - distance, confidence: "content" };
  if (sameName) return { score: 1_500 - distance, confidence: "named" };
  if (left.pairingKey && right.pairingKey && left.pairingKey !== right.pairingKey) {
    return null;
  }

  const topDifference = Math.abs(left.bounds.y - right.bounds.y)
    / Math.max(left.bounds.height, right.bounds.height);
  if (topDifference > 0.45 || distance > 5.5) return null;
  return { score: 500 - distance, confidence: "nearby" };
}

function summary(candidate: FrameCandidate): FigmaFrameSummary {
  return {
    id: candidate.id,
    name: candidate.name,
    label: candidate.label,
    width: candidate.width,
    height: candidate.height,
    variant: candidate.variant,
  };
}

function pageTitle(
  desktop: FrameCandidate | undefined,
  tablet: FrameCandidate | undefined,
  mobile: FrameCandidate | undefined,
): string {
  const preferred = desktop?.label || tablet?.label || mobile?.label
    || desktop?.name || tablet?.name || mobile?.name || "Figma page";
  return preferred.replace(/\s+/g, " ").trim();
}

export function discoverFigmaPageCandidates(document: FigmaNode): FigmaPageCandidate[] {
  const candidates = frameCandidates(document);
  const desktops = candidates.filter((candidate) => candidate.variant === "desktop");
  const tablets = candidates.filter((candidate) => candidate.variant === "tablet");
  const mobiles = candidates.filter((candidate) => candidate.variant === "mobile");
  const unknown = candidates.filter((candidate) => candidate.variant === "unknown");
  const usedMobiles = new Set<string>();
  const usedTablets = new Set<string>();
  const pages: FigmaPageCandidate[] = [];

  for (const desktop of desktops) {
    const best = mobiles
      .filter((mobile) => !usedMobiles.has(mobile.id))
      .flatMap((mobile) => {
        const match = companionScore(desktop, mobile);
        return match ? [{ mobile, ...match }] : [];
      })
      .sort((left, right) => right.score - left.score)[0];
    const bestTablet = tablets
      .filter((tablet) => !usedTablets.has(tablet.id))
      .flatMap((tablet) => {
        const match = companionScore(desktop, tablet);
        return match ? [{ tablet, ...match }] : [];
      })
      .sort((left, right) => right.score - left.score)[0];
    if (best) usedMobiles.add(best.mobile.id);
    if (bestTablet) usedTablets.add(bestTablet.tablet.id);
    pages.push({
      id: desktop.id,
      title: pageTitle(desktop, bestTablet?.tablet, best?.mobile),
      desktop: summary(desktop),
      tablet: bestTablet ? summary(bestTablet.tablet) : undefined,
      mobile: best ? summary(best.mobile) : undefined,
      confidence: best?.confidence ?? "single",
    });
  }

  for (const mobile of mobiles) {
    if (usedMobiles.has(mobile.id)) continue;
    pages.push({
      id: mobile.id,
      title: pageTitle(undefined, undefined, mobile),
      mobile: summary(mobile),
      confidence: "single",
    });
  }
  for (const tablet of tablets) {
    if (usedTablets.has(tablet.id)) continue;
    pages.push({
      id: tablet.id,
      title: pageTitle(undefined, tablet, undefined),
      tablet: summary(tablet),
      confidence: "single",
    });
  }
  for (const candidate of unknown) {
    pages.push({
      id: candidate.id,
      title: pageTitle(candidate, undefined, undefined),
      desktop: summary(candidate),
      confidence: "single",
    });
  }
  return pages;
}

export function selectedFigmaFrameIds(
  pages: FigmaPageCandidate[],
  selectedFrameId: string,
): string[] {
  const page = pages.find((candidate) =>
    candidate.id === selectedFrameId
    || candidate.desktop?.id === selectedFrameId
    || candidate.tablet?.id === selectedFrameId
    || candidate.mobile?.id === selectedFrameId,
  );
  if (!page) return [];
  return [...new Set([page.desktop?.id, page.tablet?.id, page.mobile?.id].filter((id): id is string => Boolean(id)))];
}

export function pruneFigmaDocumentToFrames(
  document: FigmaNode,
  frameIds: string[],
): FigmaNode {
  const selected = new Set(frameIds);
  return {
    ...document,
    children: (document.children ?? []).flatMap((canvas) => {
      if (canvas.type !== "CANVAS") return [];
      const children = (canvas.children ?? []).filter((node) =>
        selected.has(node.id) || !likelyWebsiteFrame(node),
      );
      return children.length ? [{ ...canvas, children }] : [];
    }),
  };
}
