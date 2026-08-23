import {
  auditElementorTemplateLinks,
  figmaPageLinkPlaceholder,
  type ElementorTemplate,
  type FigmaMultiPagePlan,
  type FigmaSitePageKey,
} from "@figmapress/elementor-renderer";

export interface FigmaSitePreflightReport {
  pages: number;
  exactPages: number;
  links: number;
  destinations: number;
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
  };
}
