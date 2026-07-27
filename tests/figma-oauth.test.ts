import assert from "node:assert/strict";
import test from "node:test";
import {
  FIGMA_OAUTH_SCOPE,
  FIGMA_OAUTH_SESSION_COOKIE,
  createFigmaOAuthAuthorization,
  exchangeFigmaOAuthCode,
  figmaOAuthAuthorizationResponse,
  figmaOAuthConfiguration,
  figmaOAuthCookie,
  figmaOAuthRedirectUri,
  figmaOAuthStatus,
  readFigmaOAuthState,
  resolveFigmaOAuthAccess,
} from "../apps/web/src/lib/figma-oauth.ts";

const env = {
  FIGMA_OAUTH_CLIENT_ID: "client-id-123",
  FIGMA_OAUTH_CLIENT_SECRET: "client-secret-123",
  FIGMA_OAUTH_COOKIE_SECRET: "0123456789abcdef0123456789abcdef",
} satisfies NodeJS.ProcessEnv;

function configuration() {
  const config = figmaOAuthConfiguration(env);
  assert.ok(config);
  return config;
}

test("Figma OAuth requires complete server-side secrets", () => {
  assert.equal(figmaOAuthConfiguration({}), null);
  assert.equal(figmaOAuthConfiguration({
    ...env,
    FIGMA_OAUTH_COOKIE_SECRET: "too-short",
  }), null);
  assert.deepEqual(figmaOAuthConfiguration(env), {
    clientId: env.FIGMA_OAUTH_CLIENT_ID,
    clientSecret: env.FIGMA_OAUTH_CLIENT_SECRET,
    cookieSecret: env.FIGMA_OAUTH_COOKIE_SECRET,
  });
});

test("Figma OAuth authorization uses state, PKCE, and the minimum read scope", () => {
  const auth = createFigmaOAuthAuthorization(
    "https://figmapress-builder.vercel.app/api/figma/oauth/callback",
    configuration(),
  );
  const url = new URL(auth.authorizationUrl);
  assert.equal(url.origin, "https://www.figma.com");
  assert.equal(url.pathname, "/oauth");
  assert.equal(url.searchParams.get("client_id"), env.FIGMA_OAUTH_CLIENT_ID);
  assert.equal(url.searchParams.get("scope"), FIGMA_OAUTH_SCOPE);
  assert.equal(url.searchParams.get("response_type"), "code");
  assert.equal(url.searchParams.get("code_challenge_method"), "S256");
  assert.match(url.searchParams.get("code_challenge") ?? "", /^[A-Za-z0-9_-]{40,}$/);
  const state = url.searchParams.get("state") ?? "";
  const stored = readFigmaOAuthState(auth.stateCookie, state, configuration());
  assert.ok(stored);
  assert.equal(stored.redirectUri, "https://figmapress-builder.vercel.app/api/figma/oauth/callback");
  assert.equal(readFigmaOAuthState(auth.stateCookie, `${state}x`, configuration()), null);
  assert.equal(readFigmaOAuthState(`${auth.stateCookie}x`, state, configuration()), null);
});

test("Figma OAuth token exchange never exposes the token outside the encrypted cookie", async (context) => {
  const config = configuration();
  const auth = createFigmaOAuthAuthorization(
    "https://figmapress-builder.vercel.app/api/figma/oauth/callback",
    config,
  );
  const stateValue = new URL(auth.authorizationUrl).searchParams.get("state") ?? "";
  const state = readFigmaOAuthState(auth.stateCookie, stateValue, config);
  assert.ok(state);
  const requests: Array<{ url: string; authorization: string | null; body: string }> = [];
  context.mock.method(globalThis, "fetch", async (input, init) => {
    const headers = new Headers(init?.headers);
    requests.push({
      url: String(input),
      authorization: headers.get("Authorization"),
      body: String(init?.body ?? ""),
    });
    return Response.json({
      access_token: "figma-access-token-value",
      refresh_token: "figma-refresh-token-value",
      expires_in: 3600,
      user_id_string: "123",
    });
  });

  const sessionCookie = await exchangeFigmaOAuthCode(
    "short-lived-authorization-code",
    state,
    config,
  );
  assert.doesNotMatch(sessionCookie, /figma-access-token-value/);
  assert.equal(requests.length, 1);
  assert.equal(requests[0]?.url, "https://api.figma.com/v1/oauth/token");
  assert.match(requests[0]?.authorization ?? "", /^Basic /);
  assert.match(requests[0]?.body ?? "", /grant_type=authorization_code/);
  assert.match(requests[0]?.body ?? "", /code_verifier=/);

  const status = figmaOAuthStatus(sessionCookie, env);
  assert.equal(status.configured, true);
  assert.equal(status.connected, true);
  const access = await resolveFigmaOAuthAccess(sessionCookie, env);
  assert.equal(access?.accessToken, "figma-access-token-value");
  assert.equal(requests.length, 1);
});

test("Figma OAuth uses a fixed production callback and hardened cookies", () => {
  assert.equal(
    figmaOAuthRedirectUri(new URL("https://preview.example/api/figma/oauth/start"), env),
    "https://figmapress-builder.vercel.app/api/figma/oauth/callback",
  );
  assert.equal(
    figmaOAuthRedirectUri(new URL("http://localhost:3000/api/figma/oauth/start"), env),
    "http://localhost:3000/api/figma/oauth/callback",
  );
  const cookie = figmaOAuthCookie(
    FIGMA_OAUTH_SESSION_COOKIE,
    "encrypted",
    true,
  );
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /SameSite=Lax/);
  assert.match(cookie, /Secure/);
  assert.match(cookie, /Path=\//);
});

test("Figma OAuth start returns a mutable redirect response with the state cookie", () => {
  const response = figmaOAuthAuthorizationResponse(
    "https://www.figma.com/oauth?client_id=test",
    "encrypted-state",
    true,
  );
  assert.equal(response.status, 302);
  assert.equal(
    response.headers.get("Location"),
    "https://www.figma.com/oauth?client_id=test",
  );
  assert.match(
    response.headers.get("Set-Cookie") ?? "",
    /figmapress_figma_oauth_state=encrypted-state/,
  );
  assert.equal(response.headers.get("Cache-Control"), "no-store, max-age=0");
  assert.doesNotThrow(() => response.headers.set("X-Test", "mutable"));
});
