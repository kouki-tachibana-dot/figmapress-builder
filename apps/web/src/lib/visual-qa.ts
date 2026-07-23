export type VisualQaStatus = "pass" | "review" | "fail";

export interface VisualQaHotspot {
  startPercent: number;
  endPercent: number;
  changedPixelRatio: number;
  meanColorError: number;
  label: string;
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

function recommendationsFor(
  score: number,
  changedPixelRatio: number,
  brightnessDelta: number,
  heightDifferenceRatio: number,
  hotspots: VisualQaHotspot[],
): string[] {
  if (score >= 92 && Math.abs(heightDifferenceRatio) < 3) {
    return ["Figma基準画像との大きな視覚差は検出されませんでした。"];
  }

  const recommendations: string[] = [];
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

export function analyzeVisualPixels(
  reference: Uint8ClampedArray,
  target: Uint8ClampedArray,
  width: number,
  height: number,
  threshold = 24,
  generatedHeight = height,
): VisualQaAnalysis {
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
      recommendations: recommendationsFor(
        roundedScore,
        changedPixelRatio,
        brightnessDelta,
        heightDifferenceRatio,
        hotspots,
      ),
    },
    diffPixels,
  };
}
