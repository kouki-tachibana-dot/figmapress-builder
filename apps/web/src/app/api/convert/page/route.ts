import { cookies } from "next/headers";
import { z } from "zod";
import type { MockFigmaFile } from "@figmapress/figma-parser";
import {
  FigmaElementorExporter,
  createFigmaQualityReport,
  createFigmaMultiPagePlan,
  createFigmaSitePageTemplate,
  renderFigmaPreview,
  type FigmaMultiPagePlan,
} from "@figmapress/elementor-renderer";
import {
  FIGMA_OAUTH_SESSION_COOKIE,
  figmaOAuthCookie,
  resolveFigmaOAuthAccess,
} from "@/lib/figma-oauth";
import {
  fetchFigmaFile,
  FigmaFrameSelectionRequired,
} from "@/lib/figma-api";
import {
  discoverFigmaPageCandidates,
  pruneFigmaDocumentToFrames,
  selectedFigmaFrameIds,
} from "@/lib/figma-frame-selection";
import {
  createCandidatePageLinkTargets,
  createSemanticPageLinkTargets,
} from "@/lib/figma-site-plan";
import { markNativeElementorTemplate } from "@/lib/elementor-native";
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
const CandidatePageSchema = z.object({
  key: z.string().regex(/^(?:home|[a-z0-9][a-z0-9-]{0,79})$/),
  title: z.string().trim().min(1).max(160),
  slug: z.string().trim().min(1).max(80),
  frameId: z.string().regex(/^[0-9]+:[0-9]+$/),
  hasDesktop: z.boolean(),
  hasMobile: z.boolean(),
}).strict();
const CandidatePagesSchema = z.array(CandidatePageSchema).min(1).max(2).refine(
  (pages) => new Set(pages.map((page) => page.key)).size === pages.length,
  "ページ指定が重複しています。",
);
const SitePagesSchema = z.array(CandidatePageSchema).min(2).max(20).refine(
  (pages) => new Set(pages.map((page) => page.key)).size === pages.length,
  "サイト内のページ指定が重複しています。",
);
const RequestSchema = z.discriminatedUnion("mode", [
  z.object({
    mode: z.literal("json"),
    data: z.unknown(),
    pageKeys: PageKeysSchema,
    pageTitle: z.string().trim().max(160).optional(),
    selectedFrameId: z.string().regex(/^[0-9]+:[0-9]+$/).optional(),
  }).strict(),
  z.object({
    mode: z.literal("figma"),
    fileKeyOrUrl: z.string().trim().min(6).max(500),
    token: z.string().trim().min(10).max(500).optional(),
    selectedFrameId: z.string().regex(/^[0-9]+:[0-9]+$/).optional(),
    pageKeys: PageKeysSchema.optional(),
    candidatePages: CandidatePagesSchema.optional(),
    sitePages: SitePagesSchema.optional(),
  }).strict(),
]).refine(
  (value) => value.mode === "json"
    || Boolean(value.pageKeys) !== Boolean(value.candidatePages),
  "ページ指定を1種類だけ選んでください。",
);

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
      const figmaRequest = parsed.data;
      const cookieStore = await cookies();
      let oauth = null;
      if (!figmaRequest.token) {
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
      const token = figmaRequest.token || oauth?.accessToken;
      if (!token) {
        throw new RequestError(
          "Figmaアカウントを接続するか、Personal Access Tokenを入力してください。",
          401,
        );
      }
      refreshedOAuthCookie = oauth?.refreshedCookie;
      if (figmaRequest.candidatePages) {
        const pages = [];
        for (const page of figmaRequest.candidatePages) {
          const fetched = await fetchFigmaFile(
            figmaRequest.fileKeyOrUrl,
            token,
            figmaRequest.token ? "pat" : "oauth",
            page.frameId,
          );
          if (
            (page.hasDesktop && !fetched.visualReferences.desktop)
            || (page.hasMobile && !fetched.visualReferences.mobile)
          ) {
            throw new RequestError(
              `「${page.title}」のPC/SP精密表示を取得できませんでした。時間を置いて再試行してください。`,
              502,
            );
          }
          const sitePages = figmaRequest.sitePages ?? figmaRequest.candidatePages ?? [];
          const sitePlan: FigmaMultiPagePlan = {
            title: fetched.fileName,
            menuName: `${fetched.fileName}｜FigmaPress`,
            pages: sitePages,
          };
          const assets = {
            imageUrls: fetched.imageUrls,
            renderedNodeUrls: fetched.renderedNodeUrls,
            linkTargets: createCandidatePageLinkTargets(
              fetched.pageCandidates,
              sitePlan,
            ),
            pageTargets: createSemanticPageLinkTargets(sitePlan),
          };
          const nativeTemplate = new FigmaElementorExporter().toTemplate(
            fetched.file,
            page.title,
            assets,
          );
          const elementorTemplate = markNativeElementorTemplate(
            nativeTemplate,
            fetched.visualReferences,
          );
          pages.push({
            page,
            elementorTemplate,
            previewHtml: renderFigmaPreview(fetched.file, assets),
            visualReferences: fetched.visualReferences,
            linkIntegrity: createFigmaQualityReport(
              fetched.file,
              elementorTemplate,
              assets,
            ).metrics.navigationIntegrity,
          });
        }
        const responseBody = { ok: true, pages };
        if (new TextEncoder().encode(JSON.stringify(responseBody)).byteLength > 4_000_000) {
          throw new RequestError(
            "複数ページの変換データが大きすぎます。ページを分けて再試行してください。",
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
      }
      let fetched;
      try {
        fetched = await fetchFigmaFile(
          parsed.data.fileKeyOrUrl,
          token,
          figmaRequest.token ? "pat" : "oauth",
          figmaRequest.selectedFrameId,
        );
      } catch (error) {
        if (error instanceof FigmaFrameSelectionRequired) {
          throw new RequestError("変換するFigmaページを選び直してください。", 422);
        }
        throw error;
      }
      file = fetched.file;
      title = fetched.pageTitle;
      assets = {
        imageUrls: fetched.imageUrls,
        renderedNodeUrls: fetched.renderedNodeUrls,
      };
    } else {
      file = parsed.data.data as MockFigmaFile;
      const candidates = discoverFigmaPageCandidates(file.document);
      let selectedPageTitle = parsed.data.pageTitle || file.document?.name || "FigmaPress Page";
      if (candidates.length > 1 && !parsed.data.selectedFrameId) {
        throw new RequestError("変換するFigmaページを選び直してください。", 422);
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
      title = selectedPageTitle;
    }

    const plan = createFigmaMultiPagePlan(file, title);
    const pageKeys = parsed.data.pageKeys;
    if (!pageKeys) {
      throw new RequestError("複数ページ変換の入力内容を確認してください。", 422);
    }
    const pages = pageKeys.map((pageKey) => {
      const page = plan.pages.find((candidate) => candidate.key === pageKey);
      if (!page) {
        throw new RequestError(`「${pageKey}」に対応するFigmaセクションが見つかりません。`, 422);
      }
      return {
        page,
        elementorTemplate: markNativeElementorTemplate(
          createFigmaSitePageTemplate(file, page, assets),
        ),
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
