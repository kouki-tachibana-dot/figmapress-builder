import {
  GutenbergExporter,
  renderPreviewPage,
} from "@figmapress/block-renderer";
import {
  assertBlueprint,
  type HeroContent,
  type SiteBlueprint,
} from "@figmapress/blueprint";
import {
  mapFigmaToBlueprint,
  type MapOptions,
  type MockFigmaFile,
} from "@figmapress/figma-parser";
import {
  ElementorExporter,
  type ElementorTemplate,
} from "@figmapress/elementor-renderer";
import { tokensToThemeJson } from "@figmapress/token-pipeline";

export interface ConversionOutput {
  blueprint: SiteBlueprint;
  pageContent: string;
  elementorTemplate: ElementorTemplate;
  previewHtml: string;
  themeJson: ReturnType<typeof tokensToThemeJson>;
  warnings: string[];
  summary: {
    pageTitle: string;
    sectionCount: number;
    sectionTypes: string[];
  };
}

export async function convertFile(
  file: MockFigmaFile,
  options: MapOptions = {},
  imageUrls: Record<string, string> = {},
  initialWarnings: string[] = [],
): Promise<ConversionOutput> {
  const mapped = mapFigmaToBlueprint(file, options);
  resolveImageUrls(mapped.blueprint, imageUrls);
  const blueprint = assertBlueprint(mapped.blueprint);
  const exported = await new GutenbergExporter().export(blueprint);
  const elementorTemplate = new ElementorExporter().toTemplate(blueprint);
  const page = blueprint.pages[0];
  const warnings = [...new Set([...initialWarnings, ...mapped.warnings, ...exported.warnings])];

  return {
    blueprint,
    pageContent: exported.pageContent ?? "",
    elementorTemplate,
    previewHtml: page ? renderPreviewPage(page) : "",
    themeJson: tokensToThemeJson(blueprint.tokens),
    warnings,
    summary: {
      pageTitle: page?.title ?? "無題",
      sectionCount: page?.sections.length ?? 0,
      sectionTypes: page?.sections.map((section) => section.type) ?? [],
    },
  };
}

function resolveImageUrls(
  blueprint: SiteBlueprint,
  imageUrls: Record<string, string>,
): void {
  for (const page of blueprint.pages) {
    for (const section of page.sections) {
      if (section.type !== "section/hero") continue;
      const content = section.content as HeroContent;
      const src = content.image?.src;
      if (!src?.startsWith("figma://image/")) continue;
      const imageRef = src.slice("figma://image/".length);
      const resolved = imageUrls[imageRef];
      if (resolved && content.image) content.image.src = resolved;
      else if (content.image) content.image.src = null;
    }
  }
}
