/**
 * Site Blueprint — Exporter-agnostic intermediate representation.
 * Must NOT contain target-specific data. Each Exporter (Gutenberg / Elementor)
 * consumes this same shape and produces target-specific output.
 */

export type SectionType =
  | "section/hero"
  | "section/service"
  | "section/features"
  | "section/faq"
  | "section/cta"
  | "section/contact"
  | "section/unsupported";

export type WpBlockName =
  | "figmapress/hero"
  | "figmapress/service-list"
  | "figmapress/card-grid"
  | "figmapress/faq"
  | "figmapress/cta"
  | "figmapress/contact";

export interface ImageRef {
  src?: string | null;
  alt?: string;
  mediaId?: number | null;
}

export interface FaqItem {
  question: string;
  answer: string;
}

export interface ListItem {
  title: string;
  text: string;
}

export interface SectionLayout {
  desktop?: string;
  mobile?: string;
}

export interface HeroContent {
  headline: string;
  subtext: string;
  primaryButtonText: string;
  primaryButtonUrl: string;
  image: ImageRef | null;
}

export interface ServiceListContent {
  headline?: string;
  items: ListItem[];
}

export interface CardGridContent {
  headline?: string;
  items: ListItem[];
}

export interface FaqContent {
  headline?: string;
  items: FaqItem[];
}

export interface CtaContent {
  headline: string;
  buttonText: string;
  buttonUrl: string;
}

export interface ContactContent {
  headline: string;
  text: string;
  buttonText: string;
  buttonUrl: string;
}

export type SectionContent =
  | HeroContent
  | ServiceListContent
  | CardGridContent
  | FaqContent
  | CtaContent
  | ContactContent
  | Record<string, unknown>;

export interface Section {
  id: string;
  type: SectionType;
  /**
   * Convenience hint for Gutenberg-target consumers. Exporters MAY ignore
   * this and re-derive the mapping themselves. Kept here so the Blueprint
   * artifact remains human-inspectable.
   */
  wpBlock?: WpBlockName | null;
  content: SectionContent;
  layout?: SectionLayout;
}

export interface ColorToken {
  name: string;
  slug: string;
  value: string;
}

export interface TypographyToken {
  name: string;
  slug: string;
  fontFamily: string;
  fontSize?: string;
  fontWeight?: number | string;
}

export interface SpacingToken {
  name: string;
  slug: string;
  size: string;
}

export interface Tokens {
  colors: ColorToken[];
  typography: TypographyToken[];
  spacing: SpacingToken[];
}

export interface SeoMeta {
  title: string;
  description: string;
}

export interface Page {
  title: string;
  slug: string;
  template: string;
  sections: Section[];
  seo: SeoMeta;
}

export interface SiteMeta {
  name: string;
  type: "landing_page" | "site";
  language: string;
}

export interface SiteBlueprint {
  site: SiteMeta;
  tokens: Tokens;
  pages: Page[];
  warnings?: string[];
}
