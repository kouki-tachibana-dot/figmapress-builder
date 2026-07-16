/**
 * Minimal Figma-shaped types used by the mock parser.
 * Real Figma API responses are far richer; we only consume what the LP
 * template convention requires (section/* frames with named children).
 */

export interface FigmaNodeBase {
  id: string;
  name: string;
  type: string;
  characters?: string;
  fills?: Array<{
    type: string;
    color?: { r: number; g: number; b: number; a?: number };
    imageRef?: string;
  }>;
  children?: FigmaNode[];
}

export type FigmaNode = FigmaNodeBase;

export interface FigmaStylesShape {
  colors?: Array<{ name: string; value: string }>;
  typography?: Array<{
    name: string;
    fontFamily: string;
    fontSize?: string;
    fontWeight?: number | string;
  }>;
  spacing?: Array<{ name: string; size: string }>;
}

export interface MockFigmaFile {
  document: FigmaNode;
  styles?: FigmaStylesShape;
}

export interface ParsedSection {
  id: string;
  rawName: string;
  /** e.g. "section/hero" — kept verbatim for the mapper. */
  sectionName: string;
  node: FigmaNode;
}

export interface ParseResult {
  pageTitle: string;
  sections: ParsedSection[];
  styles: FigmaStylesShape;
}
