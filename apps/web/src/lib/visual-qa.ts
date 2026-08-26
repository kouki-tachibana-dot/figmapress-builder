export type VisualQaStatus = "pass" | "review" | "fail";
export type VisualQaDraftGateState = "off" | "pending" | "clear" | "warning";

export interface VisualQaDraftGate {
  state: VisualQaDraftGateState;
  blocksDraft: boolean;
  complete: boolean;
  hasFailure: boolean;
}

export function resolveVisualQaDraftGate(input: {
  enabled: boolean;
  referenceCount: number;
  resultStatuses: VisualQaStatus[];
  busy: boolean;
  error: boolean;
  acknowledged: boolean;
}): VisualQaDraftGate {
  const hasFailure = input.error
    || input.resultStatuses.some((status) => status !== "pass");
  const complete =
    input.referenceCount > 0 &&
    !input.busy &&
    (input.error || input.resultStatuses.length === input.referenceCount);
  if (!input.enabled || input.referenceCount <= 0) {
    return { state: "off", blocksDraft: false, complete, hasFailure };
  }
  if (!complete) {
    return { state: "pending", blocksDraft: true, complete, hasFailure };
  }
  if (hasFailure) {
    return {
      state: "warning",
      blocksDraft: !input.acknowledged,
      complete,
      hasFailure,
    };
  }
  return { state: "clear", blocksDraft: false, complete, hasFailure };
}

export interface VisualQaHotspot {
  startPercent: number;
  endPercent: number;
  changedPixelRatio: number;
  meanColorError: number;
  label: string;
}

