import type {
  FigmaNode,
  MockFigmaFile,
  ParseResult,
  ParsedSection,
} from "./types";

const SECTION_PREFIX = "section/";

/**
 * Parse a mock Figma file shape into a flat list of section frames.
 * Strategy: walk all pages and collect the outermost descendants whose name
 * starts with "section/". Figma node-specific API responses retain the page
 * ancestor chain, so recursive discovery works for both whole files and URLs
 * that include `node-id`.
 */
export function parseFigmaFile(file: MockFigmaFile): ParseResult {
  if (!file?.document) {
    throw new Error("Figma JSON: missing `document` root");
  }

  const canvases = (file.document.children ?? []).filter(
    (n) => n.type === "CANVAS",
  );
  if (!canvases.length) {
    throw new Error("Figma JSON: no CANVAS node found under document");
  }

  const sections: ParsedSection[] = [];
  for (const canvas of canvases) collectSections(canvas, sections);
  const seen = new Set(sections.map((section) => section.id));
  for (const canvas of canvases) collectSemanticSections(canvas, sections, seen);
  if (!sections.length) {
    throw new Error(
      "Figma JSON: 変換対象セクションが見つかりません。レイヤー名に Hero、Services、Features、FAQ、CTA、Contact のいずれかを含めてください。",
    );
  }

  const firstCanvas = canvases[0];

  return {
    pageTitle: file.document.name || firstCanvas.name || "Untitled",
    sections,
    styles: file.styles ?? {},
  };
}

function collectSections(node: FigmaNode, sections: ParsedSection[]): void {
  for (const child of node.children ?? []) {
    if (typeof child.name !== "string") continue;
    if (child.name.startsWith(SECTION_PREFIX)) {
      sections.push({
        id: child.id,
        rawName: child.name,
        sectionName: child.name,
        node: child,
      });
      continue;
    }
    collectSections(child, sections);
  }
}

function collectSemanticSections(
  node: FigmaNode,
  sections: ParsedSection[],
  seen: Set<string>,
): void {
  for (const child of node.children ?? []) {
    if (child.name.startsWith(SECTION_PREFIX) || seen.has(child.id)) continue;
    const sectionName = inferSectionName(child.name);
    if (sectionName && ["FRAME", "SECTION", "COMPONENT", "INSTANCE", "GROUP"].includes(child.type)) {
      sections.push({
        id: child.id,
        rawName: child.name,
        sectionName,
        node: child,
      });
      seen.add(child.id);
      continue;
    }
    collectSemanticSections(child, sections, seen);
  }
}

function inferSectionName(name: string): string | null {
  const value = name.toLowerCase().replace(/[\s_-]+/g, "");
  if (/(hero|firstview|firstvisual|mainvisual|^fv$|intro|ヒーロー|ファーストビュー|メインビジュアル)/.test(value)) return "section/hero";
  if (/(service|solution|offering|サービス|事業|ソリューション)/.test(value)) return "section/service";
  if (/(feature|benefit|reason|strength|特徴|特長|強み|選ばれる理由|メリット)/.test(value)) return "section/features";
  if (/(faq|question|qa|よくある質問)/.test(value)) return "section/faq";
  if (/(cta|calltoaction|conversion|行動喚起)/.test(value)) return "section/cta";
  if (/(contact|inquiry|form|お問い合わせ|問い合わせ|資料請求|フォーム)/.test(value)) return "section/contact";
  return null;
}

/**
 * Find the first descendant text node whose name equals `name`.
 * Returns the node's `characters` string or `fallback`.
 */
export function findTextByName(
  node: FigmaNode,
  name: string,
  fallback = "",
): string {
  const match = findChildByName(node, name);
  return match?.characters ?? fallback;
}

export function findTextNodes(node: FigmaNode): FigmaNode[] {
  const matches: FigmaNode[] = [];
  const visit = (current: FigmaNode): void => {
    if (current.type === "TEXT" && typeof current.characters === "string") {
      matches.push(current);
    }
    for (const child of current.children ?? []) visit(child);
  };
  visit(node);
  return matches;
}

export function findTextByHints(
  node: FigmaNode,
  hints: string[],
  fallbackIndex = -1,
): string {
  const lowered = hints.map((hint) => hint.toLowerCase());
  const texts = findTextNodes(node);
  const match = texts.find((text) => {
    const name = text.name.toLowerCase().replace(/[\s_-]+/g, "");
    return lowered.some((hint) => name.includes(hint.replace(/[\s_-]+/g, "")));
  });
  return match?.characters ?? (fallbackIndex >= 0 ? texts[fallbackIndex]?.characters : "") ?? "";
}

export function findItemGroups(node: FigmaNode, hints: string[]): FigmaNode[] {
  const lowered = hints.map((hint) => hint.toLowerCase());
  const named = (node.children ?? []).filter((child) => {
    if (child.type === "TEXT") return false;
    const name = child.name.toLowerCase().replace(/[\s_-]+/g, "");
    return lowered.some((hint) => name.includes(hint.replace(/[\s_-]+/g, "")));
  });
  if (named.length) return named;
  return (node.children ?? []).filter((child) =>
    child.type !== "TEXT" && findTextNodes(child).length >= 2,
  );
}

export function findChildByName(
  node: FigmaNode,
  name: string,
): FigmaNode | null {
  for (const child of node.children ?? []) {
    if (child.name === name) return child;
    const nested = findChildByName(child, name);
    if (nested) return nested;
  }
  return null;
}

/**
 * Find direct children whose name matches `name` (no recursion).
 * Used for repeater patterns like "service/item", "faq/item".
 */
export function findDirectChildrenByName(
  node: FigmaNode,
  name: string,
): FigmaNode[] {
  return (node.children ?? []).filter((c) => c.name === name);
}

/**
 * Find the first image fill in a node or any descendant. Real API responses
 * are hydrated with rendered image URLs before this parser runs.
 */
export function findFirstImageRef(node: FigmaNode): {
  src: string | null;
  alt: string;
} | null {
  const image = findImageInNode(node);
  if (!image) return null;
  return { src: image, alt: node.name };
}

function findImageInNode(node: FigmaNode): string | null {
  for (const fill of node.fills ?? []) {
    if (fill.type === "IMAGE" && fill.imageRef) {
      return `figma://image/${fill.imageRef}`;
    }
  }
  for (const child of node.children ?? []) {
    const nested = findImageInNode(child);
    if (nested) return nested;
  }
  return null;
}
