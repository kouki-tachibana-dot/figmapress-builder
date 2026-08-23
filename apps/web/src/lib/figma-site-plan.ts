import type { FigmaMultiPagePlan } from "@figmapress/elementor-renderer";
import type { FigmaPageCandidate } from "./figma-frame-selection";

const SEMANTIC_PAGES: Array<{
  pattern: RegExp;
  title: string;
  slug: string;
}> = [
  { pattern: /会社案内|company|about/i, title: "会社案内", slug: "company" },
  { pattern: /選ばれる理由|reasons?|strength/i, title: "選ばれる理由", slug: "reasons" },
  { pattern: /事業(?:内容|案内)|services?|business/i, title: "事業内容", slug: "services" },
  { pattern: /施工事例|works?|projects?|construction/i, title: "施工事例", slug: "works" },
  { pattern: /解体工事|demolition/i, title: "解体工事", slug: "demolition" },
  { pattern: /お知らせ|news|topics?/i, title: "お知らせ", slug: "news" },
  { pattern: /お問い合わせ|contact|問(?:い)?合わせ|問合/i, title: "お問い合わせ", slug: "contact" },
  { pattern: /役員一覧|officers?|executives?|board/i, title: "役員一覧", slug: "officers" },
];

function asciiSlug(value: string): string {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

function candidateIdentity(
  candidate: FigmaPageCandidate,
  index: number,
): { title: string; slug: string } {
  const semantic = SEMANTIC_PAGES.find((definition) =>
    definition.pattern.test(candidate.title),
  );
  if (semantic) return { title: semantic.title, slug: semantic.slug };
  return {
    title: candidate.title.trim() || `ページ ${index + 1}`,
    slug: asciiSlug(candidate.title) || `page-${index + 1}`,
  };
}

function uniqueSlug(base: string, used: Set<string>): string {
  if (!used.has(base)) {
    used.add(base);
    return base;
  }
  let suffix = 2;
  while (used.has(`${base}-${suffix}`)) suffix += 1;
  const value = `${base}-${suffix}`;
  used.add(value);
  return value;
}

/**
 * Turn Figma's top-level PC/SP page pairs into a WordPress site plan.
 * When a file contains at least two complete responsive pairs, isolated
 * desktop/mobile fragments are treated as component scraps and excluded.
 */
export function createCandidateFigmaMultiPagePlan(
  candidates: FigmaPageCandidate[],
  selectedFrameId: string,
  siteTitle: string,
): FigmaMultiPagePlan | null {
  const paired = candidates.filter((candidate) => candidate.desktop && candidate.mobile);
  const eligible = (paired.length >= 2 ? paired : candidates).slice(0, 20);
  if (eligible.length < 2) return null;

  const selected = eligible.find((candidate) =>
    candidate.id === selectedFrameId
    || candidate.desktop?.id === selectedFrameId
    || candidate.mobile?.id === selectedFrameId,
  ) ?? eligible[0];
  const ordered = [
    selected,
    ...eligible.filter((candidate) => candidate.id !== selected.id),
  ];
  const used = new Set<string>(["home"]);
  return {
    title: siteTitle,
    menuName: `${siteTitle}｜FigmaPress`,
    pages: ordered.map((candidate, index) => {
      const identity = candidateIdentity(candidate, index);
      const slug = index === 0 ? "home" : uniqueSlug(identity.slug, used);
      return {
        key: index === 0 ? "home" : slug,
        title: index === 0 ? "ホーム" : identity.title,
        slug,
        hasDesktop: Boolean(candidate.desktop),
        hasMobile: Boolean(candidate.mobile),
        frameId: candidate.id,
      };
    }),
  };
}
