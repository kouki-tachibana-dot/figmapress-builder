import type { FigmaNode, MockFigmaFile } from "@figmapress/figma-parser";
import {
  FigmaElementorExporter,
  discoverSectionAnchorTargets,
  findFigmaResponsiveRoots,
  type FigmaRenderAssets,
  type SectionAnchor,
} from "./figma-exporter";
import type { ElementorTemplate } from "./types";

export type FigmaSitePageKey = string;

export interface FigmaSitePagePlan {
  key: FigmaSitePageKey;
  title: string;
  slug: string;
  hasDesktop: boolean;
  hasMobile: boolean;
  frameId?: string;
}

export interface FigmaMultiPagePlan {
  title: string;
  menuName: string;
  pages: FigmaSitePagePlan[];
}

export interface FigmaSitePageLink {
  key: FigmaSitePageKey;
  rawLink: string;
}

export interface ElementorLinkAudit {
  total: number;
  pageLinks: number;
  anchors: number;
  external: number;
  email: number;
  telephone: number;
  unresolvedPlaceholders: string[];
  missingAnchors: string[];
  unsafe: string[];
  valid: boolean;
}

const FIGMAPRESS_PAGE_LINK_PREFIX = "#figmapress-page-";

export function figmaPageLinkPlaceholder(key: FigmaSitePageKey): string {
  return `${FIGMAPRESS_PAGE_LINK_PREFIX}${encodeURIComponent(key)}`;
}

const pageDefinitions: Array<{
  key: SectionAnchor;
  title: string;
  slug: string;
}> = [
  { key: "company", title: "会社案内", slug: "company" },
  { key: "reasons", title: "選ばれる理由", slug: "reasons" },
  { key: "services", title: "事業内容", slug: "services" },
  { key: "works", title: "施工事例", slug: "works" },
  { key: "demolition", title: "解体工事", slug: "demolition" },
  { key: "news", title: "お知らせ", slug: "news" },
  { key: "officers", title: "役員一覧", slug: "officers" },
  { key: "thoughts", title: "想い", slug: "omoi" },
  { key: "policies", title: "政策", slug: "seisaku" },
  { key: "activities", title: "活動報告", slug: "katsudo" },
  { key: "profile", title: "プロフィール", slug: "profile" },
  { key: "contact", title: "ご相談・お問い合わせ", slug: "contact" },
];

function rootHasAnchor(root: FigmaNode | null, key: SectionAnchor): boolean {
  if (!root) return false;
  return [...discoverSectionAnchorTargets(root).values()].includes(key);
}

export function createFigmaMultiPagePlan(
  file: MockFigmaFile,
  title: string,
  homeSlug = "home",
): FigmaMultiPagePlan {
  const safeHomeSlug = homeSlug.replace(/^\/+|\/+$/g, "") || "home";
  const roots = findFigmaResponsiveRoots(file);
  const pages: FigmaSitePagePlan[] = [{
    key: "home",
    title,
    slug: safeHomeSlug,
    hasDesktop: Boolean(roots.desktop),
    hasMobile: Boolean(roots.mobile),
  }];
  for (const definition of pageDefinitions) {
    const hasDesktop = rootHasAnchor(roots.desktop, definition.key);
    const hasMobile = rootHasAnchor(roots.mobile, definition.key);
    if (!hasDesktop && !hasMobile) continue;
    pages.push({ ...definition, hasDesktop, hasMobile });
  }
  return {
    title,
    menuName: `${title}｜FigmaPress`,
    pages,
  };
}

function containsNode(node: FigmaNode, id: string): boolean {
  if (node.id === id) return true;
  return (node.children ?? []).some((child) => containsNode(child, id));
}

function topLevelAnchorNode(root: FigmaNode, key: SectionAnchor): FigmaNode | null {
  const target = [...discoverSectionAnchorTargets(root).entries()]
    .find(([, anchor]) => anchor === key)?.[0];
  if (!target) return null;
  return (root.children ?? []).find((child) => containsNode(child, target)) ?? null;
}

function isHeader(node: FigmaNode): boolean {
  return /(?:\{wp:nav\}|header.*(?:sec|section)|navigation|^nav(?:\b|\/))/i.test(node.name);
}

function isFooter(node: FigmaNode): boolean {
  return /(?:^|[\/_\s-])footer(?:$|[\/_\s-])/i.test(node.name);
}

