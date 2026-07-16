import type { MockFigmaFile } from "@figmapress/figma-parser";
import { RequestError } from "./request-security";

const FIGMA_FILE_KEY = /^[A-Za-z0-9_-]{6,160}$/;
const MAX_FIGMA_RESPONSE_BYTES = 12_000_000;

export interface FigmaFetchResult {
  file: MockFigmaFile;
  fileName: string;
  imageUrls: Record<string, string>;
  warnings: string[];
}

export function extractFigmaFileKey(input: string): string {
  const value = input.trim();
  if (FIGMA_FILE_KEY.test(value)) return value;

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
  const key = typeIndex >= 0 ? parts[typeIndex + 1] : undefined;
  if (!key || !FIGMA_FILE_KEY.test(key)) {
    throw new RequestError("Figma URLからファイルキーを取得できませんでした。");
  }
  return key;
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

export async function fetchFigmaFile(
  fileKeyOrUrl: string,
  token: string,
): Promise<FigmaFetchResult> {
  const key = extractFigmaFileKey(fileKeyOrUrl);
  const headers = { "X-Figma-Token": token.trim(), Accept: "application/json" };
  const init: RequestInit = {
    headers,
    cache: "no-store",
    redirect: "error",
    signal: AbortSignal.timeout(20_000),
  };

  let fileResponse: Response;
  try {
    fileResponse = await fetch(
      `https://api.figma.com/v1/files/${encodeURIComponent(key)}?depth=8`,
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

  const warnings: string[] = [];
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

  return {
    file: data as unknown as MockFigmaFile,
    fileName: typeof data.name === "string" ? data.name : "FigmaPress Page",
    imageUrls,
    warnings,
  };
}
