import { NextRequest } from "next/server";

import { SESSION_EXPIRED_MESSAGE } from "@/lib/constants";
import { createClients } from "@/lib/sdk";
import { getSession } from "@/lib/session";
import { mutationError, withSessionJson } from "@/lib/route-helpers";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const sessionContext = await getSession(request);
  const userSession = sessionContext.session.userSession;

  if (!userSession?.refreshToken) {
    sessionContext.session.userSession = null;
    sessionContext.session.oidcLogoutIdTokenHint = null;
    return mutationError(sessionContext, {
      message: "No user session is available to refresh.",
      signedOut: true,
      status: 401,
    });
  }

  try {
    const { serverClient } = await createClients(sessionContext.session);
    await serverClient.oauth2.v1.refresh();

    return withSessionJson(sessionContext, {
      message: "Session refreshed.",
      ok: true,
    });
  } catch (_error) {
    if (!sessionContext.session.userSession) {
      sessionContext.session.oidcLogoutIdTokenHint = null;
      return mutationError(sessionContext, {
        message: SESSION_EXPIRED_MESSAGE,
        signedOut: true,
        status: 401,
      });
    }

    return mutationError(sessionContext, {
      message: "Session refresh failed. Try again.",
      signedOut: false,
      status: 502,
    });
  }
}
