import type { BrowserPreparedSiteResult } from "./wordpress-browser";
import { validateWordPressSiteMap, type WordPressSiteLookupInput, type WordPressSiteMapResult } from "../../../../packages/wp-connector/src/site-map";

export interface WordPressSiteReceipt {
  baseUrl: string;
  result: BrowserPreparedSiteResult;
}

export function receiptFromWordPressSiteMap(baseUrl: string, input: WordPressSiteLookupInput, value: WordPressSiteMapResult): WordPressSiteReceipt {
  const map = validateWordPressSiteMap(input, value);
  if (map.status !== "ready") throw new Error("未解決のページがあります。自動選択・新規作成は行っていません。");
  const receipt: WordPressSiteReceipt = { baseUrl, result: {
    siteKey: map.siteKey, title: "", status: "draft", pages: map.pages, menu: null, warnings: [],
  } };
  resolveWordPressPageLinks(baseUrl, input.siteKey, input.pages.map(page => page.key), receipt);
  return receipt;
}

function siteUrl(value: string): URL {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) {
    throw new Error("WordPressの接続先URLが無効です。");
  }
  url.pathname = `${url.pathname.replace(/\/+$/, "")}/`;
  return url;
}

/** Resolve only pages acknowledged by this WordPress/site, never guessed slugs. */
export function resolveWordPressPageLinks(
  baseUrl: string,
  siteKey: string | null | undefined,
  pageKeys: readonly string[],
  receipt: WordPressSiteReceipt | null | undefined,
): Array<{ key: string; rawLink: string }> {
  const base = siteUrl(baseUrl);
  if (
    !siteKey || !receipt || siteUrl(receipt.baseUrl).href !== base.href
    || receipt.result.siteKey !== siteKey || receipt.result.status !== "draft"
  ) {
    throw new Error("このサイトの確定済みページ対応表がありません。「既存ページの対応表を取得（変更なし）」で再取得してください。推測URLでは保存しません。");
  }
  const seenKeys = new Set<string>();
  const seenIds = new Set<number>();
  for (const page of receipt.result.pages) {
    const expectedSource = page.key === "home" ? siteKey : `${siteKey}:page:${page.key}`;
    if (
      seenKeys.has(page.key) || seenIds.has(page.id)
      || !Number.isSafeInteger(page.id) || page.id <= 0
      || page.sourceKey !== expectedSource || page.status !== "draft"
    ) throw new Error("WordPressページの識別子・下書き状態が一致しません。対応表を再取得してください。");
    seenKeys.add(page.key);
    seenIds.add(page.id);
  }
  if (new Set(pageKeys).size !== pageKeys.length) {
    throw new Error("Figmaのページ識別子が重複しています。");
  }
  return pageKeys.map((key) => {
    const page = receipt.result.pages.find((candidate) => candidate.key === key);
    if (!page?.previewLink) throw new Error(`「${key}」の下書きプレビューURLがありません。対応表を再取得してください。`);
    const link = new URL(page.previewLink);
    const identity = link.searchParams.get("page_id") ?? link.searchParams.get("p");
    if (
      link.protocol !== "https:" || link.origin !== base.origin
      || link.username || link.password || !link.pathname.startsWith(base.pathname)
      || identity !== String(page.id) || link.searchParams.get("preview") !== "true"
      || link.searchParams.getAll("page_id").length > 1
      || link.searchParams.getAll("p").length > 1
      || (link.searchParams.has("page_id") && link.searchParams.has("p"))
      || /\/wp-(?:admin|login)(?:\/|\.|$)/i.test(link.pathname)
    ) throw new Error(`「${key}」のURLが対象WordPressの下書きIDと一致しません。推測URLでは保存しません。`);
    return { key, rawLink: link.href };
  });
}
