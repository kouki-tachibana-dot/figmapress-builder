import { NextRequest } from "next/server";
import {
  FIGMA_OAUTH_SESSION_COOKIE,
  clearFigmaOAuthCookie,
  figmaOAuthCookie,
  figmaOAuthStatus,
  resolveFigmaOAuthAccess,
} from "@/lib/figma-oauth";
import { jsonResponse } from "@/lib/request-security";

export const runtime = "nodejs";

export async function GET(request: NextRequest): Promise<Response> {
  const cookieValue =
    request.cookies.get(FIGMA_OAUTH_SESSION_COOKIE)?.value;
  const status = figmaOAuthStatus(cookieValue);
  if (!status.configured || !status.connected) {
    return jsonResponse(status);
  }
  const secure = request.nextUrl.protocol === "https:";
  try {
    const access = await resolveFigmaOAuthAccess(cookieValue);
    const response = jsonResponse(status);
    if (access?.refreshedCookie) {
      response.headers.append(
        "Set-Cookie",
        figmaOAuthCookie(
          FIGMA_OAUTH_SESSION_COOKIE,
          access.refreshedCookie,
          secure,
        ),
      );
    }
    return response;
  } catch {
    const response = jsonResponse({
      configured: true,
      connected: false,
    });
    response.headers.append(
      "Set-Cookie",
      clearFigmaOAuthCookie(FIGMA_OAUTH_SESSION_COOKIE, secure),
    );
    return response;
  }
}
