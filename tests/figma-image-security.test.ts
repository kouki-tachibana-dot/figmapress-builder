import assert from "node:assert/strict";
import test from "node:test";
import {
  isAllowedFigmaRasterContentType,
  safeFigmaAssetUrl,
} from "../apps/web/src/lib/figma-image-security.ts";

test("Figma image proxy accepts only approved HTTPS asset hosts", () => {
  assert.equal(
    safeFigmaAssetUrl("https://s3-alpha-sig.figma.com/img/example.png")?.hostname,
    "s3-alpha-sig.figma.com",
  );
  assert.equal(
    safeFigmaAssetUrl("https://figma-alpha-api.s3.us-west-2.amazonaws.com/img/example.png")?.hostname,
    "figma-alpha-api.s3.us-west-2.amazonaws.com",
  );
  assert.equal(
    safeFigmaAssetUrl("https://s3-us-west-2.amazonaws.com/figma-alpha-api/img/example.png")?.hostname,
    "s3-us-west-2.amazonaws.com",
  );
  assert.equal(
    safeFigmaAssetUrl("https://s3-us-west-2.amazonaws.com/private-bucket/image.png"),
    null,
  );
  assert.equal(safeFigmaAssetUrl("http://s3-alpha-sig.figma.com/image.png"), null);
  assert.equal(safeFigmaAssetUrl("https://figma.com.evil.example/image.png"), null);
  assert.equal(safeFigmaAssetUrl("https://127.0.0.1/image.png"), null);
});

test("Figma image proxy rejects active SVG content", () => {
  assert.equal(isAllowedFigmaRasterContentType("image/png"), true);
  assert.equal(isAllowedFigmaRasterContentType("image/jpeg; charset=binary"), true);
  assert.equal(isAllowedFigmaRasterContentType("image/svg+xml"), false);
  assert.equal(isAllowedFigmaRasterContentType("text/html"), false);
});
