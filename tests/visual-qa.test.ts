import assert from "node:assert/strict";
import test from "node:test";
import {
  analyzeVisualRegions,
  analyzeVisualPixels,
  resolveVisualQaDraftGate,
} from "../apps/web/src/lib/visual-qa.ts";

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

function patternedPixels(width: number, height: number): Uint8ClampedArray {
  const pixels = solidPixels(width, height, 247, 247, 243);
  for (let row = 8; row < height - 8; row += 1) {
    for (let column = 8; column < width - 8; column += 1) {
      if (
        (column >= 12 && column < 24 && row >= 10 && row < 35) ||
        (column >= 29 && column < 52 && row >= 21 && row < 31) ||
        ((column + row) % 13 === 0)
      ) {
        const offset = (row * width + column) * 4;
        pixels[offset] = (column * 17) % 210;
        pixels[offset + 1] = (row * 11) % 190;
        pixels[offset + 2] = 70;
      }
    }
  }
  return pixels;
}

function translatePixels(
  source: Uint8ClampedArray,
  width: number,
  height: number,
  offsetX: number,
  offsetY: number,
): Uint8ClampedArray {
  const target = solidPixels(width, height, 247, 247, 243);
  for (let row = 0; row < height; row += 1) {
    for (let column = 0; column < width; column += 1) {
      const targetX = column + offsetX;
      const targetY = row + offsetY;
      if (targetX < 0 || targetX >= width || targetY < 0 || targetY >= height) {
        continue;
      }
      const sourceOffset = (row * width + column) * 4;
      const targetOffset = (targetY * width + targetX) * 4;
      target.set(source.subarray(sourceOffset, sourceOffset + 4), targetOffset);
    }
  }
  return target;
}

test("identical images receive a perfect visual QA score", () => {
  const reference = solidPixels(20, 20, 248, 248, 248);
  const analysis = analyzeVisualPixels(reference, reference.slice(), 20, 20);

  assert.equal(analysis.metrics.score, 100);
  assert.equal(analysis.metrics.status, "pass");
  assert.equal(analysis.metrics.changedPixelRatio, 0);
  assert.deepEqual(analysis.metrics.hotspots, []);
  assert.equal(analysis.metrics.alignment.safeToApply, false);
  assert.match(analysis.metrics.alignment.reason, /検出されません/);
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

test("visual QA ranks named sections and text boxes by page impact", () => {
  const width = 20;
  const height = 100;
  const reference = solidPixels(width, height, 255, 255, 255);
  const target = reference.slice();
  for (let row = 80; row < height; row += 1) {
    for (let column = 0; column < width; column += 1) {
      const offset = (row * width + column) * 4;
      target[offset] = 0;
      target[offset + 1] = 0;
      target[offset + 2] = 0;
    }
  }

  const regions = analyzeVisualRegions(
    reference,
    target,
    width,
    height,
    [
      { nodeId: "hero", name: "FV/Hero Sec", x: 0, y: 0, width: 20, height: 50 },
      { nodeId: "footer", name: "Footer/Footer Sec", x: 0, y: 75, width: 20, height: 25 },
      { nodeId: "footer-copy", name: "Footer message", x: 2, y: 80, width: 16, height: 10 },
    ],
  );

  assert.equal(regions[0]?.nodeId, "footer");
  assert.equal(regions[0]?.changedPixelRatio, 80);
  assert.equal(regions[0]?.impactRatio, 20);
  assert.equal(regions.at(-1)?.nodeId, "hero");
  assert.equal(regions.at(-1)?.impactRatio, 0);
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

test("visual QA detects a safe whole-page alignment correction", () => {
  const width = 72;
  const height = 64;
  const reference = patternedPixels(width, height);
  const target = translatePixels(reference, width, height, 5, -3);
  const analysis = analyzeVisualPixels(reference, target, width, height);

  assert.equal(analysis.metrics.alignment.offsetX, -5);
  assert.equal(analysis.metrics.alignment.offsetY, 3);
  assert.equal(analysis.metrics.alignment.safeToApply, true);
  assert.notEqual(analysis.metrics.alignment.confidence, "low");
  assert.ok(analysis.metrics.alignment.errorReductionRatio >= 10);
});

test("height mismatch prevents a misleading whole-page correction", () => {
  const width = 72;
  const height = 64;
  const reference = patternedPixels(width, height);
  const target = translatePixels(reference, width, height, 4, 2);
  const analysis = analyzeVisualPixels(
    reference,
    target,
    width,
    height,
    24,
    height * 1.2,
  );

  assert.equal(analysis.metrics.alignment.safeToApply, false);
  assert.equal(analysis.metrics.alignment.confidence, "low");
  assert.match(analysis.metrics.alignment.reason, /高さ/);
});

test("Elementor visual QA gate blocks only incomplete or unacknowledged failures", () => {
  const pending = resolveVisualQaDraftGate({
    enabled: true,
    referenceCount: 2,
    resultStatuses: ["pass"],
    busy: false,
    error: false,
    acknowledged: false,
  });
  assert.deepEqual(
    { state: pending.state, blocksDraft: pending.blocksDraft },
    { state: "pending", blocksDraft: true },
  );

  const failed = resolveVisualQaDraftGate({
    enabled: true,
    referenceCount: 2,
    resultStatuses: ["pass", "fail"],
    busy: false,
    error: false,
    acknowledged: false,
  });
  assert.deepEqual(
    { state: failed.state, blocksDraft: failed.blocksDraft },
    { state: "warning", blocksDraft: true },
  );

  const acknowledged = resolveVisualQaDraftGate({
    enabled: true,
    referenceCount: 2,
    resultStatuses: ["pass", "fail"],
    busy: false,
    error: false,
    acknowledged: true,
  });
  assert.equal(acknowledged.blocksDraft, false);

  const gutenberg = resolveVisualQaDraftGate({
    enabled: false,
    referenceCount: 2,
    resultStatuses: [],
    busy: false,
    error: false,
    acknowledged: false,
  });
  assert.deepEqual(
    { state: gutenberg.state, blocksDraft: gutenberg.blocksDraft },
    { state: "off", blocksDraft: false },
  );
});
