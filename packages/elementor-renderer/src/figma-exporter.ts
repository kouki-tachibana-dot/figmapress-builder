import type {
  FigmaBounds,
  FigmaColor,
  FigmaNode,
  FigmaPaint,
  FigmaTypeStyle,
  MockFigmaFile,
} from "@figmapress/figma-parser";
import type {
  ElementorElement,
  ElementorSettings,
  ElementorTemplate,
} from "./types";

export interface FigmaRenderAssets {
  imageUrls?: Record<string, string>;
  renderedNodeUrls?: Record<string, string>;
  /** Prototype destinations outside the currently converted PC/SP pair. */
  linkTargets?: Record<string, string>;
  /** Semantic page keys used by inferred menus and CTAs in a multi-page site. */
  pageTargets?: Record<string, string>;
}

export type SectionAnchor =
  | "thoughts"
  | "policies"
  | "activities"
  | "profile"
  | "company"
  | "reasons"
  | "services"
  | "works"
  | "demolition"
  | "news"
  | "officers"
  | "contact";

interface RenderContext {
  ids: ElementIdFactory;
  root: FigmaNode;
  rootBounds: FigmaBounds;
  assets: FigmaRenderAssets;
  variant: "single" | "desktop" | "mobile";
  anchorSuffix: string;
  fallbackMenuTexts: FigmaNode[];
  navigationNode: FigmaNode | null;
  contactFormNode: FigmaNode | null;
  anchorTargets: Map<string, SectionAnchor>;
  emittedAnchorIds: Set<string>;
}

interface RichRun {
  text: string;
  style: FigmaTypeStyle;
}

interface FigmaWebfont {
  family: string;
  weights: number[];
  provider: "google";
}

interface FigmaGradientColor {
  red: number;
  green: number;
  blue: number;
  alpha: number;
}

interface FigmaGradientManifest {
  type: "linear" | "radial";
  angle?: number;
  center?: { x: number; y: number };
  radius?: { x: number; y: number };
  stops: Array<{
    color: FigmaGradientColor;
    position: number;
  }>;
}

interface FigmaShadowManifest {
  type: "drop" | "inner";
  x: number;
  y: number;
  blur: number;
  spread: number;
  color: FigmaGradientColor;
}

interface FigmaEffectsManifest {
  opacity?: number;
  shadows?: FigmaShadowManifest[];
  blur?: number;
  backgroundBlur?: number;
}

interface FigmaImageManifest {
  mode: "fill" | "fit" | "stretch" | "tile";
  transform?: {
    a: number;
    b: number;
    c: number;
    d: number;
    tx: number;
    ty: number;
  };
  rotation?: number;
  scalingFactor?: number;
  filters?: NonNullable<FigmaPaint["filters"]>;
}

interface FigmaVisualAsset {
  url: string;
  rendered: boolean;
  paint?: FigmaPaint;
}

interface AccordionItem {
  title: string;
  content: string;
  titleBounds?: FigmaBounds;
  contentBounds?: FigmaBounds;
}

interface AccordionPlan {
  bounds: FigmaBounds;
  items: AccordionItem[];
}

interface FunctionalLink {
  url: string;
  label: string;
  external: boolean;
}

interface CarouselItem {
  id: string;
  imageUrl: string;
  title: string;
  link: FunctionalLink | null;
}

interface CarouselPlan {
  items: CarouselItem[];
  previousIconUrl: string;
  nextIconUrl: string;
}

class ElementIdFactory {
  private readonly seen = new Set<string>();

  create(seed: string): string {
    let id = hashId(seed);
    let suffix = 0;
    while (this.seen.has(id)) {
      suffix += 1;
      id = hashId(`${seed}:${suffix}`);
    }
    this.seen.add(id);
    return id;
  }
}

export interface FigmaResponsiveRoots {
  desktop: FigmaNode | null;
  mobile: FigmaNode | null;
}

export function findFigmaResponsiveRoots(file: MockFigmaFile): FigmaResponsiveRoots {
  const canvases = (file.document.children ?? []).filter((node) => node.type === "CANVAS");
  const candidates = canvases.flatMap((canvas) =>
    (canvas.children ?? []).filter((node) => node.visible !== false && validBounds(node.absoluteBoundingBox)),
  );
  const desktopNamed = candidates
    .filter((node) => responsiveFrameKind(node) === "desktop")
    .sort((left, right) => area(right) - area(left));
  const mobileNamed = candidates
    .filter((node) => responsiveFrameKind(node) === "mobile")
    .sort((left, right) => area(right) - area(left));
  const desktop = desktopNamed[0]
    ?? candidates
      .filter((node) => responsiveFrameKind(node) !== "mobile")
      .sort((left, right) => area(right) - area(left))[0]
    ?? candidates.sort((left, right) => area(right) - area(left))[0]
    ?? null;
  const mobile = desktop
    ? mobileNamed.find((node) => node.id !== desktop.id) ?? null
    : null;
  return { desktop, mobile };
}

export function findFigmaDesignRoot(file: MockFigmaFile): FigmaNode | null {
  return findFigmaResponsiveRoots(file).desktop;
}

export function hasFigmaResponsiveLayout(file: MockFigmaFile): boolean {
  const roots = findFigmaResponsiveRoots(file);
  return Boolean(roots.desktop && roots.mobile);
}

export function hasFigmaLayout(file: MockFigmaFile): boolean {
  return findFigmaDesignRoot(file) !== null;
}

export function figmaLayoutSectionNames(file: MockFigmaFile): string[] {
  const root = findFigmaDesignRoot(file);
  if (!root) return [];
  return (root.children ?? [])
    .filter((node) => node.visible !== false && validBounds(node.absoluteBoundingBox))
    .slice()
    .sort((left, right) => {
      const y = (left.absoluteBoundingBox?.y ?? 0) - (right.absoluteBoundingBox?.y ?? 0);
      return y || (left.absoluteBoundingBox?.x ?? 0) - (right.absoluteBoundingBox?.x ?? 0);
    })
    .map((node) => `figma/${node.name}`);
}

export class FigmaElementorExporter {
  toTemplate(
    file: MockFigmaFile,
    title: string,
    assets: FigmaRenderAssets = {},
  ): ElementorTemplate {
    const roots = findFigmaResponsiveRoots(file);
    const root = roots.desktop;
    if (!root?.absoluteBoundingBox) {
      throw new Error("Figmaの選択ノードにレイアウト座標がありません。");
    }

    const ids = new ElementIdFactory();
    const fallbackMenuTexts = findFigmaNavigationMenuTexts(root);
    const responsive = Boolean(roots.mobile?.absoluteBoundingBox);
    const content: ElementorElement[] = [
      renderRootElement(
        root,
        createRenderContext(
          ids,
          root,
          assets,
          responsive ? "desktop" : "single",
          responsive ? "-desktop" : "",
          fallbackMenuTexts,
        ),
        responsive ? { hide_mobile: "hidden-mobile" } : {},
      ),
    ];
    if (roots.mobile?.absoluteBoundingBox) {
      content.push(renderRootElement(
        roots.mobile,
        createRenderContext(
          ids,
          roots.mobile,
          assets,
          "mobile",
          "-mobile",
          fallbackMenuTexts,
        ),
        {
          hide_desktop: "hidden-desktop",
          hide_tablet: "hidden-tablet",
        },
      ));
    }

    return {
      title,
      type: "page",
      version: "0.4",
      page_settings: {
        background_background: "classic",
        background_color: solidColor(root.fills) ?? "#FFFFFF",
        figmapress_webfonts: figmaWebfonts(
          [root, roots.mobile].filter((node): node is FigmaNode => Boolean(node)),
        ),
        hide_title: "yes",
      },
      content,
    };
  }
}

export function renderFigmaPreview(
  file: MockFigmaFile,
  assets: FigmaRenderAssets = {},
): string | null {
  const roots = findFigmaResponsiveRoots(file);
  const root = roots.desktop;
  const rootBounds = root?.absoluteBoundingBox;
  if (!root || !rootBounds) return null;
  const ids = new ElementIdFactory();
  const fallbackMenuTexts = findFigmaNavigationMenuTexts(root);
  const responsive = Boolean(roots.mobile?.absoluteBoundingBox);
  const desktop = previewRoot(
    root,
    createRenderContext(
      ids,
      root,
      assets,
      responsive ? "desktop" : "single",
      responsive ? "-desktop" : "",
      fallbackMenuTexts,
    ),
    responsive ? " figmapress-figma-preview--desktop" : "",
  );
  if (!roots.mobile?.absoluteBoundingBox) return desktop;
  const mobile = previewRoot(
    roots.mobile,
    createRenderContext(
      ids,
      roots.mobile,
      assets,
      "mobile",
      "-mobile",
      fallbackMenuTexts,
    ),
    " figmapress-figma-preview--mobile",
  );
  return `<div class="figmapress-responsive-preview">${desktop}${mobile}</div>`;
}

function createRenderContext(
  ids: ElementIdFactory,
  root: FigmaNode,
  assets: FigmaRenderAssets,
  variant: RenderContext["variant"],
  anchorSuffix: string,
  fallbackMenuTexts: FigmaNode[],
): RenderContext {
  const anchorTargets = discoverSectionAnchorTargets(root);
  return {
    ids,
    root,
    rootBounds: root.absoluteBoundingBox as FigmaBounds,
    assets,
    variant,
    anchorSuffix,
    fallbackMenuTexts,
    navigationNode: findFigmaNavigationNode(root, fallbackMenuTexts),
    contactFormNode: findFigmaContactFormNode(root),
    anchorTargets,
    emittedAnchorIds: new Set([`top${anchorSuffix}`]),
  };
}

function renderRootElement(
  root: FigmaNode,
  context: RenderContext,
  visibility: ElementorSettings,
): ElementorElement {
  const rootBounds = context.rootBounds;
  const rootAccordion = accordionPlan(root);
  const children = rootRenderNodes(root, context)
    .filter((node) => !rootAccordion || !isInsideInteractionBounds(node, rootAccordion.bounds))
    .map((node) => renderElement(node, rootBounds, root, context))
    .filter((element): element is ElementorElement => element !== null)
    .map((element) => ({
      ...element,
      settings: {
        ...element.settings,
        figmapress_section: "yes",
      },
    }));
  if (rootAccordion) {
    const accordion = accordionElement(root, rootAccordion, rootBounds, root, context);
    children.push({
      ...accordion,
      settings: {
        ...accordion.settings,
        figmapress_section: "yes",
      },
    });
  }
  return {
    id: context.ids.create(`${root.id}:root`),
    elType: "container",
    isInner: false,
    settings: {
      ...baseContainerSettings(root, context),
      ...visibility,
      figmapress_node_id: root.id,
      figmapress_node_name: root.name,
      _element_id: anchorId("top", context),
      css_classes: `figmapress-layout figmapress-layout--${context.variant}`,
      content_width: "full",
      width: size(100, "%"),
      min_height: canvasSize(rootBounds.height, context),
      html_tag: "main",
      overflow: root.clipsContent === false ? "" : "hidden",
    },
    elements: children,
  };
}

function previewRoot(
  root: FigmaNode,
  context: RenderContext,
  className: string,
): string {
  const rootBounds = context.rootBounds;
  const gradient = gradientCss(figmaGradient(root));
  const background = gradient
    ? `background-image:${escapeAttribute(gradient)};`
    : `background:${escapeAttribute(solidColor(root.fills) ?? "#FFFFFF")};`;
  return `<div class="figmapress-figma-preview${className}" data-figmapress-layout="${context.variant}" style="--figma-unit:calc(100cqw / ${round(rootBounds.width)});aspect-ratio:${round(rootBounds.width)}/${round(rootBounds.height)};${background}${previewAutoLayout(root)}${previewEffects(root)}">${rootRenderNodes(root, context).map((node) => previewNode(node, rootBounds, root, context)).join("")}</div>`;
}

function rootRenderNodes(root: FigmaNode, context: RenderContext): FigmaNode[] {
  const children = root.children ?? [];
  const syntheticNodes = [context.navigationNode, context.contactFormNode]
    .filter((node): node is FigmaNode => Boolean(
      node && !children.some((child) =>
        child.id === node.id || descendants(child).some((nested) => nested.id === node.id)
      ),
    ));
  if (!syntheticNodes.length) return children;
  const consumedByNode = syntheticNodes.map((node) => ({
    node,
    ids: new Set((node.children ?? []).map((child) => child.id)),
  }));
  const consumedIds = new Set(consumedByNode.flatMap(({ ids }) => [...ids]));
  const insertions = new Map<number, FigmaNode[]>();
  for (const entry of consumedByNode) {
    const firstIndex = children.findIndex((child) => entry.ids.has(child.id));
    const index = firstIndex >= 0 ? firstIndex : 0;
    insertions.set(index, [...(insertions.get(index) ?? []), entry.node]);
  }
  const result: FigmaNode[] = [];
  for (let index = 0; index < children.length; index += 1) {
    result.push(...(insertions.get(index) ?? []));
    const child = children[index];
    if (child && !consumedIds.has(child.id)) result.push(child);
  }
  return result;
}

function renderElement(
  node: FigmaNode,
  parentBounds: FigmaBounds,
  parentNode: FigmaNode,
  context: RenderContext,
): ElementorElement | null {
  const bounds = node.absoluteBoundingBox;
  if (node.visible === false || !bounds || bounds.width <= 0 || bounds.height <= 0) return null;

  const navigation = navigationElement(node, bounds, parentBounds, parentNode, context);
  if (navigation) return withSectionAnchor(navigation, node, context);
  const contactForm = contactFormElement(node, bounds, parentBounds, parentNode, context);
  if (contactForm) return withSectionAnchor(contactForm, node, context);
  const carousel = carouselElement(node, bounds, parentBounds, parentNode, context);
  if (carousel) return withSectionAnchor(carousel, node, context);

  const asset = visualAsset(node, context.assets);
  if (asset) {
    return withSectionAnchor(
      imageElement(node, bounds, parentBounds, parentNode, asset, context),
      node,
      context,
    );
  }
  if (node.type === "TEXT" && typeof node.characters === "string") {
    return withSectionAnchor(
      textElement(node, bounds, parentBounds, parentNode, context),
      node,
      context,
    );
  }

  const accordion = accordionPlan(node);
  const children = (node.children ?? [])
    .filter((child) => !accordion || !isInsideInteractionBounds(child, accordion.bounds))
    .map((child) => renderElement(child, bounds, node, context))
    .filter((element): element is ElementorElement => element !== null);
  if (accordion) {
    children.push(accordionElement(node, accordion, bounds, node, context));
  }
  const action = functionalLink(node, context);
  if (action) {
    children.push(linkOverlayElement(node, action, context));
  }
  const hasVisibleStyle = Boolean(
    solidColor(node.fills)
    || figmaGradient(node)
    || solidColor(node.strokes),
  );
  if (!children.length && !hasVisibleStyle) return null;

  return withSectionAnchor({
    id: context.ids.create(node.id),
    elType: "container",
    isInner: true,
    settings: {
      ...baseContainerSettings(node, context, parentBounds),
      ...containerPosition(node, bounds, parentBounds, parentNode, context),
      figmapress_node_id: node.id,
      figmapress_node_name: node.name,
      html_tag: htmlTag(node),
    },
    elements: children,
  }, node, context);
}

