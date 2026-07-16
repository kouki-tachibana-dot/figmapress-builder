import type { SiteBlueprint } from "@figmapress/blueprint";

/**
 * Exporter contract — implemented by Gutenberg today and Elementor in
 * Future Phase E. Site Blueprint MUST stay Exporter-agnostic; do not push
 * Gutenberg-specific fields into the Blueprint just because Gutenberg is
 * the only current consumer (spec §2-3, §8-1).
 */
export type ExportTarget = "gutenberg" | "elementor";

export interface ExportFile {
  path: string;
  content: string;
}

export interface ExportResult {
  target: ExportTarget;
  /** Auxiliary files written alongside the page (e.g. theme.json). */
  files?: ExportFile[];
  /** Primary page body — for Gutenberg this is block-comment HTML. */
  pageContent?: string;
  warnings: string[];
}

export interface SiteExporter {
  target: ExportTarget;
  export(blueprint: SiteBlueprint): Promise<ExportResult>;
}
