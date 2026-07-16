import type { Tokens } from "@figmapress/blueprint";

/**
 * theme.json shape — we emit a minimal subset covering color palette,
 * font families and spacing sizes (spec §13). The block theme can extend
 * this file by hand later; this generator never overwrites unrelated keys
 * because it always writes a fresh document.
 */
export interface ThemeJson {
  $schema: string;
  version: number;
  settings: {
    color: {
      palette: Array<{ name: string; slug: string; color: string }>;
    };
    typography: {
      fontFamilies: Array<{
        name: string;
        slug: string;
        fontFamily: string;
      }>;
    };
    spacing: {
      spacingSizes: Array<{ name: string; slug: string; size: string }>;
    };
  };
  styles?: {
    typography?: {
      fontFamily?: string;
      fontSize?: string;
    };
  };
}

export const DEFAULT_TOKENS: Tokens = {
  colors: [
    { name: "Primary", slug: "primary", value: "#2D5BFF" },
    { name: "Text", slug: "text", value: "#1A1A1A" },
    { name: "Background", slug: "background", value: "#FFFFFF" },
  ],
  typography: [
    {
      name: "Body",
      slug: "body",
      fontFamily: "system-ui, sans-serif",
      fontSize: "16px",
      fontWeight: 400,
    },
  ],
  spacing: [
    { name: "S", slug: "s", size: "16px" },
    { name: "M", slug: "m", size: "24px" },
    { name: "L", slug: "l", size: "40px" },
  ],
};

export function tokensToThemeJson(tokens: Tokens): ThemeJson {
  const safeTokens: Tokens = {
    colors: tokens.colors.length ? tokens.colors : DEFAULT_TOKENS.colors,
    typography: tokens.typography.length
      ? tokens.typography
      : DEFAULT_TOKENS.typography,
    spacing: tokens.spacing.length ? tokens.spacing : DEFAULT_TOKENS.spacing,
  };

  const body = safeTokens.typography.find((t) => t.slug === "body") ?? safeTokens.typography[0];

  return {
    $schema: "https://schemas.wp.org/trunk/theme.json",
    version: 2,
    settings: {
      color: {
        palette: safeTokens.colors.map((c) => ({
          name: c.name,
          slug: c.slug,
          color: c.value,
        })),
      },
      typography: {
        fontFamilies: safeTokens.typography.map((t) => ({
          name: t.name,
          slug: t.slug,
          fontFamily: t.fontFamily,
        })),
      },
      spacing: {
        spacingSizes: safeTokens.spacing.map((s) => ({
          name: s.name,
          slug: s.slug,
          size: s.size,
        })),
      },
    },
    styles: body
      ? {
          typography: {
            fontFamily: `var(--wp--preset--font-family--${body.slug})`,
            fontSize: body.fontSize,
          },
        }
      : undefined,
  };
}
