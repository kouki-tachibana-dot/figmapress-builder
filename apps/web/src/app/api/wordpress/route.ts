import { z } from "zod";
import {
  WpAuthError,
  WpRequestError,
  createDraftPage,
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
export const maxDuration = 30;

const RequestSchema = z
  .object({
    baseUrl: z.string().trim().min(8).max(500),
    username: z.string().trim().min(1).max(160),
    applicationPassword: z.string().trim().min(8).max(500),
    title: z.string().trim().min(1).max(200),
    slug: z.string().trim().max(200),
    content: z.string().min(1).max(900_000),
  })
  .strict();

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
    enforceRateLimit("wordpress", clientIp(request), 6, 10 * 60 * 1_000);
    const parsed = RequestSchema.safeParse(await readJsonBody(request, 1_000_000));
    if (!parsed.success) {
      throw new RequestError("WordPress接続情報を確認してください。", 422);
    }

    const baseUrl = await assertSafeWordPressUrl(parsed.data.baseUrl);
    try {
      const result = await createDraftPage(
        {
          baseUrl,
          username: parsed.data.username,
          applicationPassword: parsed.data.applicationPassword,
        },
        {
          title: parsed.data.title,
          slug: parsed.data.slug,
          content: parsed.data.content,
        },
      );
      return jsonResponse({ ok: true, result });
    } catch (error) {
      if (error instanceof WpAuthError) {
        throw new RequestError("WordPressのユーザー名またはアプリケーションパスワードが無効です。", 401);
      }
      if (error instanceof WpRequestError) {
        throw new RequestError(wordpressMessage(error.body), 502);
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
