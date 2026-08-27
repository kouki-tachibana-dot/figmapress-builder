import assert from "node:assert/strict";
import test from "node:test";
import { normalizeSlug } from "@figmapress/wp-connector";
import {
  effectiveFigmaFrameId,
  extractFigmaFileKey,
  extractFigmaReference,
} from "../apps/web/src/lib/figma-api.ts";
import { isPrivateOrReservedIp } from "../apps/web/src/lib/request-security.ts";

test("Figma file keys are parsed from supported URLs", () => {
  assert.equal(
    extractFigmaFileKey("https://www.figma.com/design/AbCdEf123456/Sample?node-id=1-2"),
    "AbCdEf123456",
  );
  assert.equal(extractFigmaFileKey("AbCdEf123456"), "AbCdEf123456");
  assert.throws(() => extractFigmaFileKey("https://example.com/design/AbCdEf123456"));
  assert.deepEqual(
    extractFigmaReference("https://www.figma.com/design/AbCdEf123456/Sample?node-id=123-456"),
    { fileKey: "AbCdEf123456", nodeId: "123:456" },
  );
});

test("node-specific Figma URLs retain their frame selection for site planning", () => {
  const url = "https://www.figma.com/design/AbCdEf123456/Sample?node-id=192-176";
  assert.equal(effectiveFigmaFrameId(url), "192:176");
  assert.equal(effectiveFigmaFrameId(url, "402:14"), "402:14");
});

test("private and reserved network destinations are rejected", () => {
  for (const address of [
    "127.0.0.1",
    "10.0.0.1",
    "172.16.2.3",
    "192.168.1.10",
    "169.254.169.254",
    "::1",
    "fd00::1",
  ]) {
    assert.equal(isPrivateOrReservedIp(address), true, address);
  }
  assert.equal(isPrivateOrReservedIp("8.8.8.8"), false);
  assert.equal(isPrivateOrReservedIp("1.1.1.1"), false);
});

test("WordPress slugs are normalized safely", () => {
  assert.equal(normalizeSlug("/"), "home");
  assert.equal(normalizeSlug("/campaign/summer/"), "campaign-summer");
});
