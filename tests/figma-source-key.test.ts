import assert from "node:assert/strict";
import test from "node:test";
import {
  figmaFrameId,
  figmaReviewSourceKey,
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

test("focused Figma URLs expose the frame used by preflight and site saving", () => {
  assert.equal(
    figmaFrameId("https://www.figma.com/design/PaNNOGcUo5Uyg5UrEsYeyd/site?node-id=192-176"),
    "192:176",
  );
  assert.equal(
    figmaFrameId("https://www.figma.com/design/PaNNOGcUo5Uyg5UrEsYeyd/site"),
    undefined,
  );
});

test("review drafts get an isolated, retry-stable source identity", () => {
  const sourceKey = figmaSourceKey(figmaUrl, "192:657");
  assert.equal(
    figmaReviewSourceKey(sourceKey, "01234567-89ab-cdef-0123-456789abcdef"),
    "figma:PaNNOGcUo5Uyg5UrEsYeyd:192:657:page:review-0123456789abcdef",
  );
  assert.equal(
    figmaReviewSourceKey(sourceKey, "01234567-89ab-cdef-0123-456789abcdef"),
    figmaReviewSourceKey(sourceKey, "01234567-89ab-cdef-0123-456789abcdef"),
  );
  assert.equal(figmaReviewSourceKey("unsafe", "0123456789abcdef"), undefined);
});

test("non-Figma and malformed inputs never create WordPress source identities", () => {
  assert.equal(figmaSourceKey("https://example.com/design/abcdef"), undefined);
  assert.equal(figmaSiteSourceKey("bad"), undefined);
});
