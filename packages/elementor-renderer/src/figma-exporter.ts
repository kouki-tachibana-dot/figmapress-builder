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
  tabletScale: number;
  mobileScale: number;
  assets: FigmaRenderAssets;
}

interface RichRun {
  text: string;
  style: FigmaTypeStyle;
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

export function findFigmaDesignRoot(file: MockFigmaFile): FigmaNode | null {
  const canvases = (file.document.children ?? []).filter((node) => node.type === "CANVAS");
  for (const canvas of canvases) {
    const candidates = (canvas.children ?? []).filter((node) =>
      node.visible !== false && validBounds(node.absoluteBoundingBox),
    );
    if (candidates.length === 1) return candidates[0] ?? null;
  }

  const candidates = canvases.flatMap((canvas) =>
    (canvas.children ?? []).filter((node) => node.visible !== false && validBounds(node.absoluteBoundingBox)),
  );
  return candidates.sort((left, right) => area(right) - area(left))[0] ?? null;
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
    const root = findFigmaDesignRoot(file);
    if (!root?.absoluteBoundingBox) {
      throw new Error("Figmaの選択ノードにレイアウト座標がありません。");
    }

    const rootBounds = root.absoluteBoundingBox;
    const context: RenderContext = {
      ids: new ElementIdFactory(),
      root,
      rootBounds,
      tabletScale: Math.min(1, 1024 / rootBounds.width),
      mobileScale: Math.min(1, 390 / rootBounds.width),
      assets,
    };
    const children = (root.children ?? [])
      .map((node) => renderElement(node, rootBounds, context))
      .filter((element): element is ElementorElement => element !== null);

    return {
      title,
      type: "page",
      version: "0.4",
      page_settings: {
        background_background: "classic",
        background_color: solidColor(root.fills) ?? "#FFFFFF",
        hide_title: "yes",
      },
      content: [{
        id: context.ids.create(`${root.id}:root`),
        elType: "container",
        isInner: false,
        settings: {
          ...baseContainerSettings(root, context),
          content_width: "full",
          width: size(100, "%"),
          min_height: size(rootBounds.height),
          min_height_tablet: size(rootBounds.height * context.tabletScale),
          min_height_mobile: size(rootBounds.height * context.mobileScale),
          html_tag: "main",
          overflow: root.clipsContent === false ? "" : "hidden",
        },
        elements: children,
      }],
    };
  }
}

export function renderFigmaPreview(
  file: MockFigmaFile,
  assets: FigmaRenderAssets = {},
): string | null {
  const root = findFigmaDesignRoot(file);
  const rootBounds = root?.absoluteBoundingBox;
  if (!root || !rootBounds) return null;
  const context: RenderContext = {
    ids: new ElementIdFactory(),
    root,
    rootBounds,
    tabletScale: Math.min(1, 1024 / rootBounds.width),
    mobileScale: Math.min(1, 390 / rootBounds.width),
    assets,
  };
  const background = solidColor(root.fills) ?? "#FFFFFF";
  return `<div class="figmapress-figma-preview" style="--figma-unit:calc(100cqw / ${round(rootBounds.width)});aspect-ratio:${round(rootBounds.width)}/${round(rootBounds.height)};background:${escapeAttribute(background)}">${(root.children ?? []).map((node) => previewNode(node, rootBounds, context)).join("")}</div>`;
}

function renderElement(
  node: FigmaNode,
  parentBounds: FigmaBounds,
  context: RenderContext,
): ElementorElement | null {
  const bounds = node.absoluteBoundingBox;
  if (node.visible === false || !bounds || bounds.width <= 0 || bounds.height <= 0) return null;

  const assetUrl = visualUrl(node, context.assets);
  if (assetUrl) return imageElement(node, bounds, parentBounds, assetUrl, context);
  if (node.type === "TEXT" && typeof node.characters === "string") {
    return textElement(node, bounds, parentBounds, context);
  }

  const children = (node.children ?? [])
    .map((child) => renderElement(child, bounds, context))
    .filter((element): element is ElementorElement => element !== null);
  const hasVisibleStyle = Boolean(solidColor(node.fills) || solidColor(node.strokes));
  if (!children.length && !hasVisibleStyle) return null;

  return {
    id: context.ids.create(node.id),
    elType: "container",
    isInner: true,
    settings: {
      ...baseContainerSettings(node, context),
      ...containerPosition(bounds, parentBounds, context),
      html_tag: htmlTag(node),
    },
    elements: children,
  };
}

