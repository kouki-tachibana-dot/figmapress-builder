import html2canvas from "html2canvas";
import {
  analyzeVisualRegions,
  analyzeVisualPixels,
  type VisualQaMetrics,
  type VisualQaRegionInput,
  type VisualQaRegionMetrics,
} from "@/lib/visual-qa";

export interface VisualQaReference {
  nodeId: string;
  name: string;
  url: string;
  width: number;
  height: number;
}

export interface VisualQaBrowserResult extends VisualQaMetrics {
  variant: "desktop" | "mobile";
  referenceName: string;
  referenceNodeId: string;
  sections: VisualQaRegionMetrics[];
  textNodes: VisualQaRegionMetrics[];
  diffImageUrl: string;
}

const MAX_CAPTURE_PIXELS = 4_000_000;

function proxiedImageUrl(value: string): string {
  try {
    const url = new URL(value, window.location.href);
    if (url.protocol === "data:" || url.origin === window.location.origin) {
      return url.toString();
    }
    if (url.protocol !== "https:") return value;
    return `/api/figma-image?url=${encodeURIComponent(url.toString())}`;
  } catch {
    return value;
  }
}

function rewriteCssUrls(value: string): string {
  return value.replace(
    /url\((['"]?)(https:\/\/[^'")]+)\1\)/gi,
    (_match, quote: string, url: string) =>
      `url(${quote}${proxiedImageUrl(url)}${quote})`,
  );
}

function waitForFrame(frame: HTMLIFrameElement, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(
      () => reject(new Error("生成ページの準備がタイムアウトしました。")),
      timeoutMs,
    );
    frame.addEventListener("load", () => {
      window.clearTimeout(timeout);
      resolve();
    }, { once: true });
  });
}

function waitForImage(image: HTMLImageElement, timeoutMs: number): Promise<void> {
  if (image.complete) return Promise.resolve();
  return new Promise((resolve) => {
    const timeout = window.setTimeout(resolve, timeoutMs);
    const done = () => {
      window.clearTimeout(timeout);
      resolve();
    };
    image.addEventListener("load", done, { once: true });
    image.addEventListener("error", done, { once: true });
  });
}

async function loadReferenceImage(url: string): Promise<HTMLImageElement> {
  const image = new Image();
  image.decoding = "async";
  image.src = proxiedImageUrl(url);
  await new Promise<void>((resolve, reject) => {
    const timeout = window.setTimeout(
      () => reject(new Error("Figma基準画像の読み込みがタイムアウトしました。")),
      15_000,
    );
    image.addEventListener("load", () => {
      window.clearTimeout(timeout);
      resolve();
    }, { once: true });
    image.addEventListener("error", () => {
      window.clearTimeout(timeout);
      reject(new Error("Figma基準画像を読み込めませんでした。変換をやり直してください。"));
    }, { once: true });
  });
  return image;
}

function captureSize(
  reference: VisualQaReference,
  variant: "desktop" | "mobile",
): { width: number; height: number } {
  const preferredWidth = variant === "mobile" ? 440 : 800;
  let width = Math.max(1, Math.round(Math.min(reference.width, preferredWidth)));
  let height = Math.max(1, Math.round(width * (reference.height / reference.width)));
  if (width * height > MAX_CAPTURE_PIXELS) {
    const scale = Math.sqrt(MAX_CAPTURE_PIXELS / (width * height));
    width = Math.max(1, Math.floor(width * scale));
    height = Math.max(1, Math.floor(height * scale));
  }
  return { width, height };
}

function regionInput(
  element: HTMLElement,
): VisualQaRegionInput | null {
  const rect = element.getBoundingClientRect();
  const nodeId = element.dataset.figmapressNodeId;
  if (!nodeId || rect.width <= 0 || rect.height <= 0) return null;
  return {
    nodeId,
    name: element.dataset.figmapressNodeName || nodeId,
    x: rect.left,
    y: rect.top,
    width: rect.width,
    height: rect.height,
  };
}

export async function runVisualQa(
  reference: VisualQaReference,
  sourceDocument: string,
  variant: "desktop" | "mobile",
): Promise<VisualQaBrowserResult> {
  const { width, height } = captureSize(reference, variant);
  const frame = document.createElement("iframe");
  frame.setAttribute("aria-hidden", "true");
  frame.setAttribute("sandbox", "allow-same-origin");
  frame.style.cssText = [
    "position:fixed",
    "left:-12000px",
    "top:0",
    `width:${width}px`,
    `height:${height}px`,
    "border:0",
    "pointer-events:none",
    "z-index:-1",
  ].join(";");
  document.body.append(frame);

  try {
    const loaded = waitForFrame(frame, 10_000);
    frame.srcdoc = sourceDocument;
    await loaded;
    const frameDocument = frame.contentDocument;
    if (!frameDocument) {
      throw new Error("生成ページの比較画面を準備できませんでした。");
    }

    frameDocument.querySelectorAll<HTMLImageElement>("img").forEach((image) => {
      image.removeAttribute("srcset");
      const source = image.getAttribute("src");
      if (source) image.src = proxiedImageUrl(source);
    });
    frameDocument.querySelectorAll<HTMLElement>("[style]").forEach((element) => {
      const rawStyle = element.getAttribute("style");
      if (rawStyle?.includes("url(")) {
        element.setAttribute("style", rewriteCssUrls(rawStyle));
      }
    });
    frameDocument.querySelectorAll<HTMLStyleElement>("style").forEach((style) => {
      if (style.textContent?.includes("url(")) {
        style.textContent = rewriteCssUrls(style.textContent);
      }
    });

    await Promise.all(
      Array.from(frameDocument.images, (image) => waitForImage(image, 8_000)),
    );
    await frameDocument.fonts?.ready;
    const visiblePreviews = Array.from(
      frameDocument.querySelectorAll<HTMLElement>(".figmapress-figma-preview"),
    ).filter(
      (element) =>
        frameDocument.defaultView?.getComputedStyle(element).display !== "none"
        && element.getBoundingClientRect().height > 0,
    );
    const visiblePreview = visiblePreviews
      .slice()
      .sort(
        (left, right) =>
          right.getBoundingClientRect().height - left.getBoundingClientRect().height,
      )[0];
    const generatedHeight = visiblePreview
      ? visiblePreview.getBoundingClientRect().height
      : Math.max(1, frameDocument.body.scrollHeight);
    const sectionRegions = visiblePreview
      ? Array.from(visiblePreview.children)
          .map((element) => regionInput(element as HTMLElement))
          .filter((region): region is VisualQaRegionInput => region !== null)
      : [];
    const textRegions = visiblePreview
      ? Array.from(
          visiblePreview.querySelectorAll<HTMLElement>(
            '[data-figmapress-kind="text"]',
          ),
        )
          .map(regionInput)
          .filter((region): region is VisualQaRegionInput => region !== null)
      : [];

    const targetCanvas = await html2canvas(frameDocument.documentElement, {
      allowTaint: false,
      backgroundColor: "#ffffff",
      height,
      logging: false,
      scale: 1,
      useCORS: true,
      width,
      windowHeight: height,
      windowWidth: width,
      x: 0,
      y: 0,
    });
    const referenceImage = await loadReferenceImage(reference.url);
    const referenceCanvas = document.createElement("canvas");
    referenceCanvas.width = width;
    referenceCanvas.height = height;
    const referenceContext = referenceCanvas.getContext("2d", {
      willReadFrequently: true,
    });
    const targetContext = targetCanvas.getContext("2d", {
      willReadFrequently: true,
    });
    if (!referenceContext || !targetContext) {
      throw new Error("ブラウザが画像比較に対応していません。");
    }
    referenceContext.drawImage(referenceImage, 0, 0, width, height);

    const referencePixels = referenceContext.getImageData(0, 0, width, height);
    const targetPixels = targetContext.getImageData(0, 0, width, height);
    const analysis = analyzeVisualPixels(
      referencePixels.data,
      targetPixels.data,
      width,
      height,
      24,
      generatedHeight,
    );
    const sections = analyzeVisualRegions(
      referencePixels.data,
      targetPixels.data,
      width,
      height,
      sectionRegions,
    ).slice(0, 6);
    const textNodes = analyzeVisualRegions(
      referencePixels.data,
      targetPixels.data,
      width,
      height,
      textRegions,
    ).slice(0, 8);
    const topTextDifference = textNodes.find(
      (region) => region.changedPixelRatio >= 8 && region.impactRatio >= 0.01,
    );
    const recommendations = topTextDifference
      ? [
          ...analysis.metrics.recommendations,
          `文字「${topTextDifference.name}」の差分影響が大きいため、文字幅・明示改行・行高を優先して確認してください。`,
        ]
      : analysis.metrics.recommendations;
    const diffCanvas = document.createElement("canvas");
    diffCanvas.width = width;
    diffCanvas.height = height;
    const diffContext = diffCanvas.getContext("2d");
    if (!diffContext) {
      throw new Error("差分画像を生成できませんでした。");
    }
    const diffImageData = diffContext.createImageData(width, height);
    diffImageData.data.set(analysis.diffPixels);
    diffContext.putImageData(diffImageData, 0, 0);

    return {
      ...analysis.metrics,
      recommendations,
      variant,
      referenceName: reference.name,
      referenceNodeId: reference.nodeId,
      sections,
      textNodes,
      diffImageUrl: diffCanvas.toDataURL("image/png"),
    };
  } finally {
    frame.remove();
  }
}
