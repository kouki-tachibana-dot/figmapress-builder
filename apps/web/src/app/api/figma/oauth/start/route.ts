import { NextRequest } from "next/server";
import {
  createFigmaOAuthAuthorization,
  figmaOAuthAuthorizationResponse,
  figmaOAuthConfiguration,
  figmaOAuthRedirectUri,
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
  return figmaOAuthAuthorizationResponse(
    authorization.authorizationUrl,
    authorization.stateCookie,
    request.nextUrl.protocol === "https:",
  );
}
