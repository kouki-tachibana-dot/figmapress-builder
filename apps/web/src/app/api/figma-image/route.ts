import {
  RequestError,
  clientIp,
  enforceRateLimit,
  errorResponse,
} from "@/lib/request-security";
import {
  isAllowedFigmaRasterContentType,
  safeFigmaAssetUrl,
} from "@/lib/figma-image-security";

export const runtime = "nodejs";
export const maxDuration = 20;

const MAX_IMAGE_BYTES = 20 * 1024 * 1024;

export async function GET(request: Request): Promise<Response> {
  const startedAt = Date.now();
  let sourceHost = "unknown";
  try {
    enforceRateLimit("figma-image", clientIp(request), 180, 10 * 60_000);

    const source = safeFigmaAssetUrl(new URL(request.url).searchParams.get("url") ?? "");
    if (!source) {
      throw new RequestError("Figma画像URLが無効です。");
    }
    sourceHost = source.hostname;

    const response = await fetch(source, {
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) {
      throw new RequestError("Figma基準画像を取得できませんでした。変換をやり直してください。", 502);
    }

    const contentType = response.headers.get("content-type")?.split(";")[0]?.trim() ?? "";
    const declaredLength = Number(response.headers.get("content-length") ?? "0");
    if (!isAllowedFigmaRasterContentType(contentType) || declaredLength > MAX_IMAGE_BYTES) {
      throw new RequestError("Figma基準画像の形式またはサイズが無効です。", 502);
    }

    if (!response.body) {
      throw new RequestError("Figma基準画像の内容がありません。", 502);
    }
    let receivedBytes = 0;
    const limitedStream = response.body.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        receivedBytes += chunk.byteLength;
        if (receivedBytes > MAX_IMAGE_BYTES) {
          controller.error(new Error("Figma image exceeded the proxy limit."));
          return;
        }
        controller.enqueue(chunk);
      },
    }));

    return new Response(limitedStream, {
      headers: {
        "Cache-Control": "private, no-store, max-age=0",
        "Content-Security-Policy": "default-src 'none'; sandbox",
        "Content-Type": contentType,
        "Cross-Origin-Resource-Policy": "same-origin",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    console.error(JSON.stringify({
      level: "error",
      message: "Figma image proxy failed",
      route: "/api/figma-image",
      sourceHost,
      durationMs: Date.now() - startedAt,
      error: error instanceof Error ? error.message : String(error),
    }));
    return errorResponse(error);
  }
}
