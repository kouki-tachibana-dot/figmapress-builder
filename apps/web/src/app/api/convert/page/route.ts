import { cookies } from "next/headers";
import { z } from "zod";
import type { MockFigmaFile } from "@figmapress/figma-parser";
import {
  createFigmaMultiPagePlan,
  createFigmaSitePageTemplate,
} from "@figmapress/elementor-renderer";
import {
  FIGMA_OAUTH_SESSION_COOKIE,
  figmaOAuthCookie,
  resolveFigmaOAuthAccess,
} from "@/lib/figma-oauth";
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
export const maxDuration = 60;

const PageKeySchema = z.enum(["thoughts", "policies", "activities", "profile", "contact"]);
const PageKeysSchema = z.array(PageKeySchema).min(1).max(5).refine(
  (keys) => new Set(keys).size === keys.length,
  "ページ指定が重複しています。",
);
const RequestSchema = z.discriminatedUnion("mode", [
  z.object({
    mode: z.literal("json"),
    data: z.unknown(),
    pageKeys: PageKeysSchema,
    pageTitle: z.string().trim().max(160).optional(),
  }).strict(),
  z.object({
    mode: z.literal("figma"),
    fileKeyOrUrl: z.string().trim().min(6).max(500),
    token: z.string().trim().min(10).max(500).optional(),
    pageKeys: PageKeysSchema,
  }).strict(),
]);

export async function POST(request: Request): Promise<Response> {
  try {
    enforceSameOrigin(request);
    enforceRateLimit("convert-page", clientIp(request), 30, 10 * 60 * 1_000);
    const parsed = RequestSchema.safeParse(await readJsonBody(request));
    if (!parsed.success) {
      throw new RequestError("複数ページ変換の入力内容を確認してください。", 422);
    }

    let file: MockFigmaFile;
    let title: string;
    let assets = {};
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
      file = fetched.file;
      title = fetched.fileName;
      assets = {
        imageUrls: fetched.imageUrls,
        renderedNodeUrls: fetched.renderedNodeUrls,
      };
    } else {
      file = parsed.data.data as MockFigmaFile;
      title = parsed.data.pageTitle || file.document?.name || "FigmaPress Page";
    }

    const plan = createFigmaMultiPagePlan(file, title);
    const pages = parsed.data.pageKeys.map((pageKey) => {
      const page = plan.pages.find((candidate) => candidate.key === pageKey);
      if (!page) {
        throw new RequestError(`「${pageKey}」に対応するFigmaセクションが見つかりません。`, 422);
      }
      return {
        page,
        elementorTemplate: createFigmaSitePageTemplate(file, page, assets),
      };
    });
    const responseBody = { ok: true, pages };
    if (new TextEncoder().encode(JSON.stringify(responseBody)).byteLength > 4_000_000) {
      throw new RequestError(
        "複数ページの変換データが大きすぎます。Figmaの大きな装飾グループを整理して再試行してください。",
        413,
      );
    }
    const response = jsonResponse(responseBody);
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
