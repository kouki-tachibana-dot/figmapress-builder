import type {
  FigmaBounds,
  FigmaNode,
  FigmaTypeStyle,
} from "@figmapress/figma-parser";

export const ADAPTIVE_TABLET_WIDTH = 834;

const GENERIC_NODE_NAME = /^(?:frame|group|rectangle|vector|union|line|ellipse|component|instance|section|layer|shape)(?:\s*\d+)?$/i;
const DEVICE_NAME = /(?:^|[\s/_-])(?:pc|sp|desktop|tablet|tab|ipad|mobile|phone)(?=$|[\s/_-])/gi;

interface MobileNodeMatcher {
  take(node: FigmaNode): FigmaNode | null;
}

/**
 * Create an editable tablet layout when Figma supplies desktop and mobile
 * frames but no approved tablet frame. This is deliberately kept outside
 * `findFigmaResponsiveRoots`: a derived layout must never be mistaken for a
 * Figma visual reference or receive a 99.9% source-match score.
 */
export function deriveAdaptiveTabletRoot(
  desktop: FigmaNode,
  mobile: FigmaNode,
  requestedWidth = ADAPTIVE_TABLET_WIDTH,
): FigmaNode | null {
  const desktopBounds = desktop.absoluteBoundingBox;
  const mobileBounds = mobile.absoluteBoundingBox;
  if (!validBounds(desktopBounds) || !validBounds(mobileBounds)) return null;
  if (desktopBounds.width <= mobileBounds.width) return null;

  const targetWidth = clamp(
    requestedWidth,
    mobileBounds.width + 1,
    desktopBounds.width - 1,
  );
  const desktopInfluence = clamp(
    (targetWidth - mobileBounds.width) / (desktopBounds.width - mobileBounds.width),
    0,
    1,
  );
  const targetBounds: FigmaBounds = {
    x: desktopBounds.x,
    y: desktopBounds.y,
    width: targetWidth,
    height: interpolate(mobileBounds.height, desktopBounds.height, desktopInfluence),
  };
  const matcher = createMobileNodeMatcher(mobile);
  const fallbackScale = clamp(Math.sqrt(targetWidth / desktopBounds.width), 0.72, 1);

  const clone = (node: FigmaNode, root = false): FigmaNode => {
    const mobileNode = root ? mobile : matcher.take(node);
    const next: FigmaNode = {
      ...node,
      ...(root
        ? {
            id: `${desktop.id}:adaptive-tablet`,
            name: `${desktop.name} / Adaptive Tablet`,
          }
        : {}),
      absoluteBoundingBox: root
        ? targetBounds
        : adaptiveBounds(
            node.absoluteBoundingBox,
            mobileNode?.absoluteBoundingBox,
            desktopBounds,
            mobileBounds,
            targetBounds,
            desktopInfluence,
          ),
      absoluteRenderBounds: root
        ? targetBounds
        : adaptiveNullableBounds(
            node.absoluteRenderBounds,
            mobileNode?.absoluteRenderBounds,
            desktopBounds,
            mobileBounds,
            targetBounds,
            desktopInfluence,
          ),
      style: adaptiveTypeStyle(
        node.style,
        mobileNode?.style,
        desktopInfluence,
        fallbackScale,
      ),
      styleOverrideTable: adaptiveStyleOverrideTable(
        node.styleOverrideTable,
        mobileNode?.styleOverrideTable,
        desktopInfluence,
        fallbackScale,
      ),
      rectangleCornerRadii: adaptiveCornerRadii(
        node.rectangleCornerRadii,
        mobileNode?.rectangleCornerRadii,
        desktopInfluence,
        fallbackScale,
      ),
      children: node.children?.map((child) => clone(child)),
    };

    for (const key of [
      "itemSpacing",
      "counterAxisSpacing",
      "paddingTop",
      "paddingRight",
      "paddingBottom",
      "paddingLeft",
      "cornerRadius",
      "strokeWeight",
    ] as const) {
      const value = adaptiveNumber(
        node[key],
        mobileNode?.[key],
        desktopInfluence,
        fallbackScale,
      );
      if (value !== undefined) next[key] = value;
    }

    if (mobileNode && desktopInfluence < 0.5) {
      next.layoutMode = mobileNode.layoutMode ?? node.layoutMode;
      next.layoutWrap = mobileNode.layoutWrap ?? node.layoutWrap;
      next.primaryAxisAlignItems = mobileNode.primaryAxisAlignItems ?? node.primaryAxisAlignItems;
      next.counterAxisAlignItems = mobileNode.counterAxisAlignItems ?? node.counterAxisAlignItems;
      next.primaryAxisSizingMode = mobileNode.primaryAxisSizingMode ?? node.primaryAxisSizingMode;
      next.counterAxisSizingMode = mobileNode.counterAxisSizingMode ?? node.counterAxisSizingMode;
      next.layoutSizingHorizontal = mobileNode.layoutSizingHorizontal ?? node.layoutSizingHorizontal;
      next.layoutSizingVertical = mobileNode.layoutSizingVertical ?? node.layoutSizingVertical;
    } else if (
      node.layoutMode === "HORIZONTAL"
      && (node.children?.filter((child) => child.visible !== false).length ?? 0) > 2
    ) {
      next.layoutWrap = "WRAP";
    }

    return next;
  };

  return clone(desktop, true);
}

