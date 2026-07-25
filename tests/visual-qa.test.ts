import assert from "node:assert/strict";
import test from "node:test";
import {
  analyzeVisualRegions,
  analyzeVisualPixels,
  estimateVisualGeometry,
  resolveVisualQaDraftGate,
  shouldKeepSectionVisualCorrections,
  shouldKeepTextGeometryCorrections,
  shouldKeepVisualCorrections,
} from "../apps/web/src/lib/visual-qa.ts";
import {
  applyElementorSectionVisualCorrections,
  applyElementorTextGeometryCorrections,
  applyElementorVisualCorrections,
  applyPreviewSectionVisualCorrections,
  applyPreviewTextGeometryCorrections,
  applyPreviewVisualCorrections,
  normalizeElementorVisualCorrections,
  normalizeElementorSectionVisualCorrections,
  normalizeElementorTextGeometryCorrections,
  type ElementorTemplate,
} from "@figmapress/elementor-renderer";

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

function translatePixelRegion(
  source: Uint8ClampedArray,
  width: number,
  height: number,
  regionY: number,
  regionHeight: number,
  offsetX: number,
  offsetY: number,
): Uint8ClampedArray {
  const target = source.slice();
  for (let row = regionY; row < regionY + regionHeight; row += 1) {
    for (let column = 0; column < width; column += 1) {
      const offset = (row * width + column) * 4;
      target[offset] = 247;
      target[offset + 1] = 247;
      target[offset + 2] = 243;
      target[offset + 3] = 255;
    }
  }
  for (let row = regionY; row < regionY + regionHeight; row += 1) {
    for (let column = 0; column < width; column += 1) {
      const targetX = column + offsetX;
      const targetY = row + offsetY;
      if (
        targetX < 0
        || targetX >= width
        || targetY < regionY
        || targetY >= regionY + regionHeight
        || targetY >= height
      ) {
        continue;
      }
      const sourceOffset = (row * width + column) * 4;
      target.set(
        source.subarray(sourceOffset, sourceOffset + 4),
        (targetY * width + targetX) * 4,
      );
    }
  }
  return target;
}

