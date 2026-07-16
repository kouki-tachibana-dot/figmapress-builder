/**
 * HTML-escape for visible block-inner content (the part the front-end
 * eventually renders). Used inside <h1>, <p>, <button> bodies and similar.
 */
export function escapeHtml(value: string | undefined | null): string {
  if (value == null) return "";
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Encode for HTML attribute values (URLs, alt text, etc.).
 */
export function escapeAttr(value: string | undefined | null): string {
  if (value == null) return "";
  return String(value).replace(/&/g, "&amp;").replace(/"/g, "&quot;");
}