function navigationElement(
  node: FigmaNode,
  bounds: FigmaBounds,
  parentBounds: FigmaBounds,
  parentNode: FigmaNode,
  context: RenderContext,
): ElementorElement | null {
  const localMenuTexts = navigationMenuTexts(node);
  const menuTexts = localMenuTexts.length >= 2 ? localMenuTexts : context.fallbackMenuTexts;
  if (context.navigationNode?.id !== node.id || menuTexts.length < 2) return null;

  const navigationVisuals = descendants(node)
    .filter((child) => child.absoluteBoundingBox && visualUrl(child, context.assets))
    .sort((left, right) => {
      const leftBounds = left.absoluteBoundingBox as FigmaBounds;
      const rightBounds = right.absoluteBoundingBox as FigmaBounds;
      return leftBounds.x - rightBounds.x || area(right) - area(left);
    });
  const logoNode = descendants(node).find((child) => /(?:header\/logo|\blogo\b|ロゴ)/i.test(child.name))
    ?? navigationVisuals.find((child) => {
      const childBounds = child.absoluteBoundingBox as FigmaBounds;
      return childBounds.x + childBounds.width / 2 < bounds.x + bounds.width * 0.6;
    });
  const logoUrl = logoNode ? visualUrl(logoNode, context.assets) ?? "" : "";
  const ctaText = descendants(node).find((child) =>
    child.type === "TEXT" && /(?:headercta\/text|ご相談|お問い合わせ|contact)/i.test(`${child.name} ${child.characters ?? ""}`),
  );
  const background = descendants(node).find((child) => /nav bar background/i.test(child.name));
  const topBar = descendants(node).find((child) => /top bar/i.test(child.name));
  const namedToggleNode = descendants(node).find((child) =>
    /(?:hamburger|menu.?icon|header\/menu|メニュー.?アイコン)/i.test(child.name),
  );
  const inferredToggleNode = context.variant === "mobile"
    ? navigationVisuals
      .filter((child) => child !== logoNode)
      .filter((child) => {
        const childBounds = child.absoluteBoundingBox as FigmaBounds;
        const centerX = childBounds.x + childBounds.width / 2;
        const centerY = childBounds.y + childBounds.height / 2;
        return centerX >= bounds.x + bounds.width * 0.72
          && centerY <= bounds.y + bounds.height * 0.72
          && childBounds.width <= bounds.width * 0.18
          && childBounds.height <= bounds.height * 0.72;
      })
      .sort((left, right) => {
        const leftBounds = left.absoluteBoundingBox as FigmaBounds;
        const rightBounds = right.absoluteBoundingBox as FigmaBounds;
        return rightBounds.x - leftBounds.x
          || area(left) - area(right);
      })[0]
    : undefined;
  const toggleNode = namedToggleNode ?? inferredToggleNode;
  const ctaBackground = ctaText?.absoluteBoundingBox
    ? smallestContainingVisual(node, ctaText.absoluteBoundingBox)
    : undefined;
  const ctaBounds = ctaBackground?.absoluteBoundingBox ?? ctaText?.absoluteBoundingBox;
  const ctaIconNode = ctaBounds ? navigationVisuals
    .filter((child) => child !== logoNode)
    .find((child) => {
      const childBounds = child.absoluteBoundingBox as FigmaBounds;
      const centerX = childBounds.x + childBounds.width / 2;
      const centerY = childBounds.y + childBounds.height / 2;
      return centerX >= ctaBounds.x
        && centerX <= ctaBounds.x + ctaBounds.width
        && centerY >= ctaBounds.y
        && centerY <= ctaBounds.y + ctaBounds.height;
    }) : undefined;
  const ctaIconUrl = ctaIconNode ? visualUrl(ctaIconNode, context.assets) ?? "" : "";

  const settings: ElementorSettings = {
    ...widgetPosition(node, bounds, parentBounds, parentNode),
    figmapress_node_id: node.id,
    figmapress_node_name: node.name,
    _element_id: anchorId("site-navigation", context),
    layout_variant: context.variant,
    logo: logoUrl ? {
      url: logoUrl,
      id: "",
      alt: "サイトロゴ",
      source: "library",
      figmapress_key: mediaKey(`${node.id}:logo`, logoUrl),
    } : undefined,
    cta_icon: ctaIconUrl ? {
      url: ctaIconUrl,
      id: "",
      alt: "",
      source: "library",
      figmapress_key: mediaKey(`${node.id}:cta-icon`, ctaIconUrl),
    } : undefined,
    items: menuTexts.map((item, index) => ({
      _id: hashId(`${item.id}:menu:${index}`),
      label: item.characters?.trim() ?? "",
      url: elementorUrl(
        functionalLink(item, context, false)
          ?? inferredSectionLink(item.characters ?? "", context),
      ),
    })),
    // A page-menu item named "お問い合わせ" is not automatically a separate
    // header CTA. Emitting a default label without a Figma box made the
    // absolutely positioned CTA cover the entire high-fidelity navigation.
    cta_label: ctaText?.characters?.trim() || "",
    cta_url: elementorUrl(
      functionalLink(ctaText ?? node, context, false)
        ?? inferredSectionLink("お問い合わせ", context),
    ),
    home_url: elementorUrl({
      url: context.assets.pageTargets?.home?.trim() || anchorHref("top", context),
      label: "ホーム",
      external: false,
    }),
    // High-fidelity headers commonly sit directly over the hero. An opaque
    // fallback is a visible design change when Figma has no background layer.
    background_color: solidColor(background?.fills) ?? "transparent",
    accent_color: solidColor(topBar?.fills) ?? "#D10B2C",
    text_color: solidColor(menuTexts[0]?.fills) ?? "#202020",
    design_geometry: JSON.stringify({
      root: { width: round(bounds.width), height: round(bounds.height) },
      background: relativeDesignBox(background?.absoluteBoundingBox, bounds),
      topBar: relativeDesignBox(topBar?.absoluteBoundingBox, bounds),
      logo: relativeDesignBox(logoNode?.absoluteBoundingBox, bounds),
      ctaIcon: relativeDesignBox(ctaIconNode?.absoluteBoundingBox, bounds),
      toggle: relativeDesignBox(toggleNode?.absoluteBoundingBox, bounds),
      items: menuTexts.map((item) => ({
        ...relativeDesignBox(item.absoluteBoundingBox, bounds),
        ...designTextStyle(item, bounds.width),
      })),
      cta: {
        ...relativeDesignBox(ctaBounds, bounds),
        ...designTextStyle(ctaText, bounds.width),
      },
    }),
  };
  applyEffects(settings, node);
  return widget(context.ids, node.id, "figmapress-nav", settings);
}

const CONTACT_EMAIL_LABEL = /(?:メールアドレス|e-?mail|^アドレス$)/i;
const CONTACT_MESSAGE_LABEL = /(?:ご相談|ご意見|message|お問い合わせ内容|ご質問(?:の)?詳細)/i;
const CONTACT_NAME_LABEL = /(?:お名前|氏名|name|企業名|会社名|ご担当者(?:様)?)/i;
const CONTACT_FORM_NODE_NAME = /(?:\{wp:form\}|contact.?form|button.?cta|お問い合わせ)/i;

function contactFormTexts(node: FigmaNode): FigmaNode[] {
  return descendants(node)
    .filter((child) => child.type === "TEXT" && child.characters?.trim() && child.absoluteBoundingBox)
    .sort((left, right) => {
      const y = (left.absoluteBoundingBox?.y ?? 0) - (right.absoluteBoundingBox?.y ?? 0);
      return y || (left.absoluteBoundingBox?.x ?? 0) - (right.absoluteBoundingBox?.x ?? 0);
    });
}

function looksLikeContactFormCopy(copy: string[]): boolean {
  return copy.some((value) => CONTACT_EMAIL_LABEL.test(value))
    && copy.some((value) => CONTACT_MESSAGE_LABEL.test(value))
    && copy.some((value) => CONTACT_NAME_LABEL.test(value))
    && copy.some((value) => /送る|送信|submit/i.test(value));
}

function looseRootContactFormNode(root: FigmaNode): FigmaNode | null {
  const rootBounds = root.absoluteBoundingBox;
  if (!rootBounds) return null;
  const children = root.children ?? [];
  const formTexts = contactFormTexts(root);
  const copy = formTexts.map((child) => child.characters?.trim() ?? "");
  if (!looksLikeContactFormCopy(copy) || contactFieldPlans(formTexts).length < 4) return null;
  const startNode = formTexts.find((child) =>
    /^(?:お問い合わせ項目|企業名|会社名|お名前|氏名|ご担当者(?:様)?)$/i.test(
      child.characters?.trim() ?? "",
    ),
  );
  const endNode = formTexts
    .filter((child) => /^(?:送る|送信|submit)$/i.test(child.characters?.trim() ?? ""))
    .sort((left, right) =>
      (right.absoluteBoundingBox?.y ?? 0) - (left.absoluteBoundingBox?.y ?? 0)
    )[0];
  const startBounds = startNode?.absoluteBoundingBox;
  const endBounds = endNode?.absoluteBoundingBox;
  if (!startBounds || !endBounds || endBounds.y <= startBounds.y) return null;
  const padding = Math.max(24, rootBounds.width * 0.035);
  const startY = Math.max(rootBounds.y, startBounds.y - padding);
  const endY = Math.min(
    rootBounds.y + rootBounds.height,
    endBounds.y + endBounds.height + padding,
  );
  const formChildren = children.filter((child) => {
    const bounds = child.absoluteBoundingBox;
    if (child.visible === false || !bounds) return false;
    const centerY = bounds.y + bounds.height / 2;
    if (centerY < startY || centerY > endY) return false;
    const nestedTexts = child.type === "TEXT" ? [child] : contactFormTexts(child);
    const nestedCenters = nestedTexts
      .map((text) => text.absoluteBoundingBox)
      .filter((textBounds): textBounds is FigmaBounds => Boolean(textBounds))
      .map((textBounds) => textBounds.y + textBounds.height / 2);
    return bounds.height <= (endY - startY) * 1.25
      || (nestedCenters.length > 0
        && nestedCenters.every((nestedCenter) => nestedCenter >= startY && nestedCenter <= endY));
  });
  if (!formChildren.length) return null;
  const formHeight = endY - startY;
  const isLargeBackgroundLayer = (child: FigmaNode): boolean => {
    if (child.type === "TEXT") return false;
    if (contactFormTexts(child).length > 0) return false;
    return [child, ...descendants(child)].some((surface) => {
      const surfaceBounds = surface.absoluteBoundingBox;
      if (!surfaceBounds || surface.type === "TEXT") return false;
      const hasPaint = Boolean(
        solidColor(surface.fills)
        || figmaGradient(surface)
        || ownImagePaint(surface),
      );
      return hasPaint
        && surfaceBounds.width >= rootBounds.width * 0.72
        && surfaceBounds.height >= formHeight * 0.45;
    });
  };
  // A loose root-level form often stores its translucent panel after labels
  // in the Figma child list. Once those nodes are grouped into a synthetic
  // form container, normal DOM paint order would place that panel on top and
  // make otherwise valid labels and controls look blank. Keep large paint-only
  // surfaces at the back while preserving the original order within each tier.
  const orderedFormChildren = formChildren
    .map((child, index) => ({ child, index }))
    .sort((left, right) =>
      Number(!isLargeBackgroundLayer(left.child))
      - Number(!isLargeBackgroundLayer(right.child))
      || left.index - right.index
    )
    .map(({ child }) => child);
  return {
    id: `${root.id}:figmapress-contact-form`,
    name: "{wp:form} inferred loose contact form",
    type: "FRAME",
    absoluteBoundingBox: {
      x: rootBounds.x,
      y: startY,
      width: rootBounds.width,
      height: endY - startY,
    },
    children: orderedFormChildren,
  };
}

/** Find one regular or root-level loose contact form for a responsive frame. */
export function findFigmaContactFormNode(root: FigmaNode): FigmaNode | null {
  const candidates = descendants(root)
    .filter((node) => node.type !== "TEXT" && node.visible !== false && node.absoluteBoundingBox)
    .flatMap((node) => {
      const texts = contactFormTexts(node);
      const copy = texts.map((child) => child.characters?.trim() ?? "");
      if (!looksLikeContactFormCopy(copy)) return [];
      return [{
        node,
        fieldCount: contactFieldPlans(texts).length,
        explicitlyNamed: CONTACT_FORM_NODE_NAME.test(node.name),
      }];
    })
    .sort((left, right) =>
      right.fieldCount - left.fieldCount
      || Number(right.explicitlyNamed) - Number(left.explicitlyNamed)
      || (left.explicitlyNamed && right.explicitlyNamed
        ? area(right.node) - area(left.node)
        : area(left.node) - area(right.node))
    );
  return candidates[0]?.node ?? looseRootContactFormNode(root);
}

interface ContactFieldPlan {
  name: string;
  label: string;
  type: "text" | "email" | "tel" | "textarea" | "radio" | "checkbox";
  required: boolean;
  options?: string[];
  autocomplete?: string;
  node: FigmaNode;
}

function contactFieldPlans(texts: FigmaNode[]): ContactFieldPlan[] {
  const definitions: Array<{
    name: string;
    pattern: RegExp;
    type: ContactFieldPlan["type"];
    required: boolean;
    options?: string[];
    autocomplete?: string;
  }> = [
    { name: "inquiry_type", pattern: /^お問い合わせ項目$/, type: "radio", required: true, options: ["お問い合わせ", "資料請求"] },
    { name: "company", pattern: /^(?:企業名|会社名)$/, type: "text", required: true, autocomplete: "organization" },
    { name: "company_kana", pattern: /^読み方$/, type: "text", required: true },
    { name: "name", pattern: /^(?:ご担当者様|お名前|氏名|name)$/i, type: "text", required: true, autocomplete: "name" },
    { name: "name_kana", pattern: /^ふりがな$/, type: "text", required: true },
    { name: "address", pattern: /^(?:ご住所|住所|お住まいの地域|地域|area)$/i, type: "text", required: true, autocomplete: "street-address" },
    { name: "phone", pattern: /^(?:電話番号|電話|tel(?:ephone)?|phone)$/i, type: "tel", required: true, autocomplete: "tel" },
    { name: "email", pattern: /^(?:メールアドレス|e-?mail|アドレス)$/i, type: "email", required: true, autocomplete: "email" },
    { name: "source", pattern: /^HPを知られたキッカケ$/, type: "text", required: true },
    { name: "message", pattern: /^(?:ご質問の詳細|ご相談・ご意見の内容|お問い合わせ内容|message)$/i, type: "textarea", required: false },
    { name: "privacy_consent", pattern: /^【?個人情報の取扱い】?$/, type: "checkbox", required: true },
  ];
  return definitions.flatMap((definition) => {
    const node = texts.find((candidate) => definition.pattern.test(candidate.characters?.trim() ?? ""));
    if (!node) return [];
    return [{
      ...definition,
      label: definition.name === "privacy_consent"
        ? "個人情報の取扱いに同意する"
        : node.characters?.trim() ?? definition.name,
      node,
    }];
  });
}

