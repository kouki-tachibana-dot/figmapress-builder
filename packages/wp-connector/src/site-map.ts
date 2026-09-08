import type { PreparedSitePage } from "./index";

export interface WordPressSiteLookupInput {
  siteKey: string;
  pages: Array<{ key: string; sourceKey: string }>;
}

export type WordPressSiteMapIssue = "missing" | "duplicate" | "not_draft" | "forbidden" | "identity_mismatch";

export interface WordPressSiteMapResult {
  siteKey: string;
  readOnly: true;
  status: "ready" | "unresolved";
  pages: PreparedSitePage[];
  unresolved: Array<{ key: string; reason: WordPressSiteMapIssue }>;
}

/** Check the complete response partition before accepting any page IDs. */
export function validateWordPressSiteMap(input: WordPressSiteLookupInput, value: unknown): WordPressSiteMapResult {
  const result = value as WordPressSiteMapResult | null;
  const expected = new Map(input.pages.map(page => [page.key, page.sourceKey]));
  if (expected.size !== input.pages.length || !expected.size || !result || result.siteKey !== input.siteKey
    || result.readOnly !== true || !Array.isArray(result.pages) || !Array.isArray(result.unresolved)
    || result.status !== (result.unresolved.length ? "unresolved" : "ready")) {
    throw new Error("WordPressの読み取り専用ページ対応表が無効です。Connectorを更新して再取得してください。");
  }
  const seen = new Set<string>();
  const ids = new Set<number>();
  for (const page of result.pages) {
    if (!page || !expected.has(page.key) || seen.has(page.key) || ids.has(page.id)
      || !Number.isSafeInteger(page.id) || page.id <= 0 || page.sourceKey !== expected.get(page.key)
      || page.status !== "draft" || page.created !== false || page.updated !== false
      || typeof page.title !== "string" || typeof page.slug !== "string" || typeof page.previewLink !== "string") {
      throw new Error("WordPressのページ識別子・下書き状態が一致しません。対応表を再取得してください。");
    }
    seen.add(page.key); ids.add(page.id);
  }
  for (const issue of result.unresolved) {
    if (!issue || !expected.has(issue.key) || seen.has(issue.key)
      || !["missing", "duplicate", "not_draft", "forbidden", "identity_mismatch"].includes(issue.reason)) {
      throw new Error("WordPressの未解決ページ情報が無効です。");
    }
    seen.add(issue.key);
  }
  if (seen.size !== expected.size) throw new Error("WordPressのページ対応表が不足しています。");
  return result;
}