function shiftedNode(node: FigmaNode, deltaY: number): FigmaNode {
  return {
    ...node,
    absoluteBoundingBox: node.absoluteBoundingBox
      ? { ...node.absoluteBoundingBox, y: node.absoluteBoundingBox.y + deltaY }
      : undefined,
    absoluteRenderBounds: node.absoluteRenderBounds
      ? { ...node.absoluteRenderBounds, y: node.absoluteRenderBounds.y + deltaY }
      : node.absoluteRenderBounds,
    children: node.children?.map((child) => shiftedNode(child, deltaY)),
  };
}

function slicedRoot(root: FigmaNode, key: SectionAnchor): FigmaNode | null {
  const target = topLevelAnchorNode(root, key);
  const rootBounds = root.absoluteBoundingBox;
  if (!target?.absoluteBoundingBox || !rootBounds) return null;

  const header = (root.children ?? []).filter((node) => isHeader(node) && node.absoluteBoundingBox);
  const footer = (root.children ?? []).filter((node) => isFooter(node) && node.absoluteBoundingBox);
  const ordered = [...header, target, ...footer]
    .filter((node, index, all) => all.findIndex((candidate) => candidate.id === node.id) === index);
  let cursorY = rootBounds.y;
  const children = ordered.map((node) => {
    const bounds = node.absoluteBoundingBox as NonNullable<FigmaNode["absoluteBoundingBox"]>;
    const shifted = shiftedNode(node, cursorY - bounds.y);
    cursorY += bounds.height;
    return shifted;
  });
  const height = Math.max(1, cursorY - rootBounds.y);
  return {
    ...root,
    id: `${root.id}:page:${key}`,
    name: `${root.name} / ${key}`,
    layoutMode: "NONE",
    minHeight: height,
    maxHeight: height,
    absoluteBoundingBox: { ...rootBounds, height },
    absoluteRenderBounds: root.absoluteRenderBounds
      ? { ...root.absoluteRenderBounds, height }
      : root.absoluteRenderBounds,
    children,
  };
}

export function createFigmaSectionFile(
  file: MockFigmaFile,
  key: SectionAnchor,
): MockFigmaFile {
  const roots = findFigmaResponsiveRoots(file);
  const children = [roots.desktop, roots.mobile]
    .filter((root): root is FigmaNode => Boolean(root))
    .map((root) => slicedRoot(root, key))
    .filter((root): root is FigmaNode => Boolean(root));
  if (!children.length) {
    throw new Error(`Figma内に「${key}」ページの対象セクションが見つかりません。`);
  }
  return {
    ...file,
    document: {
      ...file.document,
      children: [{
        id: `${file.document.id}:multipage:${key}`,
        name: `FigmaPress ${key}`,
        type: "CANVAS",
        children,
      }],
    },
  };
}

export function createFigmaSitePageTemplate(
  file: MockFigmaFile,
  page: FigmaSitePagePlan,
  assets: FigmaRenderAssets = {},
): ElementorTemplate {
  if (page.key === "home") {
    return new FigmaElementorExporter().toTemplate(file, page.title, assets);
  }
  return new FigmaElementorExporter().toTemplate(
    createFigmaSectionFile(file, page.key as SectionAnchor),
    page.title,
    assets,
  );
}

function keyFromAnchor(
  value: string,
  links: Map<FigmaSitePageKey, string>,
): FigmaSitePageKey | null {
  if (value.startsWith(FIGMAPRESS_PAGE_LINK_PREFIX)) {
    try {
      const key = decodeURIComponent(value.slice(FIGMAPRESS_PAGE_LINK_PREFIX.length));
      return links.has(key) ? key : null;
    } catch {
      return null;
    }
  }
  const normalized = value
    .replace(/^#/, "")
    .replace(/-(?:desktop|mobile)$/, "")
    .toLowerCase();
  if (normalized === "top" || normalized === "site-navigation") return "home";
  if (links.has(normalized)) return normalized;
  return pageDefinitions.some((definition) => definition.key === normalized)
    ? normalized as SectionAnchor
    : null;
}

function rewriteEmbeddedHrefs(
  value: string,
  links: Map<FigmaSitePageKey, string>,
): string {
  return value.replace(/href=(['"])(#[A-Za-z][\w:-]*)\1/g, (match, quote: string, href: string) => {
    const key = keyFromAnchor(href, links);
    return key && links.has(key) ? `href=${quote}${links.get(key)}${quote}` : match;
  });
}

function rewriteUrl(value: string, links: Map<FigmaSitePageKey, string>): string {
  const directKey = keyFromAnchor(value, links);
  if (directKey && links.has(directKey)) return links.get(directKey) as string;
  return rewriteEmbeddedHrefs(value, links);
}

function rewriteValue(
  value: unknown,
  links: Map<FigmaSitePageKey, string>,
  propertyName?: string,
): unknown {
  if (typeof value === "string") {
    // Elementor stores navigable destinations in `url` properties. Rewriting
    // every matching string also changed unrelated values such as a dynamic
    // form field named "company" into the company page URL. HTML fields are
    // still handled everywhere, but a whole-string page rewrite is restricted
    // to actual URL properties.
    return propertyName === "url"
      ? rewriteUrl(value, links)
      : rewriteEmbeddedHrefs(value, links);
  }
  if (Array.isArray(value)) return value.map((item) => rewriteValue(item, links));
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [key, rewriteValue(item, links, key)]),
  );
}

