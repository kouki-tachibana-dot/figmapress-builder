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
}

interface RenderContext {
  ids: ElementIdFactory;
  root: FigmaNode;
  rootBounds: FigmaBounds;
  assets: FigmaRenderAssets;
  variant: "single" | "desktop" | "mobile";
  anchorSuffix: string;
  fallbackMenuTexts: FigmaNode[];
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

interface AccordionItem {
  title: string;
  content: string;
}

interface AccordionPlan {
  bounds: FigmaBounds;
  items: AccordionItem[];
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
    const fallbackMenuTexts = navigationMenuTexts(root);
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
  const fallbackMenuTexts = navigationMenuTexts(root);
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
  return {
    ids,
    root,
    rootBounds: root.absoluteBoundingBox as FigmaBounds,
    assets,
    variant,
    anchorSuffix,
    fallbackMenuTexts,
  };
}

function renderRootElement(
  root: FigmaNode,
  context: RenderContext,
  visibility: ElementorSettings,
): ElementorElement {
  const rootBounds = context.rootBounds;
  const children = (root.children ?? [])
    .map((node) => renderElement(node, rootBounds, root, context))
    .filter((element): element is ElementorElement => element !== null)
    .map((element) => ({
      ...element,
      settings: {
        ...element.settings,
        figmapress_section: "yes",
      },
    }));
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
  return `<div class="figmapress-figma-preview${className}" data-figmapress-layout="${context.variant}" style="--figma-unit:calc(100cqw / ${round(rootBounds.width)});aspect-ratio:${round(rootBounds.width)}/${round(rootBounds.height)};${background}${previewAutoLayout(root)}">${(root.children ?? []).map((node) => previewNode(node, rootBounds, root, context)).join("")}</div>`;
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
  if (navigation) return navigation;
  const contactForm = contactFormElement(node, bounds, parentBounds, parentNode, context);
  if (contactForm) return contactForm;

  const assetUrl = visualUrl(node, context.assets);
  if (assetUrl) return imageElement(node, bounds, parentBounds, parentNode, assetUrl, context);
  if (node.type === "TEXT" && typeof node.characters === "string") {
    return textElement(node, bounds, parentBounds, parentNode, context);
  }

  const accordion = accordionPlan(node);
  const children = (node.children ?? [])
    .filter((child) => !accordion || !isInsideInteractionBounds(child, accordion.bounds))
    .map((child) => renderElement(child, bounds, node, context))
    .filter((element): element is ElementorElement => element !== null);
  if (accordion) {
    children.push(accordionElement(node, accordion, bounds, node, context));
  }
  const hasVisibleStyle = Boolean(
    solidColor(node.fills)
    || figmaGradient(node)
    || solidColor(node.strokes),
  );
  if (!children.length && !hasVisibleStyle) return null;

  return {
    id: context.ids.create(node.id),
    elType: "container",
    isInner: true,
    settings: {
      ...baseContainerSettings(node, context),
      ...containerPosition(node, bounds, parentBounds, parentNode, context),
      figmapress_node_id: node.id,
      figmapress_node_name: node.name,
      html_tag: htmlTag(node),
      ...sectionAnchorSettings(node, context),
    },
    elements: children,
  };
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
  const explicitlyNamed = /(?:\{wp:nav\}|header.*(?:sec|section)|navigation)/i.test(node.name);
  if (!explicitlyNamed || menuTexts.length < 2) return null;

  const logoNode = descendants(node).find((child) => /(?:header\/logo|\blogo\b|ロゴ)/i.test(child.name));
  const logoUrl = logoNode ? visualUrl(logoNode, context.assets) ?? "" : "";
  const ctaText = descendants(node).find((child) =>
    child.type === "TEXT" && /(?:headercta\/text|ご相談|お問い合わせ|contact)/i.test(`${child.name} ${child.characters ?? ""}`),
  );
  const background = descendants(node).find((child) => /nav bar background/i.test(child.name));
  const topBar = descendants(node).find((child) => /top bar/i.test(child.name));

  return widget(context.ids, node.id, "figmapress-nav", {
    ...widgetPosition(node, bounds, parentBounds, parentNode),
    figmapress_node_id: node.id,
    figmapress_node_name: node.name,
    _element_id: anchorId("site-navigation", context),
    layout_variant: context.variant,
    logo: logoUrl ? { url: logoUrl, id: "", alt: "サイトロゴ", source: "library" } : undefined,
    items: menuTexts.map((item, index) => ({
      _id: hashId(`${item.id}:menu:${index}`),
      label: item.characters?.trim() ?? "",
      url: { url: menuAnchor(item.characters ?? "", context), is_external: "", nofollow: "" },
    })),
    cta_label: ctaText?.characters?.trim() || "お問い合わせ",
    cta_url: { url: anchorHref("contact", context), is_external: "", nofollow: "" },
    home_url: { url: anchorHref("top", context), is_external: "", nofollow: "" },
    background_color: solidColor(background?.fills) ?? "rgba(255,255,255,0.92)",
    accent_color: solidColor(topBar?.fills) ?? "#D10B2C",
    text_color: solidColor(menuTexts[0]?.fills) ?? "#202020",
  });
}

function contactFormElement(
  node: FigmaNode,
  bounds: FigmaBounds,
  parentBounds: FigmaBounds,
  parentNode: FigmaNode,
  context: RenderContext,
): ElementorElement | null {
  const texts = descendants(node)
    .filter((child) => child.type === "TEXT" && child.characters?.trim())
    .sort((left, right) => {
      const y = (left.absoluteBoundingBox?.y ?? 0) - (right.absoluteBoundingBox?.y ?? 0);
      return y || (left.absoluteBoundingBox?.x ?? 0) - (right.absoluteBoundingBox?.x ?? 0);
    });
  const copy = texts.map((child) => child.characters?.trim() ?? "");
  const looksLikeForm = copy.some((value) => /メールアドレス|e-?mail/i.test(value))
    && copy.some((value) => /ご相談|ご意見|message|お問い合わせ内容/i.test(value))
    && copy.some((value) => /お名前|氏名|name/i.test(value));
  const explicitlyNamed = /(?:\{wp:form\}|contact.?form|button.?cta|お問い合わせ)/i.test(node.name);
  if (!looksLikeForm || !explicitlyNamed) return null;

  const exact = (pattern: RegExp, fallback: string): string =>
    copy.find((value) => pattern.test(value)) ?? fallback;
  const title = copy.find((value) => /声を聞かせて|お問い合わせ|ご相談ください/.test(value)) ?? "お問い合わせ";
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

  return widget(context.ids, node.id, "figmapress-contact-form", {
    ...widgetPosition(node, bounds, parentBounds, parentNode),
    figmapress_node_id: node.id,
    figmapress_node_name: node.name,
    _element_id: anchorId("contact", context),
    title,
    name_label: exact(/^(?:お名前|氏名|name)$/i, "お名前"),
    email_label: exact(/メールアドレス|e-?mail/i, "メールアドレス"),
    region_label: exact(/お住まいの地域|地域|area/i, "お住まいの地域"),
    message_label: exact(/ご相談・ご意見の内容|お問い合わせ内容|message/i, "ご相談・ご意見の内容"),
    reply_label: exact(/返信希望/, "返信希望"),
    reply_yes_label: exact(/^希望する$/, "希望する"),
    reply_no_label: exact(/^希望しない$/, "希望しない"),
    button_text: buttonNode?.characters?.trim() || "送信する",
    accent_color: solidColor(buttonBackground?.fills) ?? "#B90A23",
    panel_color: solidColor(panel?.fills) ?? "#FFE2E8",
    text_color: "#202020",
    success_message: "送信しました。お問い合わせありがとうございます。",
  });
}

function accordionPlan(node: FigmaNode): AccordionPlan | null {
  if (!/(?:\{wp:accordion\}|profile|プロフィール|faq|よくある質問)/i.test(node.name)) return null;
  const all = descendants(node);
  const titles = all
    .filter((child) => child.type === "TEXT" && /^\s*\d{4}年度\s*$/.test(child.characters ?? ""))
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
    return { title: title.characters?.trim() ?? `項目 ${index + 1}`, content };
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
  });
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

