import assert from "node:assert/strict";
import test from "node:test";
import nextConfig from "../apps/web/next.config.ts";

test("the production CSP permits direct HTTPS WordPress connections", async () => {
  assert.equal(typeof nextConfig.headers, "function");
  const routes = await nextConfig.headers!();
  const contentSecurityPolicy = routes
    .flatMap((route) => route.headers)
    .find((header) => header.key === "Content-Security-Policy")?.value;

  assert.match(contentSecurityPolicy ?? "", /(?:^|; )connect-src 'self' https:(?:;|$)/);
  assert.match(contentSecurityPolicy ?? "", /(?:^|; )frame-src 'self' blob: https:(?:;|$)/);
});
