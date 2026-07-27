import { NextRequest } from "next/server";
import {
  FIGMA_OAUTH_SESSION_COOKIE,
  clearFigmaOAuthCookie,
} from "@/lib/figma-oauth";
import {
  enforceSameOrigin,
  jsonResponse,
} from "@/lib/request-security";

export const runtime = "nodejs";

export async function POST(request: NextRequest): Promise<Response> {
  enforceSameOrigin(request);
  const response = jsonResponse({ ok: true });
  response.headers.append(
    "Set-Cookie",
    clearFigmaOAuthCookie(
      FIGMA_OAUTH_SESSION_COOKIE,
      request.nextUrl.protocol === "https:",
    ),
  );
  return response;
}
