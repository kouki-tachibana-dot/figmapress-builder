import {
  auditElementorTemplateLinks,
  figmaPageLinkPlaceholder,
  sectionAnchorFromText,
  type ElementorTemplate,
  type FigmaMultiPagePlan,
  type FigmaSitePageKey,
} from "@figmapress/elementor-renderer";

export interface FigmaSitePreflightReport {
  pages: number;
  exactPages: number;
  links: number;
  destinations: number;
  navigationPages: number;
  navigationWidgets: number;
  contactForms: number;
  carousels: number;
  accordions: number;
}

interface TemplateFunctionalInventory {
  navigationWidgets: number;
  navigationDestinations: Set<string>;
  semanticDestinationMismatches: string[];
  contactForms: number;
  carousels: number;
  accordions: number;
}

function inspectTemplateFunctionalInventory(
  template: ElementorTemplate,
  plan: FigmaMultiPagePlan,
): TemplateFunctionalInventory {
  const result: TemplateFunctionalInventory = {
    navigationWidgets: 0,
    navigationDestinations: new Set<string>(),
    semanticDestinationMismatches: [],
    contactForms: 0,
    carousels: 0,
    accordions: 0,
  };
  const recordUrl = (value: unknown): void => {
    if (!value || typeof value !== "object") return;
    const url = (value as Record<string, unknown>).url;
    if (typeof url === "string" && url.trim()) result.navigationDestinations.add(url.trim());
  };
  const recordSemanticUrl = (label: unknown, value: unknown): void => {
    if (typeof label !== "string" || !value || typeof value !== "object") return;
    const url = (value as Record<string, unknown>).url;
    if (typeof url !== "string" || !url.trim()) return;
    const semantic = /(?:^|\b)home(?:\b|$)|ホーム|トップ/i.test(label)
      ? "home"
      : sectionAnchorFromText(label);
    const key = semantic === "top" ? "home" : semantic;
    if (!key || !plan.pages.some((page) => page.key === key)) return;
    const expected = figmaPageLinkPlaceholder(key);
    if (url.trim() !== expected) {
      result.semanticDestinationMismatches.push(
        `${label.trim() || key}→${url.trim()}（正:${expected}）`,
      );
    }
  };
  const visit = (elements: ElementorTemplate["content"]): void => {
    for (const element of elements) {
      if (element.widgetType === "figmapress-nav") {
        result.navigationWidgets += 1;
        const items = Array.isArray(element.settings.items) ? element.settings.items : [];
        for (const item of items) {
          if (item && typeof item === "object") {
            const record = item as Record<string, unknown>;
            recordUrl(record.url);
            recordSemanticUrl(record.label, record.url);
          }
        }
        recordUrl(element.settings.home_url);
        recordSemanticUrl("home", element.settings.home_url);
        recordUrl(element.settings.cta_url);
        recordSemanticUrl(element.settings.cta_label, element.settings.cta_url);
      }
      if (element.widgetType === "figmapress-link") {
        recordSemanticUrl(element.settings.link_label, element.settings.link_url);
      }
      if (element.widgetType === "figmapress-contact-form") result.contactForms += 1;
      if (element.widgetType === "figmapress-carousel") result.carousels += 1;
      if (element.widgetType === "figmapress-accordion") result.accordions += 1;
      visit(element.elements);
    }
  };
  visit(template.content);
  return result;
}

export function inspectFigmaSiteTemplates(
  plan: FigmaMultiPagePlan,
  templates: ReadonlyMap<FigmaSitePageKey, ElementorTemplate>,
): FigmaSitePreflightReport {
  if (plan.pages.length < 2) {
    throw new Error("複数ページの構成がありません。Figmaからもう一度変換してください。");
  }

  const allowedPlaceholders = new Set(
    plan.pages.map((page) => figmaPageLinkPlaceholder(page.key)),
  );
  const referencedDestinations = new Set<string>();
  let exactPages = 0;
  let links = 0;
  let navigationPages = 0;
  let navigationWidgets = 0;
  let contactForms = 0;
  let carousels = 0;
  let accordions = 0;

  for (const page of plan.pages) {
    const template = templates.get(page.key);
    if (!template) {
      throw new Error(`「${page.title}」の編集データを準備できませんでした。`);
    }
    if (page.frameId) {
      if (template.page_settings.figmapress_exact_visual !== "yes") {
        throw new Error(
          `「${page.title}」のPC/SP精密表示が不足しています。WordPressには送信していません。`,
        );
      }
      exactPages += 1;
    }

    const audit = auditElementorTemplateLinks(template);
    const unknownPlaceholders = audit.unresolvedPlaceholders.filter(
      (destination) => !allowedPlaceholders.has(destination),
    );
    if (unknownPlaceholders.length || audit.missingAnchors.length || audit.unsafe.length) {
      throw new Error(
        `「${page.title}」のリンク検査に失敗しました（不明な移動先${unknownPlaceholders.length}・存在しないページ内リンク${audit.missingAnchors.length}・不正URL${audit.unsafe.length}）。WordPressには送信していません。`,
      );
    }
    for (const destination of audit.unresolvedPlaceholders) {
      referencedDestinations.add(destination);
    }
    links += audit.total;

    const inventory = inspectTemplateFunctionalInventory(template, plan);
    if (inventory.semanticDestinationMismatches.length) {
      throw new Error(
        `「${page.title}」のリンク名と移動先が一致しません（${inventory.semanticDestinationMismatches.slice(0, 4).join("、")}）。WordPressには送信していません。`,
      );
    }
    const expectedNavigationWidgets = Math.max(
      1,
      Number(page.hasDesktop) + Number(page.hasMobile),
    );
    if (inventory.navigationWidgets < expectedNavigationWidgets) {
      throw new Error(
        `「${page.title}」のPC/SP実動メニューが不足しています（${inventory.navigationWidgets}/${expectedNavigationWidgets}）。WordPressには送信していません。`,
      );
    }
    const missingNavigationDestinations = plan.pages.filter(
      (destination) => !inventory.navigationDestinations.has(
        figmaPageLinkPlaceholder(destination.key),
      ),
    );
    if (missingNavigationDestinations.length) {
      throw new Error(
        `「${page.title}」のメニューに移動先が不足しています（${missingNavigationDestinations.map((destination) => destination.title).join("、")}）。WordPressには送信していません。`,
      );
    }
    if (page.key === "contact" && inventory.contactForms < 1) {
      throw new Error(
        "「お問い合わせ」に送信できるフォームがありません。WordPressには送信していません。",
      );
    }
    navigationPages += 1;
    navigationWidgets += inventory.navigationWidgets;
    contactForms += inventory.contactForms;
    carousels += inventory.carousels;
    accordions += inventory.accordions;
  }

  const missingDestinations = plan.pages.filter(
    (page) => !referencedDestinations.has(figmaPageLinkPlaceholder(page.key)),
  );
  if (missingDestinations.length) {
    throw new Error(
      `リンクされていないページがあります（${missingDestinations.map((page) => page.title).join("、")}）。WordPressには送信していません。`,
    );
  }

  return {
    pages: plan.pages.length,
    exactPages,
    links,
    destinations: referencedDestinations.size,
    navigationPages,
    navigationWidgets,
    contactForms,
    carousels,
    accordions,
  };
}
