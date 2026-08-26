import type {
  ElementorElement,
  ElementorSettings,
  ElementorTemplate,
} from "./types";

export interface ElementorNativeWidgetCapabilities {
  accordion: boolean;
  form: boolean;
  navMenu: boolean;
  imageCarousel?: boolean;
}

export interface ElementorNativeWidgetOptions {
  capabilities: ElementorNativeWidgetCapabilities;
  menuId?: number | null;
}

interface DesignBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

function hashId(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0").slice(0, 8);
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function array(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value)
    ? value.filter((item): item is Record<string, unknown> => Boolean(record(item)))
    : [];
}

function string(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function parseGeometry(value: unknown): Record<string, unknown> {
  if (record(value)) return value as Record<string, unknown>;
  if (typeof value !== "string") return {};
  try {
    return record(JSON.parse(value)) ?? {};
  } catch {
    return {};
  }
}

function designBox(value: unknown): DesignBox | null {
  const item = record(value);
  if (!item) return null;
  const x = Number(item.x);
  const y = Number(item.y);
  const width = Number(item.width);
  const height = Number(item.height);
  if (![x, y, width, height].every(Number.isFinite) || width <= 0 || height <= 0) {
    return null;
  }
  return { x, y, width, height };
}

function percentSize(value: number): { unit: "%"; size: number; sizes: number[] } {
  return { unit: "%", size: value, sizes: [] };
}

function cssClasses(value: unknown, required: string): string {
  return [...new Set(`${string(value)} ${required}`.trim().split(/\s+/).filter(Boolean))].join(" ");
}

function minimumCenteredBox(
  box: DesignBox,
  minimumWidth: number,
  minimumHeight: number,
): DesignBox {
  const width = Math.max(box.width, minimumWidth);
  const height = Math.max(box.height, minimumHeight);
  return {
    x: Math.max(0, Math.min(100 - width, box.x - (width - box.width) / 2)),
    y: Math.max(0, Math.min(100 - height, box.y - (height - box.height) / 2)),
    width,
    height,
  };
}

function positioned(box: DesignBox | null): ElementorSettings {
  if (!box) return { _element_width: "initial", _element_custom_width: percentSize(100) };
  return {
    _position: "absolute",
    _offset_orientation_h: "start",
    _offset_x: percentSize(box.x),
    _offset_orientation_v: "start",
    _offset_y: percentSize(box.y),
    _element_width: "initial",
    _element_custom_width: percentSize(box.width),
    _element_custom_width_tablet: percentSize(box.width),
    _element_custom_width_mobile: percentSize(box.width),
    min_height: percentSize(box.height),
  };
}

function unionDesignBoxes(boxes: Array<DesignBox | null>): DesignBox | null {
  const valid = boxes.filter((box): box is DesignBox => Boolean(box));
  if (!valid.length) return null;
  const left = Math.min(...valid.map((box) => box.x));
  const top = Math.min(...valid.map((box) => box.y));
  const right = Math.max(...valid.map((box) => box.x + box.width));
  const bottom = Math.max(...valid.map((box) => box.y + box.height));
  return { x: left, y: top, width: right - left, height: bottom - top };
}

function elementorUrl(value: unknown): Record<string, unknown> {
  const candidate = record(value);
  return {
    url: string(candidate?.url),
    is_external: candidate?.is_external === "on" ? "on" : "",
    nofollow: candidate?.nofollow === "on" ? "on" : "",
  };
}

function nativeAccordion(element: ElementorElement): ElementorElement {
  const settings = element.settings;
  const items = array(settings.items);
  return {
    ...element,
    widgetType: "nested-accordion",
    settings: {
      ...settings,
      css_classes: cssClasses(settings.css_classes, "figmapress-native-accordion"),
      _css_classes: cssClasses(settings._css_classes, "figmapress-native-accordion"),
      items: items.map((item, index) => ({
        _id: string(item._id, hashId(`${element.id}:tab:${index}`)),
        item_title: string(item.title, `項目 ${index + 1}`),
        element_css_id: "",
      })),
      default_state: settings.open_first === "yes" ? "expanded" : "all_collapsed",
      max_items_expended: settings.allow_multiple === "yes" ? "multiple" : "one",
      n_accordion_animation_duration: { unit: "ms", size: 400, sizes: [] },
      accordion_item_title_icon_position: "end",
      accordion_item_title_icon: { value: "fas fa-plus", library: "fa-solid" },
      accordion_item_title_icon_active: { value: "fas fa-minus", library: "fa-solid" },
      title_tag: "div",
      title_normal_color: string(settings.text_color, "#202020"),
      title_active_color: string(settings.accent_color, "#D50327"),
      background_normal_background: "classic",
      background_normal_color: string(settings.background_color, "#FFFFFF"),
      figmapress_native_source: "figmapress-accordion",
    },
    elements: items.map((item, index) => {
      const content = string(item.content);
      return {
        id: hashId(`${element.id}:accordion-content:${index}`),
        elType: "container",
        isInner: true,
        settings: {
          _title: string(item.title, `項目 ${index + 1}`),
          content_width: "full",
          figmapress_native_source: "figmapress-accordion-content",
        },
        elements: content
          ? [{
              id: hashId(`${element.id}:accordion-text:${index}`),
              elType: "widget",
              widgetType: "text-editor",
              isInner: false,
              settings: {
                editor: content.replace(/\n/g, "<br>"),
                figmapress_native_source: "figmapress-accordion-text",
              },
              elements: [],
            }]
          : [],
      } satisfies ElementorElement;
    }),
  };
}

function nativeForm(element: ElementorElement): ElementorElement {
  const settings = element.settings;
  const fields = array(settings.fields);
  return {
    ...element,
    widgetType: "form",
    settings: {
      ...settings,
      css_classes: cssClasses(settings.css_classes, "figmapress-native-form"),
      _css_classes: cssClasses(settings._css_classes, "figmapress-native-form"),
      form_name: string(settings.title, "お問い合わせ"),
      form_fields: fields.map((field, index) => {
        const sourceType = string(field.type, "text");
        const fieldType = sourceType === "checkbox" ? "acceptance" : sourceType;
        return {
          _id: string(field._id, hashId(`${element.id}:field:${index}`)),
          field_type: fieldType,
          field_label: string(field.label, `項目 ${index + 1}`),
          placeholder: "",
          required: field.required === "yes" ? "true" : "",
          field_options: string(field.options),
          column_width: "100",
          width: "100",
          custom_id: string(field.name, `field_${index + 1}`),
          autocomplete: string(field.autocomplete),
        };
      }),
      button_text: string(settings.button_text, "送信する"),
      submit_actions: ["save-to-database"],
      success_message: string(
        settings.success_message,
        "送信しました。お問い合わせありがとうございます。",
      ),
      error_message: "送信できませんでした。入力内容を確認してもう一度お試しください。",
      required_field_message: "この項目は必須です。",
      invalid_message: "入力内容を確認してください。",
      button_background_color: string(settings.accent_color, "#B90A23"),
      button_text_color: "#FFFFFF",
      label_color: string(settings.text_color, "#202020"),
      figmapress_native_source: "figmapress-contact-form",
    },
  };
}

function nativeCarousel(element: ElementorElement): ElementorElement {
  const settings = element.settings;
  const items = array(settings.items);
  return {
    ...element,
    widgetType: "image-carousel",
    settings: {
      ...settings,
      carousel: items.map((item, index) => ({
        _id: string(item._id, hashId(`${element.id}:slide:${index}`)),
        image: record(item.image) ?? {},
        link: elementorUrl(item.url),
      })),
      slides_to_show: String(Number(settings.items_per_view) || Math.min(3, items.length)),
      slides_to_show_mobile: String(Number(settings.items_per_view_mobile) || 1),
      navigation: settings.show_dots === "yes" ? "dots" : "none",
      infinite: settings.loop === "yes" ? "yes" : "",
      autoplay: settings.autoplay === "yes" ? "yes" : "",
      figmapress_native_source: "figmapress-carousel",
    },
  };
}

function nativeNavigation(
  element: ElementorElement,
  menuId: number,
): ElementorElement {
  const settings = element.settings;
  const geometry = parseGeometry(settings.design_geometry);
  const variant = string(settings.layout_variant, "desktop");
  const logo = record(settings.logo);
  const ctaIcon = record(settings.cta_icon);
  const ctaLabel = string(settings.cta_label);
  const rootGeometry = record(geometry.root);
  const rootWidth = Number(rootGeometry?.width) || 0;
  const rootHeight = Number(rootGeometry?.height) || 1;
  const itemGeometry = array(geometry.items);
  const itemBox = unionDesignBoxes(itemGeometry.map(designBox));
  const toggleBox = designBox(geometry.toggle);
  const menuBox = variant === "mobile"
    ? minimumCenteredBox(
        toggleBox ?? { x: 80, y: 18, width: 16, height: 64 },
        rootWidth > 0 ? 4400 / rootWidth : 10,
        rootHeight > 0 ? 4400 / rootHeight : 44,
      )
    : itemBox ?? { x: 24, y: 15, width: 56, height: 70 };
  const firstItemFontPercent = Number(itemGeometry[0]?.fontSize) || 0;
  const menuFontSize = rootWidth > 0 && firstItemFontPercent > 0
    ? Math.max(10, Math.round(rootWidth * firstItemFontPercent / 100))
    : 16;
  const children: ElementorElement[] = [];

  if (logo && string(logo.url)) {
    children.push({
      id: hashId(`${element.id}:native-logo`),
      elType: "widget",
      widgetType: "image",
      isInner: false,
      settings: {
        ...positioned(designBox(geometry.logo)),
        image: logo,
        image_size: "full",
        link_to: "custom",
        link: elementorUrl(settings.home_url),
        figmapress_native_source: "figmapress-nav-logo",
      },
      elements: [],
    });
  }

  children.push({
    id: hashId(`${element.id}:native-menu`),
    elType: "widget",
    widgetType: "nav-menu",
    isInner: false,
    settings: {
      ...positioned(menuBox),
      css_classes: "figmapress-native-nav-menu",
      _css_classes: "figmapress-native-nav-menu",
      menu: String(menuId),
      layout: variant === "mobile" ? "dropdown" : "horizontal",
      align_items: variant === "mobile" ? "stretch" : "center",
      pointer: "underline",
      submenu_icon: { value: "<i class=\"fas fa-caret-down\"></i>", library: "fa-solid" },
      toggle: "burger",
      full_width: "stretch",
      breakpoint: "mobile",
      menu_typography_typography: "custom",
      menu_typography_font_size: { unit: "px", size: menuFontSize, sizes: [] },
      color_menu_item: string(settings.text_color, "#202020"),
      color_menu_item_hover: string(settings.accent_color, "#D10B2C"),
      color_menu_item_active: string(settings.accent_color, "#D10B2C"),
      toggle_color: string(settings.text_color, "#202020"),
      figmapress_native_source: "figmapress-nav-menu",
    },
    elements: [],
  });

  if (ctaIcon && string(ctaIcon.url)) {
    children.push({
      id: hashId(`${element.id}:native-cta-icon`),
      elType: "widget",
      widgetType: "image",
      isInner: false,
      settings: {
        ...positioned(designBox(geometry.ctaIcon)),
        image: ctaIcon,
        image_size: "full",
        link_to: "custom",
        link: elementorUrl(settings.cta_url),
        figmapress_native_source: "figmapress-nav-cta-icon",
      },
      elements: [],
    });
  }

  if (ctaLabel) {
    children.push({
      id: hashId(`${element.id}:native-cta`),
      elType: "widget",
      widgetType: "button",
      isInner: false,
      settings: {
        ...positioned(designBox(geometry.cta)),
        text: ctaLabel,
        link: elementorUrl(settings.cta_url),
        background_color: string(settings.accent_color, "#D10B2C"),
        button_text_color: "#FFFFFF",
        figmapress_native_source: "figmapress-nav-cta",
      },
      elements: [],
    });
  }

  const {
    items: _items,
    logo: _logo,
    cta_icon: _ctaIcon,
    cta_label: _ctaLabel,
    cta_url: _ctaUrl,
    home_url: _homeUrl,
    ...containerSettings
  } = settings;
  return {
    id: element.id,
    elType: "container",
    isInner: true,
    settings: {
      ...containerSettings,
      css_classes: cssClasses(containerSettings.css_classes, "figmapress-native-header"),
      html_tag: "header",
      display: "flex",
      flex_direction: "row",
      flex_justify_content: "space-between",
      flex_align_items: "center",
      flex_wrap: "nowrap",
      min_height: { unit: "px", size: rootHeight, sizes: [] },
      background_background: "classic",
      background_color: string(settings.background_color, "transparent"),
      figmapress_native_source: "figmapress-nav",
    },
    elements: children,
  };
}

function adaptElement(
  element: ElementorElement,
  options: ElementorNativeWidgetOptions,
): ElementorElement {
  const adaptedChildren = element.elements.map((child) => adaptElement(child, options));
  const current = adaptedChildren === element.elements
    ? element
    : { ...element, elements: adaptedChildren };
  if (current.widgetType === "figmapress-accordion" && options.capabilities.accordion) {
    return nativeAccordion(current);
  }
  if (current.widgetType === "figmapress-contact-form" && options.capabilities.form) {
    return nativeForm(current);
  }
  if (
    current.widgetType === "figmapress-nav"
    && options.capabilities.navMenu
    && Number.isInteger(options.menuId)
    && Number(options.menuId) > 0
  ) {
    return nativeNavigation(current, Number(options.menuId));
  }
  if (current.widgetType === "figmapress-carousel" && options.capabilities.imageCarousel) {
    return nativeCarousel(current);
  }
  return current;
}

/**
 * Replace FigmaPress fallback interactions with the exact Elementor widgets
 * registered by the destination site. Unsupported widgets remain as the
 * editable fallback instead of being saved as broken unknown widget types.
 */
export function adaptElementorTemplateToNativeWidgets(
  template: ElementorTemplate,
  options: ElementorNativeWidgetOptions,
): ElementorTemplate {
  return {
    ...template,
    page_settings: {
      ...template.page_settings,
      figmapress_native_widgets: "yes",
      figmapress_native_widgets_version: "1",
    },
    content: template.content.map((element) => adaptElement(element, options)),
  };
}
