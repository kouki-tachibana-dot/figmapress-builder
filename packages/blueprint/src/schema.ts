import { z } from "zod";

export const SectionTypeSchema = z.enum([
  "section/hero",
  "section/service",
  "section/features",
  "section/faq",
  "section/cta",
  "section/contact",
  "section/unsupported",
]);

export const WpBlockNameSchema = z.enum([
  "figmapress/hero",
  "figmapress/service-list",
  "figmapress/card-grid",
  "figmapress/faq",
  "figmapress/cta",
  "figmapress/contact",
]);

export const ImageRefSchema = z.object({
  src: z.string().nullable().optional(),
  alt: z.string().optional(),
  mediaId: z.number().nullable().optional(),
});

export const ListItemSchema = z.object({
  title: z.string(),
  text: z.string(),
});

export const FaqItemSchema = z.object({
  question: z.string(),
  answer: z.string(),
});

export const SectionSchema = z.object({
  id: z.string(),
  type: SectionTypeSchema,
  wpBlock: WpBlockNameSchema.nullable().optional(),
  content: z.record(z.any()),
  layout: z
    .object({
      desktop: z.string().optional(),
      mobile: z.string().optional(),
    })
    .optional(),
});

export const ColorTokenSchema = z.object({
  name: z.string(),
  slug: z.string(),
  value: z.string(),
});

export const TypographyTokenSchema = z.object({
  name: z.string(),
  slug: z.string(),
  fontFamily: z.string(),
  fontSize: z.string().optional(),
  fontWeight: z.union([z.number(), z.string()]).optional(),
});

export const SpacingTokenSchema = z.object({
  name: z.string(),
  slug: z.string(),
  size: z.string(),
});

export const TokensSchema = z.object({
  colors: z.array(ColorTokenSchema),
  typography: z.array(TypographyTokenSchema),
  spacing: z.array(SpacingTokenSchema),
});

export const PageSchema = z.object({
  title: z.string(),
  slug: z.string(),
  template: z.string(),
  sections: z.array(SectionSchema),
  seo: z.object({
    title: z.string(),
    description: z.string(),
  }),
});

export const SiteBlueprintSchema = z.object({
  site: z.object({
    name: z.string(),
    type: z.enum(["landing_page", "site"]),
    language: z.string(),
  }),
  tokens: TokensSchema,
  pages: z.array(PageSchema),
  warnings: z.array(z.string()).optional(),
});