export interface VisualQaRegionInput {
  nodeId: string;
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface VisualQaRegionMetrics {
  nodeId: string;
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  changedPixelRatio: number;
  meanColorError: number;
  impactRatio: number;
  alignment?: VisualQaAlignment;
  geometry?: VisualQaGeometry;
}

export interface VisualQaAlignment {
  offsetX: number;
  offsetY: number;
  baselineError: number;
  correctedError: number;
  errorReductionRatio: number;
  confidence: "high" | "medium" | "low";
  safeToApply: boolean;
  reason: string;
}

export interface VisualQaGeometry {
  offsetX: number;
  offsetY: number;
  scaleX: number;
  scaleY: number;
  baselineError: number;
  correctedError: number;
  errorReductionRatio: number;
  confidence: "high" | "medium" | "low";
  safeToApply: boolean;
  reason: string;
}

export interface VisualQaMetrics {
  score: number;
  status: VisualQaStatus;
  width: number;
  height: number;
  changedPixelRatio: number;
  rawChangedPixelRatio: number;
  edgeEquivalentPixelRatio: number;
  textureEquivalentPixelRatio: number;
  contentChangedPixelRatio: number;
  worstBandChangedPixelRatio: number;
  meanColorError: number;
  rawMeanColorError: number;
  brightnessDelta: number;
  generatedHeight: number;
  heightDifferenceRatio: number;
  hotspots: VisualQaHotspot[];
  alignment: VisualQaAlignment;
  recommendations: string[];
}

export interface VisualQaAnalysis {
  metrics: VisualQaMetrics;
  diffPixels: Uint8ClampedArray;
}

export interface VisualQaCorrectionOutcome {
  variant: "desktop" | "mobile";
  score: number;
  changedPixelRatio: number;
}

export interface VisualQaSectionCorrectionTarget {
  variant: "desktop" | "mobile";
  nodeId: string;
}

export interface VisualQaSectionCorrectionOutcome
  extends VisualQaCorrectionOutcome {
  sections: VisualQaRegionMetrics[];
}

export interface VisualQaTextCorrectionOutcome
  extends VisualQaCorrectionOutcome {
  textNodes: VisualQaRegionMetrics[];
}

export interface VisualQaMediaCorrectionOutcome
  extends VisualQaCorrectionOutcome {
  visualNodes: VisualQaRegionMetrics[];
}

export interface VisualQaDecorationCorrectionOutcome
  extends VisualQaCorrectionOutcome {
  decorationNodes: VisualQaRegionMetrics[];
}

export function shouldKeepVisualCorrections(
  before: VisualQaCorrectionOutcome[],
  after: VisualQaCorrectionOutcome[],
  correctedVariants: Array<"desktop" | "mobile">,
): boolean {
  const targetVariants = new Set(correctedVariants);
  if (!targetVariants.size) return false;
  const beforeByVariant = new Map(
    before.map((result) => [result.variant, result]),
  );
  const afterByVariant = new Map(
    after.map((result) => [result.variant, result]),
  );
  let aggregateScoreGain = 0;
  let aggregateChangedPixelReduction = 0;

  for (const variant of targetVariants) {
    const baseline = beforeByVariant.get(variant);
    const corrected = afterByVariant.get(variant);
    if (!baseline || !corrected) return false;
    if (
      corrected.score < baseline.score
      || corrected.changedPixelRatio > baseline.changedPixelRatio
    ) {
      return false;
    }
    aggregateScoreGain += corrected.score - baseline.score;
    aggregateChangedPixelReduction +=
      baseline.changedPixelRatio - corrected.changedPixelRatio;
  }

  return aggregateScoreGain >= 0.1 || aggregateChangedPixelReduction >= 0.1;
}

export function shouldKeepSectionVisualCorrections(
  before: VisualQaSectionCorrectionOutcome[],
  after: VisualQaSectionCorrectionOutcome[],
  targets: VisualQaSectionCorrectionTarget[],
): boolean {
  if (!targets.length) return false;
  const beforeByVariant = new Map(before.map((result) => [result.variant, result]));
  const afterByVariant = new Map(after.map((result) => [result.variant, result]));
  let improvedTargets = 0;

  for (const target of targets) {
    const baselinePage = beforeByVariant.get(target.variant);
    const correctedPage = afterByVariant.get(target.variant);
    if (!baselinePage || !correctedPage) return false;
    if (
      correctedPage.score < baselinePage.score
      || correctedPage.changedPixelRatio > baselinePage.changedPixelRatio
    ) {
      return false;
    }

    const baseline = baselinePage.sections.find(
      (section) => section.nodeId === target.nodeId,
    );
    const corrected = correctedPage.sections.find(
      (section) => section.nodeId === target.nodeId,
    );
    if (!baseline || !corrected) return false;
    if (
      corrected.changedPixelRatio > baseline.changedPixelRatio + 0.4
      || corrected.impactRatio > baseline.impactRatio + 0.03
    ) {
      return false;
    }
    if (
      baseline.changedPixelRatio - corrected.changedPixelRatio >= 0.2
      || baseline.impactRatio - corrected.impactRatio >= 0.01
    ) {
      improvedTargets += 1;
    }
  }

  return improvedTargets > 0;
}

export function shouldKeepTextGeometryCorrections(
  before: VisualQaTextCorrectionOutcome[],
  after: VisualQaTextCorrectionOutcome[],
  targets: VisualQaSectionCorrectionTarget[],
): boolean {
  if (!targets.length) return false;
  const beforeByVariant = new Map(before.map((result) => [result.variant, result]));
  const afterByVariant = new Map(after.map((result) => [result.variant, result]));
  let improvedTargets = 0;

  for (const target of targets) {
    const baselinePage = beforeByVariant.get(target.variant);
    const correctedPage = afterByVariant.get(target.variant);
    if (!baselinePage || !correctedPage) return false;
    if (
      correctedPage.score < baselinePage.score
      || correctedPage.changedPixelRatio > baselinePage.changedPixelRatio
    ) {
      return false;
    }
    const baseline = baselinePage.textNodes.find(
      (textNode) => textNode.nodeId === target.nodeId,
    );
    const corrected = correctedPage.textNodes.find(
      (textNode) => textNode.nodeId === target.nodeId,
    );
    if (!baseline || !corrected) return false;
    if (
      corrected.changedPixelRatio > baseline.changedPixelRatio + 0.3
      || corrected.impactRatio > baseline.impactRatio + 0.02
    ) {
      return false;
    }
    if (
      baseline.changedPixelRatio - corrected.changedPixelRatio >= 0.15
      || baseline.impactRatio - corrected.impactRatio >= 0.005
    ) {
      improvedTargets += 1;
    }
  }

  return improvedTargets === targets.length;
}

export function shouldKeepMediaGeometryCorrections(
  before: VisualQaMediaCorrectionOutcome[],
  after: VisualQaMediaCorrectionOutcome[],
  targets: VisualQaSectionCorrectionTarget[],
): boolean {
  if (!targets.length) return false;
  const beforeByVariant = new Map(before.map((result) => [result.variant, result]));
  const afterByVariant = new Map(after.map((result) => [result.variant, result]));
  let improvedTargets = 0;

  for (const target of targets) {
    const baselinePage = beforeByVariant.get(target.variant);
    const correctedPage = afterByVariant.get(target.variant);
    if (!baselinePage || !correctedPage) return false;
    if (
      correctedPage.score < baselinePage.score
      || correctedPage.changedPixelRatio > baselinePage.changedPixelRatio
    ) {
      return false;
    }
    const baseline = baselinePage.visualNodes.find(
      (visualNode) => visualNode.nodeId === target.nodeId,
    );
    const corrected = correctedPage.visualNodes.find(
      (visualNode) => visualNode.nodeId === target.nodeId,
    );
    if (!baseline || !corrected) return false;
    if (
      corrected.changedPixelRatio > baseline.changedPixelRatio + 0.3
      || corrected.impactRatio > baseline.impactRatio + 0.02
    ) {
      return false;
    }
    if (
      baseline.changedPixelRatio - corrected.changedPixelRatio >= 0.15
      || baseline.impactRatio - corrected.impactRatio >= 0.005
    ) {
      improvedTargets += 1;
    }
  }

  return improvedTargets === targets.length;
}

export function shouldKeepDecorationGeometryCorrections(
  before: VisualQaDecorationCorrectionOutcome[],
  after: VisualQaDecorationCorrectionOutcome[],
  targets: VisualQaSectionCorrectionTarget[],
): boolean {
  if (!targets.length) return false;
  const beforeByVariant = new Map(before.map((result) => [result.variant, result]));
  const afterByVariant = new Map(after.map((result) => [result.variant, result]));
  let improvedTargets = 0;

  for (const target of targets) {
    const baselinePage = beforeByVariant.get(target.variant);
    const correctedPage = afterByVariant.get(target.variant);
    if (!baselinePage || !correctedPage) return false;
    if (
      correctedPage.score < baselinePage.score
      || correctedPage.changedPixelRatio > baselinePage.changedPixelRatio
    ) {
      return false;
    }
    const baseline = baselinePage.decorationNodes.find(
      (decorationNode) => decorationNode.nodeId === target.nodeId,
    );
    const corrected = correctedPage.decorationNodes.find(
      (decorationNode) => decorationNode.nodeId === target.nodeId,
    );
    if (!baseline || !corrected) return false;
    if (
      corrected.changedPixelRatio > baseline.changedPixelRatio + 0.3
      || corrected.impactRatio > baseline.impactRatio + 0.02
    ) {
      return false;
    }
    if (
      baseline.changedPixelRatio - corrected.changedPixelRatio >= 0.15
      || baseline.impactRatio - corrected.impactRatio >= 0.005
    ) {
      improvedTargets += 1;
    }
  }

  return improvedTargets === targets.length;
}

interface BandAccumulator {
  pixels: number;
  changed: number;
  colorError: number;
}

function validatePixelBuffers(
  reference: Uint8ClampedArray,
  target: Uint8ClampedArray,
  width: number,
  height: number,
): void {
  const expectedLength = width * height * 4;
  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width <= 0 ||
    height <= 0 ||
    reference.length !== expectedLength ||
    target.length !== expectedLength
  ) {
    throw new Error("比較画像の寸法が一致していません。");
  }
}

