/** Return false when a computed CSS color cannot paint visible glyphs. */
export function cssColorIsPainted(value: string | undefined): boolean {
  const normalized = (value ?? "").trim().toLowerCase();
  if (!normalized || normalized === "currentcolor") return true;
  if (normalized === "transparent") return false;
  if (/^#[0-9a-f]{3}0$/.test(normalized)) return false;
  if (/^#[0-9a-f]{6}00$/.test(normalized)) return false;
  const legacyRgba = normalized.match(
    /^rgba?\((?:[^,]+,){3}\s*([0-9.]+)\s*\)$/,
  );
  if (legacyRgba) return Number.parseFloat(legacyRgba[1] ?? "1") > 0;
  const modernAlpha = normalized.match(/\/\s*([0-9.]+)%?\s*\)$/);
  if (!modernAlpha) return true;
  const alpha = Number.parseFloat(modernAlpha[1] ?? "1");
  return modernAlpha[0].includes("%") ? alpha > 0 : alpha > 0;
}
