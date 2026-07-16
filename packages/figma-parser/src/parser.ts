import type {
  FigmaNode,
  MockFigmaFile,
  ParseResult,
  ParsedSection,
} from "./types";

const SECTION_PREFIX = "section/";

/**
 * Parse a mock Figma file shape into a flat list of section frames.
 * Strategy: walk the first CANVAS and collect direct children whose name
 * starts with "section/". This matches the LP template naming convention
 * documented in the instructions.
 */
export function parseFigmaFile(file: MockFigmaFile): ParseResult {
  if (!file?.document) {
    throw new Error("Figma JSON: missing `document` root");
  }

  const canvases = (file.document.children ?? []).filter(
    (n) => n.type === "CANVAS",
  );
  const firstCanvas = canvases[0];
  if (!firstCanvas) {
    throw new Error("Figma JSON: no CANVAS node found under document");
  }

  const sections: ParsedSection[] = [];
  for (const child of firstCanvas.children ?? []) {
    if (typeof child.name !== "string") continue;
    if (!child.name.startsWith(SECTION_PREFIX)) continue;
    sections.push({
      id: child.id,
      rawName: child.name,
      sectionName: child.name,
      node: child,
    });
  }

  return {
    pageTitle: file.document.name || firstCanvas.name || "Untitled",
    sections,
    styles: file.styles ?? {},
  };
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
 * Find first image fill in a node or any descendant. Returns a synthetic
 * src placeholder — real Figma API integration (Priority B) replaces this
 * with an actual rendered URL via `GET /v1/images/:key`.
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
