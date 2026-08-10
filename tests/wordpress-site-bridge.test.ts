import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { buildWordPressSiteBridgeUrl } from "../apps/web/src/lib/wordpress-site-bridge";

test("WordPress site bridge stays on the configured target origin", () => {
  assert.equal(
    buildWordPressSiteBridgeUrl("https://wordpress.example"),
    "https://wordpress.example/?figmapress_bridge=1",
  );
  assert.equal(
    buildWordPressSiteBridgeUrl("https://wordpress.example/subdir?old=1#ignored"),
    "https://wordpress.example/subdir/?figmapress_bridge=1",
  );
});

test("WordPress site bridge rejects non-HTTPS target URLs before opening", () => {
  assert.throws(
    () => buildWordPressSiteBridgeUrl("http://wordpress.example"),
    /HTTPS URL/,
  );
});

test("multi-page form offers a user-initiated WordPress bridge launch", () => {
  const component = readFileSync(
    new URL("../apps/web/src/components/converter-app.tsx", import.meta.url),
    "utf8",
  );
  assert.match(component, /target="figmapress-site-bridge"/);
  assert.match(component, /rel="opener"/);
  assert.match(component, /WordPress安全接続を先に開く/);
});
