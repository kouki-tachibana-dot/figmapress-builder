import type {
  CardGridContent,
  ContactContent,
  CtaContent,
  FaqContent,
  HeroContent,
  ListItem,
  Page,
  Section,
  ServiceListContent,
  SiteBlueprint,
} from "@figmapress/blueprint";
import type { ExportResult, SiteExporter } from "@figmapress/exporter";
import type {
  ElementorElement,
  ElementorSettings,
  ElementorTemplate,
} from "./types";

interface ThemeValues {
  primary: string;
  text: string;
  surface: string;
  muted: string;
  fontFamily: string;
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

export class ElementorExporter implements SiteExporter {
  readonly target = "elementor" as const;

  async export(blueprint: SiteBlueprint): Promise<ExportResult> {
    const template = this.toTemplate(blueprint);
    return {
      target: this.target,
      pageContent: JSON.stringify(template),
      files: [
        {
          path: "elementor-template.json",
          content: JSON.stringify(template, null, 2),
        },
      ],
      warnings: [...(blueprint.warnings ?? [])],
    };
  }

  toTemplate(blueprint: SiteBlueprint): ElementorTemplate {
    const page = blueprint.pages[0];
    const ids = new ElementIdFactory();
    const theme = themeValues(blueprint);
    return {
      title: page?.title ?? blueprint.site.name,
      type: "page",
      version: "0.4",
      page_settings: {
        background_background: "classic",
        background_color: theme.surface,
        hide_title: "yes",
      },
      content: page ? page.sections.flatMap((section) => renderSection(section, page, theme, ids)) : [],
    };
  }
}

function renderSection(
  section: Section,
  page: Page,
  theme: ThemeValues,
  ids: ElementIdFactory,
): ElementorElement[] {
  const sectionSettings: ElementorSettings = {
    content_width: "boxed",
    boxed_width: size(1200),
    padding: dimensions(72, 28, 72, 28),
    flex_direction: "column",
    flex_gap: size(24),
    background_background: "classic",
    background_color: section.type === "section/cta" ? theme.text : theme.surface,
  };

  switch (section.type) {
    case "section/hero": {
      const content = section.content as HeroContent;
      const copy = container(ids, `${section.id}:copy`, {
        flex_direction: "column",
        flex_gap: size(18),
        width: size(content.image?.src ? 58 : 100, "%"),
      }, [
        heading(ids, `${section.id}:headline`, content.headline, "h1", theme, 64),
        text(ids, `${section.id}:subtext`, content.subtext, theme),
        button(ids, `${section.id}:button`, content.primaryButtonText, content.primaryButtonUrl, theme),
      ]);
      const elements = [copy];
      if (content.image?.src) {
        elements.push(container(ids, `${section.id}:visual`, {
          width: size(42, "%"),
        }, [image(ids, `${section.id}:image`, content.image.src, content.image.alt ?? page.title)]));
      }
      return [container(ids, section.id, {
        ...sectionSettings,
        min_height: size(620),
        flex_direction: content.image?.src ? "row" : "column",
        flex_direction_tablet: "column",
        flex_align_items: "center",
        flex_gap: size(48),
      }, elements, false)];
    }

    case "section/service": {
      const content = section.content as ServiceListContent;
      return [listSection(section, content.headline, content.items, theme, ids, sectionSettings)];
    }

    case "section/features": {
      const content = section.content as CardGridContent;
      return [listSection(section, content.headline, content.items, theme, ids, sectionSettings)];
    }

    case "section/faq": {
      const content = section.content as FaqContent;
      return [container(ids, section.id, sectionSettings, [
        heading(ids, `${section.id}:headline`, content.headline ?? "FAQ", "h2", theme, 44),
        widget(ids, `${section.id}:accordion`, "figmapress-accordion", {
          items: content.items.map((item, index) => ({
            _id: hashId(`${section.id}:faq:${index}`),
            title: item.question,
            content: item.answer,
          })),
          open_first: "yes",
          allow_multiple: "",
          accent_color: theme.primary,
          background_color: "#FFFFFF",
          text_color: theme.text,
        }),
      ], false)];
    }

    case "section/cta": {
      const content = section.content as CtaContent;
      return [container(ids, section.id, {
        ...sectionSettings,
        flex_align_items: "center",
        text_align: "center",
        border_radius: dimensions(24, 24, 24, 24),
      }, [
        heading(ids, `${section.id}:headline`, content.headline, "h2", { ...theme, text: "#FFFFFF" }, 48),
        button(ids, `${section.id}:button`, content.buttonText, content.buttonUrl, theme),
      ], false)];
    }

    case "section/contact": {
      const content = section.content as ContactContent;
      return [container(ids, section.id, {
        ...sectionSettings,
        flex_align_items: "center",
        text_align: "center",
      }, [
        heading(ids, `${section.id}:headline`, content.headline, "h2", theme, 44),
        text(ids, `${section.id}:text`, content.text, theme),
        widget(ids, `${section.id}:form`, "figmapress-contact-form", {
          title: content.headline,
          button_text: content.buttonText || "送信する",
          accent_color: theme.primary,
          panel_color: theme.surface,
          text_color: theme.text,
          success_message: "送信しました。お問い合わせありがとうございます。",
        }),
      ], false)];
    }

    default:
      return [];
  }
}

function listSection(
  section: Section,
  headline: string | undefined,
  items: ListItem[],
  theme: ThemeValues,
  ids: ElementIdFactory,
  sectionSettings: ElementorSettings,
): ElementorElement {
  const cards = items.map((item, index) => container(ids, `${section.id}:card:${index}`, {
    width: size(33.333, "%"),
    width_tablet: size(50, "%"),
    width_mobile: size(100, "%"),
    padding: dimensions(26, 24, 26, 24),
    background_background: "classic",
    background_color: "#FFFFFF",
    border_border: "solid",
    border_width: dimensions(1, 1, 1, 1),
    border_color: "#D7DEDB",
    border_radius: dimensions(16, 16, 16, 16),
    flex_direction: "column",
    flex_gap: size(8),
  }, [
    heading(ids, `${section.id}:title:${index}`, item.title, "h3", theme, 24),
    text(ids, `${section.id}:text:${index}`, item.text, theme),
  ]));

  return container(ids, section.id, sectionSettings, [
    heading(ids, `${section.id}:headline`, headline ?? "", "h2", theme, 44),
    container(ids, `${section.id}:grid`, {
      flex_direction: "row",
      flex_wrap: "wrap",
      flex_gap: size(18),
    }, cards),
  ], false);
}

function container(
  ids: ElementIdFactory,
  seed: string,
  settings: ElementorSettings,
  elements: ElementorElement[],
  isInner = true,
): ElementorElement {
  return { id: ids.create(seed), elType: "container", isInner, settings, elements };
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

function heading(
  ids: ElementIdFactory,
  seed: string,
  title: string,
  tag: "h1" | "h2" | "h3",
  theme: ThemeValues,
  fontSize: number,
): ElementorElement {
  return widget(ids, seed, "heading", {
    title,
    header_size: tag,
    title_color: theme.text,
    typography_typography: "custom",
    typography_font_family: theme.fontFamily,
    typography_font_size: size(fontSize),
    typography_font_size_mobile: size(Math.max(28, Math.round(fontSize * 0.68))),
    typography_font_weight: tag === "h3" ? "700" : "800",
  });
}

function text(
  ids: ElementIdFactory,
  seed: string,
  value: string,
  theme: ThemeValues,
): ElementorElement {
  return widget(ids, seed, "text-editor", {
    editor: `<p>${escapeHtml(value)}</p>`,
    text_color: theme.muted,
    typography_typography: "custom",
    typography_font_family: theme.fontFamily,
    typography_font_size: size(16),
  });
}

function button(
  ids: ElementIdFactory,
  seed: string,
  label: string,
  url: string,
  theme: ThemeValues,
): ElementorElement {
  return widget(ids, seed, "button", {
    text: label || "詳しく見る",
    link: { url: safeLink(url), is_external: "", nofollow: "", custom_attributes: "" },
    button_text_color: "#FFFFFF",
    background_color: theme.primary,
    border_radius: dimensions(999, 999, 999, 999),
    text_padding: dimensions(13, 22, 13, 22),
  });
}

function image(
  ids: ElementIdFactory,
  seed: string,
  url: string,
  alt: string,
): ElementorElement {
  return widget(ids, seed, "image", {
    image: {
      url,
      id: "",
      alt,
      source: "library",
      figmapress_key: mediaKey(`${seed}:image`, url),
    },
    image_size: "large",
    border_radius: dimensions(22, 22, 22, 22),
  });
}

function themeValues(blueprint: SiteBlueprint): ThemeValues {
  const colors = blueprint.tokens.colors.map((token) => token.value);
  const font = blueprint.tokens.typography[0]?.fontFamily;
  return {
    primary: colors[0] ?? "#2D5BFF",
    text: colors.find((value) => /^#(?:1|2|3)[0-9A-Fa-f]{5}$/.test(value)) ?? "#172A34",
    surface: colors.find((value) => /^#F[0-9A-Fa-f]{5}$/.test(value)) ?? "#F7F7F2",
    muted: colors.find((value) => /^#[5-9A-Ca-c][0-9A-Fa-f]{5}$/.test(value)) ?? "#617078",
    fontFamily: font ?? "Arial",
  };
}

function size(value: number, unit = "px"): Record<string, unknown> {
  return { unit, size: value, sizes: [] };
}

function dimensions(top: number, right: number, bottom: number, left: number): Record<string, unknown> {
  return { unit: "px", top: String(top), right: String(right), bottom: String(bottom), left: String(left), isLinked: top === right && right === bottom && bottom === left };
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

function safeLink(value: string): string {
  const url = value.trim();
  if (/^(https?:|mailto:|tel:|\/|#)/i.test(url)) return url;
  return "#";
}
