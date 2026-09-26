import { NextRequest } from "next/server";

import { getConfig } from "@/lib/env";
import { buildLogoutUrl, createRandomToken } from "@/lib/oauth";
import { getSession } from "@/lib/session";
import { getLogoutRedirectUrl, withDestroyedSessionRedirect } from "@/lib/route-helpers";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const config = getConfig();
  const sessionContext = await getSession(request);

  const idToken =
    (sessionContext.session.userSession?.idToken as string | undefined) ??
    sessionContext.session.oidcLogoutIdTokenHint ??
    null;

  const logoutUrl = buildLogoutUrl({
    idToken,
    oauth2BaseUrl: config.oauth2BaseUrl,
    postLogoutRedirectUri: getLogoutRedirectUrl(),
    state: createRandomToken(16),
  });

  return withDestroyedSessionRedirect(sessionContext, logoutUrl);
}
