import html2canvas from "html2canvas";
import {
  analyzeVisualRegions,
  analyzeVisualPixels,
  clampVisibleBottom,
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
  sourceWidth: number;
  sourceHeight: number;
  format: "png" | "jpg";
}

export interface VisualQaBrowserResult extends VisualQaMetrics {
  variant: "desktop" | "tablet" | "mobile";
  referenceName: string;
  referenceNodeId: string;
  renderWidth: number;
  renderHeight: number;
  sections: VisualQaRegionMetrics[];
  textNodes: VisualQaRegionMetrics[];
  visualNodes: VisualQaRegionMetrics[];
  decorationNodes: VisualQaRegionMetrics[];
  referenceImageUrl: string;
  previewImageUrl: string;
  diffImageUrl: string;
}

// Figma's reference exporter already caps long images at eight million
// pixels. Measure on that exact pixel grid instead of shrinking desktop
// references to 800px and resampling the reference a second time.
const MAX_CAPTURE_PIXELS = 8_000_000;

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
    let settled = false;
    let poll = 0;
    const finish = () => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeout);
      window.clearInterval(poll);
      resolve();
    };
    const timeout = window.setTimeout(
      () => {
        if (settled) return;
        settled = true;
        window.clearInterval(poll);
        reject(new Error("生成ページの準備がタイムアウトしました。"));
      },
      timeoutMs,
    );
    frame.addEventListener("load", finish, { once: true });
    poll = window.setInterval(() => {
      const document = frame.contentDocument;
      // iframe load waits for every image and font. The next stages already
      // wait for those resources independently, so continue as soon as the
      // srcdoc DOM itself is ready instead of reporting a false timeout.
      if (
        document?.URL === "about:srcdoc"
        && document.body
        && document.readyState !== "loading"
      ) {
        finish();
      }
    }, 50);
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

function waitForStylesheet(
  stylesheet: HTMLLinkElement,
  timeoutMs: number,
): Promise<void> {
  if (stylesheet.sheet) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(
      () => reject(new Error("実ページのスタイルシート読み込みがタイムアウトしました。")),
      timeoutMs,
    );
    const finish = () => {
      window.clearTimeout(timeout);
      resolve();
    };
    const fail = () => {
      window.clearTimeout(timeout);
      reject(new Error("実ページのスタイルシートを読み込めませんでした。"));
    };
    stylesheet.addEventListener("load", finish, { once: true });
    stylesheet.addEventListener("error", fail, { once: true });
  });
}

async function waitForStylesheets(
  document: Document,
  timeoutMs: number,
): Promise<void> {
  await Promise.all(
    Array.from(
      document.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"]'),
      (stylesheet) => waitForStylesheet(stylesheet, timeoutMs),
    ),
  );
}

async function waitForFonts(
  document: Document,
  timeoutMs: number,
): Promise<void> {
  if (!document.fonts) return;
  let timeout = 0;
  try {
    await Promise.race([
      document.fonts.ready.then(() => undefined),
      new Promise<void>((resolve) => {
        timeout = window.setTimeout(
          resolve,
          timeoutMs,
        );
      }),
    ]);
  } finally {
    window.clearTimeout(timeout);
  }
}

function enforceElementorResponsiveVariant(
  document: Document,
  variant: "desktop" | "tablet" | "mobile",
): void {
  const layouts = Array.from(
    document.querySelectorAll<HTMLElement>(
      ".figmapress-layout, .figmapress-figma-preview",
    ),
  );
  const hasResponsiveLayouts = layouts.some((layout) =>
    layout.classList.contains("figmapress-layout--desktop")
    || layout.classList.contains("figmapress-layout--tablet")
    || layout.classList.contains("figmapress-layout--mobile")
    || layout.classList.contains("figmapress-figma-preview--desktop")
    || layout.classList.contains("figmapress-figma-preview--mobile"),
  );
  if (!hasResponsiveLayouts) return;

  layouts.forEach((layout) => {
    const matchesVariant =
      layout.classList.contains(`figmapress-layout--${variant}`)
      || layout.classList.contains(`figmapress-figma-preview--${variant}`);
    layout.style.setProperty(
      "display",
      matchesVariant ? "var(--display, flex)" : "none",
      "important",
    );
    layout.toggleAttribute("aria-hidden", !matchesVariant);
  });
}

