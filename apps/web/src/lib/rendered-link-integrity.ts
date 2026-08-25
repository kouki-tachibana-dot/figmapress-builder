export interface RenderedLinkIntegrity {
  links: number;
  anchors: number;
  duplicateAnchors: string[];
  unresolvedPlaceholders: string[];
  missingAnchors: string[];
  unsafe: string[];
  valid: boolean;
}

const ATTRIBUTE_PATTERN = (name: string): RegExp => new RegExp(
  `\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`,
  "i",
);

function decodeHtmlAttribute(value: string): string {
  return value
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#(\d+);/g, (_match, code: string) =>
      String.fromCodePoint(Number.parseInt(code, 10)),
    )
    .replace(/&#x([0-9a-f]+);/gi, (_match, code: string) =>
      String.fromCodePoint(Number.parseInt(code, 16)),
    );
}

function attributeValue(tag: string, name: string): string | null {
  const match = tag.match(ATTRIBUTE_PATTERN(name));
  const value = match?.[1] ?? match?.[2] ?? match?.[3];
  return typeof value === "string" ? decodeHtmlAttribute(value).trim() : null;
}

/**
 * Validate the HTML returned by the authenticated Connector snapshot.
 * This is deliberately independent from the generated Elementor JSON: a
 * successful save is not proof that WordPress rendered the destination IDs.
 */
export function inspectRenderedLinkIntegrity(html: string): RenderedLinkIntegrity {
  const anchorCounts = new Map<string, number>();
  const hrefs: string[] = [];
  for (const match of html.matchAll(/<[a-z][^>]*>/gi)) {
    const tag = match[0];
    const id = attributeValue(tag, "id");
    if (id) anchorCounts.set(id, (anchorCounts.get(id) ?? 0) + 1);
    if (/^<a\b/i.test(tag)) {
      const href = attributeValue(tag, "href");
      if (href) hrefs.push(href);
    }
  }

  const unresolvedPlaceholders = [...new Set(hrefs.filter((href) =>
    href.startsWith("#figmapress-page-")
  ))];
  const missingAnchors = [...new Set(hrefs
    .filter((href) =>
      /^#[A-Za-z][\w:-]*$/.test(href)
      && !href.startsWith("#figmapress-page-")
    )
    .map((href) => href.slice(1))
    .filter((anchor) => !anchorCounts.has(anchor)))];
  const duplicateAnchors = [...anchorCounts.entries()]
    .filter(([, count]) => count > 1)
    .map(([anchor]) => anchor);
  const unsafe = [...new Set(hrefs.filter((href) =>
    /^(?:javascript|data|vbscript):/i.test(href)
  ))];
  return {
    links: hrefs.length,
    anchors: anchorCounts.size,
    duplicateAnchors,
    unresolvedPlaceholders,
    missingAnchors,
    unsafe,
    valid: unresolvedPlaceholders.length === 0
      && missingAnchors.length === 0
      && duplicateAnchors.length === 0
      && unsafe.length === 0,
  };
}
