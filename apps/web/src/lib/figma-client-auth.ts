export interface FigmaRequestAuthentication {
  mode: "pat" | "oauth" | "missing";
  credentials: { token?: string };
}

/**
 * A browser-local Personal Access Token always wins over OAuth. This lets the
 * converter run while a public OAuth app is awaiting Figma review, without
 * sharing or persisting a platform-wide token on the server.
 */
export function resolveFigmaRequestAuthentication(
  token: string,
  oauthConnected: boolean,
): FigmaRequestAuthentication {
  const normalizedToken = token.trim();
  if (normalizedToken) {
    return {
      mode: "pat",
      credentials: { token: normalizedToken },
    };
  }
  return {
    mode: oauthConnected ? "oauth" : "missing",
    credentials: {},
  };
}
