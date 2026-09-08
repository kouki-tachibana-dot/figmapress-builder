export type ResponsiveVariant = "desktop" | "tablet" | "mobile";

export interface ResponsiveIntegrity {
  valid: boolean;
  visibleVariants: string[];
  rootCount: number;
  reason: string | null;
}

/** Inspect the page's real CSS. This function must never repair the tested DOM. */
export function inspectResponsiveIntegrity(
  document: Document,
  expected: ResponsiveVariant,
): ResponsiveIntegrity {
  const roots = [...document.querySelectorAll<HTMLElement>(
    ".figmapress-layout, .figmapress-figma-preview",
  )];
  if (!roots.length) return { valid: true, visibleVariants: [], rootCount: 0, reason: null };
  const variantOf = (root: HTMLElement) => ["desktop", "tablet", "mobile"].find((variant) =>
    root.classList.contains(`figmapress-layout--${variant}`)
    || root.classList.contains(`figmapress-figma-preview--${variant}`),
  ) ?? "single";
  const visible = roots.filter((root) => {
    const rect = root.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return false;
    let element: HTMLElement | null = root;
    while (element) {
      const style = document.defaultView?.getComputedStyle(element);
      if (style?.display === "none" || style?.visibility === "hidden" || style?.opacity === "0") return false;
      element = element.parentElement;
    }
    return true;
  });
  const visibleVariants = visible.map(variantOf);
  // Inherited layouts are valid only when the requested source is absent.
  const available = roots.map(variantOf);
  const fallbackOrder = expected === "mobile" ? ["mobile", "tablet", "desktop", "single"]
    : expected === "tablet" ? ["tablet", "desktop", "single"] : ["desktop", "single"];
  const target = fallbackOrder.find((variant) => available.includes(variant));
  const valid = visible.length === 1 && visibleVariants[0] === target;
  return {
    valid, visibleVariants, rootCount: roots.length,
    reason: valid ? null : `端末表示の検査に失敗しました（対象: ${expected}、実表示: ${visibleVariants.join("・") || "なし"}）。表示を強制補正せず、元のレスポンシブCSSを修正してください。`,
  };
}

export function assertResponsiveIntegrity(document: Document, expected: ResponsiveVariant): void {
  const result = inspectResponsiveIntegrity(document, expected);
  if (!result.valid) throw new Error(result.reason ?? "端末表示を確認できませんでした。");
}
