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
  findTextByName,
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
    case "section/hero":
      return {
        ...base,
        content: {
          headline: findTextByName(node, "headline"),
          subtext: findTextByName(node, "subtext"),
          primaryButtonText: findTextByName(node, "primaryButton"),
          primaryButtonUrl: findTextByName(node, "primaryButtonUrl"),
          image: findFirstImageRef(node),
        },
        layout: { desktop: "text-left-image-right", mobile: "stacked" },
      };

    case "section/service": {
      const items = findDirectChildrenByName(node, "service/item").map((c) => ({
        title: findTextByName(c, "title"),
        text: findTextByName(c, "text"),
      }));
      return {
        ...base,
        content: {
          headline: findTextByName(node, "headline"),
          items,
        },
      };
    }

    case "section/features": {
      const items = findDirectChildrenByName(node, "feature/card").map((c) => ({
        title: findTextByName(c, "title"),
        text: findTextByName(c, "text"),
      }));
      return {
        ...base,
        content: {
          headline: findTextByName(node, "headline"),
          items,
        },
      };
    }

    case "section/faq": {
      const items = findDirectChildrenByName(node, "faq/item").map((c) => ({
        question: findTextByName(c, "question"),
        answer: findTextByName(c, "answer"),
      }));
      return {
        ...base,
        content: {
          headline: findTextByName(node, "headline"),
          items,
        },
      };
    }

    case "section/cta":
      return {
        ...base,
        content: {
          headline: findTextByName(node, "headline"),
          buttonText: findTextByName(node, "buttonText"),
          buttonUrl: findTextByName(node, "buttonUrl"),
        },
      };

    case "section/contact":
      return {
        ...base,
        content: {
          headline: findTextByName(node, "headline"),
          text: findTextByName(node, "text"),
          buttonText: findTextByName(node, "buttonText"),
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
  const colors: ColorToken[] = (styles.colors ?? []).map((c) => ({
    name: c.name,
    slug: slugify(c.name),
    value: c.value,
  }));
  const typography: TypographyToken[] = (styles.typography ?? []).map((t) => ({
    name: t.name,
    slug: slugify(t.name),
    fontFamily: t.fontFamily,
    fontSize: t.fontSize,
    fontWeight: t.fontWeight,
  }));
  const spacing: SpacingToken[] = (styles.spacing ?? []).map((s) => ({
    name: s.name,
    slug: slugify(s.name),
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
