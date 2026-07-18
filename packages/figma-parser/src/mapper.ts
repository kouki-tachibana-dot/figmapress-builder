import {
  SECTION_TO_WP_BLOCK,
  SUPPORTED_SECTION_TYPES,
  type ColorToken,
  type Page,
  type Section,
  type SectionType,
  type SiteBlueprint,
  type SpacingToken,
  type Tokens,
  type TypographyToken,
} from "@figmapress/blueprint";
import {
  findDirectChildrenByName,
  findFirstImageRef,
  findItemGroups,
  findTextByHints,
  findTextByName,
  findTextNodes,
  parseFigmaFile,
} from "./parser";
import type { FigmaNode, FigmaStylesShape, MockFigmaFile } from "./types";

export interface MapOptions {
  siteName?: string;
  language?: string;
  pageTitle?: string;
  pageSlug?: string;
  seoTitle?: string;
  seoDescription?: string;
}

export interface MapResult {
  blueprint: SiteBlueprint;
  warnings: string[];
}

const SECTION_TYPE_SET = new Set<string>(SUPPORTED_SECTION_TYPES);

/**
 * Convert a parsed Figma file into a Site Blueprint.
 * Unsupported sections become warnings and are skipped — the conversion
 * does NOT abort (per spec §15, §7).
 */
export function mapFigmaToBlueprint(
  file: MockFigmaFile,
  options: MapOptions = {},
): MapResult {
  const parsed = parseFigmaFile(file);
  const warnings: string[] = [];

  const sections: Section[] = [];
  for (const ps of parsed.sections) {
    if (!SECTION_TYPE_SET.has(ps.sectionName)) {
      warnings.push(`unsupported section detected: ${ps.sectionName}`);
      continue;
    }
    const sectionType = ps.sectionName as SectionType;
    const section = buildSection(sectionType, ps.node, ps.id);
    if (section) sections.push(section);
  }

  const page: Page = {
    title: options.pageTitle ?? parsed.pageTitle ?? "トップページ",
    slug: options.pageSlug ?? "/",
    template: "front-page",
    sections,
    seo: {
      title: options.seoTitle ?? options.pageTitle ?? parsed.pageTitle ?? "",
      description: options.seoDescription ?? "",
    },
  };

  const tokens = buildTokens(parsed.styles);

  const blueprint: SiteBlueprint = {
    site: {
      name: options.siteName ?? parsed.pageTitle ?? "Sample LP",
      type: "landing_page",
      language: options.language ?? "ja",
    },
    tokens,
    pages: [page],
    warnings,
  };

  return { blueprint, warnings };
}

