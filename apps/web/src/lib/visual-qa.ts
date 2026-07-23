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
  const hasFailure = input.resultStatuses.includes("fail");
  const complete =
    input.referenceCount > 0 &&
    input.resultStatuses.length === input.referenceCount &&
    !input.busy &&
    !input.error;
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

export interface VisualQaMetrics {
  score: number;
  status: VisualQaStatus;
  width: number;
  height: number;
  changedPixelRatio: number;
  meanColorError: number;
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

function recommendationsFor(
  score: number,
  changedPixelRatio: number,
  brightnessDelta: number,
  heightDifferenceRatio: number,
  hotspots: VisualQaHotspot[],
  alignment: VisualQaAlignment,
): string[] {
  if (score >= 92 && Math.abs(heightDifferenceRatio) < 3) {
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
): VisualQaRegionMetrics[] {
  validatePixelBuffers(reference, target, width, height);
  const pagePixels = width * height;
  return regions
    .map((region): VisualQaRegionMetrics | null => {
      const startX = clamp(Math.floor(region.x), 0, width);
      const startY = clamp(Math.floor(region.y), 0, height);
      const endX = clamp(Math.ceil(region.x + region.width), 0, width);
      const endY = clamp(Math.ceil(region.y + region.height), 0, height);
      if (endX <= startX || endY <= startY) return null;

      let pixels = 0;
      let changed = 0;
      let colorError = 0;
      for (let y = startY; y < endY; y += 1) {
        for (let x = startX; x < endX; x += 1) {
          const offset = (y * width + x) * 4;
          const pixelError =
            (
              Math.abs(reference[offset] - target[offset]) +
              Math.abs(reference[offset + 1] - target[offset + 1]) +
              Math.abs(reference[offset + 2] - target[offset + 2]) +
              Math.abs(reference[offset + 3] - target[offset + 3])
            ) / 4;
          pixels += 1;
          colorError += pixelError;
          if (pixelError > threshold) changed += 1;
        }
      }

      return {
        nodeId: region.nodeId,
        name: region.name,
        x: startX,
        y: startY,
        width: endX - startX,
        height: endY - startY,
        changedPixelRatio: round((changed / pixels) * 100),
        meanColorError: round(colorError / pixels),
        impactRatio: round((changed / pagePixels) * 100, 2),
      };
    })
    .filter((region): region is VisualQaRegionMetrics => region !== null)
    .sort((left, right) =>
      right.impactRatio - left.impactRatio ||
      right.changedPixelRatio - left.changedPixelRatio,
    );
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
  let colorError = 0;
  let referenceBrightness = 0;
  let targetBrightness = 0;

  for (let pixel = 0; pixel < width * height; pixel += 1) {
    const offset = pixel * 4;
    const row = Math.floor(pixel / width);
    const bandIndex = Math.min(
      bandCount - 1,
      Math.floor((row / height) * bandCount),
    );
    const redError = Math.abs(reference[offset] - target[offset]);
    const greenError = Math.abs(reference[offset + 1] - target[offset + 1]);
    const blueError = Math.abs(reference[offset + 2] - target[offset + 2]);
    const alphaError = Math.abs(reference[offset + 3] - target[offset + 3]);
    const pixelError = (redError + greenError + blueError + alphaError) / 4;
    const pixelChanged = pixelError > threshold;

    colorError += pixelError;
    bands[bandIndex].pixels += 1;
    bands[bandIndex].colorError += pixelError;
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
  const meanColorError = colorError / totalPixels;
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
  const score = clamp(
    100 -
      changedPixelRatio * 0.68 -
      (meanColorError / 255) * 32 -
      Math.min(30, Math.abs(heightDifferenceRatio) * 0.35),
    0,
    100,
  );
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

  return {
    metrics: {
      score: roundedScore,
      status: roundedScore >= 92 ? "pass" : roundedScore >= 75 ? "review" : "fail",
      width,
      height,
      changedPixelRatio: round(changedPixelRatio),
      meanColorError: round(meanColorError),
      brightnessDelta: round(brightnessDelta),
      generatedHeight: Math.round(normalizedGeneratedHeight),
      heightDifferenceRatio: round(heightDifferenceRatio),
      hotspots,
      alignment,
      recommendations: recommendationsFor(
        roundedScore,
        changedPixelRatio,
        brightnessDelta,
        heightDifferenceRatio,
        hotspots,
        alignment,
      ),
    },
    diffPixels,
  };
}
