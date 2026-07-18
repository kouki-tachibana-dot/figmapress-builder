import type { SiteBlueprint } from "@figmapress/blueprint";

/**
 * Exporter contract shared by the Gutenberg and Elementor renderers.
 * Site Blueprint stays Exporter-agnostic; target-specific fields belong in
 * their renderer packages.
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
