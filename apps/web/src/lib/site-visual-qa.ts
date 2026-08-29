import type {
  FigmaMultiPagePlan,
  FigmaSitePageKey,
} from "@figmapress/elementor-renderer";
import type { VisualQaStatus } from "./visual-qa";

export type SiteVisualQaVariant = "desktop" | "mobile";

export interface SiteVisualQaResultLike {
  pageKey: FigmaSitePageKey;
  variant: SiteVisualQaVariant;
  status: VisualQaStatus;
  score: number;
}

export interface SiteVisualQaGate {
  expected: number;
  completed: number;
  passed: number;
  blocked: boolean;
  complete: boolean;
  worstScore: number | null;
  missing: Array<{ pageKey: FigmaSitePageKey; variant: SiteVisualQaVariant }>;
  failures: SiteVisualQaResultLike[];
}

export function expectedSiteVisualQaChecks(
  plan: FigmaMultiPagePlan,
): Array<{ pageKey: FigmaSitePageKey; variant: SiteVisualQaVariant }> {
  return plan.pages.flatMap((page) => [
    ...(page.hasDesktop ? [{ pageKey: page.key, variant: "desktop" as const }] : []),
    ...(page.hasMobile ? [{ pageKey: page.key, variant: "mobile" as const }] : []),
  ]);
}

export function resolveSiteVisualQaGate(
  plan: FigmaMultiPagePlan,
  results: SiteVisualQaResultLike[],
): SiteVisualQaGate {
  const expectedChecks = expectedSiteVisualQaChecks(plan);
  const expectedKeys = new Set(
    expectedChecks.map((check) => `${check.pageKey}:${check.variant}`),
  );
  const resultsByKey = new Map(
    results
      .filter((result) => expectedKeys.has(`${result.pageKey}:${result.variant}`))
      .map((result) => [`${result.pageKey}:${result.variant}`, result]),
  );
  const missing = expectedChecks.filter(
    (check) => !resultsByKey.has(`${check.pageKey}:${check.variant}`),
  );
  const matched = [...resultsByKey.values()];
  const failures = matched.filter((result) => result.status !== "pass");
  const complete = expectedChecks.length > 0 && missing.length === 0;
  return {
    expected: expectedChecks.length,
    completed: matched.length,
    passed: matched.length - failures.length,
    blocked: !complete || failures.length > 0,
    complete,
    worstScore: matched.length
      ? Math.min(...matched.map((result) => result.score))
      : null,
    missing,
    failures,
  };
}
