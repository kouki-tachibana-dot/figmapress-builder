import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";

export const FIGMA_OAUTH_STATE_COOKIE = "figmapress_figma_oauth_state";
export const FIGMA_OAUTH_SESSION_COOKIE = "figmapress_figma_oauth_session";
export const FIGMA_OAUTH_SCOPE = "file_content:read";

const STATE_MAX_AGE_SECONDS = 10 * 60;
const SESSION_MAX_AGE_SECONDS = 180 * 24 * 60 * 60;
const TOKEN_REFRESH_WINDOW_MS = 5 * 60 * 1_000;

interface FigmaOAuthConfiguration {
  clientId: string;
  clientSecret: string;
  cookieSecret: string;
}

interface FigmaOAuthState {
  state: string;
  verifier: string;
  redirectUri: string;
  createdAt: number;
}

interface FigmaOAuthSession {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  userId: string;
}

interface FigmaTokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  user_id_string?: string;
}

export interface FigmaOAuthAccess {
  accessToken: string;
  expiresAt: number;
  refreshedCookie?: string;
}

export interface FigmaOAuthStatus {
  configured: boolean;
  connected: boolean;
  expiresAt?: number;
}

function base64Url(value: Buffer): string {
  return value.toString("base64url");
}

function encryptionKey(secret: string): Buffer {
  return createHash("sha256").update(secret, "utf8").digest();
}

function seal(value: unknown, secret: string): string {
  const initializationVector = randomBytes(12);
  const cipher = createCipheriv(
    "aes-256-gcm",
    encryptionKey(secret),
    initializationVector,
  );
  const encrypted = Buffer.concat([
    cipher.update(JSON.stringify(value), "utf8"),
    cipher.final(),
  ]);
  return [
    "v1",
    base64Url(initializationVector),
    base64Url(cipher.getAuthTag()),
    base64Url(encrypted),
  ].join(".");
}

function unseal<T>(value: string, secret: string): T | null {
  const [version, rawIv, rawTag, rawEncrypted] = value.split(".");
  if (
    version !== "v1"
    || !rawIv
    || !rawTag
    || !rawEncrypted
  ) {
    return null;
  }
  try {
    const decipher = createDecipheriv(
      "aes-256-gcm",
      encryptionKey(secret),
      Buffer.from(rawIv, "base64url"),
    );
    decipher.setAuthTag(Buffer.from(rawTag, "base64url"));
    const decrypted = Buffer.concat([
      decipher.update(Buffer.from(rawEncrypted, "base64url")),
      decipher.final(),
    ]);
    return JSON.parse(decrypted.toString("utf8")) as T;
  } catch {
    return null;
  }
}

function validConfigurationValue(value: string | undefined): value is string {
  return typeof value === "string" && value.trim().length >= 8;
}

export function figmaOAuthConfiguration(
  env: NodeJS.ProcessEnv = process.env,
): FigmaOAuthConfiguration | null {
  if (
    !validConfigurationValue(env.FIGMA_OAUTH_CLIENT_ID)
    || !validConfigurationValue(env.FIGMA_OAUTH_CLIENT_SECRET)
    || !validConfigurationValue(env.FIGMA_OAUTH_COOKIE_SECRET)
    || env.FIGMA_OAUTH_COOKIE_SECRET.trim().length < 32
  ) {
    return null;
  }
  return {
    clientId: env.FIGMA_OAUTH_CLIENT_ID.trim(),
    clientSecret: env.FIGMA_OAUTH_CLIENT_SECRET.trim(),
    cookieSecret: env.FIGMA_OAUTH_COOKIE_SECRET.trim(),
  };
}

export function figmaOAuthRedirectUri(
  requestUrl: URL,
  env: NodeJS.ProcessEnv = process.env,
): string {
  const configured = env.FIGMA_OAUTH_REDIRECT_URI?.trim();
  if (configured) return configured;
  if (
    requestUrl.hostname === "localhost"
    || requestUrl.hostname === "127.0.0.1"
  ) {
    return `${requestUrl.origin}/api/figma/oauth/callback`;
  }
  return "https://figmapress-builder.vercel.app/api/figma/oauth/callback";
}