function navigationMenuTexts(node: FigmaNode): FigmaNode[] {
  return descendants(node)
    .filter((child) => child.type === "TEXT" && /(?:menu.?item|nav.?item|メニュー)/i.test(child.name))
    .filter((child) => child.characters?.trim() && child.absoluteBoundingBox)
    .sort((left, right) => {
      const y = (left.absoluteBoundingBox?.y ?? 0) - (right.absoluteBoundingBox?.y ?? 0);
      return Math.abs(y) > 12
        ? y
        : (left.absoluteBoundingBox?.x ?? 0) - (right.absoluteBoundingBox?.x ?? 0);
    });
}

function menuAnchor(label: string, context: RenderContext): string {
  if (/想い|thought|message/i.test(label)) return anchorHref("thoughts", context);
  if (/政策|policy|policies/i.test(label)) return anchorHref("policies", context);
  if (/活動報告|activit|report/i.test(label)) return anchorHref("activities", context);
  if (/プロフィール|profile/i.test(label)) return anchorHref("profile", context);
  if (/相談|問合|contact/i.test(label)) return anchorHref("contact", context);
  return anchorHref(slug(label) || "section", context);
}

function anchorId(value: string, context: RenderContext): string {
  return `${value}${context.anchorSuffix}`;
}

function anchorHref(value: string, context: RenderContext): string {
  return `#${anchorId(value, context)}`;
}

