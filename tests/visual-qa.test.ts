import assert from "node:assert/strict";
import test from "node:test";
import { analyzeVisualPixels } from "../apps/web/src/lib/visual-qa.ts";

function solidPixels(
  width: number,
  height: number,
  red: number,
  green: number,
  blue: number,
): Uint8ClampedArray {
  const pixels = new Uint8ClampedArray(width * height * 4);
  for (let offset = 0; offset < pixels.length; offset += 4) {
    pixels[offset] = red;
    pixels[offset + 1] = green;
    pixels[offset + 2] = blue;
    pixels[offset + 3] = 255;
  }
  return pixels;
}

test("identical images receive a perfect visual QA score", () => {
  const reference = solidPixels(20, 20, 248, 248, 248);
  const analysis = analyzeVisualPixels(reference, reference.slice(), 20, 20);

  assert.equal(analysis.metrics.score, 100);
  assert.equal(analysis.metrics.status, "pass");
  assert.equal(analysis.metrics.changedPixelRatio, 0);
  assert.deepEqual(analysis.metrics.hotspots, []);
});

test("visual QA locates a concentrated difference near the page bottom", () => {
  const width = 20;
  const height = 100;
  const reference = solidPixels(width, height, 255, 255, 255);
  const target = reference.slice();
  for (let row = 90; row < height; row += 1) {
    for (let column = 0; column < width; column += 1) {
      const offset = (row * width + column) * 4;
      target[offset] = 0;
      target[offset + 1] = 0;
      target[offset + 2] = 0;
    }
  }

  const analysis = analyzeVisualPixels(reference, target, width, height);

  assert.equal(analysis.metrics.changedPixelRatio, 10);
  assert.equal(analysis.metrics.status, "review");
  assert.equal(analysis.metrics.hotspots[0]?.startPercent, 90);
  assert.match(analysis.metrics.hotspots[0]?.label ?? "", /下部/);
  assert.ok(analysis.metrics.brightnessDelta < 0);
});

test("visual QA rejects pixel buffers with mismatched dimensions", () => {
  assert.throws(
    () => analyzeVisualPixels(new Uint8ClampedArray(4), new Uint8ClampedArray(8), 1, 1),
    /寸法/,
  );
});

test("visual QA penalizes a page whose total height differs from Figma", () => {
  const reference = solidPixels(10, 100, 255, 255, 255);
  const analysis = analyzeVisualPixels(
    reference,
    reference.slice(),
    10,
    100,
    24,
    200,
  );

  assert.equal(analysis.metrics.heightDifferenceRatio, 100);
  assert.equal(analysis.metrics.generatedHeight, 200);
  assert.equal(analysis.metrics.status, "fail");
  assert.match(analysis.metrics.recommendations[0] ?? "", /長い/);
});
