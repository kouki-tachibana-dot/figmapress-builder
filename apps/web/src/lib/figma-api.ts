import type {
  FigmaNode,
  FigmaStylesShape,
  MockFigmaFile,
} from "@figmapress/figma-parser";
import {
  discoverFigmaPageCandidates,
  pruneFigmaDocumentToFrames,
  selectedFigmaFrameIds,
  type FigmaPageCandidate,
} from "./figma-frame-selection";
import { RequestError } from "./request-security";

const FIGMA_FILE_KEY = /^[A-Za-z0-9_-]{6,160}$/;
const MAX_FIGMA_RESPONSE_BYTES = 24_000_000;
const FIGMA_IMAGE_URL_ATTEMPTS = 3;

export interface FigmaFetchResult {
  file: MockFigmaFile;
  fileName: string;
  pageTitle: string;
  pageCandidates: FigmaPageCandidate[];
  imageUrls: Record<string, string>;
  renderedNodeUrls: Record<string, string>;
  visualReferences: FigmaVisualReferences;
  warnings: string[];
}

export class FigmaFrameSelectionRequired extends Error {
  readonly candidates: FigmaPageCandidate[];

  constructor(candidates: FigmaPageCandidate[]) {
    super("このFigmaページには複数のWebページ候補があります。");
    this.name = "FigmaFrameSelectionRequired";
    this.candidates = candidates;
  }
}

export interface FigmaVisualReference {
  nodeId: string;
  name: string;
  url: string;
  width: number;
  height: number;
  sourceWidth: number;
  sourceHeight: number;
  format: "png" | "jpg";
}

export interface FigmaVisualReferences {
  desktop?: FigmaVisualReference;
  mobile?: FigmaVisualReference;
}

export interface FigmaReference {
  fileKey: string;
  nodeId?: string;
}

interface FigmaStyleMeta {
  name?: unknown;
  styleType?: unknown;
}

interface RawFigmaFile extends Record<string, unknown> {
  document: FigmaNode;
  styles?: Record<string, FigmaStyleMeta>;
}

export function extractFigmaReference(input: string): FigmaReference {
  const value = input.trim();
  if (FIGMA_FILE_KEY.test(value)) return { fileKey: value };

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new RequestError("FigmaのURLまたはファイルキーを確認してください。");
  }

  if (!/(^|\.)figma\.com$/i.test(url.hostname)) {
    throw new RequestError("figma.com のファイルURLを入力してください。");
  }
  const parts = url.pathname.split("/").filter(Boolean);
  const typeIndex = parts.findIndex((part) =>
    ["design", "file", "proto", "board"].includes(part),
  );
  const fileKey = typeIndex >= 0 ? parts[typeIndex + 1] : undefined;
  if (!fileKey || !FIGMA_FILE_KEY.test(fileKey)) {
    throw new RequestError("Figma URLからファイルキーを取得できませんでした。");
  }

  const rawNodeId = url.searchParams.get("node-id")?.trim();
  const nodeId = rawNodeId && /^[0-9]+(?::|-)[0-9]+$/.test(rawNodeId)
    ? rawNodeId.replace("-", ":")
    : undefined;
  return { fileKey, nodeId };
}

export function extractFigmaFileKey(input: string): string {
  return extractFigmaReference(input).fileKey;
}

async function readLimitedJson(response: Response): Promise<unknown> {
  const contentLength = Number(response.headers.get("content-length") ?? "0");
  if (contentLength > MAX_FIGMA_RESPONSE_BYTES) {
    throw new RequestError("Figmaファイルが大きすぎます。対象ページを小さくしてください。", 413);
  }
  const raw = await response.text();
  if (Buffer.byteLength(raw, "utf8") > MAX_FIGMA_RESPONSE_BYTES) {
    throw new RequestError("Figmaファイルが大きすぎます。対象ページを小さくしてください。", 413);
  }
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    throw new RequestError("Figma APIから不正な応答が返されました。", 502);
  }
}

