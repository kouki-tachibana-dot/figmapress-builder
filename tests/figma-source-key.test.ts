import assert from "node:assert/strict";
import test from "node:test";
import {
  figmaSiteSourceKey,
  figmaSourceKey,
} from "../apps/web/src/lib/figma-source-key";

const figmaUrl = "https://www.figma.com/design/PaNNOGcUo5Uyg5UrEsYeyd/site?node-id=0-1";

test("single-page source identity follows the selected Figma frame", () => {
  assert.equal(
    figmaSourceKey(figmaUrl, "80:1"),
    "figma:PaNNOGcUo5Uyg5UrEsYeyd:80:1",
  );
  assert.equal(
    figmaSourceKey(figmaUrl, "10:1"),
    "figma:PaNNOGcUo5Uyg5UrEsYeyd:10:1",
  );
});

test("multi-page site identity stays stable across preview selection and shared node URLs", () => {
  const contactUrl = "https://www.figma.com/design/PaNNOGcUo5Uyg5UrEsYeyd/site?node-id=80-1";
  assert.equal(
    figmaSiteSourceKey(figmaUrl),
    "figma:PaNNOGcUo5Uyg5UrEsYeyd:root",
  );
  assert.equal(figmaSiteSourceKey(contactUrl), figmaSiteSourceKey(figmaUrl));
  assert.equal(
    figmaSiteSourceKey("PaNNOGcUo5Uyg5UrEsYeyd"),
    "figma:PaNNOGcUo5Uyg5UrEsYeyd:root",
  );
});

test("non-Figma and malformed inputs never create WordPress source identities", () => {
  assert.equal(figmaSourceKey("https://example.com/design/abcdef"), undefined);
  assert.equal(figmaSiteSourceKey("bad"), undefined);
});
