import { z } from "zod";
import {
  WpAuthError,
  WpRequestError,
  probeWordPressConnection,
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

const RequestSchema = z.object({
  baseUrl: z.string().trim().min(8).max(500),
  username: z.string().trim().min(1).max(160),
  applicationPassword: z.string().trim().min(8).max(500),
}).strict();

export async function POST(request: Request): Promise<Response> {
  try {
    enforceSameOrigin(request);
    enforceRateLimit("wordpress-status", clientIp(request), 12, 10 * 60 * 1_000);
    const parsed = RequestSchema.safeParse(await readJsonBody(request, 20_000));
    if (!parsed.success) {
      throw new RequestError("WordPress接続情報を確認してください。", 422);
    }
    const baseUrl = await assertSafeWordPressUrl(parsed.data.baseUrl);
    try {
      const status = await probeWordPressConnection({ ...parsed.data, baseUrl });
      return jsonResponse({ ok: true, status });
    } catch (error) {
      if (error instanceof WpAuthError) {
        throw new RequestError("WordPressの認証に失敗しました。Application Passwordを確認してください。", 401);
      }
      if (error instanceof WpRequestError) {
        throw new RequestError("WordPress REST APIの接続診断に失敗しました。", 502);
      }
      throw error;
    }
  } catch (error) {
    return errorResponse(error);
  }
}