function figmaError(
  status: number,
  authentication: "pat" | "oauth",
): RequestError {
  if (status === 401 && authentication === "oauth") {
    return new RequestError(
      "Figma OAuthアプリが未公開（ドラフト）か、接続が失効しています。アプリ所有者はFigmaで2FAを有効化し、「レビュー用に送信」後、承認されてから再試行してください。",
      401,
    );
  }
  if (status === 401) {
    return new RequestError(
      "Figma Personal Access Tokenが無効または期限切れです。file_content:read付きの新しいトークンを入力してください。",
      401,
    );
  }
  if (status === 403 && authentication === "oauth") {
    return new RequestError(
      "Figma OAuthアプリが未公開（ドラフト）または審査未承認か、接続中のアカウントに対象ファイルの閲覧権限がありません。アプリ所有者はFigmaで2FAを有効化し、「レビュー用に送信」後、承認されてから再試行してください。",
      403,
    );
  }
  if (status === 403) {
    return new RequestError(
      "Figmaアカウントに対象ファイルの閲覧権限がないか、Personal Access Tokenにfile_content:read権限がありません。対象ファイルを共有するか、権限付きのトークンを入力してください。",
      403,
    );
  }
  if (status === 404) return new RequestError("Figmaファイルが見つかりません。", 404);
  if (status === 429) {
    return new RequestError("Figma APIの利用上限に達しました。後で再試行してください。", 429);
  }
  return new RequestError(`Figma APIへの接続に失敗しました（${status}）。`, 502);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function colorToHex(color: { r: number; g: number; b: number }): string {
  const byte = (value: number) => Math.max(0, Math.min(255, Math.round(value * 255)))
    .toString(16)
    .padStart(2, "0");
  return `#${byte(color.r)}${byte(color.g)}${byte(color.b)}`.toUpperCase();
}

function normalizeFigmaFile(data: RawFigmaFile): MockFigmaFile {
  const styleMeta = isRecord(data.styles) ? data.styles : {};
  const colors = new Map<string, { name: string; value: string }>();
  const typography = new Map<string, NonNullable<FigmaStylesShape["typography"]>[number]>();
  const spacing = new Map<number, { name: string; size: string }>();

  const visit = (node: FigmaNode): void => {
    for (const fill of node.fills ?? []) {
      if (fill.type !== "SOLID" || !fill.color || fill.visible === false) continue;
      const value = colorToHex(fill.color);
      const styleId = node.styles?.fill;
      const meta = styleId && isRecord(styleMeta[styleId]) ? styleMeta[styleId] : undefined;
      const name = typeof meta?.name === "string" ? meta.name : node.name || value;
      colors.set(value, { name, value });
    }

    if (node.type === "TEXT" && node.style?.fontFamily) {
      const fontSize = node.style.fontSize;
      const fontWeight = node.style.fontWeight;
      const key = `${node.style.fontFamily}:${fontSize ?? ""}:${fontWeight ?? ""}`;
      const styleId = node.styles?.text;
      const meta = styleId && isRecord(styleMeta[styleId]) ? styleMeta[styleId] : undefined;
      typography.set(key, {
        name: typeof meta?.name === "string" ? meta.name : node.name || "Text",
        fontFamily: node.style.fontFamily,
        fontSize: fontSize ? `${fontSize}px` : undefined,
        fontWeight,
      });
    }

    for (const value of [
      node.itemSpacing,
      node.paddingTop,
      node.paddingRight,
      node.paddingBottom,
      node.paddingLeft,
    ]) {
      if (typeof value === "number" && value > 0 && value <= 512) {
        spacing.set(value, { name: `Spacing ${value}`, size: `${value}px` });
      }
    }
    for (const child of node.children ?? []) visit(child);
  };
  visit(data.document);

  return {
    document: data.document,
    styles: {
      colors: [...colors.values()],
      typography: [...typography.values()],
      spacing: [...spacing.values()].sort((a, b) => parseFloat(a.size) - parseFloat(b.size)),
    },
  };
}

const FIGMA_RENDERABLE_TYPES = new Set([
  "BOOLEAN_OPERATION",
  "ELLIPSE",
  "LINE",
  "POLYGON",
  "STAR",
  "VECTOR",
]);
const FIGMA_RENDER_GROUP_TYPES = new Set([
  "COMPONENT",
  "COMPONENT_SET",
  "FRAME",
  "GROUP",
  "INSTANCE",
]);
const MAX_RENDERED_NODES = 160;

interface RenderCandidate {
  id: string;
  order: number;
  priority: number;
}

function findNodeById(node: FigmaNode, id: string): FigmaNode | null {
  if (node.id === id) return node;
  for (const child of node.children ?? []) {
    const match = findNodeById(child, id);
    if (match) return match;
  }
  return null;
}

function responsiveFrameKind(node: FigmaNode): "desktop" | "mobile" | null {
  const bounds = node.absoluteBoundingBox;
  if (!bounds) return null;
  const name = node.name.toLowerCase();
  const desktopName = /(?:^|[\/_\s-])(?:pc|desktop)(?:$|[\/_\s-])|デスクトップ/.test(name);
  const mobileName = /(?:^|[\/_\s-])(?:sp|mobile|phone)(?:$|[\/_\s-])|スマホ/.test(name);
  if (desktopName && bounds.width >= 768) return "desktop";
  if (mobileName && bounds.width <= 768) return "mobile";
  return null;
}

function responsivePageRoots(document: FigmaNode): {
  desktop: FigmaNode | null;
  mobile: FigmaNode | null;
} {
  const candidates = (document.children ?? [])
    .filter((node) => node.type === "CANVAS")
    .flatMap((canvas) => canvas.children ?? [])
    .filter((node) => node.visible !== false && node.absoluteBoundingBox);
  return {
    desktop: candidates.find((node) => responsiveFrameKind(node) === "desktop") ?? null,
    mobile: candidates.find((node) => responsiveFrameKind(node) === "mobile") ?? null,
  };
}

function hasText(node: FigmaNode): boolean {
  if (node.type === "TEXT" && node.characters?.trim()) return true;
  return (node.children ?? []).some(hasText);
}

function hasOwnImageFill(node: FigmaNode): boolean {
  return node.fills?.some((fill) => fill.visible !== false && fill.type === "IMAGE") === true;
}

export function collectVisibleImageRefs(document: FigmaNode): string[] {
  const refs = new Set<string>();
  const visit = (node: FigmaNode): void => {
    if (node.visible === false) return;
    for (const fill of node.fills ?? []) {
      if (
        fill.visible !== false
        && fill.type === "IMAGE"
        && typeof fill.imageRef === "string"
        && fill.imageRef
      ) {
        refs.add(fill.imageRef);
      }
    }
    for (const child of node.children ?? []) visit(child);
  };
  visit(document);
  return [...refs];
}

export function collectUncoveredVisibleImageRefs(
  document: FigmaNode,
  imageUrls: Record<string, string>,
  renderedNodeUrls: Record<string, string>,
): string[] {
  const refs = new Set<string>();
  const visit = (node: FigmaNode, renderedAncestor: boolean): void => {
    if (node.visible === false || (typeof node.opacity === "number" && node.opacity <= 0)) return;
    const rendered = renderedAncestor || Boolean(renderedNodeUrls[node.id]);
    const bounds = node.absoluteBoundingBox;
    const nodeCanPaint = Boolean(bounds && bounds.width > 0 && bounds.height > 0);
    if (!rendered && nodeCanPaint) {
      for (const fill of node.fills ?? []) {
        if (
          fill.visible !== false
          && fill.type === "IMAGE"
          && (typeof fill.opacity !== "number" || fill.opacity > 0)
          && typeof fill.imageRef === "string"
          && fill.imageRef
          && !imageUrls[fill.imageRef]
        ) {
          refs.add(fill.imageRef);
        }
      }
    }
    for (const child of node.children ?? []) visit(child, rendered);
  };
  visit(document, false);
  return [...refs];
}

function hasImageFill(node: FigmaNode): boolean {
  if (hasOwnImageFill(node)) return true;
  return (node.children ?? []).some(hasImageFill);
}

function hasComplexVisual(node: FigmaNode): boolean {
  if (FIGMA_RENDERABLE_TYPES.has(node.type) || hasImageFill(node)) return true;
  return (node.children ?? []).some(hasComplexVisual);
}

function visibleImagePaint(node: FigmaNode) {
  return node.fills?.find((fill) => fill.visible !== false && fill.type === "IMAGE");
}

function hasMask(node: FigmaNode): boolean {
  if (node.isMask || /(?:^|\s)mask(?:\s|$)/i.test(node.name)) return true;
  return (node.children ?? []).some(hasMask);
}

function hasAdjustedImage(node: FigmaNode): boolean {
  const paint = visibleImagePaint(node);
  if (paint) {
    const filters = Object.values(paint.filters ?? {}).some((value) =>
      typeof value === "number" && Math.abs(value) > 0.0001
    );
    return paint.scaleMode === "STRETCH"
      || paint.scaleMode === "TILE"
      || Boolean(paint.imageTransform)
      || Boolean(paint.rotation)
      || filters;
  }
  return (node.children ?? []).some(hasAdjustedImage);
}

function renderPriority(node: FigmaNode): number {
  const bounds = node.absoluteBoundingBox;
  const areaBonus = bounds
    ? Math.min(50, Math.max(0, Math.round(Math.log10(Math.max(1, bounds.width * bounds.height)) * 8)))
    : 0;
  if (hasMask(node)) return 500 + areaBonus;
  if (hasAdjustedImage(node)) return 400 + areaBonus;
  if (hasImageFill(node)) return 300 + areaBonus;
  if (FIGMA_RENDER_GROUP_TYPES.has(node.type)) return 200 + areaBonus;
  return 100 + areaBonus;
}

/**
 * Export the highest text-free visual subtree as one image. Text stays as
 * native Elementor widgets, while masks, vectors and Figma image crops keep
 * their exact appearance without exploding the document into tiny paths.
 * Candidates are ranked so masks and adjusted image fills are not displaced
 * by small decorative vectors when a large responsive design reaches the API
 * render budget.
 */
export function collectRenderedNodeIds(document: FigmaNode): string[] {
  const collect = (root: FigmaNode, limit: number): string[] => {
    const candidates: RenderCandidate[] = [];
    let order = 0;
    const visit = (node: FigmaNode, functionalVisual = false): void => {
      if (node.visible === false) return;
      const currentOrder = order++;
      const bounds = node.absoluteBoundingBox;
      const prioritizedVisual = functionalVisual
        || /(?:carousel|slider|カルーセル|スライダー|header.?logo|cta.?icon)/i.test(node.name);
      const functionalContainer = /(?:carousel|slider|カルーセル|スライダー)/i.test(node.name)
        && !/(?:item|prev|previous|next|arrow|dot|項目|前へ|次へ)/i.test(node.name);
      const renderGroup = FIGMA_RENDER_GROUP_TYPES.has(node.type)
        && !functionalContainer
        && !hasText(node)
        && hasComplexVisual(node);
      const renderLeaf = FIGMA_RENDERABLE_TYPES.has(node.type) || hasOwnImageFill(node);
      if (bounds && bounds.width > 0 && bounds.height > 0 && (renderGroup || renderLeaf)) {
        candidates.push({
          id: node.id,
          order: currentOrder,
          // Functional arrows and icons outrank decorative vectors, but never
          // displace actual photos or adjusted image fills from the export.
          priority: renderPriority(node) + (prioritizedVisual ? 150 : 0),
        });
        return;
      }
      for (const child of node.children ?? []) visit(child, prioritizedVisual);
    };
    visit(root);
    return candidates
      .sort((left, right) => right.priority - left.priority || left.order - right.order)
      .slice(0, limit)
      .sort((left, right) => left.order - right.order)
      .map((candidate) => candidate.id);
  };

  const responsive = responsivePageRoots(document);
  if (responsive.desktop && responsive.mobile) {
    const desktopCandidates = collect(responsive.desktop, MAX_RENDERED_NODES);
    const mobileCandidates = collect(responsive.mobile, MAX_RENDERED_NODES);
    if (desktopCandidates.length + mobileCandidates.length <= MAX_RENDERED_NODES) {
      return [...desktopCandidates, ...mobileCandidates];
    }
    let desktopLimit = Math.min(
      desktopCandidates.length,
      Math.floor(MAX_RENDERED_NODES / 2),
    );
    let mobileLimit = Math.min(
      mobileCandidates.length,
      MAX_RENDERED_NODES - desktopLimit,
    );
    let remaining = MAX_RENDERED_NODES - desktopLimit - mobileLimit;
    const desktopExtra = Math.min(
      remaining,
      desktopCandidates.length - desktopLimit,
    );
    desktopLimit += desktopExtra;
    remaining -= desktopExtra;
    mobileLimit += Math.min(remaining, mobileCandidates.length - mobileLimit);
    return [
      ...collect(responsive.desktop, desktopLimit),
      ...collect(responsive.mobile, mobileLimit),
    ];
  }
  return collect(document, MAX_RENDERED_NODES);
}

async function fetchRenderedNodeUrls(
  key: string,
  document: FigmaNode,
  getInit: () => RequestInit,
  warnings: string[],
): Promise<Record<string, string>> {
  const ids = collectRenderedNodeIds(document);
  if (!ids.length) return {};
  if (ids.length === MAX_RENDERED_NODES) {
    warnings.push(`複雑な画像・ベクターは先頭${MAX_RENDERED_NODES}件まで取得しました。`);
  }

  const batches: string[][] = [];
  for (let index = 0; index < ids.length; index += 35) {
    batches.push(ids.slice(index, index + 35));
  }

  const results = await Promise.all(batches.map(async (batch) => {
    const batchResult: Record<string, string> = {};
    for (let attempt = 1; attempt <= FIGMA_IMAGE_URL_ATTEMPTS; attempt += 1) {
      try {
      const query = new URLSearchParams({
        ids: batch.join(","),
        format: "png",
        scale: "1",
        use_absolute_bounds: "true",
      });
      const response = await fetch(
        `https://api.figma.com/v1/images/${encodeURIComponent(key)}?${query.toString()}`,
          getInit(),
      );
        if (response.ok) {
          const data = await readLimitedJson(response);
          if (isRecord(data) && isRecord(data.images)) {
            Object.assign(
              batchResult,
              Object.fromEntries(
                Object.entries(data.images).filter(
                  (entry): entry is [string, string] => typeof entry[1] === "string",
                ),
              ),
            );
          }
          if (batch.every((nodeId) => batchResult[nodeId])) break;
        } else if (response.status < 500 && response.status !== 429) {
          break;
        }
      } catch {
        // Retry a fresh request below. A timed-out AbortSignal cannot be reused.
      }
      if (attempt < FIGMA_IMAGE_URL_ATTEMPTS) {
        await new Promise((resolve) => setTimeout(resolve, attempt * 250));
      }
    }
    return batchResult;
  }));
  const renderedNodeUrls = Object.assign({}, ...results) as Record<string, string>;
  const missingNodeIds = ids.filter((nodeId) => !renderedNodeUrls[nodeId]);
  if (missingNodeIds.length) {
    throw new RequestError(
      `Figmaの画像・ベクターを完全に取得できませんでした（${missingNodeIds.length}件不足）。欠落させずに再試行してください。`,
      502,
    );
  }
  return renderedNodeUrls;
}

async function fetchVisualReferences(
  key: string,
  document: FigmaNode,
  init: RequestInit,
  warnings: string[],
): Promise<FigmaVisualReferences> {
  const responsive = responsivePageRoots(document);
  const canvases = (document.children ?? []).filter((node) => node.type === "CANVAS");
  const candidates = canvases
    .flatMap((canvas) => canvas.children ?? [])
    .filter((node) => node.visible !== false && node.absoluteBoundingBox)
    .sort((left, right) => {
      const leftBounds = left.absoluteBoundingBox;
      const rightBounds = right.absoluteBoundingBox;
      return (rightBounds?.width ?? 0) * (rightBounds?.height ?? 0)
        - (leftBounds?.width ?? 0) * (leftBounds?.height ?? 0);
    });
  const desktop = responsive.desktop ?? candidates[0] ?? null;
  const mobile = responsive.mobile;
  const roots = [desktop, mobile].filter((node): node is FigmaNode =>
    Boolean(node?.absoluteBoundingBox),
  );
  if (!roots.length) return {};

  try {
    const rendered = await Promise.all(roots.map(async (node) => {
      const bounds = node.absoluteBoundingBox;
      if (!bounds) return null;
      const mobileFrame = bounds.width <= 768;
      const losslessWidthScale = Math.min(
        1,
        (mobileFrame ? 440 : 800) / bounds.width,
      );
      const losslessPixelScale = Math.min(
        1,
        Math.sqrt(4_000_000 / (bounds.width * bounds.height)),
      );
      const losslessScale = Math.max(
        0.01,
        Math.min(losslessWidthScale, losslessPixelScale),
      );
      const losslessLongestEdge = Math.max(bounds.width, bounds.height)
        * losslessScale;
      const jpegScale = Math.max(
        0.01,
        Math.min(
          1,
          (mobileFrame ? 440 : 960) / bounds.width,
          Math.sqrt(8_000_000 / (bounds.width * bounds.height)),
        ),
      );
      const attempts: Array<{ format: "png" | "jpg"; scale: number }> = [];
      // Figma currently rejects lossless renders whose longest edge exceeds
      // 4096px even when the total pixel count is small. Long pages go
      // directly through the proven JPEG path instead of consuming a failed
      // render request and then hitting the API rate limit on the fallback.
      if (losslessLongestEdge <= 4_096) {
        attempts.push({ format: "png", scale: losslessScale });
      }
      attempts.push({ format: "jpg", scale: jpegScale });

      let image: string | null = null;
      let renderedScale = 1;
      let renderedFormat: "png" | "jpg" = "jpg";
      for (const attempt of attempts) {
        const requestScale = Math.round(attempt.scale * 1_000) / 1_000;
        const query = new URLSearchParams({
          ids: node.id,
          format: attempt.format,
          scale: String(requestScale),
          use_absolute_bounds: "true",
        });
        const response = await fetch(
          `https://api.figma.com/v1/images/${encodeURIComponent(key)}?${query.toString()}`,
          init,
        );
        if (!response.ok) continue;
        const data = await readLimitedJson(response);
        if (!isRecord(data) || !isRecord(data.images)) continue;
        const candidate = data.images[node.id];
        if (typeof candidate === "string") {
          image = candidate;
          renderedScale = requestScale;
          renderedFormat = attempt.format;
          break;
        }
      }
      if (!image) return null;
      const renderedWidth = Math.max(
        1,
        Math.round(bounds.width * renderedScale),
      );
      return {
        nodeId: node.id,
        name: node.name,
        url: image,
        width: renderedWidth,
        height: Math.max(
          1,
          Math.round(renderedWidth * (bounds.height / bounds.width)),
        ),
        sourceWidth: Math.max(1, Math.round(bounds.width)),
        sourceHeight: Math.max(1, Math.round(bounds.height)),
        format: renderedFormat,
      };
    }));
    const references = new Map(
      rendered
        .filter((item): item is FigmaVisualReference => Boolean(item))
        .map((item) => [item.nodeId, item]),
    );
    if (!references.size) {
      warnings.push("Visual QA用のFigma基準画像を取得できませんでした。");
    }
    return {
      desktop: desktop ? references.get(desktop.id) : undefined,
      mobile: mobile ? references.get(mobile.id) : undefined,
    };
  } catch {
    warnings.push("Visual QA用のFigma基準画像を取得できませんでした。");
    return {};
  }
}

export async function fetchFigmaFile(
  fileKeyOrUrl: string,
  token: string,
  authentication: "pat" | "oauth" = "pat",
  selectedFrameId?: string,
  options: { includeVisualReferences?: boolean } = {},
): Promise<FigmaFetchResult> {
  const reference = extractFigmaReference(fileKeyOrUrl);
  const key = reference.fileKey;
  const headers = new Headers({ Accept: "application/json" });
  headers.set(
    authentication === "oauth" ? "Authorization" : "X-Figma-Token",
    authentication === "oauth"
      ? `Bearer ${token.trim()}`
      : token.trim(),
  );
  const requestInit = (timeoutMs = 20_000): RequestInit => ({
    headers,
    cache: "no-store",
    redirect: "error",
    signal: AbortSignal.timeout(timeoutMs),
  });

  let fileResponse: Response;
  try {
    const query = new URLSearchParams({ depth: "12" });
    if (reference.nodeId && !selectedFrameId) query.set("ids", reference.nodeId);
    fileResponse = await fetch(
      `https://api.figma.com/v1/files/${encodeURIComponent(key)}?${query.toString()}`,
      requestInit(),
    );
  } catch {
    throw new RequestError("Figma APIへの接続がタイムアウトしました。", 504);
  }
  if (!fileResponse.ok) {
    console.warn("[figmapress:figma-api] file request rejected", {
      authentication,
      status: fileResponse.status,
    });
    throw figmaError(fileResponse.status, authentication);
  }

  let data = await readLimitedJson(fileResponse);
  if (!isRecord(data) || !isRecord(data.document)) {
    throw new RequestError("Figmaファイルにdocumentデータがありません。", 422);
  }
  let pageCandidates = discoverFigmaPageCandidates((data as RawFigmaFile).document);

  const warnings: string[] = reference.nodeId
    ? [`Figmaノード ${reference.nodeId} を変換対象として読み込みました。`]
    : [];
  let pageTitle = typeof data.name === "string" ? data.name : "FigmaPress Page";
  let selectedNode = reference.nodeId
    ? findNodeById((data as RawFigmaFile).document, reference.nodeId)
    : null;
  if (selectedFrameId) {
    const frameIds = selectedFigmaFrameIds(pageCandidates, selectedFrameId);
    const page = pageCandidates.find((candidate) =>
      candidate.id === selectedFrameId
      || candidate.desktop?.id === selectedFrameId
      || candidate.mobile?.id === selectedFrameId,
    );
    if (!frameIds.length || !page) {
      throw new RequestError("選択したFigmaページが見つかりません。候補を読み直してください。", 422);
    }
    data = {
      ...data,
      document: pruneFigmaDocumentToFrames((data as RawFigmaFile).document, frameIds),
    };
    selectedNode = findNodeById((data as RawFigmaFile).document, selectedFrameId);
    pageTitle = page.title;
    warnings.push(
      `${page.title}（${frameIds.length === 2 ? "PC・スマホ" : "1画面"}）だけを変換対象にしました。`,
    );
  } else if (selectedNode && responsiveFrameKind(selectedNode)) {
    try {
      const companionQuery = new URLSearchParams({ depth: "12" });
      const companionResponse = await fetch(
        `https://api.figma.com/v1/files/${encodeURIComponent(key)}?${companionQuery.toString()}`,
        requestInit(),
      );
      if (companionResponse.ok) {
        const companionData = await readLimitedJson(companionResponse);
        if (isRecord(companionData) && isRecord(companionData.document)) {
          pageCandidates = discoverFigmaPageCandidates((companionData as RawFigmaFile).document);
          const frameIds = selectedFigmaFrameIds(pageCandidates, selectedNode.id);
          const page = pageCandidates.find((candidate) =>
            candidate.desktop?.id === selectedNode?.id
            || candidate.mobile?.id === selectedNode?.id,
          );
          if (frameIds.length) {
            data = {
              ...companionData,
              document: pruneFigmaDocumentToFrames(
                (companionData as RawFigmaFile).document,
                frameIds,
              ),
            };
            pageTitle = page?.title || pageTitle;
            if (frameIds.length === 2) {
              warnings.push("同じWebページのPC版とスマホ版を内容と配置から自動検出しました。");
            }
          }
        }
      }
    } catch {
      warnings.push("スマホ版フレームを追加取得できなかったため、選択した画面のみ変換しました。");
    }
  } else if (!selectedNode || selectedNode.type === "CANVAS" || selectedNode.type === "DOCUMENT") {
    if (pageCandidates.length > 1) {
      throw new FigmaFrameSelectionRequired(pageCandidates);
    }
    if (pageCandidates.length === 1) {
      const frameIds = selectedFigmaFrameIds(pageCandidates, pageCandidates[0].id);
      data = {
        ...data,
        document: pruneFigmaDocumentToFrames((data as RawFigmaFile).document, frameIds),
      };
      pageTitle = pageCandidates[0].title;
      warnings.push(
        `${pageCandidates[0].title}（${frameIds.length === 2 ? "PC・スマホ" : "1画面"}）を自動選択しました。`,
      );
    }
  }
  const normalizedData = data as RawFigmaFile;
  const plannedRenderedNodeUrls = Object.fromEntries(
    collectRenderedNodeIds(normalizedData.document).map((nodeId) => [nodeId, "planned"]),
  );
  const imageRefsRequiringRawUrls = collectUncoveredVisibleImageRefs(
    normalizedData.document,
    {},
    plannedRenderedNodeUrls,
  );
  const imageUrlsPromise = (async (): Promise<Record<string, string>> => {
    if (!imageRefsRequiringRawUrls.length) return {};
    let lastImageUrls: Record<string, string> = {};
    for (let attempt = 1; attempt <= FIGMA_IMAGE_URL_ATTEMPTS; attempt += 1) {
      try {
        const imageResponse = await fetch(
          `https://api.figma.com/v1/files/${encodeURIComponent(key)}/images`,
          requestInit(7_000),
        );
        if (imageResponse.ok) {
          const imageData = await readLimitedJson(imageResponse);
          if (!isRecord(imageData) || !isRecord(imageData.images)) {
            throw new RequestError("Figma画像APIから不正な応答が返されました。", 502);
          }
          lastImageUrls = Object.fromEntries(
            Object.entries(imageData.images).filter(
              (entry): entry is [string, string] => typeof entry[1] === "string",
            ),
          );
          if (imageRefsRequiringRawUrls.every((imageRef) => lastImageUrls[imageRef])) {
            return lastImageUrls;
          }
        }
        if (imageResponse.status < 500 && imageResponse.status !== 429) {
          throw figmaError(imageResponse.status, authentication);
        }
      } catch (error) {
        if (error instanceof RequestError && error.status < 500 && error.status !== 429) {
          throw error;
        }
      }
      if (attempt < FIGMA_IMAGE_URL_ATTEMPTS) {
        await new Promise((resolve) => setTimeout(resolve, attempt * 250));
      }
    }
    warnings.push("Figma画像URLの全体取得を完了できなかったため、選択ページの完全レンダーで補完しました。");
    return lastImageUrls;
  })();
  const [imageUrls, renderedNodeUrls, visualReferences] = await Promise.all([
    imageUrlsPromise,
    fetchRenderedNodeUrls(
      key,
      normalizedData.document,
      requestInit,
      warnings,
    ),
    options.includeVisualReferences === false
      ? Promise.resolve({})
      : fetchVisualReferences(
          key,
          normalizedData.document,
          requestInit(),
          warnings,
        ),
  ]);
  const missingImageRefs = collectUncoveredVisibleImageRefs(
    normalizedData.document,
    imageUrls,
    renderedNodeUrls,
  );
  if (missingImageRefs.length) {
    throw new RequestError(
      `Figma画像を完全に取得できませんでした（${missingImageRefs.length}件不足）。画像を欠落させずに再試行してください。`,
      502,
    );
  }

  return {
    file: normalizeFigmaFile(normalizedData),
    fileName: typeof normalizedData.name === "string" ? normalizedData.name : "FigmaPress Page",
    pageTitle,
    pageCandidates,
    imageUrls,
    renderedNodeUrls,
    visualReferences,
    warnings,
  };
}