function contactFormElement(
  node: FigmaNode,
  bounds: FigmaBounds,
  parentBounds: FigmaBounds,
  parentNode: FigmaNode,
  context: RenderContext,
): ElementorElement | null {
  const texts = contactFormTexts(node);
  const copy = texts.map((child) => child.characters?.trim() ?? "");
  if (context.contactFormNode?.id !== node.id || !looksLikeContactFormCopy(copy)) return null;

  const exact = (pattern: RegExp, fallback: string): string =>
    copy.find((value) => pattern.test(value)) ?? fallback;
  const titleNode = texts.find((child) => /声を聞かせて|お問い合わせ|ご相談ください/.test(child.characters ?? ""));
  const title = titleNode?.characters?.trim() ?? "お問い合わせ";
  const nameNode = texts.find((child) => /^(?:ご担当者様|お名前|氏名|name|企業名|会社名)$/i.test(child.characters?.trim() ?? ""));
  const emailNode = texts.find((child) => CONTACT_EMAIL_LABEL.test(child.characters?.trim() ?? ""));
  const regionNode = texts.find((child) => /ご住所|住所|お住まいの地域|地域|area/i.test(child.characters?.trim() ?? ""));
  const messageNode = texts.find((child) => CONTACT_MESSAGE_LABEL.test(child.characters?.trim() ?? ""));
  const replyNode = texts.find((child) => /^返信希望$/.test(child.characters?.trim() ?? ""));
  const replyYesNode = texts.find((child) => /^希望する$/.test(child.characters?.trim() ?? ""));
  const replyNoNode = texts.find((child) => /^希望しない$/.test(child.characters?.trim() ?? ""));
  const panel = descendants(node).find((child) => {
    const childBounds = child.absoluteBoundingBox;
    return childBounds && childBounds.width > bounds.width * 0.4 && childBounds.width < bounds.width * 0.9
      && childBounds.height > bounds.height * 0.35;
  });
  const buttonNode = descendants(node).find((child) =>
    child.type === "TEXT" && /送る|送信|submit/i.test(child.characters ?? ""),
  );
  const buttonBounds = buttonNode?.absoluteBoundingBox;
  const buttonBackground = buttonBounds ? descendants(node).find((child) => {
    const candidate = child.absoluteBoundingBox;
    if (!candidate || child.type === "TEXT" || !solidColor(child.fills)) return false;
    const centerX = buttonBounds.x + buttonBounds.width / 2;
    const centerY = buttonBounds.y + buttonBounds.height / 2;
    return centerX >= candidate.x && centerX <= candidate.x + candidate.width
      && centerY >= candidate.y && centerY <= candidate.y + candidate.height
      && candidate.width > buttonBounds.width && candidate.height > buttonBounds.height
      && candidate.height < bounds.height * 0.2;
  }) : undefined;
  const controlCandidates = descendants(node).filter((child) => {
    const candidate = child.absoluteBoundingBox;
    if (!candidate || child === panel || child === buttonBackground || child.type === "TEXT") return false;
    const hasControlSurface = Boolean(
      solidColor(child.fills)
      || solidColor(child.strokes)
      || /(?:rectangle|input|field|textarea)/i.test(child.name),
    );
    if (!hasControlSurface) return false;
    return candidate.width > bounds.width * 0.18
      && candidate.width < bounds.width * 0.98
      && candidate.height > bounds.height * 0.008
      && candidate.height < bounds.height * 0.25;
  });
  const controlFor = (labelNode: FigmaNode | undefined): FigmaNode | undefined => {
    const labelBounds = labelNode?.absoluteBoundingBox;
    if (!labelBounds) return undefined;
    const labelCenterY = labelBounds.y + labelBounds.height / 2;
    const horizontal = controlCandidates
      .filter((candidate) => {
        const candidateBounds = candidate.absoluteBoundingBox as FigmaBounds;
        return candidateBounds.x > labelBounds.x + labelBounds.width
          && labelCenterY >= candidateBounds.y - candidateBounds.height * 0.35
          && labelCenterY <= candidateBounds.y + candidateBounds.height * 1.35;
      })
      .sort((left, right) => {
        const leftBounds = left.absoluteBoundingBox as FigmaBounds;
        const rightBounds = right.absoluteBoundingBox as FigmaBounds;
        return Math.abs((leftBounds.y + leftBounds.height / 2) - labelCenterY)
          - Math.abs((rightBounds.y + rightBounds.height / 2) - labelCenterY);
      })[0];
    if (horizontal) return horizontal;

    const labelBottom = labelBounds.y + labelBounds.height;
    return controlCandidates
      .filter((candidate) => {
        const candidateBounds = candidate.absoluteBoundingBox as FigmaBounds;
        const verticalGap = candidateBounds.y - labelBottom;
        return verticalGap >= -2
          && verticalGap <= bounds.height * 0.08
          && Math.abs(candidateBounds.x - labelBounds.x) <= bounds.width * 0.15;
      })
      .sort((left, right) => {
        const leftBounds = left.absoluteBoundingBox as FigmaBounds;
        const rightBounds = right.absoluteBoundingBox as FigmaBounds;
        const leftScore = Math.max(0, leftBounds.y - labelBottom)
          + Math.abs(leftBounds.x - labelBounds.x) * 0.25;
        const rightScore = Math.max(0, rightBounds.y - labelBottom)
          + Math.abs(rightBounds.x - labelBounds.x) * 0.25;
        return leftScore - rightScore;
      })[0];
  };
  const fieldGeometry = (labelNode: FigmaNode | undefined) => ({
    label: {
      ...relativeDesignBox(labelNode?.absoluteBoundingBox, bounds),
      ...designTextStyle(labelNode, bounds.width),
    },
    control: relativeDesignBox(controlFor(labelNode)?.absoluteBoundingBox, bounds),
  });
  const fields = contactFieldPlans(texts);
  const fieldsGeometry = Object.fromEntries(
    fields.map((field) => [field.name, fieldGeometry(field.node)]),
  );

  const settings: ElementorSettings = {
    ...widgetPosition(node, bounds, parentBounds, parentNode),
    figmapress_node_id: node.id,
    figmapress_node_name: node.name,
    _element_id: anchorId("contact", context),
    title,
    fields: fields.map((field, index) => ({
      _id: hashId(`${node.id}:contact-field:${field.name}:${index}`),
      name: field.name,
      label: field.label,
      type: field.type,
      required: field.required ? "yes" : "",
      options: field.options?.join("\n") ?? "",
      autocomplete: field.autocomplete ?? "",
    })),
    name_label: exact(/^(?:ご担当者様|お名前|氏名|name|企業名|会社名)$/i, "お名前"),
    email_label: exact(CONTACT_EMAIL_LABEL, "メールアドレス"),
    region_label: exact(/ご住所|住所|お住まいの地域|地域|area/i, "お住まいの地域"),
    message_label: exact(CONTACT_MESSAGE_LABEL, "ご相談・ご意見の内容"),
    reply_label: exact(/返信希望/, "返信希望"),
    reply_yes_label: exact(/^希望する$/, "希望する"),
    reply_no_label: exact(/^希望しない$/, "希望しない"),
    button_text: buttonNode?.characters?.trim() || "送信する",
    accent_color: solidColor(buttonBackground?.fills) ?? "#B90A23",
    panel_color: solidColor(panel?.fills) ?? "#FFE2E8",
    text_color: "#202020",
    success_message: "送信しました。お問い合わせありがとうございます。",
    design_geometry: JSON.stringify({
      root: { width: round(bounds.width), height: round(bounds.height) },
      panel: relativeDesignBox(panel?.absoluteBoundingBox, bounds),
      title: {
        ...relativeDesignBox(titleNode?.absoluteBoundingBox, bounds),
        ...designTextStyle(titleNode, bounds.width),
      },
      fields: {
        name: fieldGeometry(nameNode),
        email: fieldGeometry(emailNode),
        region: fieldGeometry(regionNode),
        message: fieldGeometry(messageNode),
        ...fieldsGeometry,
      },
      reply: {
        label: {
          ...relativeDesignBox(replyNode?.absoluteBoundingBox, bounds),
          ...designTextStyle(replyNode, bounds.width),
        },
        yes: {
          ...relativeDesignBox(replyYesNode?.absoluteBoundingBox, bounds),
          ...designTextStyle(replyYesNode, bounds.width),
        },
        no: {
          ...relativeDesignBox(replyNoNode?.absoluteBoundingBox, bounds),
          ...designTextStyle(replyNoNode, bounds.width),
        },
      },
      button: {
        box: {
          ...relativeDesignBox(buttonBackground?.absoluteBoundingBox, bounds),
          ...designTextStyle(buttonNode, bounds.width),
        },
        text: {
          ...relativeDesignBox(buttonNode?.absoluteBoundingBox, bounds),
          ...designTextStyle(buttonNode, bounds.width),
        },
      },
    }),
  };
  applyEffects(settings, node);
  return widget(context.ids, node.id, "figmapress-contact-form", settings);
}

function carouselElement(
  node: FigmaNode,
  bounds: FigmaBounds,
  parentBounds: FigmaBounds,
  parentNode: FigmaNode,
  context: RenderContext,
): ElementorElement | null {
  const plan = carouselPlan(node, context);
  if (!plan) return null;
  const itemsPerView = context.variant === "mobile"
    ? 1
    : Math.min(3, plan.items.length);
  const settings: ElementorSettings = {
    ...widgetPosition(node, bounds, parentBounds, parentNode),
    figmapress_node_id: node.id,
    figmapress_node_name: node.name,
    items: plan.items.map((item, index) => ({
      _id: hashId(`${item.id}:carousel:${index}`),
      image: {
        url: item.imageUrl,
        id: "",
        alt: item.title,
        source: "library",
        figmapress_key: mediaKey(`${item.id}:carousel:${index}`, item.imageUrl),
      },
      title: item.title,
      url: item.link ? elementorUrl(item.link) : { url: "", is_external: "", nofollow: "" },
    })),
    previous_icon: plan.previousIconUrl
      ? {
          url: plan.previousIconUrl,
          id: "",
          alt: "前へ",
          source: "library",
          figmapress_key: mediaKey(`${node.id}:previous`, plan.previousIconUrl),
        }
      : undefined,
    next_icon: plan.nextIconUrl
      ? {
          url: plan.nextIconUrl,
          id: "",
          alt: "次へ",
          source: "library",
          figmapress_key: mediaKey(`${node.id}:next`, plan.nextIconUrl),
        }
      : undefined,
    items_per_view: itemsPerView,
    items_per_view_mobile: 1,
    show_dots: "yes",
    loop: plan.items.length > itemsPerView ? "yes" : "",
    autoplay: "",
    accent_color: solidColor(node.strokes) ?? "#D10B2C",
  };
  applyEffects(settings, node);
  return widget(context.ids, node.id, "figmapress-carousel", settings);
}

function carouselPlan(node: FigmaNode, context: RenderContext): CarouselPlan | null {
  if (!/(?:\{wp:carousel\}|carousel|slider|スライダー|カルーセル)/i.test(node.name)) {
    return null;
  }
  const directChildren = (node.children ?? []).filter((child) =>
    /(?:carousel|slider).?item|カルーセル.?項目/i.test(child.name),
  );
  const candidates = directChildren.length >= 2
    ? directChildren
    : (node.children ?? []).filter((child) => {
      const visual = largestVisualNode(child, context.assets);
      return Boolean(visual && !/(?:next|prev|arrow|dot|次へ|前へ)/i.test(child.name));
    });
  const items = candidates
    .map((item, index): CarouselItem | null => {
      const visual = largestVisualNode(item, context.assets);
      const imageUrl = visual ? visualUrl(visual, context.assets) : null;
      if (!imageUrl) return null;
      const textNodes = [item, ...descendants(item)]
        .filter((child) => child.type === "TEXT" && child.characters?.trim())
        .sort((left, right) => {
          const y = (left.absoluteBoundingBox?.y ?? 0) - (right.absoluteBoundingBox?.y ?? 0);
          return y || (left.absoluteBoundingBox?.x ?? 0) - (right.absoluteBoundingBox?.x ?? 0);
        });
      const title = textNodes.at(-1)?.characters?.trim()
        || (/^\d+$/.test(item.name.trim()) ? `スライド ${index + 1}` : item.name.trim())
        || `スライド ${index + 1}`;
      return {
        id: item.id,
        imageUrl,
        title,
        link: functionalLink(item, context, false),
      };
    })
    .filter((item): item is CarouselItem => item !== null);
  if (items.length < 2) return null;

  const all = descendants(node);
  const previous = all.find((child) => /(?:carousel|slider).?(?:prev|previous)|前へ/i.test(child.name));
  const next = all.find((child) => /(?:carousel|slider).?next|次へ/i.test(child.name));
  const previousVisual = previous ? largestVisualNode(previous, context.assets) : null;
  const nextVisual = next ? largestVisualNode(next, context.assets) : null;
  return {
    items,
    previousIconUrl: previous
      ? visualUrl(previous, context.assets)
        ?? (previousVisual ? visualUrl(previousVisual, context.assets) : null)
        ?? ""
      : "",
    nextIconUrl: next
      ? visualUrl(next, context.assets)
        ?? (nextVisual ? visualUrl(nextVisual, context.assets) : null)
        ?? ""
      : "",
  };
}

function largestVisualNode(node: FigmaNode, assets: FigmaRenderAssets): FigmaNode | null {
  return [node, ...descendants(node)]
    .filter((candidate) => {
      if (/(?:next|prev|arrow|dot|次へ|前へ)/i.test(candidate.name)) return false;
      return Boolean(candidate.absoluteBoundingBox && visualUrl(candidate, assets));
    })
    .sort((left, right) => area(right) - area(left))[0] ?? null;
}

const ACCORDION_YEAR_TITLE = /^\s*(?:(?:19|20)\d{2}|令和\s*(?:元|\d+)|平成\s*(?:元|\d+)|昭和\s*(?:元|\d+))\s*年度\s*$/;

function accordionYearTitles(node: FigmaNode): FigmaNode[] {
  return descendants(node).filter((child) =>
    child.type === "TEXT"
    && ACCORDION_YEAR_TITLE.test(child.characters ?? "")
    && Boolean(child.absoluteBoundingBox)
  );
}

/**
 * Identify the closest Figma group that owns an accordion-like year list.
 * Real client files often retain generic names such as `Group 152`, so the
 * repeated Japanese/Western fiscal-year structure is authoritative too.
 */
export function figmaNodeHasAccordionPlan(node: FigmaNode): boolean {
  const titles = accordionYearTitles(node);
  if (titles.length < 3) return false;
  const bounds = titles
    .map((title) => title.absoluteBoundingBox)
    .filter((box): box is FigmaBounds => Boolean(box));
  const centerXs = bounds.map((box) => box.x + box.width / 2);
  const centerYs = bounds.map((box) => box.y + box.height / 2);
  const widths = bounds.map((box) => box.width).sort((left, right) => left - right);
  const medianWidth = widths[Math.floor(widths.length / 2)] ?? 0;
  const horizontalSpread = Math.max(...centerXs) - Math.min(...centerXs);
  const verticalSpread = Math.max(...centerYs) - Math.min(...centerYs);
  // A repeated fiscal-year column is a stronger signal than mutable layer
  // names such as `Desktop 1440` or `Frame 225`. Keep the geometric guard so
  // a horizontal chronology is not converted into an accordion by mistake.
  if (horizontalSpread > Math.max(360, medianWidth * 2.5) || verticalSpread < 80) {
    return false;
  }
  return !descendants(node).some((candidate) =>
    candidate !== node
    && candidate.type !== "TEXT"
    && accordionYearTitles(candidate).length >= 3
  );
}

function accordionPlan(node: FigmaNode): AccordionPlan | null {
  if (!figmaNodeHasAccordionPlan(node)) return null;
  const all = descendants(node);
  const titles = all
    .filter((child) => child.type === "TEXT" && ACCORDION_YEAR_TITLE.test(child.characters ?? ""))
    .filter((child) => child.absoluteBoundingBox)
    .sort((left, right) => (left.absoluteBoundingBox?.y ?? 0) - (right.absoluteBoundingBox?.y ?? 0));
  if (titles.length < 3) return null;

  const firstY = titles[0]?.absoluteBoundingBox?.y ?? 0;
  const last = titles[titles.length - 1];
  const lastBounds = last?.absoluteBoundingBox;
  if (!lastBounds) return null;
  const wideRule = all
    .filter((child) => child.type === "LINE" && child.absoluteBoundingBox)
    .filter((child) => {
      const line = child.absoluteBoundingBox as FigmaBounds;
      return line.y >= firstY - 40 && line.y <= lastBounds.y + lastBounds.height + 100;
    })
    .sort((left, right) => (right.absoluteBoundingBox?.width ?? 0) - (left.absoluteBoundingBox?.width ?? 0))[0];
  const ruleBounds = wideRule?.absoluteBoundingBox;
  const x = ruleBounds?.x ?? Math.max(node.absoluteBoundingBox?.x ?? 0, (titles[0]?.absoluteBoundingBox?.x ?? 0) - 80);
  const width = ruleBounds?.width ?? Math.min(node.absoluteBoundingBox?.width ?? 1200, Math.max(600, (node.absoluteBoundingBox?.width ?? 1200) * 0.72));
  const y = Math.max(node.absoluteBoundingBox?.y ?? 0, firstY - 16);
  const bottom = Math.min(
    (node.absoluteBoundingBox?.y ?? 0) + (node.absoluteBoundingBox?.height ?? 0),
    lastBounds.y + lastBounds.height + 44,
  );

  const items = titles.map((title, index) => {
    const titleBounds = title.absoluteBoundingBox as FigmaBounds;
    const nextY = titles[index + 1]?.absoluteBoundingBox?.y ?? bottom;
    const content = all
      .filter((child) => child.type === "TEXT" && child !== title && child.characters?.trim() && child.absoluteBoundingBox)
      .filter((child) => {
        const candidate = child.absoluteBoundingBox as FigmaBounds;
        return candidate.y > titleBounds.y + 8 && candidate.y < nextY - 6
          && candidate.x >= x && candidate.x <= x + width;
      })
      .sort((left, right) => (left.absoluteBoundingBox?.y ?? 0) - (right.absoluteBoundingBox?.y ?? 0))
      .map((child) => child.characters?.trim() ?? "")
      .join("\n");
    const contentNodes = all
      .filter((child) => child.type === "TEXT" && child !== title && child.characters?.trim() && child.absoluteBoundingBox)
      .filter((child) => {
        const candidate = child.absoluteBoundingBox as FigmaBounds;
        return candidate.y > titleBounds.y + 8 && candidate.y < nextY - 6
          && candidate.x >= x && candidate.x <= x + width;
      });
    return {
      title: title.characters?.trim() ?? `項目 ${index + 1}`,
      content,
      titleBounds,
      contentBounds: unionBounds(contentNodes.map((child) => child.absoluteBoundingBox as FigmaBounds)),
    };
  });
  return { bounds: { x, y, width, height: Math.max(120, bottom - y) }, items };
}