function createMobileNodeMatcher(root: FigmaNode): MobileNodeMatcher {
  const candidates = new Map<string, FigmaNode[]>();
  const visit = (node: FigmaNode): void => {
    const key = nodeIdentity(node);
    if (key) candidates.set(key, [...(candidates.get(key) ?? []), node]);
    for (const child of node.children ?? []) visit(child);
  };
  for (const child of root.children ?? []) visit(child);

  return {
    take(node: FigmaNode): FigmaNode | null {
      const key = nodeIdentity(node);
      if (!key) return null;
      return candidates.get(key)?.shift() ?? null;
    },
  };
}

function nodeIdentity(node: FigmaNode): string | null {
  const text = normalize(node.characters ?? "");
  if (node.type === "TEXT" && text) return `text:${text}`;
  const imageRef = node.fills?.find((paint) =>
    paint.visible !== false && paint.type.toUpperCase() === "IMAGE" && paint.imageRef
  )?.imageRef;
  if (imageRef) return `${node.type}:image:${imageRef}`;
  const name = normalize(node.name.replace(DEVICE_NAME, " "));
  if (!name || GENERIC_NODE_NAME.test(name)) return null;
  return `${node.type}:name:${name}`;
}

function adaptiveBounds(
  desktop: FigmaBounds | undefined,
  mobile: FigmaBounds | undefined,
  desktopRoot: FigmaBounds,
  mobileRoot: FigmaBounds,
  targetRoot: FigmaBounds,
  desktopInfluence: number,
): FigmaBounds | undefined {
  if (!desktop) return undefined;
  if (mobile) {
    return {
      x: targetRoot.x + interpolate(
        mobile.x - mobileRoot.x,
        desktop.x - desktopRoot.x,
        desktopInfluence,
      ),
      y: targetRoot.y + interpolate(
        mobile.y - mobileRoot.y,
        desktop.y - desktopRoot.y,
        desktopInfluence,
      ),
      width: Math.max(1, interpolate(mobile.width, desktop.width, desktopInfluence)),
      height: Math.max(1, interpolate(mobile.height, desktop.height, desktopInfluence)),
    };
  }
  const scaleX = targetRoot.width / desktopRoot.width;
  const scaleY = targetRoot.height / desktopRoot.height;
  return {
    x: targetRoot.x + (desktop.x - desktopRoot.x) * scaleX,
    y: targetRoot.y + (desktop.y - desktopRoot.y) * scaleY,
    width: Math.max(1, desktop.width * scaleX),
    height: Math.max(1, desktop.height * scaleY),
  };
}

function adaptiveNullableBounds(
  desktop: FigmaBounds | null | undefined,
  mobile: FigmaBounds | null | undefined,
  desktopRoot: FigmaBounds,
  mobileRoot: FigmaBounds,
  targetRoot: FigmaBounds,
  desktopInfluence: number,
): FigmaBounds | null | undefined {
  if (desktop === null) return null;
  return adaptiveBounds(
    desktop,
    mobile ?? undefined,
    desktopRoot,
    mobileRoot,
    targetRoot,
    desktopInfluence,
  );
}

function adaptiveTypeStyle(
  desktop: FigmaTypeStyle | undefined,
  mobile: FigmaTypeStyle | undefined,
  desktopInfluence: number,
  fallbackScale: number,
): FigmaTypeStyle | undefined {
  if (!desktop) return undefined;
  const style: FigmaTypeStyle = { ...desktop };
  for (const key of ["fontSize", "lineHeightPx", "letterSpacing"] as const) {
    const value = adaptiveNumber(
      desktop[key],
      mobile?.[key],
      desktopInfluence,
      fallbackScale,
    );
    if (value !== undefined) style[key] = value;
  }
  if (mobile && desktopInfluence < 0.5) {
    style.textAlignHorizontal = mobile.textAlignHorizontal ?? desktop.textAlignHorizontal;
    style.textAlignVertical = mobile.textAlignVertical ?? desktop.textAlignVertical;
  }
  return style;
}

function adaptiveCornerRadii(
  desktop: [number, number, number, number] | undefined,
  mobile: [number, number, number, number] | undefined,
  desktopInfluence: number,
  fallbackScale: number,
): [number, number, number, number] | undefined {
  if (!desktop) return undefined;
  return desktop.map((value, index) => adaptiveNumber(
    value,
    mobile?.[index],
    desktopInfluence,
    fallbackScale,
  ) ?? value) as [number, number, number, number];
}

function adaptiveStyleOverrideTable(
  desktop: Record<string, FigmaTypeStyle> | undefined,
  mobile: Record<string, FigmaTypeStyle> | undefined,
  desktopInfluence: number,
  fallbackScale: number,
): Record<string, FigmaTypeStyle> | undefined {
  if (!desktop) return undefined;
  return Object.fromEntries(Object.entries(desktop).map(([key, style]) => [
    key,
    adaptiveTypeStyle(
      style,
      mobile?.[key],
      desktopInfluence,
      fallbackScale,
    ) ?? style,
  ]));
}

function adaptiveNumber(
  desktop: number | undefined,
  mobile: number | undefined,
  desktopInfluence: number,
  fallbackScale: number,
): number | undefined {
  if (!Number.isFinite(desktop)) return undefined;
  if (Number.isFinite(mobile)) {
    return round(interpolate(Number(mobile), Number(desktop), desktopInfluence));
  }
  return round(Number(desktop) * fallbackScale);
}

function validBounds(bounds: FigmaBounds | undefined): bounds is FigmaBounds {
  return Boolean(bounds && bounds.width > 0 && bounds.height > 0);
}

function normalize(value: string): string {
  return value.normalize("NFKC").replace(/\s+/g, " ").trim().toLowerCase();
}

function interpolate(start: number, end: number, progress: number): number {
  return start + (end - start) * progress;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}
