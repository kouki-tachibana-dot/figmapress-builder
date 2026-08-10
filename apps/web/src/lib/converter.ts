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
  FigmaElementorExporter,
  createFigmaQualityReport,
  createFigmaMultiPagePlan,
  figmaLayoutSectionNames,
  hasFigmaLayout,
  hasFigmaResponsiveLayout,
  renderFigmaPreview,
  type ElementorTemplate,
  type FigmaQualityReport,
  type FigmaMultiPagePlan,
} from "@figmapress/elementor-renderer";
import { tokensToThemeJson } from "@figmapress/token-pipeline";

export interface ConversionOutput {
  blueprint: SiteBlueprint;
  pageContent: string;
  elementorTemplate: ElementorTemplate;
  previewHtml: string;
  qualityReport: FigmaQualityReport | null;
  multiPagePlan: FigmaMultiPagePlan | null;
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
  renderedNodeUrls: Record<string, string> = {},
): Promise<ConversionOutput> {
  const fidelityLayout = hasFigmaLayout(file);
  const responsiveFidelityLayout = fidelityLayout && hasFigmaResponsiveLayout(file);
  let mapped;
  try {
    mapped = mapFigmaToBlueprint(file, options);
  } catch (error) {
    if (!fidelityLayout) throw error;
    const title = options.pageTitle ?? options.siteName ?? file.document.name ?? "FigmaPress Page";
    mapped = {
      blueprint: {
        site: { name: options.siteName ?? title, type: "landing_page" as const, language: options.language ?? "ja" },
        tokens: { colors: [], typography: [], spacing: [] },
        pages: [{
          title,
          slug: options.pageSlug ?? "/",
          template: "front-page",
          sections: [],
          seo: { title: options.seoTitle ?? title, description: options.seoDescription ?? "" },
        }],
        warnings: [],
      },
      warnings: ["Gutenberg用の意味セクションは見つかりませんでした。Elementor高忠実度変換は利用できます。"],
    };
  }
  resolveImageUrls(mapped.blueprint, imageUrls);
  const blueprint = assertBlueprint(mapped.blueprint);
  const exported = await new GutenbergExporter().export(blueprint);
  const page = blueprint.pages[0];
  const fidelityAssets = { imageUrls, renderedNodeUrls };
  const elementorTemplate = fidelityLayout
    ? new FigmaElementorExporter().toTemplate(
        file,
        page?.title ?? blueprint.site.name,
        fidelityAssets,
      )
    : new ElementorExporter().toTemplate(blueprint);
  const fidelityPreview = fidelityLayout ? renderFigmaPreview(file, fidelityAssets) : null;
  const qualityReport = fidelityLayout
    ? createFigmaQualityReport(file, elementorTemplate, fidelityAssets)
    : null;
  const warnings = [...new Set([
    ...initialWarnings,
    ...mapped.warnings,
    ...exported.warnings,
    ...(fidelityLayout
      ? ["Elementor出力はFigmaの座標・文字スタイル・画像を直接保持する高忠実度モードです。"]
      : []),
    ...(responsiveFidelityLayout
      ? ["FigmaのPC版とスマホ版を端末別レイアウトとして変換しました。"]
      : []),
    ...(qualityReport
      ? qualityReport.checks
        .filter((check) => check.status === "warning")
        .map((check) => `${check.label}: ${check.detail}`)
      : []),
  ])];
  const layoutSections = fidelityLayout ? figmaLayoutSectionNames(file) : [];

  return {
    blueprint,
    pageContent: exported.pageContent ?? "",
    elementorTemplate,
    previewHtml: fidelityPreview ?? (page ? renderPreviewPage(page) : ""),
    qualityReport,
    multiPagePlan: fidelityLayout
      ? createFigmaMultiPagePlan(
          file,
          page?.title ?? blueprint.site.name,
          page?.slug ?? "/",
        )
      : null,
    themeJson: tokensToThemeJson(blueprint.tokens),
    warnings,
    summary: {
      pageTitle: page?.title ?? "無題",
      sectionCount: layoutSections.length || page?.sections.length || 0,
      sectionTypes: layoutSections.length
        ? layoutSections
        : page?.sections.map((section) => section.type) ?? [],
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