function transformPixels(
  source: Uint8ClampedArray,
  width: number,
  height: number,
  scaleX: number,
  scaleY: number,
  offsetX: number,
  offsetY: number,
): Uint8ClampedArray {
  const target = solidPixels(width, height, 247, 247, 243);
  const centerX = (width - 1) / 2;
  const centerY = (height - 1) / 2;
  for (let row = 0; row < height; row += 1) {
    for (let column = 0; column < width; column += 1) {
      const sourceX = Math.round(
        centerX + (column - centerX - offsetX) / scaleX,
      );
      const sourceY = Math.round(
        centerY + (row - centerY - offsetY) / scaleY,
      );
      if (
        sourceX < 0
        || sourceX >= width
        || sourceY < 0
        || sourceY >= height
      ) {
        continue;
      }
      const sourceOffset = (sourceY * width + sourceX) * 4;
      const targetOffset = (row * width + column) * 4;
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

test("visual QA isolates a safe alignment correction to one shifted section", () => {
  const width = 120;
  const height = 160;
  const reference = patternedPixels(width, height);
  const target = translatePixelRegion(reference, width, height, 80, 80, 4, -3);
  const regions = analyzeVisualRegions(
    reference,
    target,
    width,
    height,
    [
      { nodeId: "top", name: "Top", x: 0, y: 0, width, height: 80 },
      { nodeId: "bottom", name: "Bottom", x: 0, y: 80, width, height: 80 },
    ],
    24,
    8,
  );

  const top = regions.find((region) => region.nodeId === "top");
  const bottom = regions.find((region) => region.nodeId === "bottom");
  assert.equal(top?.alignment, undefined);
  assert.equal(bottom?.alignment?.offsetX, -4);
  assert.equal(bottom?.alignment?.offsetY, 3);
  assert.equal(bottom?.alignment?.safeToApply, true);
});

test("visual QA estimates a bounded inverse transform for a shifted text region", () => {
  const width = 160;
  const height = 80;
  const reference = patternedPixels(width, height);
  const target = transformPixels(reference, width, height, 0.97, 1.02, 2, -2);
  const geometry = estimateVisualGeometry(reference, target, width, height);

  assert.equal(geometry.safeToApply, true);
  assert.notEqual(geometry.confidence, "low");
  assert.ok(Math.abs(geometry.scaleX - (1 / 0.97)) <= 0.011);
  assert.ok(Math.abs(geometry.scaleY - (1 / 1.02)) <= 0.011);
  assert.ok(geometry.errorReductionRatio >= 18);
});

test("visual QA can measure a wide single-line text box", () => {
  const width = 360;
  const height = 40;
  const reference = patternedPixels(width, height);
  const target = transformPixels(reference, width, height, 0.98, 1.01, 2, -1);
  const geometry = estimateVisualGeometry(reference, target, width, height);

  assert.equal(geometry.safeToApply, true);
  assert.ok(Math.abs(geometry.scaleX - (1 / 0.98)) <= 0.011);
  assert.ok(geometry.errorReductionRatio >= 18);
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

test("safe visual corrections become viewport-scaled Elementor transforms", () => {
  const template: ElementorTemplate = {
    title: "Responsive page",
    type: "page",
    version: "0.4",
    page_settings: {},
    content: [
      {
        id: "desktop",
        elType: "container",
        isInner: false,
        settings: {
          css_classes: "figmapress-layout figmapress-layout--desktop",
        },
        elements: [
          {
            id: "hero",
            elType: "container",
            isInner: true,
            settings: { figmapress_node_id: "10:hero" },
            elements: [],
          },
        ],
      },
      {
        id: "mobile",
        elType: "container",
        isInner: false,
        settings: {
          css_classes: "figmapress-layout figmapress-layout--mobile",
        },
        elements: [
          {
            id: "mobile-hero",
            elType: "container",
            isInner: true,
            settings: { figmapress_node_id: "20:hero" },
            elements: [],
          },
        ],
      },
    ],
  };
  const corrections = [
    {
      variant: "desktop" as const,
      offsetX: -5,
      offsetY: 3,
      captureWidth: 800,
      confidence: "high" as const,
      errorReductionRatio: 26.4,
    },
    {
      variant: "mobile" as const,
      offsetX: 2,
      offsetY: -4,
      captureWidth: 400,
      confidence: "medium" as const,
      errorReductionRatio: 14,
    },
  ];

  const corrected = applyElementorVisualCorrections(template, corrections);
  assert.notEqual(corrected, template);
  assert.equal(
    corrected.content[0]?.elements[0]?.settings._transform_translate_popover,
    "transform",
  );
  assert.deepEqual(
    corrected.content[0]?.elements[0]?.settings._transform_translateX_effect,
    { unit: "custom", size: "-0.625vw", sizes: [] },
  );
  assert.deepEqual(
    corrected.content[0]?.elements[0]?.settings._transform_translateY_effect,
    { unit: "custom", size: "0.375vw", sizes: [] },
  );
  assert.deepEqual(
    corrected.content[1]?.elements[0]?.settings._transform_translateY_effect,
    { unit: "custom", size: "-1vw", sizes: [] },
  );
  assert.equal(
    (
      corrected.page_settings.figmapress_visual_corrections as Array<{
        variant: string;
      }>
    )[1]?.variant,
    "mobile",
  );

  const preview = applyPreviewVisualCorrections(
    '<div class="figmapress-figma-preview" data-figmapress-layout="desktop"></div>',
    corrections,
  );
  assert.match(preview, /data-figmapress-visual-corrections/);
  assert.match(preview, /--figmapress-qa-global-transform:translate\(-0\.625vw,0\.375vw\)!important/);
  assert.match(preview, /data-figmapress-layout="mobile"/);

  const sectionCorrection = [{
    variant: "desktop" as const,
    nodeId: "10:hero",
    nodeName: "Hero",
    offsetX: 2,
    offsetY: -1,
    captureWidth: 800,
    confidence: "high" as const,
    errorReductionRatio: 22,
  }];
  const sectionCorrected = applyElementorSectionVisualCorrections(
    corrected,
    sectionCorrection,
  );
  assert.deepEqual(
    sectionCorrected.content[0]?.elements[0]?.settings._transform_translateX_effect,
    { unit: "custom", size: "-0.375vw", sizes: [] },
  );
  assert.deepEqual(
    sectionCorrected.content[0]?.elements[0]?.settings._transform_translateY_effect,
    { unit: "custom", size: "0.25vw", sizes: [] },
  );
  assert.deepEqual(
    sectionCorrected.content[1]?.elements[0]?.settings._transform_translateY_effect,
    { unit: "custom", size: "-1vw", sizes: [] },
  );

  const sectionPreview = applyPreviewSectionVisualCorrections(
    preview,
    sectionCorrection,
  );
  assert.match(sectionPreview, /data-figmapress-section-visual-corrections/);
  assert.match(sectionPreview, /data-figmapress-node-id="10:hero"/);
  assert.match(sectionPreview, /--figmapress-qa-local-transform:translate\(0\.25vw,-0\.125vw\)!important/);

  const secondGlobal = applyElementorVisualCorrections(sectionCorrected, [{
    variant: "desktop",
    offsetX: 2,
    offsetY: -1,
    captureWidth: 800,
    confidence: "high",
    errorReductionRatio: 20,
  }]);
  assert.deepEqual(
    secondGlobal.content[0]?.elements[0]?.settings._transform_translateX_effect,
    { unit: "custom", size: "-0.125vw", sizes: [] },
  );
  assert.deepEqual(
    secondGlobal.content[0]?.elements[0]?.settings._transform_translateY_effect,
    { unit: "custom", size: "0.125vw", sizes: [] },
  );

  const runtimePreview = applyPreviewVisualCorrections(
    sectionPreview,
    [{
      variant: "desktop",
      offsetX: 2,
      offsetY: -1,
      captureWidth: 800,
      confidence: "high",
      errorReductionRatio: 20,
    }],
    "runtime",
  );
  assert.match(
    runtimePreview,
    /--figmapress-qa-runtime-global-transform:translate\(0\.25vw,-0\.125vw\)!important/,
  );

  const textGeometryCorrection = [{
    variant: "desktop" as const,
    nodeId: "10:hero",
    nodeName: "Hero heading",
    offsetX: 1,
    offsetY: -2,
    scaleX: 1.03,
    scaleY: 0.98,
    captureWidth: 800,
    confidence: "high" as const,
    errorReductionRatio: 34,
  }];
  const textGeometryCorrected = applyElementorTextGeometryCorrections(
    template,
    textGeometryCorrection,
  );
  assert.deepEqual(
    textGeometryCorrected.content[0]?.elements[0]?.settings._transform_scaleX_effect,
    { unit: "px", size: 1.03, sizes: [] },
  );
  assert.deepEqual(
    textGeometryCorrected.content[0]?.elements[0]?.settings._transform_scaleY_effect,
    { unit: "px", size: 0.98, sizes: [] },
  );
  assert.deepEqual(
    textGeometryCorrected.content[0]?.elements[0]?.settings._transform_translateY_effect,
    { unit: "custom", size: "-0.25vw", sizes: [] },
  );
  assert.equal(
    textGeometryCorrected.content[1]?.elements[0]?.settings._transform_scale_popover,
    undefined,
  );

  const textGeometryPreview = applyPreviewTextGeometryCorrections(
    preview,
    textGeometryCorrection,
    "runtime",
  );
  assert.match(textGeometryPreview, /data-figmapress-text-geometry-corrections/);
  assert.match(
    textGeometryPreview,
    /--figmapress-qa-runtime-geometry-transform:translate\(0\.125vw,-0\.25vw\) scale\(1\.03,0\.98\)!important/,
  );
});

test("unsafe or oversized visual corrections are ignored without mutation", () => {
  const invalid = normalizeElementorVisualCorrections([
    {
      variant: "desktop",
      offsetX: 24,
      offsetY: 0,
      captureWidth: 800,
      confidence: "high",
      errorReductionRatio: 40,
    },
    {
      variant: "mobile",
      offsetX: 2,
      offsetY: 1,
      captureWidth: 440,
      confidence: "medium",
      errorReductionRatio: 4,
    },
  ]);
  assert.deepEqual(invalid, []);
  assert.deepEqual(
    normalizeElementorSectionVisualCorrections([
      {
        variant: "desktop",
        nodeId: "unsafe id\"]",
        nodeName: "Unsafe",
        offsetX: 2,
        offsetY: 1,
        captureWidth: 800,
        confidence: "high",
        errorReductionRatio: 30,
      },
    ]),
    [],
  );
  assert.deepEqual(
    normalizeElementorTextGeometryCorrections([
      {
        variant: "desktop",
        nodeId: "hero",
        nodeName: "Hero",
        offsetX: 1,
        offsetY: 0,
        scaleX: 1.09,
        scaleY: 1,
        captureWidth: 800,
        confidence: "high",
        errorReductionRatio: 30,
      },
    ]),
    [],
  );
  assert.equal(
    applyPreviewVisualCorrections("<div>unchanged</div>", []),
    "<div>unchanged</div>",
  );
});

test("visual correction rollback guard keeps only measured improvements", () => {
  const before = [
    { variant: "desktop" as const, score: 80, changedPixelRatio: 20 },
    { variant: "mobile" as const, score: 86, changedPixelRatio: 12 },
  ];
  assert.equal(
    shouldKeepVisualCorrections(
      before,
      [
        { variant: "desktop", score: 84, changedPixelRatio: 16 },
        { variant: "mobile", score: 86, changedPixelRatio: 12 },
      ],
      ["desktop"],
    ),
    true,
  );
  assert.equal(
    shouldKeepVisualCorrections(
      before,
      [
        { variant: "desktop", score: 79.7, changedPixelRatio: 20.4 },
        { variant: "mobile", score: 86, changedPixelRatio: 12 },
      ],
      ["desktop"],
    ),
    false,
  );
  assert.equal(
    shouldKeepVisualCorrections(before, before, ["desktop"]),
    false,
  );
});

test("section visual correction rollback guard checks the targeted node", () => {
  const before = [{
    variant: "desktop" as const,
    score: 82,
    changedPixelRatio: 18,
    sections: [{
      nodeId: "hero",
      name: "Hero",
      x: 0,
      y: 0,
      width: 800,
      height: 400,
      changedPixelRatio: 32,
      meanColorError: 20,
      impactRatio: 8,
    }],
  }];
  assert.equal(
    shouldKeepSectionVisualCorrections(
      before,
      [{
        ...before[0],
        score: 83,
        changedPixelRatio: 17,
        sections: [{
          ...before[0].sections[0],
          changedPixelRatio: 27,
          impactRatio: 6.5,
        }],
      }],
      [{ variant: "desktop", nodeId: "hero" }],
    ),
    true,
  );
  assert.equal(
    shouldKeepSectionVisualCorrections(
      before,
      [{
        ...before[0],
        sections: [{
          ...before[0].sections[0],
          changedPixelRatio: 33,
        }],
      }],
      [{ variant: "desktop", nodeId: "hero" }],
    ),
    false,
  );
});

test("text geometry rollback guard checks the targeted text node", () => {
  const before = [{
    variant: "desktop" as const,
    score: 82,
    changedPixelRatio: 18,
    textNodes: [{
      nodeId: "headline",
      name: "Headline",
      x: 100,
      y: 80,
      width: 480,
      height: 100,
      changedPixelRatio: 38,
      meanColorError: 24,
      impactRatio: 2.4,
    }],
  }];
  assert.equal(
    shouldKeepTextGeometryCorrections(
      before,
      [{
        ...before[0],
        score: 82.4,
        changedPixelRatio: 17.9,
        textNodes: [{
          ...before[0].textNodes[0],
          changedPixelRatio: 31,
          impactRatio: 1.8,
        }],
      }],
      [{ variant: "desktop", nodeId: "headline" }],
    ),
    true,
  );
  assert.equal(
    shouldKeepTextGeometryCorrections(
      before,
      [{
        ...before[0],
        changedPixelRatio: 18.3,
        textNodes: [{
          ...before[0].textNodes[0],
          changedPixelRatio: 39,
        }],
      }],
      [{ variant: "desktop", nodeId: "headline" }],
    ),
    false,
  );
});