function buildSection(
  type: SectionType,
  node: FigmaNode,
  id: string,
): Section | null {
  const wpBlock = SECTION_TO_WP_BLOCK[type];
  const base: Pick<Section, "id" | "type" | "wpBlock"> = {
    id: friendlyId(id, type),
    type,
    wpBlock,
  };

  switch (type) {
    case "section/hero": {
      return {
        ...base,
        content: {
          headline: findTextByName(node, "headline") || findTextByHints(node, ["headline", "heading", "title"], 0),
          subtext: findTextByName(node, "subtext") || findTextByHints(node, ["subtext", "description", "body"], 1),
          primaryButtonText: findTextByName(node, "primaryButton") || findTextByHints(node, ["button", "cta"], 2),
          primaryButtonUrl: findTextByName(node, "primaryButtonUrl") || "#contact",
          image: findFirstImageRef(node),
        },
        layout: { desktop: "text-left-image-right", mobile: "stacked" },
      };
    }

    case "section/service": {
      const exactItems = findDirectChildrenByName(node, "service/item");
      const groups = exactItems.length ? exactItems : findItemGroups(node, ["service", "item", "card"]);
      const items = groups.map((c) => ({
        title: findTextByName(c, "title") || findTextByHints(c, ["title", "heading"], 0),
        text: findTextByName(c, "text") || findTextByHints(c, ["text", "description", "body"], 1),
      }));
      return {
        ...base,
        content: {
          headline: findTextByName(node, "headline") || findTextByHints(node, ["headline", "heading", "title"], 0),
          items,
        },
      };
    }

    case "section/features": {
      const exactItems = findDirectChildrenByName(node, "feature/card");
      const groups = exactItems.length ? exactItems : findItemGroups(node, ["feature", "item", "card", "benefit"]);
      const items = groups.map((c) => ({
        title: findTextByName(c, "title") || findTextByHints(c, ["title", "heading"], 0),
        text: findTextByName(c, "text") || findTextByHints(c, ["text", "description", "body"], 1),
      }));
      return {
        ...base,
        content: {
          headline: findTextByName(node, "headline") || findTextByHints(node, ["headline", "heading", "title"], 0),
          items,
        },
      };
    }

    case "section/faq": {
      const exactItems = findDirectChildrenByName(node, "faq/item");
      const groups = exactItems.length ? exactItems : findItemGroups(node, ["faq", "question", "item"]);
      const items = groups.map((c) => ({
        question: findTextByName(c, "question") || findTextByHints(c, ["question", "title"], 0),
        answer: findTextByName(c, "answer") || findTextByHints(c, ["answer", "text"], 1),
      }));
      return {
        ...base,
        content: {
          headline: findTextByName(node, "headline") || findTextByHints(node, ["headline", "heading", "title"], 0),
          items,
        },
      };
    }

    case "section/cta":
      return {
        ...base,
        content: {
          headline: findTextByName(node, "headline") || findTextByHints(node, ["headline", "heading", "title"], 0),
          buttonText: findTextByName(node, "buttonText") || findTextByHints(node, ["button", "cta"], 1),
          buttonUrl: findTextByName(node, "buttonUrl"),
        },
      };

    case "section/contact":
      return {
        ...base,
        content: {
          headline: findTextByName(node, "headline") || findTextByHints(node, ["headline", "heading", "title"], 0),
          text: findTextByName(node, "text") || findTextByHints(node, ["text", "description", "body"], 1),
          buttonText: findTextByName(node, "buttonText") || findTextByHints(node, ["button", "cta"], 2),
          buttonUrl: findTextByName(node, "buttonUrl"),
        },
      };

    default:
      return null;
  }
}

function friendlyId(rawId: string, type: SectionType): string {
  const slug = type.replace("section/", "");
  const suffix = rawId.replace(/[^a-zA-Z0-9]+/g, "-");
  return `${slug}-${suffix}`;
}

function buildTokens(styles: FigmaStylesShape): Tokens {
  const colorSlugs = new Set<string>();
  const typographySlugs = new Set<string>();
  const spacingSlugs = new Set<string>();
  const colors: ColorToken[] = (styles.colors ?? []).map((c, index) => ({
    name: c.name,
    slug: uniqueSlug(c.name, `color-${index + 1}`, colorSlugs),
    value: c.value,
  }));
  const typography: TypographyToken[] = (styles.typography ?? []).map((t, index) => ({
    name: t.name,
    slug: uniqueSlug(t.name, `font-${index + 1}`, typographySlugs),
    fontFamily: t.fontFamily,
    fontSize: t.fontSize,
    fontWeight: t.fontWeight,
  }));
  const spacing: SpacingToken[] = (styles.spacing ?? []).map((s, index) => ({
    name: s.name,
    slug: uniqueSlug(s.name, `spacing-${index + 1}`, spacingSlugs),
    size: s.size,
  }));
  return { colors, typography, spacing };
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

function uniqueSlug(name: string, fallback: string, seen: Set<string>): string {
  const base = slugify(name) || fallback;
  let value = base;
  let suffix = 2;
  while (seen.has(value)) {
    value = `${base}-${suffix}`;
    suffix += 1;
  }
  seen.add(value);
  return value;
}