function textElement(
  node: FigmaNode,
  bounds: FigmaBounds,
  parentBounds: FigmaBounds,
  context: RenderContext,
): ElementorElement {
  const style = node.style ?? {};
  const fontSize = style.fontSize ?? Math.max(12, bounds.height * 0.72);
  const settings: ElementorSettings = {
    ...widgetPosition(bounds, parentBounds),
    text_color: solidColor(style.fills ?? node.fills) ?? "#111111",
    typography_typography: "custom",
    typography_font_family: style.fontFamily ?? "Arial",
    typography_font_size: size(fontSize),
    typography_font_size_tablet: size(Math.max(8, fontSize * context.tabletScale)),
    typography_font_size_mobile: size(Math.max(6, fontSize * context.mobileScale)),
    typography_font_weight: String(style.fontWeight ?? 400),
    typography_line_height: size(style.lineHeightPx ?? fontSize * 1.25),
    typography_line_height_tablet: size((style.lineHeightPx ?? fontSize * 1.25) * context.tabletScale),
    typography_line_height_mobile: size((style.lineHeightPx ?? fontSize * 1.25) * context.mobileScale),
    typography_letter_spacing: size(style.letterSpacing ?? 0),
    align: textAlign(style.textAlignHorizontal),
  };
  applyTypographyFlags(settings, style);

  const richRuns = textRuns(node);
  if (richRuns.length > 1) {
    settings.editor = `<div>${richRuns.map(runHtml).join("").replace(/\n/g, "<br>")}</div>`;
    return widget(context.ids, node.id, "text-editor", settings);
  }

  settings.title = node.characters ?? "";
  settings.header_size = headingTag(node, fontSize);
  settings.title_color = settings.text_color;
  delete settings.text_color;
  return widget(context.ids, node.id, "heading", settings);
}

function imageElement(
  node: FigmaNode,
  bounds: FigmaBounds,
  parentBounds: FigmaBounds,
  url: string,
  context: RenderContext,
): ElementorElement {
  const settings: ElementorSettings = {
    ...widgetPosition(bounds, parentBounds),
    image: { url, id: "", alt: node.name, source: "library" },
    image_size: "full",
    space: size(100, "%"),
    height: size(bounds.height),
    height_tablet: size(bounds.height * context.tabletScale),
    height_mobile: size(bounds.height * context.mobileScale),
    "object-fit": "fill",
    image_border_radius: radiusDimensions(node),
  };
  if (typeof node.opacity === "number" && node.opacity < 1) {
    settings.opacity = size(node.opacity);
  }
  return widget(context.ids, node.id, "image", settings);
}

function baseContainerSettings(node: FigmaNode, context: RenderContext): ElementorSettings {
  const bounds = node.absoluteBoundingBox;
  const settings: ElementorSettings = {
    content_width: "full",
    flex_direction: "column",
    flex_gap: gap(0),
    padding: dimensions(0, 0, 0, 0),
    overflow: node.clipsContent ? "hidden" : "",
  };
  const background = solidColor(node.fills);
  if (background) {
    settings.background_background = "classic";
    settings.background_color = background;
  }
  const backgroundUrl = ownImageUrl(node, context.assets.imageUrls ?? {});
  if (backgroundUrl) {
    settings.background_background = "classic";
    settings.background_image = { url: backgroundUrl, id: "", source: "library" };
    settings.background_position = "center center";
    settings.background_repeat = "no-repeat";
    settings.background_size = "cover";
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
    );
  }
  settings.border_radius = radiusDimensions(node);
  applyShadow(settings, node);
  if (bounds && node === context.root) settings.min_height = size(bounds.height);
  return settings;
}

function containerPosition(
  bounds: FigmaBounds,
  parent: FigmaBounds,
  context: RenderContext,
): ElementorSettings {
  return {
    position: "absolute",
    _offset_orientation_h: "start",
    _offset_x: size(percent(bounds.x - parent.x, parent.width), "%"),
    _offset_orientation_v: "start",
    _offset_y: size(percent(bounds.y - parent.y, parent.height), "%"),
    width: size(percent(bounds.width, parent.width), "%"),
    min_height: size(bounds.height),
    min_height_tablet: size(bounds.height * context.tabletScale),
    min_height_mobile: size(bounds.height * context.mobileScale),
  };
}