function accordionElement(
  node: FigmaNode,
  plan: AccordionPlan,
  parentBounds: FigmaBounds,
  parentNode: FigmaNode,
  context: RenderContext,
): ElementorElement {
  return widget(context.ids, `${node.id}:accordion`, "figmapress-accordion", {
    ...widgetPosition(node, plan.bounds, parentBounds, parentNode),
    figmapress_node_id: `${node.id}:accordion`,
    figmapress_node_name: `${node.name} / accordion`,
    items: plan.items.map((item, index) => ({
      _id: hashId(`${node.id}:accordion:${index}`),
      title: item.title,
      content: item.content,
    })),
    allow_multiple: "",
    open_first: "yes",
    accent_color: "#D50327",
    background_color: "#FFFFFF",
    text_color: "#202020",
    design_geometry: JSON.stringify({
      root: { width: round(plan.bounds.width), height: round(plan.bounds.height) },
      items: plan.items.map((item) => ({
        title: relativeDesignBox(item.titleBounds, plan.bounds),
        content: relativeDesignBox(item.contentBounds, plan.bounds),
      })),
    }),
  });
}

function relativeDesignBox(
  box: FigmaBounds | undefined,
  root: FigmaBounds,
): { x: number; y: number; width: number; height: number } | null {
  if (!box || root.width <= 0 || root.height <= 0) return null;
  return {
    x: round(percent(box.x - root.x, root.width)),
    y: round(percent(box.y - root.y, root.height)),
    width: round(percent(box.width, root.width)),
    height: round(percent(box.height, root.height)),
  };
}

function designTextStyle(
  node: FigmaNode | undefined,
  rootWidth: number,
): { fontSize: number; fontWeight: number; letterSpacing: number } {
  const style = node?.style ?? {};
  return {
    fontSize: round(percent(style.fontSize ?? 16, rootWidth)),
    fontWeight: round(style.fontWeight ?? 400),
    letterSpacing: round(percent(style.letterSpacing ?? 0, rootWidth)),
  };
}

function smallestContainingVisual(node: FigmaNode, target: FigmaBounds): FigmaNode | undefined {
  const centerX = target.x + target.width / 2;
  const centerY = target.y + target.height / 2;
  return descendants(node)
    .filter((candidate) => {
      const box = candidate.absoluteBoundingBox;
      return Boolean(
        box
        && candidate.type !== "TEXT"
        && solidColor(candidate.fills)
        && centerX >= box.x
        && centerX <= box.x + box.width
        && centerY >= box.y
        && centerY <= box.y + box.height
        && box.width >= target.width
        && box.height >= target.height,
      );
    })
    .sort((left, right) => area(left) - area(right))[0];
}

function unionBounds(boxes: FigmaBounds[]): FigmaBounds | undefined {
  if (!boxes.length) return undefined;
  const left = Math.min(...boxes.map((box) => box.x));
  const top = Math.min(...boxes.map((box) => box.y));
  const right = Math.max(...boxes.map((box) => box.x + box.width));
  const bottom = Math.max(...boxes.map((box) => box.y + box.height));
  return { x: left, y: top, width: right - left, height: bottom - top };
}

function descendants(node: FigmaNode): FigmaNode[] {
  const result: FigmaNode[] = [];
  const visit = (child: FigmaNode): void => {
    result.push(child);
    for (const nested of child.children ?? []) visit(nested);
  };
  for (const child of node.children ?? []) visit(child);
  return result;
}

const GOOGLE_WEBFONT_FAMILIES = new Set([
  "BIZ UDPGothic",
  "BIZ UDPMincho",
  "IBM Plex Sans JP",
  "Inter",
  "Lato",
  "M PLUS 1p",
  "M PLUS Rounded 1c",
  "Montserrat",
  "Noto Sans JP",
  "Noto Serif JP",
  "Open Sans",
  "Poppins",
  "Roboto",
  "Shippori Mincho",
  "Zen Kaku Gothic New",
  "Zen Maru Gothic",
]);

function normalizedFontWeight(value: number | undefined): number {
  if (!Number.isFinite(value)) return 400;
  return Math.min(900, Math.max(100, Math.round((value as number) / 100) * 100));
}

