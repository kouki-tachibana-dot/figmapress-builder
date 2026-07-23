export type ElementorSettings = Record<string, unknown>;

export interface ElementorElement {
  id: string;
  elType: "container" | "widget";
  isInner: boolean;
  widgetType?:
    | "heading"
    | "text-editor"
    | "button"
    | "image"
    | "figmapress-nav"
    | "figmapress-contact-form"
    | "figmapress-accordion";
  settings: ElementorSettings;
  elements: ElementorElement[];
}

export interface ElementorTemplate {
  title: string;
  type: "page";
  version: "0.4";
  page_settings: ElementorSettings;
  content: ElementorElement[];
}