function round(value: number, digits = 1): number {
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

interface PerceptualPixelDelta {
  rawError: number;
  changed: boolean;
  edgeEquivalent: boolean;
  textureEquivalent: boolean;
}

function pixelColorError(
  source: Uint8ClampedArray,
  sourceOffset: number,
  target: Uint8ClampedArray,
  targetOffset: number,
): number {
  return (
    Math.abs(source[sourceOffset] - target[targetOffset])
    + Math.abs(source[sourceOffset + 1] - target[targetOffset + 1])
    + Math.abs(source[sourceOffset + 2] - target[targetOffset + 2])
    + Math.abs(source[sourceOffset + 3] - target[targetOffset + 3])
  ) / 4;
}

function minimumNeighborhoodError(
  sample: Uint8ClampedArray,
  candidates: Uint8ClampedArray,
  width: number,
  height: number,
  x: number,
  y: number,
  radius = 1,
): number {
  const sampleOffset = (y * width + x) * 4;
  let minimum = Number.POSITIVE_INFINITY;
  for (let candidateY = Math.max(0, y - radius); candidateY <= Math.min(height - 1, y + radius); candidateY += 1) {
    for (let candidateX = Math.max(0, x - radius); candidateX <= Math.min(width - 1, x + radius); candidateX += 1) {
      minimum = Math.min(
        minimum,
        pixelColorError(
          sample,
          sampleOffset,
          candidates,
          (candidateY * width + candidateX) * 4,
        ),
      );
    }
  }
  return minimum;
}

function neighborhoodEdgeStrength(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  x: number,
  y: number,
  radius: number,
): number {
  let minimum = Number.POSITIVE_INFINITY;
  let maximum = Number.NEGATIVE_INFINITY;
  for (let candidateY = Math.max(0, y - radius); candidateY <= Math.min(height - 1, y + radius); candidateY += 1) {
    for (let candidateX = Math.max(0, x - radius); candidateX <= Math.min(width - 1, x + radius); candidateX += 1) {
      const offset = (candidateY * width + candidateX) * 4;
      const luminance =
        pixels[offset] * 0.2126
        + pixels[offset + 1] * 0.7152
        + pixels[offset + 2] * 0.0722;
      minimum = Math.min(minimum, luminance);
      maximum = Math.max(maximum, luminance);
    }
  }
  return maximum - minimum;
}

function neighborhoodMeanColorError(
  source: Uint8ClampedArray,
  target: Uint8ClampedArray,
  width: number,
  height: number,
  x: number,
  y: number,
  radius: number,
): number {
  const sourceTotals = [0, 0, 0, 0];
  const targetTotals = [0, 0, 0, 0];
  let count = 0;
  for (let candidateY = Math.max(0, y - radius); candidateY <= Math.min(height - 1, y + radius); candidateY += 1) {
    for (let candidateX = Math.max(0, x - radius); candidateX <= Math.min(width - 1, x + radius); candidateX += 1) {
      const offset = (candidateY * width + candidateX) * 4;
      for (let channel = 0; channel < 4; channel += 1) {
        sourceTotals[channel] += source[offset + channel];
        targetTotals[channel] += target[offset + channel];
      }
      count += 1;
    }
  }
  return sourceTotals.reduce(
    (error, total, channel) =>
      error + Math.abs(total / count - targetTotals[channel] / count),
    0,
  ) / 4;
}

function perceptualPixelDelta(
  reference: Uint8ClampedArray,
  target: Uint8ClampedArray,
  width: number,
  height: number,
  x: number,
  y: number,
  threshold: number,
): PerceptualPixelDelta {
  const offset = (y * width + x) * 4;
  const rawError = pixelColorError(reference, offset, target, offset);
  if (rawError <= threshold) {
    return {
      rawError,
      changed: false,
      edgeEquivalent: false,
      textureEquivalent: false,
    };
  }

  // Figma and the browser rasterize the same vector/text edge with slightly
  // different sub-pixel coverage. Treat it as equivalent only when the color
  // at this coordinate can be found within one pixel in both directions. The
  // symmetric check keeps missing content, color changes, and larger geometry
  // shifts visible while removing renderer-only edge noise.
  const referenceToTarget = minimumNeighborhoodError(
    reference,
    target,
    width,
    height,
    x,
    y,
  );
  const targetToReference = minimumNeighborhoodError(
    target,
    reference,
    width,
    height,
    x,
    y,
  );
  let edgeEquivalent = Math.max(referenceToTarget, targetToReference) <= threshold;
  let hasSharedRendererEdge = false;
  let rendererEdgeStrengthDelta = Number.POSITIVE_INFINITY;
  if (!edgeEquivalent) {
    // A 1440px Figma frame is exported near 960px while the editable browser
    // page is rasterized on the same grid. The two resamplers can spread a
    // genuine shared edge across two pixels. Extend equivalence to radius two
    // only when both images contain a real local edge and its color exists in
    // both directions. Flat missing content and shifts of three pixels or more
    // therefore remain material differences.
    const radius = 2;
    const referenceEdgeStrength = neighborhoodEdgeStrength(
      reference,
      width,
      height,
      x,
      y,
      radius,
    );
    const targetEdgeStrength = neighborhoodEdgeStrength(
      target,
      width,
      height,
      x,
      y,
      radius,
    );
    rendererEdgeStrengthDelta = Math.abs(
      referenceEdgeStrength - targetEdgeStrength,
    );
    hasSharedRendererEdge =
      referenceEdgeStrength >= 12
      && targetEdgeStrength >= 12;
    if (hasSharedRendererEdge) {
      edgeEquivalent = Math.max(
        minimumNeighborhoodError(reference, target, width, height, x, y, radius),
        minimumNeighborhoodError(target, reference, width, height, x, y, radius),
      ) <= threshold;
    }
  }
  // Figma must use a full-page JPEG for long frames. Recompressing and
  // resampling a detailed photograph can change individual high-frequency
  // pixels even when the visible local tone is unchanged. Accept that narrow
  // case only for JPEG thresholds, only where both sides contain structure,
  // and only when their centered 5x5 mean color differs by at most 8/255.
  // Missing/flat content, palette changes and geometry shifts stay material.
  const textureEquivalent =
    !edgeEquivalent
    && threshold >= 32
    && hasSharedRendererEdge
    && rendererEdgeStrengthDelta <= 16
    && neighborhoodMeanColorError(
      reference,
      target,
      width,
      height,
      x,
      y,
      2,
    ) <= 8;
  return {
    rawError,
    changed: !(edgeEquivalent || textureEquivalent),
    edgeEquivalent,
    textureEquivalent,
  };
}

function locationLabel(startPercent: number, endPercent: number): string {
  const midpoint = (startPercent + endPercent) / 2;
  const area = midpoint < 25 ? "上部" : midpoint < 75 ? "中央" : "下部";
  return `${area} ${startPercent}–${endPercent}%`;
}

interface AlignmentError {
  error: number;
  signalRatio: number;
}

function alignmentError(
  reference: Uint8ClampedArray,
  target: Uint8ClampedArray,
  width: number,
  height: number,
  correctionX: number,
  correctionY: number,
  maximumShift: number,
  sampleStride: number,
): AlignmentError {
  const left = maximumShift + 1;
  const top = maximumShift + 1;
  const right = width - maximumShift - 1;
  const bottom = height - maximumShift - 1;
  let weightedError = 0;
  let totalWeight = 0;
  let signalSamples = 0;
  let samples = 0;

  for (let y = top; y < bottom; y += sampleStride) {
    for (let x = left; x < right; x += sampleStride) {
      const referenceOffset = (y * width + x) * 4;
      const targetOffset =
        ((y - correctionY) * width + x - correctionX) * 4;
      const rightOffset = referenceOffset + 4;
      const lowerOffset = referenceOffset + width * 4;
      const referenceLuminance =
        reference[referenceOffset] * 0.2126 +
        reference[referenceOffset + 1] * 0.7152 +
        reference[referenceOffset + 2] * 0.0722;
      const rightLuminance =
        reference[rightOffset] * 0.2126 +
        reference[rightOffset + 1] * 0.7152 +
        reference[rightOffset + 2] * 0.0722;
      const lowerLuminance =
        reference[lowerOffset] * 0.2126 +
        reference[lowerOffset + 1] * 0.7152 +
        reference[lowerOffset + 2] * 0.0722;
      const edgeStrength = Math.max(
        Math.abs(referenceLuminance - rightLuminance),
        Math.abs(referenceLuminance - lowerLuminance),
      );
      const weight = 1 + Math.min(8, edgeStrength / 20);
      const pixelError =
        (
          Math.abs(reference[referenceOffset] - target[targetOffset]) +
          Math.abs(reference[referenceOffset + 1] - target[targetOffset + 1]) +
          Math.abs(reference[referenceOffset + 2] - target[targetOffset + 2])
        ) / 3;

      weightedError += pixelError * weight;
      totalWeight += weight;
      if (edgeStrength >= 8) signalSamples += 1;
      samples += 1;
    }
  }

  return {
    error: totalWeight ? weightedError / totalWeight : 0,
    signalRatio: samples ? signalSamples / samples : 0,
  };
}

export function estimateVisualAlignment(
  reference: Uint8ClampedArray,
  target: Uint8ClampedArray,
  width: number,
  height: number,
  maximumShift = 12,
): VisualQaAlignment {
  const safeMaximumShift = Math.max(
    0,
    Math.min(
      Math.round(maximumShift),
      Math.floor((Math.min(width, height) - 4) / 2),
    ),
  );
  if (safeMaximumShift < 2) {
    return {
      offsetX: 0,
      offsetY: 0,
      baselineError: 0,
      correctedError: 0,
      errorReductionRatio: 0,
      confidence: "low",
      safeToApply: false,
      reason: "測定画像が小さいため、全体位置ずれを判定できません。",
    };
  }

  const sampleStride = Math.max(
    1,
    Math.ceil(Math.sqrt((width * height) / 45_000)),
  );
  const baseline = alignmentError(
    reference,
    target,
    width,
    height,
    0,
    0,
    safeMaximumShift,
    sampleStride,
  );
  let bestX = 0;
  let bestY = 0;
  let bestError = baseline.error;
  const coarseStep = safeMaximumShift >= 6 ? 3 : 2;

  for (
    let correctionY = -safeMaximumShift;
    correctionY <= safeMaximumShift;
    correctionY += coarseStep
  ) {
    for (
      let correctionX = -safeMaximumShift;
      correctionX <= safeMaximumShift;
      correctionX += coarseStep
    ) {
      const measurement = alignmentError(
        reference,
        target,
        width,
        height,
        correctionX,
        correctionY,
        safeMaximumShift,
        sampleStride,
      );
      if (measurement.error < bestError) {
        bestX = correctionX;
        bestY = correctionY;
        bestError = measurement.error;
      }
    }
  }

  const refinedX = bestX;
  const refinedY = bestY;
  for (
    let correctionY = Math.max(-safeMaximumShift, refinedY - coarseStep);
    correctionY <= Math.min(safeMaximumShift, refinedY + coarseStep);
    correctionY += 1
  ) {
    for (
      let correctionX = Math.max(-safeMaximumShift, refinedX - coarseStep);
      correctionX <= Math.min(safeMaximumShift, refinedX + coarseStep);
      correctionX += 1
    ) {
      const measurement = alignmentError(
        reference,
        target,
        width,
        height,
        correctionX,
        correctionY,
        safeMaximumShift,
        sampleStride,
      );
      if (measurement.error < bestError) {
        bestX = correctionX;
        bestY = correctionY;
        bestError = measurement.error;
      }
    }
  }

  const errorReductionRatio =
    baseline.error > 0
      ? ((baseline.error - bestError) / baseline.error) * 100
      : 0;
  const hitsSearchBoundary =
    Math.abs(bestX) === safeMaximumShift ||
    Math.abs(bestY) === safeMaximumShift;
  const hasUsableSignal = baseline.signalRatio >= 0.003;
  const confidence =
    hasUsableSignal && errorReductionRatio >= 22 && baseline.error >= 8
      ? "high"
      : hasUsableSignal && errorReductionRatio >= 10 && baseline.error >= 4
        ? "medium"
        : "low";
  const safeToApply =
    (bestX !== 0 || bestY !== 0) &&
    !hitsSearchBoundary &&
    confidence !== "low";
  const reason = baseline.error < 0.1
    ? "全体位置ずれは検出されませんでした。"
    : !hasUsableSignal
      ? "輪郭情報が少ないため、全体位置ずれを確定できません。"
    : hitsSearchBoundary
      ? "探索範囲の端まで差が続くため、単純な位置補正ではなくレイアウト差の可能性があります。"
      : !safeToApply
        ? "局所差分の影響が大きく、全体移動による補正の確度は低い状態です。"
        : `ページ全体をX ${bestX >= 0 ? "+" : ""}${bestX}px / Y ${bestY >= 0 ? "+" : ""}${bestY}px移動すると、画素誤差を約${round(errorReductionRatio)}%削減できる見込みです。`;

  return {
    offsetX: bestX,
    offsetY: bestY,
    baselineError: round(baseline.error),
    correctedError: round(bestError),
    errorReductionRatio: round(errorReductionRatio),
    confidence,
    safeToApply,
    reason,
  };
}

function geometryError(
  reference: Uint8ClampedArray,
  target: Uint8ClampedArray,
  width: number,
  height: number,
  offsetX: number,
  offsetY: number,
  scaleX: number,
  scaleY: number,
  marginX: number,
  marginY: number,
  sampleStride: number,
): AlignmentError {
  const left = marginX;
  const top = marginY;
  const right = width - marginX - 1;
  const bottom = height - marginY - 1;
  const centerX = (width - 1) / 2;
  const centerY = (height - 1) / 2;
  let weightedError = 0;
  let totalWeight = 0;
  let signalSamples = 0;
  let samples = 0;

  for (let y = top; y < bottom; y += sampleStride) {
    for (let x = left; x < right; x += sampleStride) {
      const targetX = Math.round(
        centerX + (x - centerX - offsetX) / scaleX,
      );
      const targetY = Math.round(
        centerY + (y - centerY - offsetY) / scaleY,
      );
      if (
        targetX < 0
        || targetX >= width
        || targetY < 0
        || targetY >= height
      ) {
        continue;
      }
      const referenceOffset = (y * width + x) * 4;
      const targetOffset = (targetY * width + targetX) * 4;
      const rightOffset = referenceOffset + 4;
      const lowerOffset = referenceOffset + width * 4;
      const referenceLuminance =
        reference[referenceOffset] * 0.2126 +
        reference[referenceOffset + 1] * 0.7152 +
        reference[referenceOffset + 2] * 0.0722;
      const rightLuminance =
        reference[rightOffset] * 0.2126 +
        reference[rightOffset + 1] * 0.7152 +
        reference[rightOffset + 2] * 0.0722;
      const lowerLuminance =
        reference[lowerOffset] * 0.2126 +
        reference[lowerOffset + 1] * 0.7152 +
        reference[lowerOffset + 2] * 0.0722;
      const edgeStrength = Math.max(
        Math.abs(referenceLuminance - rightLuminance),
        Math.abs(referenceLuminance - lowerLuminance),
      );
      const weight = 1 + Math.min(8, edgeStrength / 20);
      const pixelError =
        (
          Math.abs(reference[referenceOffset] - target[targetOffset]) +
          Math.abs(reference[referenceOffset + 1] - target[targetOffset + 1]) +
          Math.abs(reference[referenceOffset + 2] - target[targetOffset + 2])
        ) / 3;

      weightedError += pixelError * weight;
      totalWeight += weight;
      if (edgeStrength >= 8) signalSamples += 1;
      samples += 1;
    }
  }

  return {
    error: totalWeight ? weightedError / totalWeight : 0,
    signalRatio: samples ? signalSamples / samples : 0,
  };
}

export function estimateVisualGeometry(
  reference: Uint8ClampedArray,
  target: Uint8ClampedArray,
  width: number,
  height: number,
  maximumShift = 6,
  maximumScaleDelta = 0.05,
): VisualQaGeometry {
  validatePixelBuffers(reference, target, width, height);
  const safeMaximumShift = Math.max(0, Math.min(6, Math.round(maximumShift)));
  const safeScaleDelta = Math.max(
    0.01,
    Math.min(0.05, maximumScaleDelta),
  );
  const marginX = Math.max(
    safeMaximumShift + 2,
    Math.ceil((width * safeScaleDelta) / 2) + safeMaximumShift + 2,
  );
  const marginY = Math.max(
    safeMaximumShift + 2,
    Math.ceil((height * safeScaleDelta) / 2) + safeMaximumShift + 2,
  );
  if (width - marginX * 2 < 24 || height - marginY * 2 < 12) {
    return {
      offsetX: 0,
      offsetY: 0,
      scaleX: 1,
      scaleY: 1,
      baselineError: 0,
      correctedError: 0,
      errorReductionRatio: 0,
      confidence: "low",
      safeToApply: false,
      reason: "文字領域が小さいため、寸法補正を安全に判定できません。",
    };
  }

  const sampleStride = Math.max(
    1,
    Math.ceil(Math.sqrt((width * height) / 8_000)),
  );
  const baseline = geometryError(
    reference,
    target,
    width,
    height,
    0,
    0,
    1,
    1,
    marginX,
    marginY,
    sampleStride,
  );
  let bestX = 0;
  let bestY = 0;
  let bestScaleX = 1;
  let bestScaleY = 1;
  let bestError = baseline.error;
  const minimumScale = 1 - safeScaleDelta;
  const maximumScale = 1 + safeScaleDelta;
  const scales = Array.from(
    new Set(
      [-1, -0.6, -0.2, 0, 0.2, 0.6, 1].map((factor) =>
        round(1 + safeScaleDelta * factor, 3)
      ),
    ),
  );
  const offsets: number[] = [];
  for (
    let offset = -safeMaximumShift;
    offset <= safeMaximumShift;
    offset += 3
  ) {
    offsets.push(offset);
  }
  if (!offsets.includes(0)) offsets.push(0);
  if (!offsets.includes(safeMaximumShift)) offsets.push(safeMaximumShift);

  for (const scaleY of scales) {
    for (const scaleX of scales) {
      if (Math.abs(scaleX - scaleY) > 0.061) continue;
      for (const offsetY of offsets) {
        for (const offsetX of offsets) {
          const measurement = geometryError(
            reference,
            target,
            width,
            height,
            offsetX,
            offsetY,
            scaleX,
            scaleY,
            marginX,
            marginY,
            sampleStride,
          );
          if (measurement.error < bestError) {
            bestX = offsetX;
            bestY = offsetY;
            bestScaleX = scaleX;
            bestScaleY = scaleY;
            bestError = measurement.error;
          }
        }
      }
    }
  }

  const refinedScalesX = [-0.01, -0.005, 0, 0.005, 0.01].map((delta) =>
    clamp(bestScaleX + delta, minimumScale, maximumScale)
  );
  const refinedScalesY = [-0.01, -0.005, 0, 0.005, 0.01].map((delta) =>
    clamp(bestScaleY + delta, minimumScale, maximumScale)
  );
  const refinedOffsetsX = [-1, 0, 1].map((delta) =>
    clamp(bestX + delta, -safeMaximumShift, safeMaximumShift)
  );
  const refinedOffsetsY = [-1, 0, 1].map((delta) =>
    clamp(bestY + delta, -safeMaximumShift, safeMaximumShift)
  );
  for (const scaleY of refinedScalesY) {
    for (const scaleX of refinedScalesX) {
      if (Math.abs(scaleX - scaleY) > 0.061) continue;
      for (const offsetY of refinedOffsetsY) {
        for (const offsetX of refinedOffsetsX) {
          const measurement = geometryError(
            reference,
            target,
            width,
            height,
            offsetX,
            offsetY,
            scaleX,
            scaleY,
            marginX,
            marginY,
            sampleStride,
          );
          if (measurement.error < bestError) {
            bestX = offsetX;
            bestY = offsetY;
            bestScaleX = scaleX;
            bestScaleY = scaleY;
            bestError = measurement.error;
          }
        }
      }
    }
  }

  const errorReductionRatio =
    baseline.error > 0
      ? ((baseline.error - bestError) / baseline.error) * 100
      : 0;
  const scaleChanged =
    Math.abs(bestScaleX - 1) >= 0.008
    || Math.abs(bestScaleY - 1) >= 0.008;
  const offsetChanged = bestX !== 0 || bestY !== 0;
  const hitsBoundary =
    Math.abs(bestX) === safeMaximumShift
    || Math.abs(bestY) === safeMaximumShift
    || Math.abs(bestScaleX - minimumScale) < 0.0001
    || Math.abs(bestScaleX - maximumScale) < 0.0001
    || Math.abs(bestScaleY - minimumScale) < 0.0001
    || Math.abs(bestScaleY - maximumScale) < 0.0001;
  const hasUsableSignal = baseline.signalRatio >= 0.006;
  const confidence =
    hasUsableSignal && errorReductionRatio >= 30 && baseline.error >= 8
      ? "high"
      : hasUsableSignal && errorReductionRatio >= 18 && baseline.error >= 4
        ? "medium"
        : "low";
  const safeToApply =
    (scaleChanged || offsetChanged)
    && !hitsBoundary
    && confidence !== "low";
  const reason = !hasUsableSignal
    ? "文字輪郭が少ないため、寸法差を確定できません。"
    : hitsBoundary
      ? "安全な探索範囲を超える差があり、自動的な文字寸法補正を見送りました。"
      : !safeToApply
        ? "文字差分を幅・高さの微調整だけで改善できる確度が不足しています。"
        : `X ${bestX >= 0 ? "+" : ""}${bestX}px / Y ${bestY >= 0 ? "+" : ""}${bestY}px、幅 ${round(bestScaleX * 100)}% / 高さ ${round(bestScaleY * 100)}%で、文字領域の画素誤差を約${round(errorReductionRatio)}%削減できる見込みです。`;

  return {
    offsetX: bestX,
    offsetY: bestY,
    scaleX: round(bestScaleX, 3),
    scaleY: round(bestScaleY, 3),
    baselineError: round(baseline.error),
    correctedError: round(bestError),
    errorReductionRatio: round(errorReductionRatio),
    confidence,
    safeToApply,
    reason,
  };
}

function recommendationsFor(
  score: number,
  changedPixelRatio: number,
  contentChangedPixelRatio: number,
  worstBandChangedPixelRatio: number,
  brightnessDelta: number,
  heightDifferenceRatio: number,
  hotspots: VisualQaHotspot[],
  alignment: VisualQaAlignment,
): string[] {
  if (
    score >= 94
    && contentChangedPixelRatio < 8
    && worstBandChangedPixelRatio < 12
    && Math.abs(heightDifferenceRatio) < 3
  ) {
    return ["Figma基準画像との大きな視覚差は検出されませんでした。"];
  }

  const recommendations: string[] = [];
  if (alignment.safeToApply) {
    recommendations.push(alignment.reason);
  }
  if (Math.abs(heightDifferenceRatio) >= 3) {
    recommendations.push(
      heightDifferenceRatio > 0
        ? `生成ページ全体がFigma基準より${round(Math.abs(heightDifferenceRatio))}%長いため、セクション高と縦余白を確認してください。`
        : `生成ページ全体がFigma基準より${round(Math.abs(heightDifferenceRatio))}%短いため、欠落要素とセクション高を確認してください。`,
    );
  }
  if (hotspots.length) {
    recommendations.push(
      `${hotspots.map((hotspot) => hotspot.label).join("、")}に差分が集中しています。該当セクションの位置・高さ・余白を確認してください。`,
    );
  }
  if (contentChangedPixelRatio >= 12) {
    recommendations.push(
      `文字・画像・部品がある領域の${round(contentChangedPixelRatio)}%に差があります。余白で平均化せず、原本との横並び比較で内容を確認してください。`,
    );
  }
  if (worstBandChangedPixelRatio >= 20) {
    recommendations.push(
      `最も差が大きい縦区間では${round(worstBandChangedPixelRatio)}%が異なります。該当区間を優先して修正してください。`,
    );
  }
  if (Math.abs(brightnessDelta) >= 8) {
    recommendations.push(
      brightnessDelta > 0
        ? "生成結果が基準より明るいため、背景色・画像の不透明度・オーバーレイを確認してください。"
        : "生成結果が基準より暗いため、背景色・画像の不透明度・オーバーレイを確認してください。",
    );
  }
  if (changedPixelRatio >= 15) {
    recommendations.push(
      "差分面積が大きいため、Webフォントの読み込み、画像のトリミング、要素の幅と折り返しを優先して確認してください。",
    );
  }
  if (!recommendations.length) {
    recommendations.push("小さな差分があります。文字サイズ・行高・境界線を確認してください。");
  }
  return recommendations;
}

export function analyzeVisualRegions(
  reference: Uint8ClampedArray,
  target: Uint8ClampedArray,
  width: number,
  height: number,
  regions: VisualQaRegionInput[],
  threshold = 24,
  maximumAlignmentShift = 0,
  estimateGeometry = false,
): VisualQaRegionMetrics[] {
  validatePixelBuffers(reference, target, width, height);
  const pagePixels = width * height;
  const analyzed = regions
    .map((region): VisualQaRegionMetrics | null => {
      const startX = clamp(Math.floor(region.x), 0, width);
      const startY = clamp(Math.floor(region.y), 0, height);
      const endX = clamp(Math.ceil(region.x + region.width), 0, width);
      const endY = clamp(Math.ceil(region.y + region.height), 0, height);
      if (endX <= startX || endY <= startY) return null;

      let pixels = 0;
      let changed = 0;
      let rawChanged = 0;
      let colorError = 0;
      for (let y = startY; y < endY; y += 1) {
        for (let x = startX; x < endX; x += 1) {
          const delta = perceptualPixelDelta(
            reference,
            target,
            width,
            height,
            x,
            y,
            threshold,
          );
          pixels += 1;
          if (delta.rawError > threshold) rawChanged += 1;
          if (delta.changed) {
            changed += 1;
            colorError += delta.rawError;
          }
        }
      }

      const changedPixelRatio = round((changed / pixels) * 100);
      const rawChangedPixelRatio = round((rawChanged / pixels) * 100);
      const impactRatio = round((changed / pagePixels) * 100, 2);
      let alignment: VisualQaAlignment | undefined;
      const regionWidth = endX - startX;
      const regionHeight = endY - startY;
      if (
        maximumAlignmentShift >= 2
        && regionWidth >= 64
        && regionHeight >= 64
        && rawChangedPixelRatio >= 4
        && impactRatio >= 0.03
      ) {
        const referenceCrop = cropPixelBuffer(
          reference,
          width,
          startX,
          startY,
          regionWidth,
          regionHeight,
        );
        const targetCrop = cropPixelBuffer(
          target,
          width,
          startX,
          startY,
          regionWidth,
          regionHeight,
        );
        const estimated = estimateVisualAlignment(
          referenceCrop,
          targetCrop,
          regionWidth,
          regionHeight,
          Math.min(10, maximumAlignmentShift),
        );
        alignment =
          estimated.safeToApply && estimated.errorReductionRatio >= 15
            ? {
                ...estimated,
                reason: `「${region.name}」をX ${estimated.offsetX >= 0 ? "+" : ""}${estimated.offsetX}px / Y ${estimated.offsetY >= 0 ? "+" : ""}${estimated.offsetY}px移動すると、領域内の画素誤差を約${estimated.errorReductionRatio}%削減できる見込みです。`,
              }
            : {
                ...estimated,
                confidence: "low",
                safeToApply: false,
                reason: `「${region.name}」は単純な位置移動だけで安全に改善できる確度が不足しています。`,
              };
      }
      return {
        nodeId: region.nodeId,
        name: region.name,
        x: startX,
        y: startY,
        width: regionWidth,
        height: regionHeight,
        changedPixelRatio,
        meanColorError: round(colorError / pixels),
        impactRatio,
        alignment,
      };
    })
    .filter((region): region is VisualQaRegionMetrics => region !== null)
    .sort((left, right) =>
      right.impactRatio - left.impactRatio ||
      right.changedPixelRatio - left.changedPixelRatio,
    );

  if (!estimateGeometry) return analyzed;
  return analyzed.map((region, index) => {
    if (
      index >= 4
      || region.width < 48
      || region.height < 20
      || region.changedPixelRatio < 4
      || region.impactRatio < 0.002
    ) {
      return region;
    }
    const referenceCrop = cropPixelBuffer(
      reference,
      width,
      region.x,
      region.y,
      region.width,
      region.height,
    );
    const targetCrop = cropPixelBuffer(
      target,
      width,
      region.x,
      region.y,
      region.width,
      region.height,
    );
    const estimated = estimateVisualGeometry(
      referenceCrop,
      targetCrop,
      region.width,
      region.height,
    );
    return {
      ...region,
      geometry: estimated.safeToApply
        ? {
            ...estimated,
            reason: `「${region.name}」は${estimated.reason}`,
          }
        : estimated,
    };
  });
}

function cropPixelBuffer(
  source: Uint8ClampedArray,
  sourceWidth: number,
  x: number,
  y: number,
  width: number,
  height: number,
): Uint8ClampedArray {
  const crop = new Uint8ClampedArray(width * height * 4);
  for (let row = 0; row < height; row += 1) {
    const sourceStart = ((y + row) * sourceWidth + x) * 4;
    const targetStart = row * width * 4;
    crop.set(
      source.subarray(sourceStart, sourceStart + width * 4),
      targetStart,
    );
  }
  return crop;
}

export function analyzeVisualPixels(
  reference: Uint8ClampedArray,
  target: Uint8ClampedArray,
  width: number,
  height: number,
  threshold = 24,
  generatedHeight = height,
): VisualQaAnalysis {
  validatePixelBuffers(reference, target, width, height);
  const expectedLength = width * height * 4;

  const bandCount = 10;
  const bands: BandAccumulator[] = Array.from(
    { length: bandCount },
    () => ({ pixels: 0, changed: 0, colorError: 0 }),
  );
  const diffPixels = new Uint8ClampedArray(expectedLength);
  let changed = 0;
  let rawChanged = 0;
  let edgeEquivalent = 0;
  let textureEquivalent = 0;
  let contentPixels = 0;
  let changedContentPixels = 0;
  let colorError = 0;
  let rawColorError = 0;
  let referenceBrightness = 0;
  let targetBrightness = 0;

  for (let pixel = 0; pixel < width * height; pixel += 1) {
    const offset = pixel * 4;
    const row = Math.floor(pixel / width);
    const bandIndex = Math.min(
      bandCount - 1,
      Math.floor((row / height) * bandCount),
    );
    const column = pixel % width;
    const delta = perceptualPixelDelta(
      reference,
      target,
      width,
      height,
      column,
      row,
      threshold,
    );
    const pixelError = delta.rawError;
    const pixelChanged = delta.changed;
    if (pixelError > threshold) rawChanged += 1;
    if (delta.edgeEquivalent) edgeEquivalent += 1;
    if (delta.textureEquivalent) textureEquivalent += 1;
    // Plain page backgrounds can occupy most of a long website screenshot and
    // previously hid very visible typography and component differences. Count
    // the union of non-white pixels separately so foreground content is not
    // diluted by large matching margins.
    const referenceHasContent =
      reference[offset] < 246
      || reference[offset + 1] < 246
      || reference[offset + 2] < 246
      || reference[offset + 3] < 250;
    const targetHasContent =
      target[offset] < 246
      || target[offset + 1] < 246
      || target[offset + 2] < 246
      || target[offset + 3] < 250;
    if (referenceHasContent || targetHasContent) {
      contentPixels += 1;
      if (pixelChanged) changedContentPixels += 1;
    }

    rawColorError += pixelError;
    if (pixelChanged) colorError += pixelError;
    bands[bandIndex].pixels += 1;
    if (pixelChanged) bands[bandIndex].colorError += pixelError;
    if (pixelChanged) {
      changed += 1;
      bands[bandIndex].changed += 1;
      const intensity = clamp(70 + pixelError * 1.8, 70, 255);
      diffPixels[offset] = 255;
      diffPixels[offset + 1] = Math.max(20, 255 - intensity);
      diffPixels[offset + 2] = 24;
      diffPixels[offset + 3] = 255;
    } else {
      const gray = Math.round(
        target[offset] * 0.2126 +
        target[offset + 1] * 0.7152 +
        target[offset + 2] * 0.0722,
      );
      diffPixels[offset] = gray;
      diffPixels[offset + 1] = gray;
      diffPixels[offset + 2] = gray;
      diffPixels[offset + 3] = 95;
    }

    referenceBrightness +=
      reference[offset] * 0.2126 +
      reference[offset + 1] * 0.7152 +
      reference[offset + 2] * 0.0722;
    targetBrightness +=
      target[offset] * 0.2126 +
      target[offset + 1] * 0.7152 +
      target[offset + 2] * 0.0722;
  }

  const totalPixels = width * height;
  const changedPixelRatio = (changed / totalPixels) * 100;
  const rawChangedPixelRatio = (rawChanged / totalPixels) * 100;
  const edgeEquivalentPixelRatio = (edgeEquivalent / totalPixels) * 100;
  const textureEquivalentPixelRatio = (textureEquivalent / totalPixels) * 100;
  const contentChangedPixelRatio = contentPixels
    ? (changedContentPixels / contentPixels) * 100
    : changedPixelRatio;
  const meanColorError = colorError / totalPixels;
  const rawMeanColorError = rawColorError / totalPixels;
  const brightnessDelta = (targetBrightness - referenceBrightness) / totalPixels;
  const normalizedGeneratedHeight =
    Number.isFinite(generatedHeight) && generatedHeight > 0
      ? generatedHeight
      : height;
  const heightDifferenceRatio =
    ((normalizedGeneratedHeight - height) / height) * 100;
  const estimatedAlignment = estimateVisualAlignment(
    reference,
    target,
    width,
    height,
  );
  const alignment: VisualQaAlignment =
    Math.abs(heightDifferenceRatio) >= 5 && estimatedAlignment.safeToApply
      ? {
          ...estimatedAlignment,
          confidence: "low",
          safeToApply: false,
          reason:
            "ページ全体の高さがFigma基準と異なるため、位置補正より先にセクション高と欠落要素の確認が必要です。",
        }
      : estimatedAlignment;
  const bandChangedRatios = bands.map((band) =>
    band.pixels ? (band.changed / band.pixels) * 100 : 0,
  );
  const worstBandChangedPixelRatio = Math.max(0, ...bandChangedRatios);
  const calculatedScore = clamp(
    100 -
      changedPixelRatio * 0.38 -
      contentChangedPixelRatio * 0.52 -
      worstBandChangedPixelRatio * 0.12 -
      (meanColorError / 255) * 24 -
      Math.min(30, Math.abs(heightDifferenceRatio) * 0.35),
    0,
    100,
  );
  // 100 means byte-for-byte equality. Perceptually equivalent anti-aliasing
  // may reach the product gate but remains distinguishable from exact pixels.
  const score = rawChanged > 0 ? Math.min(99.9, calculatedScore) : calculatedScore;
  const hotspotFloor = Math.max(2, changedPixelRatio * 1.05);
  const hotspots = bands
    .map((band, index): VisualQaHotspot => {
      const startPercent = index * (100 / bandCount);
      const endPercent = (index + 1) * (100 / bandCount);
      return {
        startPercent,
        endPercent,
        changedPixelRatio: band.pixels ? (band.changed / band.pixels) * 100 : 0,
        meanColorError: band.pixels ? band.colorError / band.pixels : 0,
        label: locationLabel(startPercent, endPercent),
      };
    })
    .filter((band) => band.changedPixelRatio >= hotspotFloor)
    .sort((left, right) => right.changedPixelRatio - left.changedPixelRatio)
    .slice(0, 3)
    .map((band) => ({
      ...band,
      changedPixelRatio: round(band.changedPixelRatio),
      meanColorError: round(band.meanColorError),
    }));
  const roundedScore = round(score);
  const roundedContentChangedPixelRatio = round(contentChangedPixelRatio);
  const roundedWorstBandChangedPixelRatio = round(worstBandChangedPixelRatio);
  const status: VisualQaStatus =
    roundedScore >= 99.9
      && roundedContentChangedPixelRatio < 0.2
      && roundedWorstBandChangedPixelRatio < 0.5
      && Math.abs(heightDifferenceRatio) < 0.1
      ? "pass"
      : roundedScore >= 94
        && roundedContentChangedPixelRatio < 8
        && roundedWorstBandChangedPixelRatio < 12
        && Math.abs(heightDifferenceRatio) < 3
        ? "review"
        : "fail";

  return {
    metrics: {
      score: roundedScore,
      status,
      width,
      height,
      changedPixelRatio: round(changedPixelRatio),
      rawChangedPixelRatio: round(rawChangedPixelRatio),
      edgeEquivalentPixelRatio: round(edgeEquivalentPixelRatio),
      textureEquivalentPixelRatio: round(textureEquivalentPixelRatio),
      contentChangedPixelRatio: roundedContentChangedPixelRatio,
      worstBandChangedPixelRatio: roundedWorstBandChangedPixelRatio,
      meanColorError: round(meanColorError),
      rawMeanColorError: round(rawMeanColorError),
      brightnessDelta: round(brightnessDelta),
      generatedHeight: Math.round(normalizedGeneratedHeight),
      heightDifferenceRatio: round(heightDifferenceRatio),
      hotspots,
      alignment,
      recommendations: recommendationsFor(
        roundedScore,
        changedPixelRatio,
        contentChangedPixelRatio,
        worstBandChangedPixelRatio,
        brightnessDelta,
        heightDifferenceRatio,
        hotspots,
        alignment,
      ),
    },
    diffPixels,
  };
}
