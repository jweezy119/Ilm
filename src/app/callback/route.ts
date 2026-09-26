import { NextRequest } from "next/server";

import { getSession, rotateSession } from "@/lib/session";
import { createClients } from "@/lib/sdk";
import { getAppUrl, getCallbackUrl, withSessionRedirect } from "@/lib/route-helpers";

export const dynamic = "force-dynamic";

const setFlashError = (message: string, session: Awaited<ReturnType<typeof getSession>>["session"]) => {
  session.authError = message;
  session.oauth = null;
};

export async function GET(request: NextRequest) {
  const sessionContext = await getSession(request);
  const params = request.nextUrl.searchParams;
  const homeUrl = getAppUrl("/");

  const error = params.get("error");
  const code = params.get("code");
  const state = params.get("state");
  const oauth = sessionContext.session.oauth;

  if (!oauth && !error && !code) {
    return withSessionRedirect(sessionContext, homeUrl);
  }

  if (error) {
    setFlashError(
      `OAuth2 provider returned ${error}: ${params.get("error_description") ?? "Unknown error."}`,
      sessionContext.session,
    );

    return withSessionRedirect(sessionContext, homeUrl);
  }

  if (!code) {
    setFlashError("No authorization code was returned.", sessionContext.session);
    return withSessionRedirect(sessionContext, homeUrl);
  }

  if (!oauth?.state || state !== oauth.state) {
    setFlashError("OAuth2 state check failed.", sessionContext.session);
    return withSessionRedirect(sessionContext, homeUrl);
  }

  try {
    const { serverClient } = await createClients(sessionContext.session);

    await serverClient.oauth2.v1.exchangeCode({
      code,
      codeVerifier: oauth.codeVerifier,
      redirectUri: getCallbackUrl(),
    });

    sessionContext.session.oauth = null;
    rotateSession(sessionContext);
    return withSessionRedirect(sessionContext, homeUrl);
  } catch (error) {
    setFlashError(
      `Code exchange failed: ${(error as Error).message || String(error)}`,
      sessionContext.session,
    );
    return withSessionRedirect(sessionContext, homeUrl);
  }
}