function clipsVerticalOverflow(style: CSSStyleDeclaration | undefined): boolean {
  const overflow = style?.overflowY || style?.overflow;
  return overflow === "hidden"
    || overflow === "clip"
    || overflow === "auto"
    || overflow === "scroll";
}

function renderedContentHeight(element: HTMLElement): number {
  const rootRect = element.getBoundingClientRect();
  const view = element.ownerDocument.defaultView;
  const rootClipsOverflow = clipsVerticalOverflow(view?.getComputedStyle(element));
  let bottom = rootRect.bottom;
  element.querySelectorAll<HTMLElement>("*").forEach((descendant) => {
    const descendantView = descendant.ownerDocument.defaultView;
    const style = descendantView?.getComputedStyle(descendant);
    if (
      style?.display === "none"
      || style?.visibility === "hidden"
      || style?.position === "fixed"
    ) {
      return;
    }
    const rect = descendant.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    const clippingBottoms: number[] = [];
    let ancestor = descendant.parentElement;
    while (ancestor) {
      const ancestorStyle = descendantView?.getComputedStyle(ancestor);
      if (clipsVerticalOverflow(ancestorStyle)) {
        clippingBottoms.push(ancestor.getBoundingClientRect().bottom);
      }
      if (ancestor === element) break;
      ancestor = ancestor.parentElement;
    }
    bottom = Math.max(
      bottom,
      clampVisibleBottom(rect.bottom, clippingBottoms),
    );
  });
  return Math.max(
    rootRect.height,
    rootClipsOverflow ? rootRect.height : element.scrollHeight,
    bottom - rootRect.top,
  );
}

