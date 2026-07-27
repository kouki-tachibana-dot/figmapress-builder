import { z } from "zod";
import { cookies } from "next/headers";
import type { MockFigmaFile } from "@figmapress/figma-parser";
import { convertFile } from "@/lib/converter";
import {
  FIGMA_OAUTH_SESSION_COOKIE,
  figmaOAuthCookie,
  resolveFigmaOAuthAccess,
} from "@/lib/figma-oauth";
import {
  fetchFigmaFile,
  type FigmaVisualReferences,
} from "@/lib/figma-api";
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
export const maxDuration = 60;

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
      token: z.string().trim().min(10).max(500).optional(),
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
    let visualReferences: FigmaVisualReferences = {};
    let refreshedOAuthCookie: string | undefined;
    if (parsed.data.mode === "figma") {
      const cookieStore = await cookies();
      let oauth = null;
      if (!parsed.data.token) {
        try {
          oauth = await resolveFigmaOAuthAccess(
            cookieStore.get(FIGMA_OAUTH_SESSION_COOKIE)?.value,
          );
        } catch {
          throw new RequestError(
            "Figma接続の有効期限を更新できませんでした。接続を解除して、もう一度接続してください。",
            401,
          );
        }
      }
      const token = parsed.data.token || oauth?.accessToken;
      if (!token) {
        throw new RequestError(
          "Figmaアカウントを接続するか、Personal Access Tokenを入力してください。",
          401,
        );
      }
      refreshedOAuthCookie = oauth?.refreshedCookie;
      const fetched = await fetchFigmaFile(
        parsed.data.fileKeyOrUrl,
        token,
        parsed.data.token ? "pat" : "oauth",
      );
      output = await convertFile(
        fetched.file,
        { siteName: fetched.fileName, pageTitle: fetched.fileName },
        fetched.imageUrls,
        fetched.warnings,
        fetched.renderedNodeUrls,
      );
      visualReferences = fetched.visualReferences;
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

    const response = jsonResponse({
      ok: true,
      ...output,
      visualReferences,
    });
    if (refreshedOAuthCookie) {
      response.headers.append(
        "Set-Cookie",
        figmaOAuthCookie(
          FIGMA_OAUTH_SESSION_COOKIE,
          refreshedOAuthCookie,
          new URL(request.url).protocol === "https:",
        ),
      );
    }
    return response;
  } catch (error) {
    return errorResponse(error);
  }
}
