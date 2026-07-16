import assert from "node:assert/strict";
import test from "node:test";
import mockFigma from "../examples/mock-figma.json";
import { convertFile } from "../apps/web/src/lib/converter.ts";
import type { MockFigmaFile } from "@figmapress/figma-parser";

test("mock Figma JSON converts into six Gutenberg blocks", async () => {
  const result = await convertFile(mockFigma as MockFigmaFile);

  assert.equal(result.summary.sectionCount, 6);
  assert.match(result.pageContent, /wp:figmapress\/hero .* \/-->/);
  assert.match(result.pageContent, /wp:figmapress\/contact .* \/-->/);
  assert.doesNotMatch(result.pageContent, /<section/);
  assert.match(result.previewHtml, /<section/);
  assert.doesNotMatch(result.pageContent, /section\/pricing/);
  assert.doesNotMatch(result.pageContent, /figma:\/\/image/);
  assert.ok(result.warnings.some((warning) => warning.includes("section/pricing")));
});

test("theme generation preserves tokens", async () => {
  const result = await convertFile(mockFigma as MockFigmaFile);
  assert.equal(result.themeJson.version, 2);
  assert.ok(result.themeJson.settings.color.palette.length >= 3);
  assert.ok(result.themeJson.settings.spacing.spacingSizes.length >= 3);
});
