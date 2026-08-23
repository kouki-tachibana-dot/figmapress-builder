import { z } from "zod";
import { cookies } from "next/headers";
import type { MockFigmaFile } from "@figmapress/figma-parser";
import { convertFile } from "@/lib/converter";
import { applyExactVisualPresentation } from "@/lib/exact-visual";
import {
  FIGMA_OAUTH_SESSION_COOKIE,
  figmaOAuthCookie,
  resolveFigmaOAuthAccess,
} from "@/lib/figma-oauth";
import {
  fetchFigmaFile,
  FigmaFrameSelectionRequired,
  type FigmaVisualReferences,
} from "@/lib/figma-api";
import {
  discoverFigmaPageCandidates,
  pruneFigmaDocumentToFrames,
  selectedFigmaFrameIds,
} from "@/lib/figma-frame-selection";
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
      selectedFrameId: z.string().regex(/^[0-9]+:[0-9]+$/).optional(),
    })
    .strict(),
  z
    .object({
      mode: z.literal("figma"),
      fileKeyOrUrl: z.string().trim().min(6).max(500),
      token: z.string().trim().min(10).max(500).optional(),
      selectedFrameId: z.string().regex(/^[0-9]+:[0-9]+$/).optional(),
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
      let fetched;
      try {
        fetched = await fetchFigmaFile(
          parsed.data.fileKeyOrUrl,
          token,
          parsed.data.token ? "pat" : "oauth",
          parsed.data.selectedFrameId,
        );
      } catch (error) {
        if (!(error instanceof FigmaFrameSelectionRequired)) throw error;
        const response = jsonResponse({
          ok: true,
          selectionRequired: true,
          candidates: error.candidates,
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
      }
      output = await convertFile(
        fetched.file,
        { siteName: fetched.fileName, pageTitle: fetched.pageTitle },
        fetched.imageUrls,
        fetched.warnings,
        fetched.renderedNodeUrls,
        parsed.data.selectedFrameId
          ? {
              candidates: fetched.pageCandidates,
              selectedFrameId: parsed.data.selectedFrameId,
              siteTitle: fetched.fileName,
            }
          : null,
      );
      visualReferences = fetched.visualReferences;
    } else {
      try {
        let file = parsed.data.data as MockFigmaFile;
        const candidates = discoverFigmaPageCandidates(file.document);
        let selectedPageTitle = parsed.data.pageTitle || undefined;
        if (candidates.length > 1 && !parsed.data.selectedFrameId) {
          return jsonResponse({
            ok: true,
            selectionRequired: true,
            candidates,
          });
        }
        if (candidates.length) {
          const selectedId = parsed.data.selectedFrameId || candidates[0]?.id || "";
          const frameIds = selectedFigmaFrameIds(candidates, selectedId);
          const selectedPage = candidates.find((candidate) =>
            candidate.id === selectedId
            || candidate.desktop?.id === selectedId
            || candidate.mobile?.id === selectedId,
          );
          if (!frameIds.length) {
            throw new RequestError("選択したFigmaページが見つかりません。", 422);
          }
          selectedPageTitle = selectedPage?.title || selectedPageTitle;
          file = {
            ...file,
            document: pruneFigmaDocumentToFrames(file.document, frameIds),
          };
        }
        output = await convertFile(
          file,
          { pageTitle: selectedPageTitle },
          {},
          [],
          {},
          parsed.data.selectedFrameId
            ? {
                candidates,
                selectedFrameId: parsed.data.selectedFrameId,
                siteTitle: file.document?.name || selectedPageTitle || "FigmaPress Site",
              }
            : null,
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : "Figma JSONを変換できませんでした。";
        throw new RequestError(message, 422);
      }
    }

    if (Object.keys(visualReferences).length > 0) {
      output = applyExactVisualPresentation(output, visualReferences);
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
