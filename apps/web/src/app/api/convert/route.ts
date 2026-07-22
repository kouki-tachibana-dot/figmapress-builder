import { z } from "zod";
import type { MockFigmaFile } from "@figmapress/figma-parser";
import { convertFile } from "@/lib/converter";
import { fetchFigmaFile } from "@/lib/figma-api";
import {
  RequestError,
  clientIp,
  enforceRateLimit,
  enforceSameOrigin,
  errorResponse,
  jsonResponse,
  readJsonBody,
} from "@/lib/request-security";

export const runtime = "nodejs";
export const maxDuration = 30;

const RequestSchema = z.discriminatedUnion("mode", [
  z
    .object({
      mode: z.literal("json"),
      data: z.unknown(),
      pageTitle: z.string().trim().max(160).optional(),
    })
    .strict(),
  z
    .object({
      mode: z.literal("figma"),
      fileKeyOrUrl: z.string().trim().min(6).max(500),
      token: z.string().trim().min(10).max(500),
    })
    .strict(),
]);

export async function POST(request: Request): Promise<Response> {
  try {
    enforceSameOrigin(request);
    enforceRateLimit("convert", clientIp(request), 20, 10 * 60 * 1_000);
    const parsed = RequestSchema.safeParse(await readJsonBody(request));
    if (!parsed.success) {
      throw new RequestError("入力内容を確認してください。", 422);
    }

    let output;
    if (parsed.data.mode === "figma") {
      const fetched = await fetchFigmaFile(
        parsed.data.fileKeyOrUrl,
        parsed.data.token,
      );
      output = await convertFile(
        fetched.file,
        { siteName: fetched.fileName, pageTitle: fetched.fileName },
        fetched.imageUrls,
        fetched.warnings,
        fetched.renderedNodeUrls,
      );
    } else {
      try {
        output = await convertFile(parsed.data.data as MockFigmaFile, {
          pageTitle: parsed.data.pageTitle || undefined,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : "Figma JSONを変換できませんでした。";
        throw new RequestError(message, 422);
      }
    }

    return jsonResponse({ ok: true, ...output });
  } catch (error) {
    return errorResponse(error);
  }
}
