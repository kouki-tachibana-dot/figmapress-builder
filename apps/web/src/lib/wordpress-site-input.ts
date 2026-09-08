import { z } from "zod";

const SiteKeySchema = z.string().trim().regex(/^figma:[A-Za-z0-9_-]{6,160}:(?:root|[0-9]+:[0-9]+)$/);
export const WordPressReviewSiteShape = {
  siteKey: SiteKeySchema.refine(value => !value.startsWith("figma:review-")),
  reviewId: z.string().regex(/^[a-f0-9]{32}$/),
  title: z.string().trim().min(1).max(200),
  pages: z.array(z.object({ key: z.string().regex(/^[a-z0-9][a-z0-9-]{0,79}$/),
    title: z.string().trim().min(1).max(200), slug: z.string().trim().min(1).max(200),
    originalId: z.number().int().positive().safe(),
  }).strict()).min(2).max(20),
};
export const WordPressReviewSiteSchema = z.object(WordPressReviewSiteShape).superRefine((input, context) => {
  if (!input.pages.some(page => page.key === "home")
    || new Set(input.pages.map(page => page.key)).size !== input.pages.length
    || new Set(input.pages.map(page => page.originalId)).size !== input.pages.length) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["pages"], message: "ホームを含む重複しない元ページ対応が必要です。" });
  }
});
export const WordPressSiteLookupShape = {
  siteKey: SiteKeySchema,
  pages: z.array(z.object({
    key: z.string().regex(/^[a-z0-9][a-z0-9-]{0,79}$/),
    sourceKey: z.string().max(260),
  }).strict()).min(1).max(20),
};
export const WordPressSiteLookupSchema = z.object(WordPressSiteLookupShape).superRefine((value, context) => {
  const seen = new Set<string>();
  value.pages.forEach((page, index) => {
    if (seen.has(page.key) || page.sourceKey !== (page.key === "home" ? value.siteKey : `${value.siteKey}:page:${page.key}`)) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["pages", index], message: "ページ識別子が一致しないか重複しています。" });
    }
    seen.add(page.key);
  });
});
const SitePageSchema = z.object({
  key: z.string().regex(/^(?:home|[a-z0-9][a-z0-9-]{0,79})$/),
  title: z.string().trim().min(1).max(200),
  slug: z.string().trim().min(1).max(200),
  sourceKey: z.string().trim().regex(/^figma:[A-Za-z0-9_-]{6,160}:(?:root|[0-9]+:[0-9]+)(?::page:[a-z0-9-]{1,80})?$/),
}).strict();

/** Same 2–20 page contract as the direct and paired Connector routes. */
export const WordPressSiteShape = {
  siteKey: SiteKeySchema,
  title: z.string().trim().min(1).max(200),
  menuName: z.string().trim().min(1).max(200),
  pages: z.array(SitePageSchema).min(2).max(20),
};

export const WordPressSiteInputSchema = z.object(WordPressSiteShape).superRefine((value, context) => {
  if (!value.pages.some(page => page.key === "home")) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["pages"], message: "ホームページの指定が必要です。" });
  }
  const keys = new Set<string>();
  value.pages.forEach((page, index) => {
    const expected = page.key === "home" ? value.siteKey : `${value.siteKey}:page:${page.key}`;
    if (keys.has(page.key) || page.sourceKey !== expected) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["pages", index], message: "ページの識別子が対象サイトと一致しないか重複しています。" });
    }
    keys.add(page.key);
  });
});
