const EXACT_FIGMA_ASSET_HOSTS = new Set([
  "figma-alpha-api.s3.us-west-2.amazonaws.com",
]);
const ALLOWED_RASTER_CONTENT_TYPES = new Set([
  "image/avif",
  "image/gif",
  "image/jpeg",
  "image/png",
  "image/webp",
]);

function isFigmaDomain(hostname: string): boolean {
  return (
    hostname === "figma.com" ||
    hostname.endsWith(".figma.com") ||
    hostname === "figmausercontent.com" ||
    hostname.endsWith(".figmausercontent.com")
  );
}

export function safeFigmaAssetUrl(value: string): URL | null {
  if (!value || value.length > 8_000) return null;

  try {
    const url = new URL(value);
    const legacyFigmaS3 =
      (url.hostname === "s3-us-west-2.amazonaws.com" ||
        url.hostname === "s3.amazonaws.com") &&
      url.pathname.startsWith("/figma-alpha-api/");
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      (
        !isFigmaDomain(url.hostname) &&
        !EXACT_FIGMA_ASSET_HOSTS.has(url.hostname) &&
        !legacyFigmaS3
      )
    ) {
      return null;
    }
    return url;
  } catch {
    return null;
  }
}

export function isAllowedFigmaRasterContentType(value: string): boolean {
  return ALLOWED_RASTER_CONTENT_TYPES.has(
    value.split(";")[0]?.trim().toLowerCase() ?? "",
  );
}
