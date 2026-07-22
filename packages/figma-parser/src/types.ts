/** Figma REST fields consumed by both the semantic and high-fidelity paths. */

export interface FigmaBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface FigmaColor {
  r: number;
  g: number;
  b: number;
  a?: number;
}

export interface FigmaPaint {
  type: string;
  color?: FigmaColor;
  opacity?: number;
  imageRef?: string;
  scaleMode?: string;
  visible?: boolean;
}

export interface FigmaTypeStyle {
  fontFamily?: string;
  fontSize?: number;
  fontWeight?: number;
  italic?: boolean;
  letterSpacing?: number;
  lineHeightPx?: number;
  textAlignHorizontal?: "LEFT" | "CENTER" | "RIGHT" | "JUSTIFIED";
  textAlignVertical?: "TOP" | "CENTER" | "BOTTOM";
  textCase?: "ORIGINAL" | "UPPER" | "LOWER" | "TITLE" | "SMALL_CAPS" | "SMALL_CAPS_FORCED";
  textDecoration?: "NONE" | "UNDERLINE" | "STRIKETHROUGH";
  fills?: FigmaPaint[];
}

export interface FigmaEffect {
  type: string;
  visible?: boolean;
  color?: FigmaColor;
  offset?: { x: number; y: number };
  radius?: number;
  spread?: number;
}

export interface FigmaNodeBase {
  id: string;
  name: string;
  type: string;
  characters?: string;
  visible?: boolean;
  opacity?: number;
  rotation?: number;
  textAutoResize?: "NONE" | "WIDTH_AND_HEIGHT" | "HEIGHT" | "TRUNCATE";
  absoluteBoundingBox?: FigmaBounds;
  absoluteRenderBounds?: FigmaBounds | null;
  fills?: FigmaPaint[];
  strokes?: FigmaPaint[];
  strokeWeight?: number;
  cornerRadius?: number;
  rectangleCornerRadii?: [number, number, number, number];
  effects?: FigmaEffect[];
  clipsContent?: boolean;
  style?: FigmaTypeStyle;
  characterStyleOverrides?: number[];
  styleOverrideTable?: Record<string, FigmaTypeStyle>;
  styles?: Record<string, string>;
  layoutMode?: "HORIZONTAL" | "VERTICAL" | "NONE";
  primaryAxisAlignItems?: string;
  counterAxisAlignItems?: string;
  primaryAxisSizingMode?: string;
  counterAxisSizingMode?: string;
  layoutAlign?: string;
  layoutGrow?: number;
  itemSpacing?: number;
  paddingTop?: number;
  paddingRight?: number;
  paddingBottom?: number;
  paddingLeft?: number;
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
