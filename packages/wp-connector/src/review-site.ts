import type { PrepareWordPressSiteResult } from "./index";

export interface PrepareReviewSiteInput {
  siteKey: string;
  reviewId: string;
  title: string;
  pages: Array<{ key: string; title: string; slug: string; originalId: number }>;
}

export interface PrepareReviewSiteResult extends PrepareWordPressSiteResult {
  review: true;
  reviewId: string;
  originalSiteKey: string;
  pages: Array<PrepareWordPressSiteResult["pages"][number] & { originalId: number; requestId: string }>;
}

/** The server chooses a separate namespace. Never accept the original IDs. */
export function validateReviewSiteResult(input: PrepareReviewSiteInput, value: unknown): PrepareReviewSiteResult {
  const result = value as PrepareReviewSiteResult | null;
  const originals = new Set(input.pages.map(page => page.originalId));
  if (!result || result.review !== true || result.reviewId !== input.reviewId
    || result.originalSiteKey !== input.siteKey || result.status !== "draft"
    || !/^figma:review-[a-f0-9]{40}:root$/.test(result.siteKey) || result.siteKey === input.siteKey
    || !Array.isArray(result.pages) || result.pages.length !== input.pages.length
    || !result.menu || result.menu.assigned !== false || result.menu.assignedLocations?.length !== 0
    || !Number.isSafeInteger(result.menu.id) || result.menu.id <= 0
    || !Array.isArray(result.menu.items) || result.menu.items.length !== input.pages.length) {
    throw new Error("独立した検証コピーの準備結果を確認できません。元ページには保存しません。");
  }
  const seen = new Set<string>();
  const ids = new Set<number>();
  for (const page of result.pages) {
    const expected = input.pages.find(candidate => candidate.key === page.key);
    if (!expected || seen.has(page.key) || ids.has(page.id) || originals.has(page.id)
      || !Number.isSafeInteger(page.id) || page.id <= 0 || page.originalId !== expected.originalId
      || page.status !== "draft" || page.updated !== false || typeof page.created !== "boolean"
      || page.sourceKey !== (page.key === "home" ? result.siteKey : `${result.siteKey}:page:${page.key}`)
      || !/^[a-f0-9]{32}$/.test(page.requestId)) {
      throw new Error("検証コピーの識別子が一致しません。既存ページの上書きを中止しました。");
    }
    seen.add(page.key); ids.add(page.id);
  }
  const menuKeys = new Set<string>();
  const menuIds = new Set<number>();
  for (const item of result.menu.items) {
    const page = result.pages.find(candidate => candidate.key === item.key);
    if (!page || menuKeys.has(item.key) || menuIds.has(item.id) || !Number.isSafeInteger(item.id) || item.id <= 0
      || item.pageId !== page.id || item.rawLink !== page.previewLink) {
      throw new Error("検証メニューがコピー先ページと一致しません。");
    }
    menuKeys.add(item.key); menuIds.add(item.id);
  }
  return result;
}

/** Do not continue the bundle after a mismatched/empty save acknowledgement. */
export function validateReviewPageSave(target: PrepareReviewSiteResult["pages"][number], value: unknown): void {
  const saved = value as { id?: unknown; status?: unknown; target?: unknown; storedElements?: unknown } | null;
  if (!saved || saved.id !== target.id || saved.status !== "draft" || saved.target !== "elementor"
    || typeof saved.storedElements !== "number" || !Number.isSafeInteger(saved.storedElements) || saved.storedElements < 1) {
    throw new Error("検証コピーの完全保存を確認できません。後続ページの保存を停止しました。");
  }
}