export function rewriteElementorTemplatePageLinks(
  template: ElementorTemplate,
  pageLinks: FigmaSitePageLink[],
): ElementorTemplate {
  const links = new Map(pageLinks.map((link) => [link.key, link.rawLink]));
  return rewriteValue(template, links) as ElementorTemplate;
}

/** Product gate used immediately before every WordPress page save. */
export function auditElementorTemplateLinks(
  template: ElementorTemplate,
  pageLinks: FigmaSitePageLink[] = [],
): ElementorLinkAudit {
  const urls: string[] = [];
  const anchors = new Set<string>();
  const recordUrlObject = (value: unknown): void => {
    if (!value || typeof value !== "object") return;
    const url = (value as Record<string, unknown>).url;
    if (typeof url === "string" && url.trim()) urls.push(url.trim());
  };
  const visit = (elements: ElementorTemplate["content"]): void => {
    for (const element of elements) {
      const anchor = element.settings._element_id;
      if (typeof anchor === "string" && anchor) anchors.add(anchor);
      if (element.widgetType === "figmapress-nav") {
        const items = Array.isArray(element.settings.items) ? element.settings.items : [];
        for (const item of items) {
          if (item && typeof item === "object") {
            recordUrlObject((item as Record<string, unknown>).url);
          }
        }
        recordUrlObject(element.settings.cta_url);
        recordUrlObject(element.settings.home_url);
      }
      if (element.widgetType === "figmapress-link") {
        recordUrlObject(element.settings.link_url);
      }
      if (element.elType === "container" && element.settings.html_tag === "a") {
        recordUrlObject(element.settings.link);
      }
      if (element.widgetType === "image" || element.widgetType === "button") {
        recordUrlObject(element.settings.link);
      }
      if (element.widgetType === "figmapress-carousel") {
        const items = Array.isArray(element.settings.items) ? element.settings.items : [];
        for (const item of items) {
          if (item && typeof item === "object") {
            recordUrlObject((item as Record<string, unknown>).url);
          }
        }
      }
      if (element.widgetType === "text-editor" && typeof element.settings.editor === "string") {
        for (const match of element.settings.editor.matchAll(/href=["']([^"']+)["']/g)) {
          if (match[1]?.trim()) urls.push(match[1].trim());
        }
      }
      visit(element.elements);
    }
  };
  visit(template.content);

  const pageUrls = new Set(pageLinks.map((link) => link.rawLink));
  const unresolvedPlaceholders = [...new Set(urls.filter((url) =>
    url.startsWith(FIGMAPRESS_PAGE_LINK_PREFIX)
  ))];
  const missingAnchors = [...new Set(urls
    .filter((url) =>
      /^#[A-Za-z][\w:-]*$/.test(url)
      && !url.startsWith(FIGMAPRESS_PAGE_LINK_PREFIX)
    )
    .map((url) => url.slice(1))
    .filter((anchor) => !anchors.has(anchor)))];
  const safeUrl = /^(?:https?:\/\/|mailto:|tel:|\/|#)/i;
  const unsafe = [...new Set(urls.filter((url) => !safeUrl.test(url)))];
  const audit: ElementorLinkAudit = {
    total: urls.length,
    pageLinks: urls.filter((url) => pageUrls.has(url)).length,
    anchors: urls.filter((url) => url.startsWith("#")).length,
    external: urls.filter((url) => /^https?:\/\//i.test(url) && !pageUrls.has(url)).length,
    email: urls.filter((url) => /^mailto:/i.test(url)).length,
    telephone: urls.filter((url) => /^tel:/i.test(url)).length,
    unresolvedPlaceholders,
    missingAnchors,
    unsafe,
    valid: false,
  };
  audit.valid = unresolvedPlaceholders.length === 0
    && missingAnchors.length === 0
    && unsafe.length === 0;
  return audit;
}