function widgetPosition(bounds: FigmaBounds, parent: FigmaBounds): ElementorSettings {
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
  context: RenderContext,
): string {
  const bounds = node.absoluteBoundingBox;
  if (node.visible === false || !bounds || bounds.width <= 0 || bounds.height <= 0) return "";
  const position = previewPosition(bounds, parentBounds);
  const assetUrl = visualUrl(node, context.assets);
  if (assetUrl) {
    return `<img alt="${escapeAttribute(node.name)}" src="${escapeAttribute(assetUrl)}" style="${position};object-fit:fill;${previewRadius(node)}" />`;
  }

  const backgroundUrl = ownImageUrl(node, context.assets.imageUrls ?? {});
  const background = backgroundUrl
    ? `background-image:url(&quot;${escapeAttribute(backgroundUrl)}&quot;);background-position:center;background-repeat:no-repeat;background-size:cover;`
    : solidColor(node.fills) ? `background:${escapeAttribute(solidColor(node.fills) ?? "")};` : "";
  const border = solidColor(node.strokes)
    ? `border:${round(node.strokeWeight ?? 1)}px solid ${escapeAttribute(solidColor(node.strokes) ?? "")};`
    : "";
  const opacity = typeof node.opacity === "number" ? `opacity:${round(node.opacity)};` : "";
  const overflow = node.clipsContent ? "overflow:hidden;" : "overflow:visible;";

  if (node.type === "TEXT") {
    const style = node.style ?? {};
    const fontSize = style.fontSize ?? Math.max(12, bounds.height * 0.72);
    const runs = textRuns(node);
    const content = runs.length > 1
      ? runs.map(runHtml).join("").replace(/\n/g, "<br>")
      : escapeHtml(node.characters ?? "").replace(/\n/g, "<br>");
    return `<div style="${position};color:${escapeAttribute(solidColor(style.fills ?? node.fills) ?? "#111111")};font-family:${escapeAttribute(cssFont(style.fontFamily))};font-size:calc(var(--figma-unit) * ${round(fontSize)});font-style:${style.italic ? "italic" : "normal"};font-weight:${round(style.fontWeight ?? 400)};letter-spacing:calc(var(--figma-unit) * ${round(style.letterSpacing ?? 0)});line-height:${round((style.lineHeightPx ?? fontSize * 1.25) / fontSize)};text-align:${textAlign(style.textAlignHorizontal)};text-decoration:${textDecoration(style.textDecoration)};text-transform:${textTransform(style.textCase)};white-space:pre-wrap;${opacity}">${content}</div>`;
  }

  const children = (node.children ?? []).map((child) => previewNode(child, bounds, context)).join("");
  if (!children && !background && !border) return "";
  return `<div aria-label="${escapeAttribute(node.name)}" style="${position};${background}${border}${previewRadius(node)}${overflow}${opacity}">${children}</div>`;
}

function previewPosition(bounds: FigmaBounds, parent: FigmaBounds): string {
  return `position:absolute;left:${round(percent(bounds.x - parent.x, parent.width))}%;top:${round(percent(bounds.y - parent.y, parent.height))}%;width:${round(percent(bounds.width, parent.width))}%;height:${round(percent(bounds.height, parent.height))}%;`;
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

function runHtml(run: RichRun): string {
  const color = solidColor(run.style.fills);
  const styles = [
    color ? `color:${color}` : "",
    run.style.fontWeight ? `font-weight:${run.style.fontWeight}` : "",
    run.style.italic ? "font-style:italic" : "",
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

function radiusDimensions(node: FigmaNode): Record<string, unknown> {
  const corners = node.rectangleCornerRadii;
  if (corners) return dimensions(corners[0], corners[1], corners[2], corners[3]);
  const radius = node.type === "ELLIPSE"
    ? Math.max(node.absoluteBoundingBox?.width ?? 0, node.absoluteBoundingBox?.height ?? 0)
    : node.cornerRadius ?? 0;
  return dimensions(radius, radius, radius, radius);
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
  if (!value) return "Arial, sans-serif";
  return `'${value.replace(/['\\]/g, "")}', Arial, sans-serif`;
}

function size(value: number, unit = "px"): Record<string, unknown> {
  return { unit, size: round(value), sizes: [] };
}

function gap(value: number): Record<string, unknown> {
  return { column: String(value), row: String(value), isLinked: true, unit: "px", size: value };
}

function dimensions(top: number, right: number, bottom: number, left: number): Record<string, unknown> {
  return {
    unit: "px",
    top: String(round(top)),
    right: String(round(right)),
    bottom: String(round(bottom)),
    left: String(round(left)),
    isLinked: top === right && right === bottom && bottom === left,
  };
}

function percent(value: number, total: number): number {
  return total > 0 ? (value / total) * 100 : 0;
}

function validBounds(bounds: FigmaBounds | undefined): bounds is FigmaBounds {
  return Boolean(bounds && bounds.width > 0 && bounds.height > 0);
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
