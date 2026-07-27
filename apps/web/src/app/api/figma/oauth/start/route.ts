import { NextRequest } from "next/server";
import {
  createFigmaOAuthAuthorization,
  figmaOAuthConfiguration,
  figmaOAuthRedirectUri,
  figmaOAuthStateCookie,
} from "@/lib/figma-oauth";

export const runtime = "nodejs";

export async function GET(request: NextRequest): Promise<Response> {
  const configuration = figmaOAuthConfiguration();
  if (!configuration) {
    return Response.redirect(
      new URL("/?figma_oauth=unavailable", request.url),
      302,
    );
  }
  const redirectUri = figmaOAuthRedirectUri(request.nextUrl);
  const authorization = createFigmaOAuthAuthorization(
    redirectUri,
    configuration,
  );
  const response = Response.redirect(authorization.authorizationUrl, 302);
  response.headers.append(
    "Set-Cookie",
    figmaOAuthStateCookie(
      authorization.stateCookie,
      request.nextUrl.protocol === "https:",
    ),
  );
  response.headers.set("Cache-Control", "no-store, max-age=0");
  return response;
}
