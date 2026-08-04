import assert from "node:assert/strict";
import test from "node:test";
import { resolveFigmaRequestAuthentication } from "../apps/web/src/lib/figma-client-auth.ts";

test("browser-local PAT takes precedence over a connected OAuth session", () => {
  assert.deepEqual(
    resolveFigmaRequestAuthentication("  figd_local_token  ", true),
    {
      mode: "pat",
      credentials: { token: "figd_local_token" },
    },
  );
});

test("OAuth remains an optional fallback when no PAT is present", () => {
  assert.deepEqual(resolveFigmaRequestAuthentication("", true), {
    mode: "oauth",
    credentials: {},
  });
  assert.deepEqual(resolveFigmaRequestAuthentication("  ", false), {
    mode: "missing",
    credentials: {},
  });
});