function sectionAnchorSettings(node: FigmaNode, context: RenderContext): ElementorSettings {
  const name = node.name;
  if (/thought|message|想い|voice|現場の声/i.test(name)) return { _element_id: anchorId("thoughts", context) };
  if (/policy|policies|政策/i.test(name)) return { _element_id: anchorId("policies", context) };
  if (/activit|report|活動報告|news/i.test(name)) return { _element_id: anchorId("activities", context) };
  if (/profile|プロフィール/i.test(name)) return { _element_id: anchorId("profile", context) };
  if (/contact|相談|問合/i.test(name)) return { _element_id: anchorId("contact", context) };
  if (!/^(?:group|frame|section)\b/i.test(name)) return {};
  const copy = descendants(node)
    .filter((child) => child.type === "TEXT" && child.characters?.trim())
    .slice(0, 80)
    .map((child) => child.characters)
    .join(" ");
  if (/thought|message|想い|voice|現場の声/i.test(copy)) return { _element_id: anchorId("thoughts", context) };
  if (/policy|policies|政策/i.test(copy)) return { _element_id: anchorId("policies", context) };
  if (/activit|report|活動報告|news/i.test(copy)) return { _element_id: anchorId("activities", context) };
  if (/profile|プロフィール/i.test(copy)) return { _element_id: anchorId("profile", context) };
  if (/contact|相談|問合/i.test(copy)) return { _element_id: anchorId("contact", context) };
  return {};
}

