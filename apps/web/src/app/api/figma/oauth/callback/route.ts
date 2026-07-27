import { NextRequest } from "next/server";
import {
  FIGMA_OAUTH_SESSION_COOKIE,
  FIGMA_OAUTH_STATE_COOKIE,
  clearFigmaOAuthCookie,
  exchangeFigmaOAuthCode,
  figmaOAuthConfiguration,
  figmaOAuthCookie,
  readFigmaOAuthState,
} from "@/lib/figma-oauth";

export const runtime = "nodejs";

function callbackHtml(
  origin: string,
  success: boolean,
  message: string,
): string {
  const payload = JSON.stringify({
    type: "figmapress:figma-oauth",
    success,
    message,
  }).replace(/</g, "\\u003c");
  const targetOrigin = JSON.stringify(origin);
  return `<!doctype html>
<html lang="ja">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Figma接続</title></head>
<body style="font-family:system-ui,sans-serif;padding:32px;color:#10212a">
<h1 style="font-size:20px">${success ? "Figmaとの接続が完了しました" : "Figmaとの接続に失敗しました"}</h1>
<p>${message}</p>
<p><button onclick="window.close()">この画面を閉じる</button></p>
<script>
if (window.opener) window.opener.postMessage(${payload}, ${targetOrigin});
if (${success ? "true" : "false"}) window.setTimeout(() => window.close(), 500);
</script>
</body>
</html>`;
}

function htmlResponse(
  request: NextRequest,
  success: boolean,
  message: string,
  sessionCookie?: string,
): Response {
  const secure = request.nextUrl.protocol === "https:";
  const response = new Response(
    callbackHtml(request.nextUrl.origin, success, message),
    {
      status: success ? 200 : 400,
      headers: {
        "Cache-Control": "no-store, max-age=0",
        "Content-Security-Policy":
          "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'",
        "Content-Type": "text/html; charset=utf-8",
        "Referrer-Policy": "no-referrer",
        "X-Content-Type-Options": "nosniff",
        "X-Frame-Options": "DENY",
      },
    },
  );
  response.headers.append(
    "Set-Cookie",
    clearFigmaOAuthCookie(FIGMA_OAUTH_STATE_COOKIE, secure),
  );
  if (sessionCookie) {
    response.headers.append(
      "Set-Cookie",
      figmaOAuthCookie(
        FIGMA_OAUTH_SESSION_COOKIE,
        sessionCookie,
        secure,
      ),
    );
  }
  return response;
}

export async function GET(request: NextRequest): Promise<Response> {
  const configuration = figmaOAuthConfiguration();
  if (!configuration) {
    return htmlResponse(
      request,
      false,
      "この環境ではFigma OAuthが設定されていません。",
    );
  }
  const code = request.nextUrl.searchParams.get("code")?.trim() ?? "";
  const returnedState =
    request.nextUrl.searchParams.get("state")?.trim() ?? "";
  const storedState = request.cookies.get(FIGMA_OAUTH_STATE_COOKIE)?.value;
  const state = readFigmaOAuthState(
    storedState,
    returnedState,
    configuration,
  );
  if (!code || !state) {
    return htmlResponse(
      request,
      false,
      "認証状態を確認できませんでした。元の画面から接続をやり直してください。",
    );
  }
  try {
    const sessionCookie = await exchangeFigmaOAuthCode(
      code,
      state,
      configuration,
    );
    return htmlResponse(
      request,
      true,
      "元のFigmaPress画面へ戻って変換を続けられます。",
      sessionCookie,
    );
  } catch {
    return htmlResponse(
      request,
      false,
      "認証コードを交換できませんでした。接続をやり直してください。",
    );
  }
}
