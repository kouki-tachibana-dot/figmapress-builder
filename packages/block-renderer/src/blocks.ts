import { escapeAttr, escapeHtml } from "./escape";

/**
 * Serialize a block comment attribute object. Gutenberg expects valid JSON
 * directly inside the comment delimiters (e.g. `<!-- wp:foo {...} -->`).
 * We keep formatting minimal — single-line, no surrounding whitespace.
 */
function attrsJson(attrs: Record<string, unknown>): string {
  return JSON.stringify(stripUndefined(attrs));
}

function stripUndefined<T extends Record<string, unknown>>(obj: T): T {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined) continue;
    if (v === null) continue;
    if (Array.isArray(v) && v.length === 0) continue;
    out[k] = v;
  }
  return out as T;
}

export function renderBlockComment(blockName: string, attrs: object): string {
  const json = attrsJson(attrs as Record<string, unknown>);
  return `<!-- wp:${blockName} ${json} /-->`;
}

export interface HeroAttrs {
  headline: string;
  subtext: string;
  primaryButtonText: string;
  primaryButtonUrl: string;
  imageUrl?: string | null;
  imageId?: number | null;
  layoutVariant?: string;
}

export function renderHero(attrs: HeroAttrs): string {
  const json = attrsJson(attrs as unknown as Record<string, unknown>);
  const imageHtml = attrs.imageUrl
    ? `<figure class="wp-block-figmapress-hero__image"><img src="${escapeAttr(attrs.imageUrl)}" alt="${escapeAttr(attrs.headline)}" /></figure>`
    : "";
  return [
    `<!-- wp:figmapress/hero ${json} -->`,
    `<section class="wp-block-figmapress-hero" data-layout="${escapeAttr(attrs.layoutVariant ?? "stacked")}">`,
    `  <div class="wp-block-figmapress-hero__body">`,
    `    <h1 class="wp-block-figmapress-hero__headline">${escapeHtml(attrs.headline)}</h1>`,
    `    <p class="wp-block-figmapress-hero__subtext">${escapeHtml(attrs.subtext)}</p>`,
    attrs.primaryButtonText
      ? `    <a class="wp-block-figmapress-hero__button" href="${escapeAttr(attrs.primaryButtonUrl)}">${escapeHtml(attrs.primaryButtonText)}</a>`
      : "",
    `  </div>`,
    imageHtml ? `  ${imageHtml}` : "",
    `</section>`,
    `<!-- /wp:figmapress/hero -->`,
  ]
    .filter(Boolean)
    .join("\n");
}

export interface ListBlockAttrs {
  headline?: string;
  items: Array<{ title: string; text: string }>;
}

function renderListBlock(
  blockName: "figmapress/service-list" | "figmapress/card-grid",
  attrs: ListBlockAttrs,
): string {
  const json = attrsJson(attrs as unknown as Record<string, unknown>);
  const cssClass =
    blockName === "figmapress/service-list"
      ? "wp-block-figmapress-service-list"
      : "wp-block-figmapress-card-grid";
  const lines: string[] = [];
  lines.push(`<!-- wp:${blockName} ${json} -->`);
  lines.push(`<section class="${cssClass}">`);
  if (attrs.headline) {
    lines.push(`  <h2 class="${cssClass}__headline">${escapeHtml(attrs.headline)}</h2>`);
  }
  lines.push(`  <ul class="${cssClass}__items">`);
  for (const item of attrs.items) {
    lines.push(`    <li class="${cssClass}__item">`);
    lines.push(`      <h3>${escapeHtml(item.title)}</h3>`);
    lines.push(`      <p>${escapeHtml(item.text)}</p>`);
    lines.push(`    </li>`);
  }
  lines.push(`  </ul>`);
  lines.push(`</section>`);
  lines.push(`<!-- /wp:${blockName} -->`);
  return lines.join("\n");
}

export function renderServiceList(attrs: ListBlockAttrs): string {
  return renderListBlock("figmapress/service-list", attrs);
}

export function renderCardGrid(attrs: ListBlockAttrs): string {
  return renderListBlock("figmapress/card-grid", attrs);
}

export interface FaqAttrs {
  headline?: string;
  items: Array<{ question: string; answer: string }>;
}

export function renderFaq(attrs: FaqAttrs): string {
  const json = attrsJson(attrs as unknown as Record<string, unknown>);
  const lines: string[] = [];
  lines.push(`<!-- wp:figmapress/faq ${json} -->`);
  lines.push(`<section class="wp-block-figmapress-faq">`);
  if (attrs.headline) {
    lines.push(`  <h2 class="wp-block-figmapress-faq__headline">${escapeHtml(attrs.headline)}</h2>`);
  }
  lines.push(`  <dl class="wp-block-figmapress-faq__items">`);
  for (const item of attrs.items) {
    lines.push(`    <dt>${escapeHtml(item.question)}</dt>`);
    lines.push(`    <dd>${escapeHtml(item.answer)}</dd>`);
  }
  lines.push(`  </dl>`);
  lines.push(`</section>`);
  lines.push(`<!-- /wp:figmapress/faq -->`);
  return lines.join("\n");
}

export interface CtaAttrs {
  headline: string;
  buttonText: string;
  buttonUrl: string;
}

export function renderCta(attrs: CtaAttrs): string {
  const json = attrsJson(attrs as unknown as Record<string, unknown>);
  return [
    `<!-- wp:figmapress/cta ${json} -->`,
    `<section class="wp-block-figmapress-cta">`,
    `  <h2 class="wp-block-figmapress-cta__headline">${escapeHtml(attrs.headline)}</h2>`,
    `  <a class="wp-block-figmapress-cta__button" href="${escapeAttr(attrs.buttonUrl)}">${escapeHtml(attrs.buttonText)}</a>`,
    `</section>`,
    `<!-- /wp:figmapress/cta -->`,
  ].join("\n");
}

export interface ContactAttrs {
  headline: string;
  text: string;
  buttonText: string;
  buttonUrl: string;
}

export function renderContact(attrs: ContactAttrs): string {
  const json = attrsJson(attrs as unknown as Record<string, unknown>);
  return [
    `<!-- wp:figmapress/contact ${json} -->`,
    `<section class="wp-block-figmapress-contact">`,
    `  <h2 class="wp-block-figmapress-contact__headline">${escapeHtml(attrs.headline)}</h2>`,
    `  <p class="wp-block-figmapress-contact__text">${escapeHtml(attrs.text)}</p>`,
    `  <a class="wp-block-figmapress-contact__button" href="${escapeAttr(attrs.buttonUrl)}">${escapeHtml(attrs.buttonText)}</a>`,
    `</section>`,
    `<!-- /wp:figmapress/contact -->`,
  ].join("\n");
}
