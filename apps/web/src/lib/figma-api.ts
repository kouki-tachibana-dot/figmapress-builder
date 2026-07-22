import type {
  FigmaNode,
  FigmaStylesShape,
  MockFigmaFile,
} from "@figmapress/figma-parser";
import { RequestError } from "./request-security";

const FIGMA_FILE_KEY = /^[A-Za-z0-9_-]{6,160}$/;
const MAX_FIGMA_RESPONSE_BYTES = 12_000_000;

export interface FigmaFetchResult {
  file: MockFigmaFile;
  fileName: string;
  imageUrls: Record<string, string>;
  renderedNodeUrls: Record<string, string>;
  warnings: string[];
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

function figmaError(status: number): RequestError {
  if (status === 401 || status === 403) {
    return new RequestError(
      "Figmaトークンが無効か、file_content:read 権限がありません。",
      401,
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
const MAX_RENDERED_NODES = 120;

function hasText(node: FigmaNode): boolean {
  if (node.type === "TEXT" && node.characters?.trim()) return true;
  return (node.children ?? []).some(hasText);
}

function hasOwnImageFill(node: FigmaNode): boolean {
  return node.fills?.some((fill) => fill.visible !== false && fill.type === "IMAGE") === true;
}

function hasImageFill(node: FigmaNode): boolean {
  if (hasOwnImageFill(node)) return true;
  return (node.children ?? []).some(hasImageFill);
}

function hasComplexVisual(node: FigmaNode): boolean {
  if (FIGMA_RENDERABLE_TYPES.has(node.type) || hasImageFill(node)) return true;
  return (node.children ?? []).some(hasComplexVisual);
}

/**
 * Export the highest text-free visual subtree as one image. Text stays as
 * native Elementor widgets, while masks, vectors and Figma image crops keep
 * their exact appearance without exploding the document into tiny paths.
 */
export function collectRenderedNodeIds(document: FigmaNode): string[] {
  const ids: string[] = [];
  const visit = (node: FigmaNode): void => {
    if (node.visible === false || ids.length >= MAX_RENDERED_NODES) return;
    const bounds = node.absoluteBoundingBox;
    const renderGroup = FIGMA_RENDER_GROUP_TYPES.has(node.type)
      && !hasText(node)
      && hasComplexVisual(node);
    const renderLeaf = FIGMA_RENDERABLE_TYPES.has(node.type) || hasOwnImageFill(node);
    if (bounds && bounds.width > 0 && bounds.height > 0 && (renderGroup || renderLeaf)) {
      ids.push(node.id);
      return;
    }
    for (const child of node.children ?? []) visit(child);
  };
  visit(document);
  return ids;
}

async function fetchRenderedNodeUrls(
  key: string,
  document: FigmaNode,
  init: RequestInit,
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

  try {
    const results = await Promise.all(batches.map(async (batch) => {
      const query = new URLSearchParams({
        ids: batch.join(","),
        format: "png",
        scale: "1",
        use_absolute_bounds: "true",
      });
      const response = await fetch(
        `https://api.figma.com/v1/images/${encodeURIComponent(key)}?${query.toString()}`,
        init,
      );
      if (!response.ok) return {};
      const data = await readLimitedJson(response);
      if (!isRecord(data) || !isRecord(data.images)) return {};
      return Object.fromEntries(
        Object.entries(data.images).filter(
          (entry): entry is [string, string] => typeof entry[1] === "string",
        ),
      );
    }));
    return Object.assign({}, ...results) as Record<string, string>;
  } catch {
    warnings.push("Figmaのベクター・マスク画像を取得できなかったため、一部を簡略化しました。");
    return {};
  }
}

export async function fetchFigmaFile(
  fileKeyOrUrl: string,
  token: string,
): Promise<FigmaFetchResult> {
  const reference = extractFigmaReference(fileKeyOrUrl);
  const key = reference.fileKey;
  const headers = { "X-Figma-Token": token.trim(), Accept: "application/json" };
  const init: RequestInit = {
    headers,
    cache: "no-store",
    redirect: "error",
    signal: AbortSignal.timeout(20_000),
  };

  let fileResponse: Response;
  try {
    const query = new URLSearchParams({ depth: "12" });
    if (reference.nodeId) query.set("ids", reference.nodeId);
    fileResponse = await fetch(
      `https://api.figma.com/v1/files/${encodeURIComponent(key)}?${query.toString()}`,
      init,
    );
  } catch {
    throw new RequestError("Figma APIへの接続がタイムアウトしました。", 504);
  }
  if (!fileResponse.ok) throw figmaError(fileResponse.status);

  const data = await readLimitedJson(fileResponse);
  if (!isRecord(data) || !isRecord(data.document)) {
    throw new RequestError("Figmaファイルにdocumentデータがありません。", 422);
  }

  const warnings: string[] = reference.nodeId
    ? [`Figmaノード ${reference.nodeId} を変換対象として読み込みました。`]
    : [];
  let imageUrls: Record<string, string> = {};
  try {
    const imageResponse = await fetch(
      `https://api.figma.com/v1/files/${encodeURIComponent(key)}/images`,
      init,
    );
    if (imageResponse.ok) {
      const imageData = await readLimitedJson(imageResponse);
      if (isRecord(imageData) && isRecord(imageData.images)) {
        imageUrls = Object.fromEntries(
          Object.entries(imageData.images).filter(
            (entry): entry is [string, string] => typeof entry[1] === "string",
          ),
        );
      }
    } else {
      warnings.push("Figma画像のURLを取得できなかったため、画像なしで続行しました。");
    }
  } catch {
    warnings.push("Figma画像の取得がタイムアウトしたため、画像なしで続行しました。");
  }

  const renderedNodeUrls = await fetchRenderedNodeUrls(
    key,
    (data as RawFigmaFile).document,
    init,
    warnings,
  );

  return {
    file: normalizeFigmaFile(data as RawFigmaFile),
    fileName: typeof data.name === "string" ? data.name : "FigmaPress Page",
    imageUrls,
    renderedNodeUrls,
    warnings,
  };
}