export function createFigmaOAuthAuthorization(
  redirectUri: string,
  configuration: FigmaOAuthConfiguration,
): { authorizationUrl: string; stateCookie: string } {
  const state = base64Url(randomBytes(24));
  const verifier = base64Url(randomBytes(48));
  const challenge = base64Url(
    createHash("sha256").update(verifier, "ascii").digest(),
  );
  const payload: FigmaOAuthState = {
    state,
    verifier,
    redirectUri,
    createdAt: Date.now(),
  };
  const url = new URL("https://www.figma.com/oauth");
  url.searchParams.set("client_id", configuration.clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("scope", FIGMA_OAUTH_SCOPE);
  url.searchParams.set("state", state);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("code_challenge", challenge);
  url.searchParams.set("code_challenge_method", "S256");
  return {
    authorizationUrl: url.toString(),
    stateCookie: seal(payload, configuration.cookieSecret),
  };
}

export function readFigmaOAuthState(
  cookieValue: string | undefined,
  returnedState: string,
  configuration: FigmaOAuthConfiguration,
): FigmaOAuthState | null {
  if (!cookieValue || !returnedState) return null;
  const payload = unseal<FigmaOAuthState>(
    cookieValue,
    configuration.cookieSecret,
  );
  if (
    !payload
    || payload.state !== returnedState
    || !payload.verifier
    || !payload.redirectUri
    || !Number.isFinite(payload.createdAt)
    || Date.now() - payload.createdAt > STATE_MAX_AGE_SECONDS * 1_000
  ) {
    return null;
  }
  return payload;
}

function basicAuthorization(configuration: FigmaOAuthConfiguration): string {
  return `Basic ${Buffer.from(
    `${configuration.clientId}:${configuration.clientSecret}`,
    "utf8",
  ).toString("base64")}`;
}

async function tokenRequest(
  body: URLSearchParams,
  configuration: FigmaOAuthConfiguration,
): Promise<FigmaTokenResponse> {
  const response = await fetch("https://api.figma.com/v1/oauth/token", {
    method: "POST",
    headers: {
      Accept: "application/json",
      Authorization: basicAuthorization(configuration),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
    cache: "no-store",
    redirect: "error",
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) {
    throw new Error(`Figma OAuth token exchange failed (${response.status}).`);
  }
  const parsed = await response.json() as Partial<FigmaTokenResponse>;
  if (
    typeof parsed.access_token !== "string"
    || parsed.access_token.length < 10
    || typeof parsed.expires_in !== "number"
    || !Number.isFinite(parsed.expires_in)
    || parsed.expires_in <= 0
  ) {
    throw new Error("Figma OAuth returned an invalid token response.");
  }
  return parsed as FigmaTokenResponse;
}

export async function exchangeFigmaOAuthCode(
  code: string,
  state: FigmaOAuthState,
  configuration: FigmaOAuthConfiguration,
): Promise<string> {
  const token = await tokenRequest(
    new URLSearchParams({
      redirect_uri: state.redirectUri,
      code,
      grant_type: "authorization_code",
      code_verifier: state.verifier,
    }),
    configuration,
  );
  if (!token.refresh_token) {
    throw new Error("Figma OAuth did not return a refresh token.");
  }
  const session: FigmaOAuthSession = {
    accessToken: token.access_token,
    refreshToken: token.refresh_token,
    expiresAt: Date.now() + token.expires_in * 1_000,
    userId: token.user_id_string ?? "",
  };
  return seal(session, configuration.cookieSecret);
}

async function refreshFigmaOAuthSession(
  session: FigmaOAuthSession,
  configuration: FigmaOAuthConfiguration,
): Promise<FigmaOAuthSession> {
  const token = await tokenRequest(
    new URLSearchParams({
      refresh_token: session.refreshToken,
      grant_type: "refresh_token",
    }),
    configuration,
  );
  return {
    accessToken: token.access_token,
    refreshToken: token.refresh_token ?? session.refreshToken,
    expiresAt: Date.now() + token.expires_in * 1_000,
    userId: token.user_id_string ?? session.userId,
  };
}

function validSession(
  cookieValue: string | undefined,
  configuration: FigmaOAuthConfiguration,
): FigmaOAuthSession | null {
  if (!cookieValue) return null;
  const session = unseal<FigmaOAuthSession>(
    cookieValue,
    configuration.cookieSecret,
  );
  if (
    !session
    || typeof session.accessToken !== "string"
    || session.accessToken.length < 10
    || typeof session.refreshToken !== "string"
    || session.refreshToken.length < 10
    || !Number.isFinite(session.expiresAt)
  ) {
    return null;
  }
  return session;
}

export function figmaOAuthStatus(
  cookieValue: string | undefined,
  env: NodeJS.ProcessEnv = process.env,
): FigmaOAuthStatus {
  const configuration = figmaOAuthConfiguration(env);
  if (!configuration) return { configured: false, connected: false };
  const session = validSession(cookieValue, configuration);
  return session
    ? {
        configured: true,
        // The short-lived access token can be refreshed with the encrypted
        // refresh token. The browser remains connected until refresh fails or
        // the HttpOnly session cookie is cleared.
        connected: true,
        expiresAt: session.expiresAt,
      }
    : { configured: true, connected: false };
}

export async function resolveFigmaOAuthAccess(
  cookieValue: string | undefined,
  env: NodeJS.ProcessEnv = process.env,
): Promise<FigmaOAuthAccess | null> {
  const configuration = figmaOAuthConfiguration(env);
  if (!configuration) return null;
  const session = validSession(cookieValue, configuration);
  if (!session) return null;
  if (session.expiresAt > Date.now() + TOKEN_REFRESH_WINDOW_MS) {
    return {
      accessToken: session.accessToken,
      expiresAt: session.expiresAt,
    };
  }
  const refreshed = await refreshFigmaOAuthSession(session, configuration);
  return {
    accessToken: refreshed.accessToken,
    expiresAt: refreshed.expiresAt,
    refreshedCookie: seal(refreshed, configuration.cookieSecret),
  };
}

export function figmaOAuthCookie(
  name: string,
  value: string,
  secure: boolean,
  maxAge = SESSION_MAX_AGE_SECONDS,
): string {
  return [
    `${name}=${encodeURIComponent(value)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    secure ? "Secure" : "",
    `Max-Age=${Math.max(0, Math.round(maxAge))}`,
  ].filter(Boolean).join("; ");
}

export function figmaOAuthStateCookie(
  value: string,
  secure: boolean,
): string {
  return figmaOAuthCookie(
    FIGMA_OAUTH_STATE_COOKIE,
    value,
    secure,
    STATE_MAX_AGE_SECONDS,
  );
}

export function figmaOAuthAuthorizationResponse(
  authorizationUrl: string,
  stateCookie: string,
  secure: boolean,
): Response {
  return new Response(null, {
    status: 302,
    headers: {
      "Cache-Control": "no-store, max-age=0",
      Location: authorizationUrl,
      "Set-Cookie": figmaOAuthStateCookie(stateCookie, secure),
    },
  });
}

export function clearFigmaOAuthCookie(
  name: string,
  secure: boolean,
): string {
  return figmaOAuthCookie(name, "", secure, 0);
}
