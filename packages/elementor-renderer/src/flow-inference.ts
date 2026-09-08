import type { FigmaNode } from "@figmapress/figma-parser";

/** Infer only an exact, equal-gap vertical stack. Overlaps/artwork stay absolute. */
export function inferFigmaVerticalFlow(node: FigmaNode): FigmaNode | null {
  if (node.layoutMode === "VERTICAL" || node.layoutMode === "HORIZONTAL" || node.clipsContent || node.rotation) return null;
  const bounds = node.absoluteBoundingBox;
  const children = (node.children ?? []).filter(child => child.visible !== false);
  if (!bounds || children.length < 2 || children.length > 24) return null;
  if (children.some(child => !["TEXT", "FRAME", "GROUP", "COMPONENT", "INSTANCE"].includes(child.type) || child.rotation || child.layoutPositioning === "ABSOLUTE" || !child.absoluteBoundingBox)) return null;
  const boxes = children.map(child => child.absoluteBoundingBox!);
  const first = boxes[0]!;
  const last = boxes[boxes.length - 1]!;
  const tolerance = 0.25;
  const gap = boxes[1]!.y - (first.y + first.height);
  if (gap < 0 || boxes.some((box, index) =>
    box.width <= 0 || box.height <= 0
    || Math.abs(box.x - first.x) > tolerance || Math.abs(box.width - first.width) > tolerance
    || box.x < bounds.x || box.x + box.width > bounds.x + bounds.width
    || box.y < bounds.y || box.y + box.height > bounds.y + bounds.height
    || (index > 0 && Math.abs(box.y - boxes[index - 1]!.y - boxes[index - 1]!.height - gap) > tolerance)
  )) return null;
  return {
    ...node, layoutMode: "VERTICAL", layoutWrap: "NO_WRAP",
    primaryAxisAlignItems: "MIN", counterAxisAlignItems: "STRETCH",
    itemSpacing: gap,
    paddingTop: first.y - bounds.y,
    paddingLeft: first.x - bounds.x,
    paddingRight: bounds.x + bounds.width - first.x - first.width,
    paddingBottom: bounds.y + bounds.height - last.y - last.height,
    children: (node.children ?? []).map(child => ({ ...child, layoutAlign: "STRETCH", layoutSizingHorizontal: "FILL" })),
  };
}