async function loadReferenceImage(url: string): Promise<HTMLImageElement> {
  const image = new Image();
  image.decoding = "async";
  image.fetchPriority = "high";
  image.src = proxiedImageUrl(url);
  await new Promise<void>((resolve, reject) => {
    const timeout = window.setTimeout(
      () => reject(new Error("Figma基準画像の読み込みがタイムアウトしました。")),
      45_000,
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
): {
  width: number;
  height: number;
  renderWidth: number;
  renderHeight: number;
  captureScale: number;
} {
  const renderWidth = Math.max(1, Math.round(reference.sourceWidth));
  const renderHeight = Math.max(1, Math.round(reference.sourceHeight));
  let width = Math.max(
    1,
    Math.round(Math.min(reference.width, renderWidth)),
  );
  let height = Math.max(1, Math.round(width * (reference.height / reference.width)));
  if (width * height > MAX_CAPTURE_PIXELS) {
    const scale = Math.sqrt(MAX_CAPTURE_PIXELS / (width * height));
    width = Math.max(1, Math.floor(width * scale));
    height = Math.max(1, Math.floor(height * scale));
  }
  return {
    width,
    height,
    renderWidth,
    renderHeight,
    captureScale: width / renderWidth,
  };
}

function regionInput(
  element: HTMLElement,
  scale = 1,
): VisualQaRegionInput | null {
  const rect = element.getBoundingClientRect();
  const nodeId = element.dataset.figmapressNodeId;
  if (!nodeId || rect.width <= 0 || rect.height <= 0) return null;
  return {
    nodeId,
    name: element.dataset.figmapressNodeName || nodeId,
    x: rect.left * scale,
    y: rect.top * scale,
    width: rect.width * scale,
    height: rect.height * scale,
  };
}

function verifiedExactSnapshot(
  visiblePreview: HTMLElement | undefined,
  reference: VisualQaReference,
  renderWidth: number,
  renderHeight: number,
): HTMLImageElement | null {
  if (
    !visiblePreview?.classList.contains("figmapress-exact-preview")
    || visiblePreview.children.length !== 1
  ) {
    return null;
  }
  const image = visiblePreview.querySelector<HTMLImageElement>(
    'img[data-figmapress-exact-snapshot="true"]',
  );
  if (
    !image
    || visiblePreview.firstElementChild !== image
    || !image.complete
    || image.naturalWidth <= 0
    || image.naturalHeight <= 0
  ) {
    return null;
  }
  if (image.dataset.figmapressReferenceNodeId !== reference.nodeId) {
    return null;
  }
  const rootRect = visiblePreview.getBoundingClientRect();
  const imageRect = image.getBoundingClientRect();
  const fillsReferenceViewport =
    Math.abs(rootRect.width - renderWidth) <= 1
    && Math.abs(rootRect.height - renderHeight) <= 1
    && Math.abs(imageRect.left - rootRect.left) <= 1
    && Math.abs(imageRect.top - rootRect.top) <= 1
    && Math.abs(imageRect.width - rootRect.width) <= 1
    && Math.abs(imageRect.height - rootRect.height) <= 1;
  return fillsReferenceViewport ? image : null;
}

export async function runVisualQa(
  reference: VisualQaReference,
  sourceDocument: string,
  variant: "desktop" | "tablet" | "mobile",
): Promise<VisualQaBrowserResult> {
  const {
    width,
    height,
    renderWidth,
    renderHeight,
    captureScale,
  } = captureSize(reference);
  // JPEG is the only Figma-supported reference format for very long pages.
  // Ignore its small block/compression noise while keeping the stricter
  // lossless threshold for ordinary PNG references.
  const pixelThreshold = reference.format === "jpg" ? 32 : 24;
  // Fetch the visual source of truth before the preview starts requesting up
  // to one hundred proxied assets. Long pages otherwise place this request at
  // the back of the same-origin browser queue and can report a false 45s
  // timeout even though the Figma image itself is valid.
  const referenceImage = await loadReferenceImage(reference.url);
  const frame = document.createElement("iframe");
  frame.setAttribute("aria-hidden", "true");
  frame.setAttribute("sandbox", "allow-same-origin");
  frame.style.cssText = [
    "position:fixed",
    "left:-12000px",
    "top:0",
    `width:${renderWidth}px`,
    `height:${renderHeight}px`,
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

    // Pin the target before assigning proxied media URLs. The source contains
    // both PC and mobile trees; downloading the hidden tree doubled requests,
    // exhausted the image budget and could starve the Figma reference itself.
    enforceElementorResponsiveVariant(frameDocument, variant);
    frameDocument.querySelectorAll<HTMLImageElement>("img").forEach((image) => {
      image.removeAttribute("srcset");
      const responsiveRoot = image.closest<HTMLElement>(
        ".figmapress-layout, .figmapress-figma-preview",
      );
      if (responsiveRoot?.getAttribute("aria-hidden") === "true") {
        image.removeAttribute("src");
        return;
      }
      // Elementor marks below-the-fold media as lazy. The comparison iframe is
      // intentionally positioned off screen, so those images would otherwise
      // never become viewport candidates and html2canvas would capture blanks.
      image.setAttribute("loading", "eager");
      const source = image.getAttribute("src");
      if (source) image.src = proxiedImageUrl(source);
    });
    frameDocument.querySelectorAll<HTMLElement>("[style]").forEach((element) => {
      const responsiveRoot = element.closest<HTMLElement>(
        ".figmapress-layout, .figmapress-figma-preview",
      );
      if (responsiveRoot?.getAttribute("aria-hidden") === "true") return;
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

    // DOM readiness intentionally does not wait for slow media, but the
    // WordPress snapshot contains external Elementor stylesheets. Measuring
    // before those links finish produces a stable yet misleading low score.
    // Wait for CSS first because it can also discover fonts and backgrounds.
    await waitForStylesheets(frameDocument, 12_000);
    // Elementor's responsive visibility rules depend on the complete frontend
    // page context. The authenticated snapshot intentionally contains only the
    // rendered document, so those rules can otherwise leave both the PC and
    // mobile roots visible and produce a confidently wrong comparison. Pin the
    // requested variant explicitly inside this isolated QA document.
    enforceElementorResponsiveVariant(frameDocument, variant);
    await Promise.all(
      Array.from(frameDocument.images, (image) => waitForImage(image, 8_000)),
    );
    await waitForFonts(frameDocument, 12_000);
    const visiblePreviews = Array.from(
      frameDocument.querySelectorAll<HTMLElement>(
        ".figmapress-figma-preview, .figmapress-layout",
      ),
    ).filter(
      (element) =>
        frameDocument.defaultView?.getComputedStyle(element).display !== "none"
        && element.getBoundingClientRect().height > 0,
    );
    const visiblePreview = visiblePreviews.find((element) =>
      element.classList.contains("figmapress-exact-preview")
    ) ?? visiblePreviews
      .slice()
      .sort(
        (left, right) =>
          right.getBoundingClientRect().height - left.getBoundingClientRect().height,
      )[0];
    const visibleElementorLayouts = visiblePreviews.filter((element) =>
      element.classList.contains("figmapress-layout"),
    );
    if (
      frameDocument.querySelector(".figmapress-layout--desktop, .figmapress-layout--tablet, .figmapress-layout--mobile")
      && visibleElementorLayouts.length !== 1
    ) {
      throw new Error(
        "実ページのPC／タブレット／スマホ表示を分離できませんでした。Connectorを更新して再試行してください。",
      );
    }
    const exactSnapshot = verifiedExactSnapshot(
      visiblePreview,
      reference,
      renderWidth,
      renderHeight,
    );
    const generatedHeight = visiblePreview
      ? renderedContentHeight(visiblePreview)
      : Math.max(1, frameDocument.body.scrollHeight);
    const markedSections = visiblePreview
      ? Array.from(
          visiblePreview.querySelectorAll<HTMLElement>(
            '[data-figmapress-section="true"]',
          ),
        )
      : [];
    const sectionRegions = visiblePreview
      ? (markedSections.length
          ? markedSections
          : Array.from(visiblePreview.children) as HTMLElement[])
          .map((element) => regionInput(element as HTMLElement, captureScale))
          .filter((region): region is VisualQaRegionInput => region !== null)
      : [];
    const textRegions = visiblePreview
      ? Array.from(
          visiblePreview.querySelectorAll<HTMLElement>(
            '[data-figmapress-kind="text"]',
          ),
        )
          .map((element) => regionInput(element, captureScale))
          .filter((region): region is VisualQaRegionInput => region !== null)
          .filter(
            (region) =>
              region.x < width
              && region.y < height
              && region.x + region.width > 0
              && region.y + region.height > 0,
          )
          .sort(
            (left, right) =>
              right.width * right.height - left.width * left.height,
          )
          .slice(0, 24)
      : [];
    const visualRegions = visiblePreview
      ? Array.from(
          visiblePreview.querySelectorAll<HTMLElement>(
            '[data-figmapress-kind="visual"]',
          ),
        )
          .map((element) => regionInput(element, captureScale))
          .filter((region): region is VisualQaRegionInput => region !== null)
          .filter(
            (region) =>
              region.x < width
              && region.y < height
              && region.x + region.width > 0
              && region.y + region.height > 0,
          )
          .sort(
            (left, right) =>
              right.width * right.height - left.width * left.height,
          )
          .slice(0, 24)
      : [];
    const decorationRegions = visiblePreview
      ? Array.from(
          visiblePreview.querySelectorAll<HTMLElement>(
            '[data-figmapress-kind="container"]',
          ),
        )
          .filter(
            (element) =>
              element.children.length === 0
              && !element.textContent?.trim()
              && !element.querySelector("[data-figmapress-node-id]"),
          )
          .map((element) => regionInput(element, captureScale))
          .filter((region): region is VisualQaRegionInput => region !== null)
          .filter(
            (region) =>
              region.x < width
              && region.y < height
              && region.x + region.width > 0
              && region.y + region.height > 0,
          )
          .sort(
            (left, right) =>
              right.width * right.height - left.width * left.height,
          )
          .slice(0, 24)
      : [];

    const targetCanvas = await html2canvas(frameDocument.documentElement, {
      allowTaint: false,
      backgroundColor: "#ffffff",
      height: renderHeight,
      logging: false,
      scale: captureScale,
      useCORS: true,
      width: renderWidth,
      windowHeight: renderHeight,
      windowWidth: renderWidth,
      x: 0,
      y: 0,
    });
    const referenceCanvas = document.createElement("canvas");
    referenceCanvas.width = width;
    referenceCanvas.height = height;
    const referenceContext = referenceCanvas.getContext("2d", {
      willReadFrequently: true,
    });
    const comparisonTargetCanvas = exactSnapshot
      ? document.createElement("canvas")
      : targetCanvas;
    if (exactSnapshot) {
      comparisonTargetCanvas.width = width;
      comparisonTargetCanvas.height = height;
      comparisonTargetCanvas.getContext("2d")?.drawImage(
        exactSnapshot,
        0,
        0,
        width,
        height,
      );
    }
    const targetContext = comparisonTargetCanvas.getContext("2d", {
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
      pixelThreshold,
      generatedHeight * captureScale,
    );
    const sections = analyzeVisualRegions(
      referencePixels.data,
      targetPixels.data,
      width,
      height,
      sectionRegions,
      pixelThreshold,
      8,
    ).slice(0, 6);
    const textNodes = analyzeVisualRegions(
      referencePixels.data,
      targetPixels.data,
      width,
      height,
      textRegions,
      pixelThreshold,
      0,
      true,
    ).slice(0, 8);
    const visualNodes = analyzeVisualRegions(
      referencePixels.data,
      targetPixels.data,
      width,
      height,
      visualRegions,
      pixelThreshold,
      0,
      true,
    ).slice(0, 8);
    const decorationNodes = analyzeVisualRegions(
      referencePixels.data,
      targetPixels.data,
      width,
      height,
      decorationRegions,
      pixelThreshold,
      0,
      true,
    ).slice(0, 8);
    const topTextGeometry = textNodes.find(
      (region) => region.geometry?.safeToApply,
    );
    const topVisualGeometry = visualNodes.find(
      (region) => region.geometry?.safeToApply,
    );
    const topDecorationGeometry = decorationNodes.find(
      (region) => region.geometry?.safeToApply,
    );
    const topTextDifference = textNodes.find(
      (region) => region.changedPixelRatio >= 8 && region.impactRatio >= 0.01,
    );
    const recommendations = topTextGeometry
      ? [
          ...analysis.metrics.recommendations,
          topTextGeometry.geometry!.reason,
        ]
      : topVisualGeometry
        ? [
            ...analysis.metrics.recommendations,
            `画像「${topVisualGeometry.name}」は${topVisualGeometry.geometry!.reason}`,
          ]
      : topDecorationGeometry
        ? [
            ...analysis.metrics.recommendations,
            `背景・枠「${topDecorationGeometry.name}」は${topDecorationGeometry.geometry!.reason}`,
          ]
      : topTextDifference
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
      renderWidth,
      renderHeight,
      sections,
      textNodes,
      visualNodes,
      decorationNodes,
      referenceImageUrl: referenceCanvas.toDataURL("image/jpeg", 0.82),
      previewImageUrl: targetCanvas.toDataURL("image/jpeg", 0.82),
      diffImageUrl: diffCanvas.toDataURL("image/png"),
    };
  } finally {
    frame.remove();
  }
}
