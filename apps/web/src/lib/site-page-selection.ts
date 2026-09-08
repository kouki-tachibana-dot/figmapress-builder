import type { FigmaMultiPagePlan, FigmaSitePagePlan } from "@figmapress/elementor-renderer";

/** Keep source identities and canvas order: deselection must never rename a page. */
export function selectFigmaSitePages(plan: FigmaMultiPagePlan, keys: readonly string[]): FigmaMultiPagePlan {
  if (keys.length < 2) throw new Error("採用するページを2ページ以上選択してください。");
  if (new Set(keys).size !== keys.length || new Set(plan.pages.map(page => page.key)).size !== plan.pages.length) {
    throw new Error("ページ識別子が重複しています。Figmaから再変換してください。");
  }
  if (keys.some(key => !plan.pages.some(page => page.key === key))) {
    throw new Error("選択したページが現在の変換結果にありません。採用ページを選び直してください。");
  }
  const pages = plan.pages.filter(page => keys.includes(page.key));
  const frames = pages.flatMap(page => page.frameId ? [page.frameId] : []);
  if (new Set(frames).size !== frames.length) throw new Error("同じFigmaフレームを複数ページへ採用できません。");
  return { ...plan, pages: pages.map(page => ({ ...page })) };
}

export function sitePageIdentity(page: FigmaSitePagePlan): string {
  return JSON.stringify([page.key, page.frameId ?? null, page.slug, page.title,
    page.hasDesktop, Boolean(page.hasTablet), page.hasMobile]);
}

/** Reject an API batch if it changes the explicitly selected topology. */
export function assertSitePageBatch(plan: FigmaMultiPagePlan, pages: readonly FigmaSitePagePlan[]): void {
  selectFigmaSitePages(plan, plan.pages.map(page => page.key));
  if (!pages.length || new Set(pages.map(page => page.key)).size !== pages.length
    || pages.some(page => !plan.pages.some(selected => sitePageIdentity(selected) === sitePageIdentity(page)))) {
    throw new Error("変換対象のページが確定したサイト構成と一致しません。採用ページを選び直してください。");
  }
}