function slug(value: string): string {
  return value.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function textElement(
  node: FigmaNode,
  bounds: FigmaBounds,
  parentBounds: FigmaBounds,
  parentNode: FigmaNode,
  context: RenderContext,
): ElementorElement {
  const style = node.style ?? {};
  const richRuns = textRuns(node);
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
  applyRotation(settings, node);

  const content = richRuns.map((run) => runHtml(run, context)).join("").replace(/\n/g, "<br>");
  const whiteSpace = textWhiteSpace(node);
  const verticalAlign = textVerticalAlign(style.textAlignVertical);
  settings.editor = `<div data-figmapress-text-box="${escapeAttribute(node.id)}" style="box-sizing:border-box;display:flex;flex-direction:column;font-family:${escapeAttribute(cssFont(style.fontFamily))};hyphens:none;justify-content:${verticalAlign};line-break:strict;margin:0;max-width:100%;${textBoxHeight(node, bounds, context)}overflow:${textOverflow(node)};overflow-wrap:normal;text-orientation:mixed;white-space:${whiteSpace};width:100%;word-break:${whiteSpace === "pre" ? "keep-all" : "normal"};writing-mode:horizontal-tb"><span style="display:block;max-width:100%">${content}</span></div>`;
  return widget(context.ids, node.id, "text-editor", settings);
}

function imageElement(
  node: FigmaNode,
  bounds: FigmaBounds,
  parentBounds: FigmaBounds,
  parentNode: FigmaNode,
  url: string,
  context: RenderContext,
): ElementorElement {
  const settings: ElementorSettings = {
    ...widgetPosition(node, bounds, parentBounds, parentNode),
    figmapress_node_id: node.id,
    figmapress_node_name: node.name,
    image: { url, id: "", alt: node.name, source: "library" },
    image_size: "full",
    space: size(100, "%"),
    height: canvasSize(bounds.height, context),
    "object-fit": "fill",
    image_border_radius: radiusDimensions(node, context),
  };
  if (typeof node.opacity === "number" && node.opacity < 1) {
    settings.opacity = size(node.opacity);
  }
  applyRotation(settings, node);
  return widget(context.ids, node.id, "image", settings);
}

function baseContainerSettings(node: FigmaNode, context: RenderContext): ElementorSettings {
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
  const backgroundUrl = ownImageUrl(node, context.assets.imageUrls ?? {});
  if (backgroundUrl) {
    settings.background_background = "classic";
    settings.background_image = { url: backgroundUrl, id: "", source: "library" };
    settings.background_position = "center center";
    settings.background_repeat = "no-repeat";
    settings.background_size = "cover";
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
  applyShadow(settings, node);
  applyRotation(settings, node);
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
    return {
      width: flowSize(node, bounds, parent, parentNode),
      min_height: canvasSize(bounds.height, context),
      flex_grow: node.layoutGrow && node.layoutGrow > 0 ? "1" : "0",
      flex_shrink: "0",
      ...(node.layoutAlign ? { flex_align_self: flexAlignment(node.layoutAlign) } : {}),
    };
  }
  return {
    position: "absolute",
    _offset_orientation_h: "start",
    _offset_x: size(percent(bounds.x - parent.x, parent.width), "%"),
    _offset_orientation_v: "start",
    _offset_y: size(percent(bounds.y - parent.y, parent.height), "%"),
    width: size(percent(bounds.width, parent.width), "%"),
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
  const assetUrl = visualUrl(node, context.assets);
  if (assetUrl) {
    return `<img alt="${escapeAttribute(node.name)}" ${attributes} data-figmapress-kind="visual" src="${escapeAttribute(assetUrl)}" style="${position};object-fit:fill;${previewRadius(node)}${previewTransform(node)}" />`;
  }

  const backgroundUrl = ownImageUrl(node, context.assets.imageUrls ?? {});
  const gradient = figmaGradient(node);
  const background = backgroundUrl
    ? `background-image:url(&quot;${escapeAttribute(backgroundUrl)}&quot;);background-position:center;background-repeat:no-repeat;background-size:cover;`
    : gradient
      ? `background-image:${escapeAttribute(gradientCss(gradient))};`
      : solidColor(node.fills) ? `background:${escapeAttribute(solidColor(node.fills) ?? "")};` : "";
  const border = solidColor(node.strokes)
    ? `border:${round(node.strokeWeight ?? 1)}px solid ${escapeAttribute(solidColor(node.strokes) ?? "")};`
    : "";
  const opacity = typeof node.opacity === "number" ? `opacity:${round(node.opacity)};` : "";
  const overflow = node.clipsContent ? "overflow:hidden;" : "overflow:visible;";

  if (node.type === "TEXT") {
    const style = node.style ?? {};
    const runs = textRuns(node);
    const fontSize = textFontSize(style, runs, bounds);
    const content = runs.length > 1
      ? runs.map((run) => runHtml(run, context)).join("").replace(/\n/g, "<br>")
      : escapeHtml(node.characters ?? "").replace(/\n/g, "<br>");
    return `<div ${attributes} data-figmapress-kind="text" style="${position};box-sizing:border-box;color:${escapeAttribute(solidColor(style.fills ?? node.fills) ?? "#111111")};display:flex;flex-direction:column;font-family:${escapeAttribute(cssFont(style.fontFamily))};font-size:calc(var(--figma-unit) * ${round(fontSize)});font-style:${style.italic ? "italic" : "normal"};font-weight:${round(style.fontWeight ?? 400)};hyphens:none;justify-content:${textVerticalAlign(style.textAlignVertical)};letter-spacing:calc(var(--figma-unit) * ${round(style.letterSpacing ?? 0)});line-break:strict;line-height:${round(textLineHeight(style, runs, fontSize) / fontSize)};max-width:100%;overflow:${textOverflow(node)};overflow-wrap:normal;text-align:${textAlign(style.textAlignHorizontal)};text-decoration:${textDecoration(style.textDecoration)};text-orientation:mixed;text-transform:${textTransform(style.textCase)};white-space:${textWhiteSpace(node)};word-break:${textWhiteSpace(node) === "pre" ? "keep-all" : "normal"};writing-mode:horizontal-tb;${previewTransform(node)}${opacity}"><span style="display:block;max-width:100%">${content}</span></div>`;
  }

  const children = (node.children ?? []).map((child) => previewNode(child, bounds, node, context)).join("");
  if (!children && !background && !border) return "";
  return `<div aria-label="${escapeAttribute(node.name)}" ${attributes} data-figmapress-kind="container" style="${position};${previewAutoLayout(node)}${background}${border}${previewRadius(node)}${overflow}${previewTransform(node)}${opacity}">${children}</div>`;
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
  const overrides = node.characterStyleOverrides;
  if (!overrides?.length || !node.styleOverrideTable) {
    return [{ text: value, style: node.style ?? {} }];
  }
  const runs: RichRun[] = [];
  let start = 0;
  let current = overrides[0] ?? 0;
  for (let index = 1; index <= value.length; index += 1) {
    const next = overrides[index] ?? current;
    if (index < value.length && next === current) continue;
    runs.push({
      text: value.slice(start, index),
      style: { ...(node.style ?? {}), ...(node.styleOverrideTable[String(current)] ?? {}) },
    });
    start = index;
    current = next;
  }
  return runs.length ? runs : [{ text: value, style: node.style ?? {} }];
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
  const rendered = assets.renderedNodeUrls?.[node.id];
  if (rendered) return rendered;
  return containsText(node) ? null : ownImageUrl(node, assets.imageUrls ?? {});
}

function containsText(node: FigmaNode): boolean {
  if (node.type === "TEXT" && node.characters?.trim()) return true;
  return (node.children ?? []).some(containsText);
}

function ownImageUrl(node: FigmaNode, imageUrls: Record<string, string>): string | null {
  const imageRef = node.fills?.find((fill) =>
    fill.visible !== false && fill.type === "IMAGE" && fill.imageRef,
  )?.imageRef;
  return imageRef ? imageUrls[imageRef] ?? null : null;
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

function applyRotation(settings: ElementorSettings, node: FigmaNode): void {
  if (!node.rotation || Math.abs(node.rotation) < 0.001) return;
  settings._transform_rotate_popover = "transform";
  settings._transform_rotateZ_effect = size(node.rotation, "deg");
}

function applyShadow(settings: ElementorSettings, node: FigmaNode): void {
  const shadow = node.effects?.find((effect) => effect.visible !== false && effect.type === "DROP_SHADOW");
  if (!shadow) return;
  settings.box_shadow_box_shadow_type = "yes";
  settings.box_shadow_box_shadow = {
    horizontal: shadow.offset?.x ?? 0,
    vertical: shadow.offset?.y ?? 0,
    blur: shadow.radius ?? 0,
    spread: shadow.spread ?? 0,
    color: shadow.color ? colorCss(shadow.color) : "rgba(0, 0, 0, 0.2)",
  };
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
  if (
    node.textAutoResize === "HEIGHT"
    || node.textAutoResize === "NONE"
    || node.textAutoResize === "TRUNCATE"
  ) {
    return "pre-wrap";
  }
  return "pre";
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

function previewTransform(node: FigmaNode): string {
  const rotation = node.rotation ? ` rotate(${round(node.rotation)}deg)` : "";
  return `--figmapress-qa-global-transform:translate(0px,0px);--figmapress-qa-runtime-global-transform:translate(0px,0px);--figmapress-qa-local-transform:translate(0px,0px);--figmapress-qa-runtime-local-transform:translate(0px,0px);transform:var(--figmapress-qa-global-transform) var(--figmapress-qa-runtime-global-transform) var(--figmapress-qa-local-transform) var(--figmapress-qa-runtime-local-transform)${rotation};transform-origin:center;`;
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
