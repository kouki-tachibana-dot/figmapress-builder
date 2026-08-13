import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  buildWordPressSiteBridgeUrl,
  WORDPRESS_SITE_BRIDGE_FRAME_ID,
} from "../apps/web/src/lib/wordpress-site-bridge";

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

test("multi-page form embeds the target-origin WordPress bridge", () => {
  const component = readFileSync(
    new URL("../apps/web/src/components/converter-app.tsx", import.meta.url),
    "utf8",
  );
  const bridge = readFileSync(
    new URL("../apps/web/src/lib/wordpress-site-bridge.ts", import.meta.url),
    "utf8",
  );
  assert.equal(WORDPRESS_SITE_BRIDGE_FRAME_ID, "figmapress-site-bridge-frame");
  assert.match(component, /id=\{WORDPRESS_SITE_BRIDGE_FRAME_ID\}/);
  assert.match(component, /sandbox="allow-same-origin allow-scripts"/);
  assert.match(component, /title="WordPress安全接続"/);
  assert.match(bridge, /saveElementor<T>/);
  assert.match(bridge, /confirmElementor<T>/);
  assert.match(bridge, /localizeMedia<T>/);
  assert.match(bridge, /BRIDGE_ELEMENTOR_TIMEOUT_MS = 600_000/);
  assert.match(component, /siteBridge\.saveElementor<WordPressResult>/);
  assert.match(component, /ELEMENTOR_CONFIRMATION_RETRY_DELAYS_MS = \[0, 1_500, 4_000, 10_000, 20_000\]/);
  assert.match(component, /function confirmElementorAfterInterruptedSave<T>/);
  assert.match(component, /siteBridge\.confirmElementor<T>\(connectorToken, payload\)/);
  assert.match(component, /confirmElementorAfterInterruptedSave<WordPressResult>/);
  assert.match(component, /siteBridge\.localizeMedia<BrowserElementorMediaProgress>/);
});
