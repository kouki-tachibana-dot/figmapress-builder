import type {
  CardGridContent,
  ContactContent,
  CtaContent,
  FaqContent,
  HeroContent,
  Page,
  Section,
  ServiceListContent,
  SiteBlueprint,
} from "@figmapress/blueprint";
import type {
  ExportResult,
  SiteExporter,
} from "@figmapress/exporter";
import {
  renderCardGrid,
  renderBlockComment,
  renderContact,
  renderCta,
  renderFaq,
  renderHero,
  renderServiceList,
} from "./blocks";

/**
 * GutenbergExporter — turns a Site Blueprint into Gutenberg block-comment
 * HTML. It shares the target-neutral SiteExporter contract with the
 * Elementor renderer.
 */
export class GutenbergExporter implements SiteExporter {
  readonly target = "gutenberg" as const;

  async export(blueprint: SiteBlueprint): Promise<ExportResult> {
    const warnings: string[] = [...(blueprint.warnings ?? [])];
    const firstPage = blueprint.pages[0];
    if (!firstPage) {
      return {
        target: this.target,
        pageContent: "",
        warnings: [...warnings, "blueprint has no pages"],
      };
    }
    const pageContent = renderPage(firstPage, warnings);
    return { target: this.target, pageContent, warnings };
  }
}

export function renderPage(page: Page, warnings: string[]): string {
  const chunks: string[] = [];
  for (const section of page.sections) {
    const html = renderSection(section, warnings, false);
    if (html) chunks.push(html);
  }
  return chunks.join("\n\n") + "\n";
}

export function renderPreviewPage(page: Page, warnings: string[] = []): string {
  const chunks: string[] = [];
  for (const section of page.sections) {
    const html = renderSection(section, warnings, true);
    if (html) chunks.push(html);
  }
  return chunks.join("\n\n") + "\n";
}

function renderSection(
  section: Section,
  warnings: string[],
  preview: boolean,
): string | null {
  switch (section.type) {
    case "section/hero": {
      const c = section.content as HeroContent;
      const attrs = {
        headline: c.headline ?? "",
        subtext: c.subtext ?? "",
        primaryButtonText: c.primaryButtonText ?? "",
        primaryButtonUrl: c.primaryButtonUrl ?? "",
        imageUrl: c.image?.src ?? null,
        imageId: c.image?.mediaId ?? null,
        layoutVariant: c.image?.src ? (section.layout?.desktop ?? "stacked") : "stacked",
      };
      return preview
        ? renderHero(attrs)
        : renderBlockComment("figmapress/hero", attrs);
    }
    case "section/service": {
      const c = section.content as ServiceListContent;
      const attrs = {
        headline: c.headline,
        items: c.items ?? [],
      };
      return preview
        ? renderServiceList(attrs)
        : renderBlockComment("figmapress/service-list", attrs);
    }
    case "section/features": {
      const c = section.content as CardGridContent;
      const attrs = {
        headline: c.headline,
        items: c.items ?? [],
      };
      return preview
        ? renderCardGrid(attrs)
        : renderBlockComment("figmapress/card-grid", attrs);
    }
    case "section/faq": {
      const c = section.content as FaqContent;
      const attrs = {
        headline: c.headline,
        items: c.items ?? [],
      };
      return preview
        ? renderFaq(attrs)
        : renderBlockComment("figmapress/faq", attrs);
    }
    case "section/cta": {
      const c = section.content as CtaContent;
      const attrs = {
        headline: c.headline ?? "",
        buttonText: c.buttonText ?? "",
        buttonUrl: c.buttonUrl ?? "",
      };
      return preview
        ? renderCta(attrs)
        : renderBlockComment("figmapress/cta", attrs);
    }
    case "section/contact": {
      const c = section.content as ContactContent;
      const attrs = {
        headline: c.headline ?? "",
        text: c.text ?? "",
        buttonText: c.buttonText ?? "",
        buttonUrl: c.buttonUrl ?? "",
      };
      return preview
        ? renderContact(attrs)
        : renderBlockComment("figmapress/contact", attrs);
    }
    case "section/unsupported":
      warnings.push(`skipping unsupported section: ${section.id}`);
      return null;
    default:
      warnings.push(`unknown section type at render time: ${section.type}`);
      return null;
  }
}
