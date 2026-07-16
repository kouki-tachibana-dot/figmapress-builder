export * from "./types";
export * from "./schema";
export * from "./validate";

import type { SectionType, WpBlockName } from "./types";

/**
 * Component Mapping Rule — Figma section → WordPress block.
 * Single source of truth used by both Blueprint generation (for the
 * convenience `wpBlock` hint) and the Gutenberg Exporter.
 *
 * Extending to Elementor later: add a parallel map (e.g. `sectionToElementor`)
 * in a sibling Exporter — do NOT couple it to this file.
 */
export const SECTION_TO_WP_BLOCK: Record<SectionType, WpBlockName | null> = {
  "section/hero": "figmapress/hero",
  "section/service": "figmapress/service-list",
  "section/features": "figmapress/card-grid",
  "section/faq": "figmapress/faq",
  "section/cta": "figmapress/cta",
  "section/contact": "figmapress/contact",
  "section/unsupported": null,
};

export const SUPPORTED_SECTION_TYPES: SectionType[] = [
  "section/hero",
  "section/service",
  "section/features",
  "section/faq",
  "section/cta",
  "section/contact",
];