function figmaWebfonts(roots: FigmaNode[]): FigmaWebfont[] {
  const weightsByFamily = new Map<string, Set<number>>();
  const japaneseFallbackWeights = new Map<string, Set<number>>();
  const add = (familyValue: string | undefined, weight: number | undefined): void => {
    const family = familyValue?.replace(/['"\\]/g, "").trim();
    if (!family || !GOOGLE_WEBFONT_FAMILIES.has(family)) return;
    const weights = weightsByFamily.get(family) ?? new Set<number>();
    weights.add(normalizedFontWeight(weight));
    weightsByFamily.set(family, weights);
  };

  for (const root of roots) {
    for (const node of [root, ...descendants(root)]) {
      if (node.type !== "TEXT") continue;
      const hasJapaneseCopy =
        /[\u3000-\u30ff\u3400-\u9fff\uf900-\ufaff]/u.test(node.characters ?? "");
      for (const run of textRuns(node)) {
        add(run.style.fontFamily, run.style.fontWeight);
        if (hasJapaneseCopy) {
          const fallback =
            run.style.fontFamily && /serif|mincho/i.test(run.style.fontFamily)
              ? "Noto Serif JP"
              : "Noto Sans JP";
          const weights =
            japaneseFallbackWeights.get(fallback) ?? new Set<number>();
          weights.add(normalizedFontWeight(run.style.fontWeight));
          japaneseFallbackWeights.set(fallback, weights);
        }
      }
    }
  }

  for (const [fallback, weights] of japaneseFallbackWeights) {
    const fallbackWeights = weightsByFamily.get(fallback) ?? new Set<number>();
    for (const weight of weights) fallbackWeights.add(weight);
    weightsByFamily.set(fallback, fallbackWeights);
  }

  const sorted = Array.from(weightsByFamily.entries())
    .sort(([left], [right]) => left.localeCompare(right));
  const fallbacks = sorted.filter(([family]) => /^Noto (?:Sans|Serif) JP$/.test(family));
  const selected = [
    ...sorted
      .filter(([family]) => !/^Noto (?:Sans|Serif) JP$/.test(family))
      .slice(0, Math.max(0, 4 - fallbacks.length)),
    ...fallbacks.slice(0, 2),
  ].sort(([left], [right]) => left.localeCompare(right));

  return selected
    .map(([family, weights]) => ({
      family,
      provider: "google",
      weights: Array.from(weights).sort((left, right) => left - right).slice(0, 6),
    }));
}

function isInsideInteractionBounds(node: FigmaNode, interaction: FigmaBounds): boolean {
  const bounds = node.absoluteBoundingBox;
  if (!bounds) return false;
  const centerX = bounds.x + bounds.width / 2;
  const centerY = bounds.y + bounds.height / 2;
  return centerX >= interaction.x && centerX <= interaction.x + interaction.width
    && centerY >= interaction.y && centerY <= interaction.y + interaction.height;
}

const NAVIGATION_NODE_NAME = /(?:\{wp:nav\}|header.*(?:sec|section)|navigation)/i;
const NAVIGATION_TEXT_NAME = /(?:menu.?item|nav.?item|メニュー)/i;
const SEMANTIC_NAVIGATION_LABEL = /^(?:home|top|ホーム|トップ|会社案内|選ばれる理由|事業(?:内容|案内)|施工事例|解体工事|役員一覧|お知らせ|お問い合わせ|想い|政策|活動報告|プロフィール|company|about|reasons?|strength|services?|business|works?|projects?|construction|demolition|news|topics?|officers?|executives?|board|thoughts?|polic(?:y|ies)|activit(?:y|ies)|reports?|profile|contact)$/i;

function navigationTextKey(node: FigmaNode): string {
  const copy = node.characters?.trim() ?? "";
  return sectionAnchorFromText(copy) ?? copy.toLocaleLowerCase();
}

function isNavigationText(node: FigmaNode): boolean {
  const copy = node.characters?.trim() ?? "";
  return node.type === "TEXT"
    && Boolean(copy)
    && Boolean(node.absoluteBoundingBox)
    && (NAVIGATION_TEXT_NAME.test(node.name) || SEMANTIC_NAVIGATION_LABEL.test(copy));
}

function navigationMenuTexts(node: FigmaNode): FigmaNode[] {
  const seen = new Set<string>();
  return descendants(node)
    .filter(isNavigationText)
    .sort((left, right) => {
      const y = (left.absoluteBoundingBox?.y ?? 0) - (right.absoluteBoundingBox?.y ?? 0);
      return Math.abs(y) > 12
        ? y
        : (left.absoluteBoundingBox?.x ?? 0) - (right.absoluteBoundingBox?.x ?? 0);
    })
    .filter((child) => {
      const key = navigationTextKey(child);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

export function findFigmaNavigationMenuTexts(root: FigmaNode): FigmaNode[] {
  const rootBounds = root.absoluteBoundingBox;
  if (!rootBounds) return navigationMenuTexts(root);
  const topLimit = rootBounds.y + Math.min(320, Math.max(96, rootBounds.width * 0.28));
  const topTextIds = new Set(
    descendants(root)
      .filter(isNavigationText)
      .filter((child) => (child.absoluteBoundingBox?.y ?? Number.POSITIVE_INFINITY) < topLimit)
      .map((child) => child.id),
  );
  return navigationMenuTexts(root).filter((child) => topTextIds.has(child.id));
}

function looksLikeTopNavigationGeometry(node: FigmaNode, root: FigmaNode): boolean {
  const bounds = node.absoluteBoundingBox;
  const rootBounds = root.absoluteBoundingBox;
  if (!bounds || !rootBounds || node.id === root.id) return false;
  const topOffset = bounds.y - rootBounds.y;
  const widthRatio = bounds.width / rootBounds.width;
  const shallowLimit = Math.min(320, Math.max(96, rootBounds.width * 0.28));
  return topOffset >= -2
    && topOffset <= Math.min(120, rootBounds.width * 0.1)
    && widthRatio >= 0.68
    && bounds.height >= 32
    && bounds.height <= shallowLimit;
}

function looseRootNavigationNode(
  root: FigmaNode,
  fallbackMenuTexts: FigmaNode[],
): FigmaNode | null {
  const rootBounds = root.absoluteBoundingBox;
  if (!rootBounds || fallbackMenuTexts.length < 2) return null;
  const headerHeight = Math.min(
    rootBounds.width <= 767 ? 104 : 180,
    Math.max(72, rootBounds.width * (rootBounds.width <= 767 ? 0.22 : 0.125)),
  );
  const headerBottom = rootBounds.y + headerHeight;
  const topChildren = (root.children ?? []).filter((child) => {
    const bounds = child.absoluteBoundingBox;
    if (child.visible === false || !bounds) return false;
    return bounds.y < headerBottom
      && bounds.y + bounds.height <= rootBounds.y + headerHeight * 1.65
      && bounds.height <= headerHeight * 1.5;
  });
  const localMenuTexts = topChildren.filter(isNavigationText);
  const visualEvidence = topChildren.filter((child) => child.type !== "TEXT").length;
  const inferredDesktop = localMenuTexts.length >= 3;
  const inferredCollapsed = localMenuTexts.length < 2
    && fallbackMenuTexts.length >= 3
    && visualEvidence >= 2;
  if (!(inferredDesktop || inferredCollapsed)) return null;
  return {
    id: `${root.id}:figmapress-navigation`,
    name: "{wp:nav} inferred loose header",
    type: "FRAME",
    absoluteBoundingBox: {
      x: rootBounds.x,
      y: rootBounds.y,
      width: rootBounds.width,
      height: headerHeight,
    },
    children: topChildren,
  };
}

/**
 * Find one outer header/navigation container without requiring designers to
 * rename Figma groups. Corporate files commonly use names such as `Group 85`;
 * position, geometry and visible page labels are therefore first-class clues.
 */
export function findFigmaNavigationNode(
  root: FigmaNode,
  fallbackMenuTexts: FigmaNode[] = findFigmaNavigationMenuTexts(root),
): FigmaNode | null {
  const rootBounds = root.absoluteBoundingBox;
  if (!rootBounds || fallbackMenuTexts.length < 2) return null;
  const candidates = descendants(root)
    .filter((node) => node.visible !== false && node.absoluteBoundingBox)
    .map((node) => {
      const bounds = node.absoluteBoundingBox as FigmaBounds;
      const localMenuTexts = navigationMenuTexts(node);
      const explicitlyNamed = NAVIGATION_NODE_NAME.test(node.name);
      const topGeometry = looksLikeTopNavigationGeometry(node, root);
      const descendantsCount = descendants(node).filter((child) => child.visible !== false).length;
      const inferredDesktop = topGeometry && localMenuTexts.length >= 3;
      const inferredCollapsed = topGeometry
        && localMenuTexts.length < 2
        && fallbackMenuTexts.length >= 3
        && descendantsCount >= 2;
      if (!(explicitlyNamed || inferredDesktop || inferredCollapsed)) return null;
      if (!explicitlyNamed && !topGeometry) return null;
      const widthRatio = bounds.width / rootBounds.width;
      const topOffset = Math.max(0, bounds.y - rootBounds.y);
      const score = (explicitlyNamed ? 1_000 : 0)
        + localMenuTexts.length * 80
        + widthRatio * 100
        + Math.min(40, descendantsCount * 2)
        - topOffset
        - Math.abs(bounds.height - Math.min(120, rootBounds.width * 0.09)) * 0.08;
      return { node, score, area: bounds.width * bounds.height };
    })
    .filter((entry): entry is { node: FigmaNode; score: number; area: number } => Boolean(entry))
    .sort((left, right) => right.score - left.score || right.area - left.area);
  return candidates[0]?.node ?? looseRootNavigationNode(root, fallbackMenuTexts);
}

function menuAnchor(label: string, context: RenderContext): string {
  if (/会社案内|company|about/i.test(label)) return anchorHref("company", context);
  if (/選ばれる理由|reasons?|strength/i.test(label)) return anchorHref("reasons", context);
  if (/事業(?:内容|案内)|services?|business/i.test(label)) return anchorHref("services", context);
  if (/施工事例|works?|projects?|construction/i.test(label)) return anchorHref("works", context);
  if (/解体工事|demolition/i.test(label)) return anchorHref("demolition", context);
  if (/お知らせ|news|topics?/i.test(label)) return anchorHref("news", context);
  if (/役員一覧|officers?|executives?|board/i.test(label)) return anchorHref("officers", context);
  if (/想い|thought|message/i.test(label)) return anchorHref("thoughts", context);
  if (/政策|policy|policies/i.test(label)) return anchorHref("policies", context);
  if (/活動報告|activit|report/i.test(label)) return anchorHref("activities", context);
  if (/プロフィール|profile/i.test(label)) return anchorHref("profile", context);
  if (/相談|問(?:い)?合わせ|問合|contact/i.test(label)) return anchorHref("contact", context);
  return anchorHref(slug(label) || "section", context);
}

function inferredSectionLink(label: string, context: RenderContext): FunctionalLink {
  const anchor = sectionAnchorFromText(label);
  return {
    url: anchor ? anchorHref(anchor, context) : menuAnchor(label, context),
    label: label.trim() || "リンク",
    external: false,
  };
}

function anchorId(value: string, context: RenderContext): string {
  return `${value}${context.anchorSuffix}`;
}

function anchorHref(value: string, context: RenderContext): string {
  const pageTarget = context.assets.pageTargets?.[value];
  if (pageTarget) return pageTarget;
  return `#${anchorId(value, context)}`;
}

function sectionAnchorSettings(node: FigmaNode, context: RenderContext): ElementorSettings {
  const anchor = context.anchorTargets.get(node.id);
  return anchor ? { _element_id: anchorId(anchor, context) } : {};
}

function withSectionAnchor(
  element: ElementorElement,
  node: FigmaNode,
  context: RenderContext,
): ElementorElement {
  const anchor = sectionAnchorSettings(node, context);
  const existingId = typeof element.settings._element_id === "string"
    ? element.settings._element_id
    : "";
  const desiredId = existingId || (typeof anchor._element_id === "string" ? anchor._element_id : "");
  if (!desiredId) return element;
  if (context.emittedAnchorIds.has(desiredId)) {
    if (!existingId) return element;
    const { _element_id: _duplicateId, ...settings } = element.settings;
    return { ...element, settings };
  }
  context.emittedAnchorIds.add(desiredId);
  if (existingId === desiredId) return element;
  return {
    ...element,
    settings: {
      ...element.settings,
      _element_id: desiredId,
    },
  };
}

function slug(value: string): string {
  return value.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function functionalLink(
  node: FigmaNode,
  context: RenderContext,
  infer = true,
): FunctionalLink | null {
  const related = [node, ...descendants(node)];
  for (const candidate of related) {
    for (const interaction of candidate.interactions ?? []) {
      for (const action of interaction.actions ?? []) {
        const url = typeof action.url === "string" ? action.url.trim() : "";
        if (url) {
          return {
            url,
            label: actionLabel(node),
            external: /^https?:\/\//i.test(url) || action.openInNewTab === true,
          };
        }
        const navigation = `${action.type ?? ""} ${action.navigation ?? ""}`.toUpperCase();
        if (
          typeof action.destinationId === "string"
          && action.destinationId
          && !/(?:OVERLAY|SWAP|BACK|CLOSE)/.test(navigation)
        ) {
          const semanticTargetKey = sectionAnchorFromText(actionLabel(node));
          const semanticTarget = semanticTargetKey
            ? context.assets.pageTargets?.[semanticTargetKey]?.trim()
            : "";
          if (semanticTarget) {
            return {
              // In a generated multi-page site the visible semantic label is
              // authoritative even when a stale Figma wire points back to the
              // current frame. This keeps every duplicate header/footer/CTA
              // label attached to the same logical WordPress page.
              url: semanticTarget,
              label: actionLabel(node),
              external: false,
            };
          }
          const destination = findNode(context.root, action.destinationId);
          const anchor = destination?.id === context.root.id
            ? "top"
            : destination ? sectionAnchor(destination) : null;
          if (anchor) {
            return {
              url: anchorHref(anchor, context),
              label: actionLabel(node),
              external: false,
            };
          }
          const crossPageUrl = context.assets.linkTargets?.[action.destinationId]?.trim();
          if (crossPageUrl) {
            return {
              // Business-site files often contain stale prototype wires after
              // a menu label is renamed. A known visible page label is safer
              // than a conflicting frame ID; generic CTAs still use the
              // explicit Figma destination.
              url: crossPageUrl,
              label: actionLabel(node),
              external: false,
            };
          }
        }
      }
    }
  }
  if (!infer) return null;

  const copy = node.type === "TEXT"
    ? node.characters?.trim() ?? ""
    : related
      .filter((child) => child.type === "TEXT" && child.characters?.trim())
      .slice(0, 12)
      .map((child) => child.characters?.trim())
      .join(" ");
  const description = `${node.name} ${copy}`.trim();
  const email = description.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0];
  const phoneSource = /(?:tel(?:ephone)?|phone|電話)/i.test(node.name)
    ? description
    : copy;
  const phone = phoneSource.match(/(?:\+?\d[\d\s().-]{8,}\d)/)?.[0];
  const explicitlyActionable = /(?:button|cta|link|card|電話|メール|privacy|トップ|menu.?item|nav.?item)/i.test(node.name)
    || (
      node.type === "TEXT"
      && Boolean(
        email
        || phone
        || /^(?:home|top|会社案内|選ばれる理由|事業(?:内容|案内)|施工事例|解体工事|役員一覧|お知らせ|お問い合わせ)$/i.test(copy)
        || /(?:こちら|(?:もっと)?見る|詳しく|トップへ|お問い合わせ|ご相談|送る|送信|プライバシー|→|＞|>)/i.test(copy),
      )
    );
  if (!explicitlyActionable) return null;

  if (email) return { url: `mailto:${email}`, label: copy || email, external: false };
  if (phone && phone.replace(/\D/g, "").length >= 10) {
    return {
      url: `tel:${phone.replace(/[^\d+]/g, "")}`,
      label: copy || phone,
      external: false,
    };
  }
  const anchor = sectionAnchorFromText(description);
  if (anchor) {
    return {
      url: anchorHref(anchor, context),
      label: copy || actionLabel(node),
      external: false,
    };
  }
  if (/プライバシー|privacy/i.test(description)) {
    return { url: "/privacy-policy/", label: copy || "プライバシーポリシー", external: false };
  }
  return null;
}

function actionLabel(node: FigmaNode): string {
  if (node.type === "TEXT" && node.characters?.trim()) return node.characters.trim();
  return descendants(node)
    .find((child) => child.type === "TEXT" && child.characters?.trim())
    ?.characters?.trim()
    || node.name
    || "リンク";
}

function sectionAnchor(node: FigmaNode): string | null {
  const copy = [node.name, ...descendants(node)
    .filter((child) => child.type === "TEXT" && child.characters?.trim())
    .slice(0, 20)
    .map((child) => child.characters ?? "")]
    .join(" ");
  return sectionAnchorFromText(copy);
}

export function sectionAnchorFromText(value: string): string | null {
  if (/トップ|page.?top|\btop\b/i.test(value)) return "top";
  if (/会社案内|company|about/i.test(value)) return "company";
  if (/選ばれる理由|reasons?|strength/i.test(value)) return "reasons";
  if (/事業(?:内容|案内)|services?|business/i.test(value)) return "services";
  if (/施工事例|works?|projects?|construction/i.test(value)) return "works";
  if (/解体工事|demolition/i.test(value)) return "demolition";
  if (/お知らせ|news|topics?/i.test(value)) return "news";
  if (/役員一覧|officers?|executives?|board/i.test(value)) return "officers";
  if (/thought|message|想い|voice|現場の声/i.test(value)) return "thoughts";
  if (/policy|policies|政策/i.test(value)) return "policies";
  if (/activit|report|活動報告|news|results?|実績/i.test(value)) return "activities";
  if (/profile|プロフィール/i.test(value)) return "profile";
  if (/contact|問(?:い)?合わせ|問合|声を聞かせて|ご相談(?:はこちら|・ご意見|ください|$)/i.test(value)) return "contact";
  return null;
}

function sectionTextMatchesAnchor(value: string, anchor: SectionAnchor): boolean {
  switch (anchor) {
    case "thoughts":
      return /thought|message|想い|voice|現場の声/i.test(value);
    case "policies":
      return /policy|policies|政策/i.test(value);
    case "activities":
      return /activit|report|活動報告|news|results?|実績/i.test(value);
    case "profile":
      return /profile|プロフィール/i.test(value);
    case "company":
      return /会社案内|company|about/i.test(value);
    case "reasons":
      return /選ばれる理由|reasons?|strength/i.test(value);
    case "services":
      return /事業(?:内容|案内)|services?|business/i.test(value);
    case "works":
      return /施工事例|works?|projects?|construction/i.test(value);
    case "demolition":
      return /解体工事|demolition/i.test(value);
    case "news":
      return /お知らせ|news|topics?/i.test(value);
    case "officers":
      return /役員一覧|officers?|executives?|board/i.test(value);
    case "contact":
      return /contact|問(?:い)?合わせ|問合|声を聞かせて|ご相談(?:はこちら|・ご意見|ください|$)/i.test(value);
  }
}

/**
 * Resolve each section anchor to exactly one meaningful Figma container before
 * rendering. This avoids duplicate HTML ids when nested groups repeat section
 * words, while still allowing a nested policy/activity heading to be a target
 * inside a broader visual section.
 */
export function discoverSectionAnchorTargets(root: FigmaNode): Map<string, SectionAnchor> {
  const anchors: SectionAnchor[] = [
    "thoughts",
    "policies",
    "activities",
    "profile",
    "company",
    "reasons",
    "services",
    "works",
    "demolition",
    "news",
    "officers",
    "contact",
  ];
  const candidates = new Map<SectionAnchor, Array<{
    id: string;
    score: number;
    y: number;
    area: number;
  }>>(anchors.map((anchor) => [anchor, []]));
  const rootBounds = root.absoluteBoundingBox;
  const rootWidth = rootBounds?.width ?? 1;

  const visit = (node: FigmaNode, depth: number): void => {
    if (node.visible === false) return;
    const bounds = node.absoluteBoundingBox;
    const children = node.children ?? [];
    const excluded = /(?:^|\b)(?:header|footer|hero|navigation|nav)(?:\b|\/)/i.test(node.name);
    if (
      node !== root
      && node.type !== "TEXT"
      && bounds
      && bounds.width > 0
      && bounds.height > 0
      && !excluded
    ) {
      const nameAnchor = sectionAnchorFromText(node.name);
      const directText = children
        .filter((child) => child.type === "TEXT" && child.characters?.trim())
        .map((child) => child.characters?.trim() ?? "")
        .join(" ");
      const descendantText = descendants(node)
        .filter((child) => child.type === "TEXT" && child.characters?.trim())
        .slice(0, 120)
        .map((child) => child.characters?.trim() ?? "")
        .join(" ");
      const widthRatio = Math.min(1, bounds.width / rootWidth);

      for (const anchor of anchors) {
        let score = 0;
        if (nameAnchor === anchor) score = 100_000 - depth * 100;
        if (sectionTextMatchesAnchor(directText, anchor)) {
          score = Math.max(score, 80_000 - depth * 100);
        }
        if (score === 0 && sectionTextMatchesAnchor(descendantText, anchor)) {
          score = 20_000 - depth * 200;
        }
        if (score <= 0) continue;
        score += Math.round(widthRatio * 100);
        candidates.get(anchor)?.push({
          id: node.id,
          score,
          y: bounds.y,
          area: bounds.width * bounds.height,
        });
      }
    }
    for (const child of children) visit(child, depth + 1);
  };
  visit(root, 0);

  const result = new Map<string, SectionAnchor>();
  const usedNodes = new Set<string>();
  for (const anchor of anchors) {
    const target = candidates.get(anchor)
      ?.sort((left, right) =>
        right.score - left.score
        || left.area - right.area
        || left.y - right.y
      )
      .find((candidate) => !usedNodes.has(candidate.id));
    if (!target) continue;
    usedNodes.add(target.id);
    result.set(target.id, anchor);
  }
  return result;
}

function findNode(root: FigmaNode, id: string): FigmaNode | null {
  if (root.id === id) return root;
  for (const child of root.children ?? []) {
    const found = findNode(child, id);
    if (found) return found;
  }
  return null;
}

function elementorUrl(link: FunctionalLink): Record<string, unknown> {
  return {
    url: link.url,
    is_external: link.external ? "on" : "",
    nofollow: "",
  };
}

function linkOverlayElement(
  node: FigmaNode,
  action: FunctionalLink,
  context: RenderContext,
): ElementorElement {
  return widget(context.ids, `${node.id}:link`, "figmapress-link", {
    figmapress_node_id: `${node.id}:link`,
    figmapress_node_name: `${node.name} / link`,
    link_label: action.label,
    link_url: elementorUrl(action),
    _position: "absolute",
    _offset_orientation_h: "start",
    _offset_x: size(0, "%"),
    _offset_orientation_v: "start",
    _offset_y: size(0, "%"),
    _element_width: "initial",
    _element_custom_width: size(100, "%"),
    _element_custom_width_tablet: size(100, "%"),
    _element_custom_width_mobile: size(100, "%"),
    z_index: 20,
  });
}

function textElement(
  node: FigmaNode,
  bounds: FigmaBounds,
  parentBounds: FigmaBounds,
  parentNode: FigmaNode,
  context: RenderContext,
): ElementorElement {
  const richRuns = textRuns(node);
  const style = richRuns.length === 1 ? richRuns[0]?.style ?? {} : node.style ?? {};
  const fontSize = textFontSize(style, richRuns, bounds);
  const lineHeight = textLineHeight(style, richRuns, fontSize);
  const settings: ElementorSettings = {
    ...widgetPosition(node, bounds, parentBounds, parentNode),
    figmapress_node_id: node.id,
    figmapress_node_name: node.name,
    css_classes: "figmapress-text figmapress-text--horizontal",
    text_color: solidColor(style.fills ?? node.fills) ?? "#111111",
    typography_typography: "custom",
    typography_font_family: style.fontFamily ?? "Arial",
    typography_font_size: canvasSize(fontSize, context),
    typography_font_weight: String(style.fontWeight ?? 400),
    typography_line_height: size(lineHeight / fontSize, "em"),
    typography_letter_spacing: canvasSize(style.letterSpacing ?? 0, context),
    align: textAlign(style.textAlignHorizontal),
  };
  applyTypographyFlags(settings, style);
  applyEffects(settings, node);
  applyRotation(settings, node, parentBounds);

  const content = richRuns.map((run) => runHtml(run, context)).join("").replace(/\n/g, "<br>");
  const action = functionalLink(node, context);
  const linkedContent = action
    ? `<a data-figmapress-functional-link href="${escapeAttribute(action.url)}"${action.external ? ' target="_blank" rel="noopener noreferrer"' : ""} style="color:inherit;text-decoration:inherit">${content}</a>`
    : content;
  const whiteSpace = textWhiteSpace(node);
  const overflowWrap = textOverflowWrap(node);
  const wordBreak = textWordBreak(node);
  const verticalAlign = textVerticalAlign(style.textAlignVertical);
  settings.editor = `<div data-figmapress-text-box="${escapeAttribute(node.id)}" style="box-sizing:border-box;display:flex;flex-direction:column;font-family:${escapeAttribute(cssFont(style.fontFamily))};hyphens:none;justify-content:${verticalAlign};line-break:strict;margin:0;max-width:100%;${textBoxHeight(node, bounds, context)}overflow:${textOverflow(node)};overflow-wrap:${overflowWrap};text-orientation:mixed;white-space:${whiteSpace};width:100%;word-break:${wordBreak};writing-mode:horizontal-tb"><span style="display:block;font-size:0;line-height:0;max-width:100%">${linkedContent}</span></div>`;
  return widget(context.ids, node.id, "text-editor", settings);
}

function imageElement(
  node: FigmaNode,
  bounds: FigmaBounds,
  parentBounds: FigmaBounds,
  parentNode: FigmaNode,
  asset: FigmaVisualAsset,
  context: RenderContext,
): ElementorElement {
  const settings: ElementorSettings = {
    ...widgetPosition(node, bounds, parentBounds, parentNode),
    figmapress_node_id: node.id,
    figmapress_node_name: node.name,
    image: {
      url: asset.url,
      id: "",
      alt: node.name,
      source: "library",
      figmapress_key: mediaKey(`${node.id}:image`, asset.url),
    },
    image_size: "full",
    space: size(100, "%"),
    height: canvasSize(bounds.height, context),
    "object-fit": imageObjectFit(asset),
    "object-position": "center center",
    image_border_radius: radiusDimensions(node, context),
  };
  if (typeof node.opacity === "number" && node.opacity < 1) {
    settings.opacity = size(node.opacity);
  }
  const imageManifest = asset.rendered ? null : figmaImageManifest(asset.paint);
  if (imageManifest) settings.figmapress_image = imageManifest;
  const action = functionalLink(node, context);
  if (action) {
    settings.link_to = "custom";
    settings.link = elementorUrl(action);
  }
  applyEffects(settings, node, "image");
  applyRotation(settings, node, parentBounds);
  return widget(context.ids, node.id, "image", settings);
}

function baseContainerSettings(
  node: FigmaNode,
  context: RenderContext,
  parentBounds?: FigmaBounds,
): ElementorSettings {
  const bounds = node.absoluteBoundingBox;
  const autoLayout = isAutoLayout(node);
  const settings: ElementorSettings = {
    content_width: "full",
    flex_direction: node.layoutMode === "HORIZONTAL" ? "row" : "column",
    flex_gap: autoLayout
      ? gap(node.itemSpacing ?? 0, "vw", context.rootBounds.width)
      : gap(0),
    padding: autoLayout
      ? dimensions(
          node.paddingTop ?? 0,
          node.paddingRight ?? 0,
          node.paddingBottom ?? 0,
          node.paddingLeft ?? 0,
          "vw",
          context.rootBounds.width,
        )
      : dimensions(0, 0, 0, 0),
    overflow: node.clipsContent ? "hidden" : "",
  };
  if (autoLayout) {
    settings.flex_justify_content = flexAlignment(node.primaryAxisAlignItems);
    settings.flex_align_items = flexAlignment(node.counterAxisAlignItems);
    settings.flex_wrap = node.layoutWrap === "WRAP" ? "wrap" : "nowrap";
  }
  const backgroundPaint = ownImagePaint(node);
  const backgroundUrl = backgroundPaint?.imageRef
    ? context.assets.imageUrls?.[backgroundPaint.imageRef] ?? null
    : null;
  if (backgroundUrl) {
    settings.background_background = "classic";
    settings.background_image = {
      url: backgroundUrl,
      id: "",
      source: "library",
      figmapress_key: mediaKey(`${node.id}:background`, backgroundUrl),
    };
    settings.background_position = "center center";
    settings.background_repeat = backgroundPaint?.scaleMode === "TILE" ? "repeat" : "no-repeat";
    settings.background_size = imageBackgroundSize(backgroundPaint);
  } else {
    const gradient = figmaGradient(node);
    if (gradient) {
      applyGradient(settings, gradient);
    } else {
      const background = solidColor(node.fills);
      if (background) {
        settings.background_background = "classic";
        settings.background_color = background;
      }
    }
  }
  const border = solidColor(node.strokes);
  if (border) {
    settings.border_border = "solid";
    settings.border_color = border;
    settings.border_width = dimensions(
      node.strokeWeight ?? 1,
      node.strokeWeight ?? 1,
      node.strokeWeight ?? 1,
      node.strokeWeight ?? 1,
      "vw",
      context.rootBounds.width,
    );
  }
  settings.border_radius = radiusDimensions(node, context);
  applyEffects(settings, node, "container");
  applyRotation(settings, node, parentBounds);
  if (bounds && node === context.root) settings.min_height = canvasSize(bounds.height, context);
  return settings;
}

function containerPosition(
  node: FigmaNode,
  bounds: FigmaBounds,
  parent: FigmaBounds,
  parentNode: FigmaNode,
  context: RenderContext,
): ElementorSettings {
  if (isAutoLayout(parentNode)) {
    const width = flowSize(node, bounds, parent, parentNode);
    return {
      width,
      width_tablet: width,
      width_mobile: width,
      min_height: canvasSize(bounds.height, context),
      flex_grow: node.layoutGrow && node.layoutGrow > 0 ? "1" : "0",
      flex_shrink: "0",
      ...(node.layoutAlign ? { flex_align_self: flexAlignment(node.layoutAlign) } : {}),
    };
  }
  const width = size(percent(bounds.width, parent.width), "%");
  return {
    position: "absolute",
    z_index: 1,
    _offset_orientation_h: "start",
    _offset_x: size(percent(bounds.x - parent.x, parent.width), "%"),
    _offset_orientation_v: "start",
    _offset_y: size(percent(bounds.y - parent.y, parent.height), "%"),
    width,
    width_tablet: width,
    width_mobile: width,
    min_height: canvasSize(bounds.height, context),
  };
}

function widgetPosition(
  node: FigmaNode,
  bounds: FigmaBounds,
  parent: FigmaBounds,
  parentNode: FigmaNode,
): ElementorSettings {
  if (isAutoLayout(parentNode)) {
    const width = flowSize(node, bounds, parent, parentNode);
    return {
      _element_width: "initial",
      _element_custom_width: width,
      _element_custom_width_tablet: width,
      _element_custom_width_mobile: width,
      _flex_grow: node.layoutGrow && node.layoutGrow > 0 ? "1" : "0",
      ...(node.layoutAlign ? { _flex_align_self: flexAlignment(node.layoutAlign) } : {}),
    };
  }
  return {
    _position: "absolute",
    _offset_orientation_h: "start",
    _offset_x: size(percent(bounds.x - parent.x, parent.width), "%"),
    _offset_orientation_v: "start",
    _offset_y: size(percent(bounds.y - parent.y, parent.height), "%"),
    _element_width: "initial",
    _element_custom_width: size(percent(bounds.width, parent.width), "%"),
    _element_custom_width_tablet: size(percent(bounds.width, parent.width), "%"),
    _element_custom_width_mobile: size(percent(bounds.width, parent.width), "%"),
  };
}

function widget(
  ids: ElementIdFactory,
  seed: string,
  widgetType: NonNullable<ElementorElement["widgetType"]>,
  settings: ElementorSettings,
): ElementorElement {
  return {
    id: ids.create(seed),
    elType: "widget",
    widgetType,
    isInner: false,
    settings,
    elements: [],
  };
}

function previewNode(
  node: FigmaNode,
  parentBounds: FigmaBounds,
  parentNode: FigmaNode,
  context: RenderContext,
): string {
  const bounds = node.absoluteBoundingBox;
  if (node.visible === false || !bounds || bounds.width <= 0 || bounds.height <= 0) return "";
  const position = previewPosition(node, bounds, parentBounds, parentNode);
  const attributes = previewNodeAttributes(node);
  const asset = visualAsset(node, context.assets);
  if (asset) {
    const imageManifest = asset.rendered ? null : figmaImageManifest(asset.paint);
    if (imageManifest) {
      if (imageManifest.mode === "tile") {
        return previewActionWrapper(`<div aria-label="${escapeAttribute(node.name)}" ${attributes} data-figmapress-kind="visual" data-figmapress-image-mode="tile" data-figmapress-image-source="native" style="${position};background-image:url(&quot;${escapeAttribute(asset.url)}&quot;);background-position:0 0;background-repeat:repeat;background-size:${round((imageManifest.scalingFactor ?? 1) * 100)}% auto;overflow:hidden;${previewRadius(node)}${previewTransform(node, parentBounds)}${previewEffects(node)}"></div>`, node, functionalLink(node, context));
      }
      return previewActionWrapper(`<div aria-label="${escapeAttribute(node.name)}" ${attributes} data-figmapress-kind="visual" data-figmapress-image-mode="${imageManifest.mode}" data-figmapress-image-source="native" style="${position};overflow:hidden;${previewRadius(node)}${previewTransform(node, parentBounds)}${previewEffects(node)}"><img alt="${escapeAttribute(node.name)}" src="${escapeAttribute(asset.url)}" style="display:block;height:100%;max-width:none;object-fit:${imageObjectFit(asset)};object-position:center center;width:100%;${previewImagePaint(imageManifest)}" /></div>`, node, functionalLink(node, context));
    }
    return previewActionWrapper(`<img alt="${escapeAttribute(node.name)}" ${attributes} data-figmapress-kind="visual" data-figmapress-image-source="${asset.rendered ? "rendered" : "native"}" src="${escapeAttribute(asset.url)}" style="${position};object-fit:${imageObjectFit(asset)};object-position:center center;${previewRadius(node)}${previewTransform(node, parentBounds)}${previewEffects(node)}" />`, node, functionalLink(node, context));
  }

  const backgroundPaint = ownImagePaint(node);
  const backgroundUrl = ownImageUrl(node, context.assets.imageUrls ?? {});
  const gradient = figmaGradient(node);
  const background = backgroundUrl
    ? `background-image:url(&quot;${escapeAttribute(backgroundUrl)}&quot;);background-position:center;background-repeat:${backgroundPaint?.scaleMode === "TILE" ? "repeat" : "no-repeat"};background-size:${imageBackgroundSize(backgroundPaint)};`
    : gradient
      ? `background-image:${escapeAttribute(gradientCss(gradient))};`
      : solidColor(node.fills) ? `background:${escapeAttribute(solidColor(node.fills) ?? "")};` : "";
  const border = solidColor(node.strokes)
    ? `border:${round(node.strokeWeight ?? 1)}px solid ${escapeAttribute(solidColor(node.strokes) ?? "")};`
    : "";
  const overflow = node.clipsContent ? "overflow:hidden;" : "overflow:visible;";

  if (node.type === "TEXT") {
    const runs = textRuns(node);
    const style = runs.length === 1 ? runs[0]?.style ?? {} : node.style ?? {};
    const fontSize = textFontSize(style, runs, bounds);
    // The wrapper intentionally has a zero font size so adjacent rich-text
    // runs do not inherit stray whitespace. Every run therefore has to restore
    // its own typography, including ordinary single-style text. Returning raw
    // text for a single run made most headings, body copy, nav labels and CTA
    // text exist in the DOM but render at 0px in the page preview.
    const content = runs
      .map((run) => runHtml(run, context))
      .join("")
      .replace(/\n/g, "<br>");
    return previewActionWrapper(`<div ${attributes} data-figmapress-kind="text" style="${position};box-sizing:border-box;color:${escapeAttribute(solidColor(style.fills ?? node.fills) ?? "#111111")};display:flex;flex-direction:column;font-family:${escapeAttribute(cssFont(style.fontFamily))};font-size:calc(var(--figma-unit) * ${round(fontSize)});font-style:${style.italic ? "italic" : "normal"};font-weight:${round(style.fontWeight ?? 400)};hyphens:none;justify-content:${textVerticalAlign(style.textAlignVertical)};letter-spacing:calc(var(--figma-unit) * ${round(style.letterSpacing ?? 0)});line-break:strict;line-height:${round(textLineHeight(style, runs, fontSize) / fontSize)};max-width:100%;overflow:${textOverflow(node)};overflow-wrap:${textOverflowWrap(node)};text-align:${textAlign(style.textAlignHorizontal)};text-decoration:${textDecoration(style.textDecoration)};text-orientation:mixed;text-transform:${textTransform(style.textCase)};white-space:${textWhiteSpace(node)};word-break:${textWordBreak(node)};writing-mode:horizontal-tb;${previewTransform(node, parentBounds)}${previewEffects(node)}"><span style="display:block;font-size:0;line-height:0;max-width:100%">${content}</span></div>`, node, functionalLink(node, context));
  }

  const children = (node.children ?? []).map((child) => previewNode(child, bounds, node, context)).join("");
  const action = functionalLink(node, context);
  if (!children && !background && !border && !action) return "";
  const link = action
    ? `<a data-figmapress-preview-link href="${escapeAttribute(action.url)}" aria-label="${escapeAttribute(action.label)}"${action.external ? ' target="_blank" rel="noopener noreferrer"' : ""} style="background:transparent;border:0;border-radius:0;box-shadow:none;color:transparent;display:block;inset:0;margin:0;padding:0;position:absolute;text-decoration:none;z-index:20"></a>`
    : "";
  return `<div aria-label="${escapeAttribute(node.name)}" ${attributes} data-figmapress-kind="container" style="${position};${previewAutoLayout(node)}${background}${border}${previewRadius(node)}${overflow}${previewTransform(node, parentBounds)}${previewEffects(node)}">${children}${link}</div>`;
}

function previewActionWrapper(
  content: string,
  node: FigmaNode,
  action: FunctionalLink | null,
): string {
  if (!action) return content;
  return `<a data-figmapress-preview-link href="${escapeAttribute(action.url)}" aria-label="${escapeAttribute(action.label || node.name)}"${action.external ? ' target="_blank" rel="noopener noreferrer"' : ""} style="background:transparent;border:0;border-radius:0;box-shadow:none;display:contents;margin:0;padding:0;text-decoration:none">${content}</a>`;
}

function previewNodeAttributes(node: FigmaNode): string {
  return `data-figmapress-node-id="${escapeAttribute(node.id)}" data-figmapress-node-name="${escapeAttribute(node.name)}"`;
}

function previewPosition(
  node: FigmaNode,
  bounds: FigmaBounds,
  parent: FigmaBounds,
  parentNode: FigmaNode,
): string {
  if (isAutoLayout(parentNode)) {
    const horizontalParent = parentNode.layoutMode === "HORIZONTAL";
    const stretch = node.layoutAlign === "STRETCH";
    const fillHorizontal = node.layoutSizingHorizontal === "FILL"
      || (stretch && !horizontalParent);
    const fillVertical = node.layoutSizingVertical === "FILL"
      || (stretch && horizontalParent);
    const width = fillHorizontal
      ? "width:auto;"
      : `width:calc(var(--figma-unit) * ${round(bounds.width)});`;
    const height = fillVertical
      ? "height:auto;"
      : `height:calc(var(--figma-unit) * ${round(bounds.height)});`;
    const grow = node.layoutGrow && node.layoutGrow > 0 ? "flex-grow:1;" : "flex-grow:0;";
    return `position:relative;${width}${height}${grow}flex-shrink:0;${stretch ? "align-self:stretch;" : ""}`;
  }
  return `position:absolute;left:${round(percent(bounds.x - parent.x, parent.width))}%;top:${round(percent(bounds.y - parent.y, parent.height))}%;width:${round(percent(bounds.width, parent.width))}%;height:${round(percent(bounds.height, parent.height))}%;`;
}

function previewAutoLayout(node: FigmaNode): string {
  if (!isAutoLayout(node)) return "";
  const padding = [
    node.paddingTop ?? 0,
    node.paddingRight ?? 0,
    node.paddingBottom ?? 0,
    node.paddingLeft ?? 0,
  ].map((value) => `calc(var(--figma-unit) * ${round(value)})`).join(" ");
  return [
    "display:flex;",
    `flex-direction:${node.layoutMode === "HORIZONTAL" ? "row" : "column"};`,
    `flex-wrap:${node.layoutWrap === "WRAP" ? "wrap" : "nowrap"};`,
    `gap:calc(var(--figma-unit) * ${round(node.itemSpacing ?? 0)});`,
    `justify-content:${flexAlignment(node.primaryAxisAlignItems)};`,
    `align-items:${flexAlignment(node.counterAxisAlignItems)};`,
    `padding:${padding};`,
  ].join("");
}

function isAutoLayout(node: FigmaNode): boolean {
  return node.layoutMode === "HORIZONTAL" || node.layoutMode === "VERTICAL";
}

function flowSize(
  node: FigmaNode,
  bounds: FigmaBounds,
  parent: FigmaBounds,
  parentNode: FigmaNode,
): Record<string, unknown> {
  if (parentNode.layoutMode === "HORIZONTAL" && node.layoutGrow && node.layoutGrow > 0) {
    return size(0, "%");
  }
  if (
    node.layoutSizingHorizontal === "FILL"
    || (parentNode.layoutMode === "VERTICAL" && node.layoutAlign === "STRETCH")
  ) {
    return size(100, "%");
  }
  return size(percent(bounds.width, parent.width), "%");
}

function flexAlignment(value: string | undefined): string {
  if (value === "CENTER") return "center";
  if (value === "MAX") return "flex-end";
  if (value === "SPACE_BETWEEN") return "space-between";
  if (value === "BASELINE") return "baseline";
  if (value === "STRETCH") return "stretch";
  return "flex-start";
}

function textRuns(node: FigmaNode): RichRun[] {
  const value = node.characters ?? "";
  const latinBlocks = value.match(/[A-Za-z0-9]{30,}/g) ?? [];
  const calibrateLongLatin = latinBlocks.some((block) => block.length >= 80)
    || (
      latinBlocks.length >= 2
      && latinBlocks.reduce((total, block) => total + block.length, 0) >= 120
    );
  const calibratedStyle = (style: FigmaTypeStyle): FigmaTypeStyle => {
    const fontSize = positive(style.fontSize) ? style.fontSize : 0;
    const serif = /serif|mincho/i.test(style.fontFamily ?? "");
    if (!calibrateLongLatin || !serif || !fontSize) return style;
    // Figma and Chromium use slightly different advances for long, unbroken
    // Noto Serif Latin runs. The small tracking calibration keeps Figma's
    // editable text and line wrapping aligned without rasterising the copy.
    return {
      ...style,
      letterSpacing: round((style.letterSpacing ?? 0) + fontSize * 0.025),
    };
  };
  const overrides = node.characterStyleOverrides;
  if (!overrides?.length || !node.styleOverrideTable) {
    return [{ text: value, style: calibratedStyle(node.style ?? {}) }];
  }
  const runs: RichRun[] = [];
  let start = 0;
  let current = overrides[0] ?? 0;
  for (let index = 1; index <= value.length; index += 1) {
    const next = overrides[index] ?? current;
    if (index < value.length && next === current) continue;
    const baseStyle = node.style ?? {};
    const overrideStyle = node.styleOverrideTable[String(current)] ?? {};
    const style = { ...baseStyle, ...overrideStyle };
    // Figma's override table can change only the font size while leaving the
    // node-level absolute lineHeightPx in the base style. Smaller runs should
    // preserve the base ratio, otherwise they gain 2x+ line heights. Larger
    // runs (for example an enlarged leading numeral) share the node's absolute
    // line box; scaling that line height again pushes every following line
    // down even though Figma keeps the common lineHeightPx.
    if (
      overrideStyle.lineHeightPx === undefined
      && positive(baseStyle.fontSize)
      && positive(baseStyle.lineHeightPx)
      && positive(overrideStyle.fontSize)
    ) {
      style.lineHeightPx = overrideStyle.fontSize > baseStyle.fontSize
        ? baseStyle.lineHeightPx
        : baseStyle.lineHeightPx * (overrideStyle.fontSize / baseStyle.fontSize);
    }
    runs.push({
      text: value.slice(start, index),
      style: calibratedStyle(style),
    });
    start = index;
    current = next;
  }
  return runs.length
    ? runs
    : [{ text: value, style: calibratedStyle(node.style ?? {}) }];
}

function runHtml(run: RichRun, context: RenderContext): string {
  const color = solidColor(run.style.fills);
  const styles = [
    color ? `color:${color}` : "",
    run.style.fontFamily ? `font-family:${cssFont(run.style.fontFamily)}` : "",
    positive(run.style.fontSize) ? `font-size:${canvasCss(run.style.fontSize, context)}` : "",
    run.style.fontWeight ? `font-weight:${run.style.fontWeight}` : "",
    run.style.italic ? "font-style:italic" : "",
    finite(run.style.letterSpacing) && run.style.letterSpacing !== 0
      ? `letter-spacing:${canvasCss(run.style.letterSpacing, context)}`
      : "",
    positive(run.style.lineHeightPx) && positive(run.style.fontSize)
      ? `line-height:${round(run.style.lineHeightPx / run.style.fontSize)}`
      : "",
    run.style.textDecoration && run.style.textDecoration !== "NONE"
      ? `text-decoration:${textDecoration(run.style.textDecoration)}`
      : "",
  ].filter(Boolean).join(";");
  const content = escapeHtml(run.text);
  return styles ? `<span style="${escapeAttribute(styles)}">${content}</span>` : content;
}

function visualUrl(node: FigmaNode, assets: FigmaRenderAssets): string | null {
  return visualAsset(node, assets)?.url ?? null;
}

function visualAsset(node: FigmaNode, assets: FigmaRenderAssets): FigmaVisualAsset | null {
  const rendered = assets.renderedNodeUrls?.[node.id];
  if (rendered) return { url: rendered, rendered: true };
  if (containsText(node)) return null;
  const paint = ownImagePaint(node);
  const url = paint?.imageRef ? assets.imageUrls?.[paint.imageRef] : undefined;
  return url ? { url, rendered: false, paint } : null;
}

function imageObjectFit(asset: FigmaVisualAsset): "contain" | "cover" | "fill" {
  if (asset.rendered) return "fill";
  switch (asset.paint?.scaleMode?.toUpperCase()) {
    case "FIT":
      return "contain";
    case "STRETCH":
      return "fill";
    case "TILE":
      return "contain";
    case "FILL":
    default:
      return "cover";
  }
}

function imageBackgroundSize(paint: FigmaPaint | undefined): "auto" | "contain" | "cover" {
  switch (paint?.scaleMode?.toUpperCase()) {
    case "FIT":
      return "contain";
    case "TILE":
      return "auto";
    case "FILL":
    case "STRETCH":
    default:
      return "cover";
  }
}

function figmaImageManifest(paint: FigmaPaint | undefined): FigmaImageManifest | null {
  if (!paint) return null;
  const mode = imageMode(paint.scaleMode);
  const transform = imageTransformManifest(paint.imageTransform);
  const filters = imageFiltersManifest(paint.filters);
  const rotation = finite(paint.rotation) && Math.abs(paint.rotation!) > 0.0001
    ? round(paint.rotation!)
    : undefined;
  const scalingFactor = mode === "tile" && positive(paint.scalingFactor)
    ? round(Math.max(0.01, Math.min(20, paint.scalingFactor!)))
    : undefined;
  if (!transform && rotation === undefined && !filters && mode !== "tile") return null;
  return {
    mode,
    ...(transform ? { transform } : {}),
    ...(rotation === undefined ? {} : { rotation }),
    ...(scalingFactor === undefined ? {} : { scalingFactor }),
    ...(filters ? { filters } : {}),
  };
}

function imageMode(scaleMode: string | undefined): FigmaImageManifest["mode"] {
  switch (scaleMode?.toUpperCase()) {
    case "FIT":
      return "fit";
    case "STRETCH":
      return "stretch";
    case "TILE":
      return "tile";
    case "FILL":
    default:
      return "fill";
  }
}

function imageTransformManifest(
  transform: FigmaPaint["imageTransform"],
): FigmaImageManifest["transform"] | undefined {
  if (
    !transform
    || transform.length !== 2
    || transform[0].length !== 3
    || transform[1].length !== 3
    || !transform.flat().every(finite)
  ) {
    return undefined;
  }
  return {
    a: round(transform[0][0]),
    b: round(transform[0][1]),
    c: round(transform[1][0]),
    d: round(transform[1][1]),
    tx: round(transform[0][2]),
    ty: round(transform[1][2]),
  };
}

function imageFiltersManifest(
  filters: FigmaPaint["filters"],
): FigmaImageManifest["filters"] | undefined {
  if (!filters) return undefined;
  const result = Object.fromEntries(
    Object.entries(filters)
      .filter((entry): entry is [string, number] =>
        finite(entry[1]) && Math.abs(entry[1]) > 0.0001
      )
      .map(([key, value]) => [key, round(Math.max(-1, Math.min(1, value)))]),
  ) as NonNullable<FigmaPaint["filters"]>;
  return Object.keys(result).length ? result : undefined;
}

function previewImagePaint(manifest: FigmaImageManifest): string {
  const declarations: string[] = ["transform-origin:0 0"];
  if (manifest.transform) {
    declarations.push(
      `translate:${round(manifest.transform.tx * 100)}% ${round(manifest.transform.ty * 100)}%`,
    );
  }
  const transforms: string[] = [];
  if (manifest.transform) {
    const { a, b, c, d } = manifest.transform;
    transforms.push(`matrix(${round(a)},${round(c)},${round(b)},${round(d)},0,0)`);
  }
  if (manifest.rotation !== undefined) {
    transforms.push(`rotate(${round(manifest.rotation)}deg)`);
  }
  if (transforms.length) declarations.push(`transform:${transforms.join(" ")}`);
  const filter = imageFilterCss(manifest.filters);
  if (filter) declarations.push(`filter:${filter}`);
  return `${declarations.join(";")};`;
}

function imageFilterCss(filters: FigmaImageManifest["filters"]): string {
  if (!filters) return "";
  const values: string[] = [];
  if (finite(filters.exposure)) {
    values.push(`brightness(${round(Math.max(0.05, Math.min(20, 2 ** filters.exposure!)))})`);
  }
  if (finite(filters.contrast)) {
    values.push(`contrast(${round(Math.max(0, Math.min(2, 1 + filters.contrast!)))})`);
  }
  if (finite(filters.saturation)) {
    values.push(`saturate(${round(Math.max(0, Math.min(2, 1 + filters.saturation!)))})`);
  }
  return values.join(" ");
}

function containsText(node: FigmaNode): boolean {
  if (node.type === "TEXT" && node.characters?.trim()) return true;
  return (node.children ?? []).some(containsText);
}

function ownImageUrl(node: FigmaNode, imageUrls: Record<string, string>): string | null {
  const imageRef = ownImagePaint(node)?.imageRef;
  return imageRef ? imageUrls[imageRef] ?? null : null;
}

function ownImagePaint(node: FigmaNode): FigmaPaint | undefined {
  return node.fills?.find((fill) =>
    fill.visible !== false && fill.type === "IMAGE" && fill.imageRef,
  );
}

function figmaGradient(node: FigmaNode): FigmaGradientManifest | null {
  const paint = node.fills?.find((candidate) =>
    candidate.visible !== false
    && ["GRADIENT_LINEAR", "GRADIENT_RADIAL"].includes(candidate.type.toUpperCase()),
  );
  const bounds = node.absoluteBoundingBox;
  const handles = paint?.gradientHandlePositions;
  const rawStops = paint?.gradientStops
    ?.filter((stop) =>
      Number.isFinite(stop.position)
      && stop.color
      && [stop.color.r, stop.color.g, stop.color.b].every(Number.isFinite),
    )
    .sort((left, right) => left.position - right.position);
  if (!paint || !bounds || !handles || handles.length !== 3 || !rawStops || rawStops.length < 2) {
    return null;
  }

  const selectedStops = rawStops.length <= 8
    ? rawStops
    : [...rawStops.slice(0, 7), rawStops[rawStops.length - 1]];
  const color = (value: FigmaColor): FigmaGradientColor => ({
    red: byte(value.r),
    green: byte(value.g),
    blue: byte(value.b),
    alpha: round(Math.max(0, Math.min(1, (value.a ?? 1) * (paint.opacity ?? 1)))),
  });
  const type = paint.type.toUpperCase();

  if (type === "GRADIENT_LINEAR") {
    const start = {
      x: handles[0].x * bounds.width,
      y: handles[0].y * bounds.height,
    };
    const end = {
      x: handles[1].x * bounds.width,
      y: handles[1].y * bounds.height,
    };
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const distance = Math.hypot(dx, dy);
    if (distance < 0.001) return null;
    const ux = dx / distance;
    const uy = dy / distance;
    const cssLineLength =
      Math.abs(bounds.width * ux) + Math.abs(bounds.height * uy);
    if (cssLineLength < 0.001) return null;
    const startProjection =
      (start.x - bounds.width / 2) * ux + (start.y - bounds.height / 2) * uy;
    const angle = (Math.atan2(dx, -dy) * 180 / Math.PI + 360) % 360;
    return {
      type: "linear",
      angle: round(angle),
      stops: selectedStops.map((stop) => ({
        color: color(stop.color),
        position: round(
          (startProjection + stop.position * distance + cssLineLength / 2)
          / cssLineLength
          * 100,
        ),
      })),
    };
  }

  const center = handles[0];
  const radiusX = Math.hypot(
    (handles[1].x - center.x) * bounds.width,
    (handles[1].y - center.y) * bounds.height,
  ) / bounds.width * 100;
  const radiusY = Math.hypot(
    (handles[2].x - center.x) * bounds.width,
    (handles[2].y - center.y) * bounds.height,
  ) / bounds.height * 100;
  if (radiusX < 0.001 || radiusY < 0.001) return null;
  return {
    type: "radial",
    center: { x: round(center.x * 100), y: round(center.y * 100) },
    radius: { x: round(radiusX), y: round(radiusY) },
    stops: selectedStops.map((stop) => ({
      color: color(stop.color),
      position: round(stop.position * 100),
    })),
  };
}

function gradientColorCss(color: FigmaGradientColor): string {
  if (color.alpha < 0.999) {
    return `rgba(${color.red}, ${color.green}, ${color.blue}, ${round(color.alpha)})`;
  }
  return `#${hex(color.red)}${hex(color.green)}${hex(color.blue)}`.toUpperCase();
}

function gradientCss(gradient: FigmaGradientManifest | null): string {
  if (!gradient) return "";
  const stops = gradient.stops
    .map((stop) => `${gradientColorCss(stop.color)} ${round(stop.position)}%`)
    .join(", ");
  if (gradient.type === "linear") {
    return `linear-gradient(${round(gradient.angle ?? 180)}deg, ${stops})`;
  }
  return `radial-gradient(ellipse ${round(gradient.radius?.x ?? 50)}% ${round(gradient.radius?.y ?? 50)}% at ${round(gradient.center?.x ?? 50)}% ${round(gradient.center?.y ?? 50)}%, ${stops})`;
}

function applyGradient(
  settings: ElementorSettings,
  gradient: FigmaGradientManifest,
): void {
  const first = gradient.stops[0];
  const last = gradient.stops[gradient.stops.length - 1];
  settings.background_background = "gradient";
  settings.background_color = gradientColorCss(first.color);
  settings.background_color_stop = size(
    Math.max(0, Math.min(100, first.position)),
    "%",
  );
  settings.background_color_b = gradientColorCss(last.color);
  settings.background_color_b_stop = size(
    Math.max(0, Math.min(100, last.position)),
    "%",
  );
  settings.background_gradient_type = gradient.type;
  if (gradient.type === "linear") {
    settings.background_gradient_angle = size(gradient.angle ?? 180, "deg");
  } else {
    settings.background_gradient_position = nearestGradientPosition(
      gradient.center?.x ?? 50,
      gradient.center?.y ?? 50,
    );
  }
  settings.figmapress_gradient = gradient;
}

function nearestGradientPosition(x: number, y: number): string {
  const horizontal = x < 33.333 ? "left" : x > 66.667 ? "right" : "center";
  const vertical = y < 33.333 ? "top" : y > 66.667 ? "bottom" : "center";
  return `${vertical} ${horizontal}`;
}

function solidColor(paints: FigmaPaint[] | undefined): string | null {
  const paint = paints?.find((candidate) =>
    candidate.visible !== false && candidate.type === "SOLID" && candidate.color,
  );
  if (!paint?.color) return null;
  return colorCss(paint.color, paint.opacity);
}

function colorCss(color: FigmaColor, paintOpacity = 1): string {
  const red = byte(color.r);
  const green = byte(color.g);
  const blue = byte(color.b);
  const alpha = Math.max(0, Math.min(1, (color.a ?? 1) * paintOpacity));
  if (alpha < 0.999) return `rgba(${red}, ${green}, ${blue}, ${round(alpha)})`;
  return `#${hex(red)}${hex(green)}${hex(blue)}`.toUpperCase();
}

function applyTypographyFlags(settings: ElementorSettings, style: FigmaTypeStyle): void {
  if (style.italic) settings.typography_font_style = "italic";
  const transform = textTransform(style.textCase);
  if (transform !== "none") settings.typography_text_transform = transform;
  const decoration = textDecoration(style.textDecoration);
  if (decoration !== "none") settings.typography_text_decoration = decoration;
}

export function figmaRotationShouldApply(
  node: FigmaNode,
  parentBounds?: FigmaBounds,
): boolean {
  if (!node.rotation || Math.abs(node.rotation) < 0.001) return false;
  const bounds = node.absoluteBoundingBox;
  if (!bounds || !parentBounds) return true;
  const edgeTolerance = parentBounds.width * 0.02;
  const fullBleedSolidRectangle = node.type === "RECTANGLE"
    && Math.abs(node.rotation) <= 5
    && Boolean(solidColor(node.fills))
    && bounds.width >= parentBounds.width * 0.98
    && bounds.x <= parentBounds.x + edgeTolerance
    && bounds.x + bounds.width >= parentBounds.x + parentBounds.width - edgeTolerance;
  // Figma's absoluteBoundingBox already encloses these clipped, full-bleed
  // section backgrounds. Rotating that axis-aligned box again creates white
  // triangles and diagonal section gaps that are absent from the Figma render.
  return !fullBleedSolidRectangle;
}

function applyRotation(
  settings: ElementorSettings,
  node: FigmaNode,
  parentBounds?: FigmaBounds,
): void {
  if (!figmaRotationShouldApply(node, parentBounds)) return;
  settings._transform_rotate_popover = "transform";
  settings._transform_rotateZ_effect = size(node.rotation ?? 0, "deg");
}

function figmaEffects(node: FigmaNode): FigmaEffectsManifest | null {
  const manifest: FigmaEffectsManifest = {};
  if (finite(node.opacity) && node.opacity! >= 0 && node.opacity! < 0.999) {
    manifest.opacity = round(Math.max(0, Math.min(1, node.opacity!)));
  }
  const shadows = (node.effects ?? [])
    .filter((effect) =>
      effect.visible !== false
      && (effect.type === "DROP_SHADOW" || effect.type === "INNER_SHADOW"),
    )
    .slice(0, 8)
    .map((effect): FigmaShadowManifest => ({
      type: effect.type === "INNER_SHADOW" ? "inner" : "drop",
      x: round(effect.offset?.x ?? 0),
      y: round(effect.offset?.y ?? 0),
      blur: round(Math.max(0, effect.radius ?? 0)),
      spread: round(effect.spread ?? 0),
      color: figmaEffectColor(effect.color),
    }));
  if (shadows.length) manifest.shadows = shadows;
  const blur = (node.effects ?? []).find((effect) =>
    effect.visible !== false && effect.type === "LAYER_BLUR" && finite(effect.radius),
  );
  if (blur?.radius && blur.radius > 0) manifest.blur = round(blur.radius);
  const backgroundBlur = (node.effects ?? []).find((effect) =>
    effect.visible !== false && effect.type === "BACKGROUND_BLUR" && finite(effect.radius),
  );
  if (backgroundBlur?.radius && backgroundBlur.radius > 0) {
    manifest.backgroundBlur = round(backgroundBlur.radius);
  }
  return Object.keys(manifest).length ? manifest : null;
}

function figmaEffectColor(color: FigmaColor | undefined): FigmaGradientColor {
  return {
    red: byte(color?.r ?? 0),
    green: byte(color?.g ?? 0),
    blue: byte(color?.b ?? 0),
    alpha: round(Math.max(0, Math.min(1, color?.a ?? 0.2))),
  };
}

function applyEffects(
  settings: ElementorSettings,
  node: FigmaNode,
  target: "container" | "image" | "widget" = "widget",
): void {
  const effects = figmaEffects(node);
  if (!effects) return;
  const connectorEffects = target === "image" && typeof effects.opacity === "number"
    ? Object.fromEntries(Object.entries(effects).filter(([key]) => key !== "opacity"))
    : effects;
  if (Object.keys(connectorEffects).length) settings.figmapress_effects = connectorEffects;
  const shadow = effects.shadows?.[0];
  if (!shadow || target !== "container") return;
  const prefix = "box_shadow";
  settings[`${prefix}_box_shadow_type`] = "yes";
  settings[`${prefix}_box_shadow`] = {
    horizontal: shadow.x,
    vertical: shadow.y,
    blur: shadow.blur,
    spread: shadow.spread,
    color: gradientColorCss(shadow.color),
  };
  if (shadow.type === "inner") {
    settings[`${prefix}_box_shadow_position`] = "inset";
  }
}

function previewEffects(node: FigmaNode): string {
  const effects = figmaEffects(node);
  if (!effects) return "";
  const declarations: string[] = [];
  if (typeof effects.opacity === "number") declarations.push(`opacity:${round(effects.opacity)}`);
  if (effects.shadows?.length) {
    const shadows = effects.shadows.map((shadow) => [
      `${round(shadow.x)}px`,
      `${round(shadow.y)}px`,
      `${round(shadow.blur)}px`,
      `${round(shadow.spread)}px`,
      gradientColorCss(shadow.color),
      shadow.type === "inner" ? "inset" : "",
    ].filter(Boolean).join(" "));
    declarations.push(`box-shadow:${shadows.join(",")}`);
  }
  if (effects.blur) declarations.push(`filter:blur(${round(effects.blur)}px)`);
  if (effects.backgroundBlur) {
    declarations.push(`-webkit-backdrop-filter:blur(${round(effects.backgroundBlur)}px)`);
    declarations.push(`backdrop-filter:blur(${round(effects.backgroundBlur)}px)`);
  }
  return `${declarations.join(";")};`;
}

function headingTag(node: FigmaNode, fontSize: number): string {
  const name = node.name.toLowerCase();
  if (/h1|headline|main.?title|メイン|見出し/.test(name) && fontSize >= 34) return "h1";
  if (/h2|section.?title|heading|title|見出し/.test(name) && fontSize >= 24) return "h2";
  if (/h3|subtitle|sub.?title|小見出し/.test(name) && fontSize >= 18) return "h3";
  return "div";
}

function htmlTag(node: FigmaNode): string {
  const name = node.name.toLowerCase();
  if (/(header|ヘッダー)/.test(name)) return "header";
  if (/(footer|フッター)/.test(name)) return "footer";
  if (/(nav|menu|ナビ)/.test(name)) return "nav";
  if (/(section|sec|セクション)/.test(name)) return "section";
  return "div";
}

function radiusDimensions(node: FigmaNode, context: RenderContext): Record<string, unknown> {
  const corners = node.rectangleCornerRadii;
  if (corners) return dimensions(corners[0], corners[1], corners[2], corners[3], "vw", context.rootBounds.width);
  const radius = node.type === "ELLIPSE"
    ? Math.max(node.absoluteBoundingBox?.width ?? 0, node.absoluteBoundingBox?.height ?? 0)
    : node.cornerRadius ?? 0;
  return dimensions(radius, radius, radius, radius, "vw", context.rootBounds.width);
}

function previewRadius(node: FigmaNode): string {
  const corners = node.rectangleCornerRadii;
  if (corners) {
    return `border-radius:${corners.map((value) => `calc(var(--figma-unit) * ${round(value)})`).join(" ")};`;
  }
  if (node.type === "ELLIPSE") return "border-radius:50%;";
  return node.cornerRadius
    ? `border-radius:calc(var(--figma-unit) * ${round(node.cornerRadius)});`
    : "";
}

function textAlign(value: FigmaTypeStyle["textAlignHorizontal"]): string {
  if (value === "CENTER") return "center";
  if (value === "RIGHT") return "right";
  if (value === "JUSTIFIED") return "justify";
  return "left";
}

function textVerticalAlign(value: FigmaTypeStyle["textAlignVertical"]): string {
  if (value === "CENTER") return "center";
  if (value === "BOTTOM") return "flex-end";
  return "flex-start";
}

function textWhiteSpace(node: FigmaNode): "pre" | "pre-wrap" {
  return figmaTextShouldWrap(node) ? "pre-wrap" : "pre";
}

function textOverflowWrap(node: FigmaNode): "anywhere" | "normal" {
  return figmaTextShouldWrap(node) ? "anywhere" : "normal";
}

function textWordBreak(node: FigmaNode): "break-word" | "keep-all" {
  return figmaTextShouldWrap(node) ? "break-word" : "keep-all";
}

export function figmaTextShouldWrap(node: FigmaNode): boolean {
  const bounds = node.absoluteBoundingBox;
  if (!bounds || node.type !== "TEXT" || !node.characters) return false;
  const style = node.style ?? {};
  const runs = textRuns(node);
  const fontSize = textFontSize(style, runs, bounds);
  const lineHeight = textLineHeight(style, runs, fontSize);
  const explicitLines = node.characters.split("\n").length;
  const tallestRunLineHeight = Math.max(
    lineHeight,
    ...runs.map((run) => Math.max(
      positive(run.style.lineHeightPx) ? run.style.lineHeightPx : 0,
      positive(run.style.fontSize) ? run.style.fontSize * 1.25 : lineHeight,
    )),
  );
  // Figma can label a text box HEIGHT, NONE or WIDTH_AND_HEIGHT depending on
  // how its width was authored. The rendered bounds are the reliable signal:
  // if the box is only one run-line tall and contains no explicit newline,
  // browser fallback-font metrics must not create a second colliding line.
  if (explicitLines === 1 && bounds.height <= tallestRunLineHeight * 1.4) {
    return false;
  }
  if (
    node.textAutoResize === "HEIGHT"
    || node.textAutoResize === "NONE"
    || node.textAutoResize === "TRUNCATE"
  ) {
    return true;
  }
  return bounds.height > tallestRunLineHeight * (explicitLines + 0.4);
}

function textOverflow(node: FigmaNode): "hidden" | "visible" {
  return node.textAutoResize === "TRUNCATE" ? "hidden" : "visible";
}

function textBoxHeight(
  node: FigmaNode,
  bounds: FigmaBounds,
  context: RenderContext,
): string {
  const property =
    node.textAutoResize === "NONE" || node.textAutoResize === "TRUNCATE"
      ? "height"
      : "min-height";
  return `${property}:${canvasCss(bounds.height, context)};`;
}

function textFontSize(style: FigmaTypeStyle, runs: RichRun[], bounds: FigmaBounds): number {
  if (positive(style.fontSize)) return style.fontSize;
  const runSize = Math.max(0, ...runs.map((run) => positive(run.style.fontSize) ? run.style.fontSize : 0));
  return runSize || Math.max(12, bounds.height * 0.72);
}

function textLineHeight(style: FigmaTypeStyle, runs: RichRun[], fontSize: number): number {
  if (positive(style.lineHeightPx)) return style.lineHeightPx;
  const runHeight = Math.max(0, ...runs.map((run) => positive(run.style.lineHeightPx) ? run.style.lineHeightPx : 0));
  return runHeight || fontSize * 1.25;
}

function textTransform(value: FigmaTypeStyle["textCase"]): string {
  if (value === "UPPER") return "uppercase";
  if (value === "LOWER") return "lowercase";
  if (value === "TITLE") return "capitalize";
  return "none";
}

function textDecoration(value: FigmaTypeStyle["textDecoration"]): string {
  if (value === "UNDERLINE") return "underline";
  if (value === "STRIKETHROUGH") return "line-through";
  return "none";
}

function cssFont(value: string | undefined): string {
  const primary = value?.replace(/['\\]/g, "").trim();
  const serif = Boolean(primary && /serif|mincho/i.test(primary));
  const japaneseFallback = serif ? "Noto Serif JP" : "Noto Sans JP";
  const families = [
    primary,
    japaneseFallback,
    ...(serif
      ? ["Hiragino Mincho ProN", "Yu Mincho", "Times New Roman", "serif"]
      : [
          "Hiragino Kaku Gothic ProN",
          "Yu Gothic",
          "Meiryo",
          "Arial",
          "sans-serif",
        ]),
  ].filter((family, index, values): family is string =>
    Boolean(family)
    && values.findIndex(
      (candidate) => candidate?.toLowerCase() === family?.toLowerCase(),
    ) === index,
  );
  return families
    .map((family) =>
      family.includes(" ") ? `'${family}'` : family,
    )
    .join(",");
}

function size(value: number, unit = "px"): Record<string, unknown> {
  return { unit, size: round(value), sizes: [] };
}

function canvasSize(value: number, context: RenderContext): Record<string, unknown> {
  return size(percent(value, context.rootBounds.width), "vw");
}

function canvasCss(value: number, context: RenderContext): string {
  return `${round(percent(value, context.rootBounds.width))}vw`;
}

function gap(value: number, unit = "px", scaleBase?: number): Record<string, unknown> {
  const converted = scaleBase ? percent(value, scaleBase) : value;
  const rounded = round(converted);
  return {
    column: String(rounded),
    row: String(rounded),
    isLinked: true,
    unit,
    size: rounded,
  };
}

function dimensions(
  top: number,
  right: number,
  bottom: number,
  left: number,
  unit = "px",
  scaleBase?: number,
): Record<string, unknown> {
  const convert = (value: number): number => scaleBase ? percent(value, scaleBase) : value;
  return {
    unit,
    top: String(round(convert(top))),
    right: String(round(convert(right))),
    bottom: String(round(convert(bottom))),
    left: String(round(convert(left))),
    isLinked: top === right && right === bottom && bottom === left,
  };
}

function previewTransform(node: FigmaNode, parentBounds?: FigmaBounds): string {
  const rotation = figmaRotationShouldApply(node, parentBounds)
    ? ` rotate(${round(node.rotation ?? 0)}deg)`
    : "";
  return `--figmapress-qa-global-transform:translate(0px,0px);--figmapress-qa-runtime-global-transform:translate(0px,0px);--figmapress-qa-local-transform:translate(0px,0px);--figmapress-qa-runtime-local-transform:translate(0px,0px);--figmapress-qa-geometry-transform:translate(0px,0px) scale(1,1);--figmapress-qa-runtime-geometry-transform:translate(0px,0px) scale(1,1);transform:var(--figmapress-qa-global-transform) var(--figmapress-qa-runtime-global-transform) var(--figmapress-qa-local-transform) var(--figmapress-qa-runtime-local-transform) var(--figmapress-qa-geometry-transform) var(--figmapress-qa-runtime-geometry-transform)${rotation};transform-origin:center;`;
}

function positive(value: number | undefined): value is number {
  return finite(value) && value > 0;
}

function finite(value: number | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function percent(value: number, total: number): number {
  return total > 0 ? (value / total) * 100 : 0;
}

function validBounds(bounds: FigmaBounds | undefined): bounds is FigmaBounds {
  return Boolean(bounds && bounds.width > 0 && bounds.height > 0);
}

function responsiveFrameKind(node: FigmaNode): "desktop" | "mobile" | null {
  const bounds = node.absoluteBoundingBox;
  if (!bounds) return null;
  const name = node.name.toLowerCase();
  const desktopName = /(?:^|[\/_\s-])(?:pc|desktop)(?:$|[\/_\s-])|デスクトップ/.test(name);
  const mobileName = /(?:^|[\/_\s-])(?:sp|mobile|phone)(?:$|[\/_\s-])|スマホ/.test(name);
  if (desktopName && bounds.width >= 768) return "desktop";
  if (mobileName && bounds.width <= 768) return "mobile";
  return null;
}

function area(node: FigmaNode): number {
  const bounds = node.absoluteBoundingBox;
  return bounds ? bounds.width * bounds.height : 0;
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function byte(value: number): number {
  return Math.max(0, Math.min(255, Math.round(value * 255)));
}

function hex(value: number): string {
  return value.toString(16).padStart(2, "0");
}

function hashId(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0").slice(0, 8);
}

function mediaKey(seed: string, value: string): string {
  let assetIdentity = value.split("?", 1)[0] ?? value;
  try {
    const url = new URL(value);
    assetIdentity = `${url.hostname.toLowerCase()}${url.pathname}`;
  } catch {
    // The URL is validated before WordPress import; hashing remains bounded.
  }
  return `${seed}:${hashId(assetIdentity)}`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function escapeAttribute(value: string): string {
  return escapeHtml(value).replace(/`/g, "&#096;");
}
