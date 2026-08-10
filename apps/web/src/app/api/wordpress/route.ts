import { z } from "zod";
import {
  WpAuthError,
  WpRequestError,
  createDraftPage,
  createElementorDraftPage,
  prepareWordPressSite,
} from "@figmapress/wp-connector";
import {
  RequestError,
  assertSafeWordPressUrl,
  clientIp,
  enforceRateLimit,
  enforceSameOrigin,
  errorResponse,
  jsonResponse,
  readJsonBody,
} from "@/lib/request-security";

export const runtime = "nodejs";
export const maxDuration = 120;

const CredentialsSchema = z.object({
    baseUrl: z.string().trim().min(8).max(500),
    username: z.string().trim().max(160).default(""),
    applicationPassword: z.string().trim().max(500).default(""),
    connectorToken: z.string().trim()
      .regex(/^fp1\.[1-9][0-9]{0,19}\.[A-Za-z0-9_-]{32,128}$/)
      .optional(),
});

const CommonSchema = CredentialsSchema.extend({
    title: z.string().trim().min(1).max(200),
    slug: z.string().trim().max(200),
});

const SiteKeySchema = z.string().trim()
  .regex(/^figma:[A-Za-z0-9_-]{6,160}:(?:root|[0-9]+:[0-9]+)$/);
const SitePageKeySchema = z.enum(["home", "thoughts", "policies", "activities", "profile", "contact"]);
const SitePageSchema = z.object({
  key: SitePageKeySchema,
  title: z.string().trim().min(1).max(200),
  slug: z.string().trim().min(1).max(200),
  sourceKey: z.string().trim().regex(
    /^figma:[A-Za-z0-9_-]{6,160}:(?:root|[0-9]+:[0-9]+)(?::page:[a-z0-9-]{1,80})?$/,
  ),
}).strict();

const ElementorTemplateSchema = z.object({
  title: z.string().max(200),
  type: z.literal("page"),
  version: z.literal("0.4"),
  page_settings: z.record(z.unknown()),
  content: z.array(z.unknown()).min(1).max(300),
}).strict();

const RequestSchema = z.discriminatedUnion("target", [
  CommonSchema.extend({
    target: z.literal("gutenberg"),
    content: z.string().min(1).max(900_000),
  }).strict(),
  CommonSchema.extend({
    target: z.literal("elementor"),
    requestId: z.string().trim().regex(/^[a-f0-9-]{16,64}$/i),
    sourceKey: z.string().trim()
      .regex(/^figma:[A-Za-z0-9_-]{6,160}:(?:root|[0-9]+:[0-9]+)(?::page:[a-z0-9-]{1,80})?$/)
      .optional(),
    template: ElementorTemplateSchema,
    pageTemplate: z.enum(["elementor_canvas", "elementor_header_footer", "default"]).default("elementor_canvas"),
  }).strict(),
  CredentialsSchema.extend({
    target: z.literal("site"),
    siteKey: SiteKeySchema,
    title: z.string().trim().min(1).max(200),
    menuName: z.string().trim().min(1).max(200),
    pages: z.array(SitePageSchema).min(2).max(8),
  }).strict(),
]);

function wordpressMessage(body: string): string {
  try {
    const parsed = JSON.parse(body) as { message?: unknown };
    if (typeof parsed.message === "string") return parsed.message.slice(0, 300);
  } catch {
    // WordPress or its proxy returned a non-JSON error page.
  }
  return "WordPressがリクエストを受け付けませんでした。";
}

export async function POST(request: Request): Promise<Response> {
  try {
    enforceSameOrigin(request);
    enforceRateLimit("wordpress", clientIp(request), 20, 10 * 60 * 1_000);
    const parsed = RequestSchema.safeParse(await readJsonBody(request, 4_000_000));
    if (!parsed.success) {
      throw new RequestError("WordPress接続情報を確認してください。", 422);
    }
    if (
      !parsed.data.connectorToken
      && (!parsed.data.username || parsed.data.applicationPassword.length < 8)
    ) {
      throw new RequestError("WordPress接続情報を確認してください。", 422);
    }

    const baseUrl = await assertSafeWordPressUrl(parsed.data.baseUrl);
    try {
      const config = {
        baseUrl,
        username: parsed.data.username,
        applicationPassword: parsed.data.applicationPassword,
        connectorToken: parsed.data.connectorToken,
      };
      const result = parsed.data.target === "site"
        ? await prepareWordPressSite(config, {
            siteKey: parsed.data.siteKey,
            title: parsed.data.title,
            menuName: parsed.data.menuName,
            pages: parsed.data.pages,
          })
        : parsed.data.target === "elementor"
          ? await createElementorDraftPage(config, {
            title: parsed.data.title,
            slug: parsed.data.slug,
            requestId: parsed.data.requestId,
            sourceKey: parsed.data.sourceKey,
            template: parsed.data.template,
            pageTemplate: parsed.data.pageTemplate,
          })
          : await createDraftPage(config, {
              title: parsed.data.title,
              slug: parsed.data.slug,
              content: parsed.data.content,
            });
      return jsonResponse({ ok: true, result });
    } catch (error) {
      if (error instanceof WpAuthError) {
        throw new RequestError(
          parsed.data.connectorToken
            ? "WordPress接続が無効または期限切れです。Connectorから再接続してください。"
            : "WordPressのユーザー名またはアプリケーションパスワードが無効です。",
          401,
        );
      }
      if (error instanceof WpRequestError) {
        const status = error.status >= 400 && error.status < 500 ? error.status : 502;
        throw new RequestError(wordpressMessage(error.body), status);
      }
      throw new RequestError(
        "WordPressへ接続できませんでした。URLとREST APIの公開状態を確認してください。",
        502,
      );
    }
  } catch (error) {
    return errorResponse(error);
  }
}
