import { NextRequest, NextResponse } from "next/server";

import { SESSION_COOKIE_NAME, SESSION_TTL_SECONDS } from "@/lib/constants";
import { getConfig } from "@/lib/env";
import {
  createSessionId,
  createSignedSessionId,
  getSessionStore,
  parseSignedSessionId,
  type StoredSession,
} from "@/lib/session/store";

const emptySession = (): StoredSession => ({
  authError: null,
  flashNotice: null,
  oauth: null,
  oidcLogoutIdTokenHint: null,
  userSession: null,
});

const hasObjectValue = (value: unknown): boolean =>
  Boolean(value && typeof value === "object" && Object.keys(value).length > 0);

export const isSessionEmpty = (session: StoredSession): boolean =>
  !session.authError &&
  !session.flashNotice &&
  !session.oauth &&
  !session.oidcLogoutIdTokenHint &&
  !hasObjectValue(session.userSession);

export interface SessionContext {
  hasSessionCookie: boolean;
  session: StoredSession;
  sessionId: string;
  sessionIdsToDelete?: string[];
  storeSummary: string;
}

export const getSession = async (
  request: NextRequest,
): Promise<SessionContext> => {
  const config = getConfig();
  const store = getSessionStore(config.redisUrl);
  const sessionCookie = request.cookies.get(SESSION_COOKIE_NAME);
  const signedValue = sessionCookie?.value;
  const parsedSessionId = parseSignedSessionId(
    signedValue,
    config.sessionSecret,
  );

  const persistedSession = parsedSessionId
    ? await store.get(parsedSessionId)
    : null;
  const sessionId = parsedSessionId ?? createSessionId();

  return {
    hasSessionCookie: Boolean(sessionCookie),
    session: persistedSession ?? emptySession(),
    sessionId,
    sessionIdsToDelete: [],
    storeSummary: store.summary,
  };
};

export const commitSession = async (
  response: NextResponse,
  context: SessionContext,
): Promise<NextResponse> => {
  const sessionIdsToDelete = context.sessionIdsToDelete ?? [];

  if (isSessionEmpty(context.session)) {
    if (context.hasSessionCookie || sessionIdsToDelete.length > 0) {
      const config = getConfig();
      const store = getSessionStore(config.redisUrl);

      await Promise.all([
        context.hasSessionCookie
          ? store.delete(context.sessionId)
          : Promise.resolve(),
        ...sessionIdsToDelete
          .filter((sessionId) => sessionId !== context.sessionId)
          .map((sessionId) => store.delete(sessionId)),
      ]);
      response.cookies.delete(SESSION_COOKIE_NAME);
    }

    return response;
  }

  const config = getConfig();
  const store = getSessionStore(config.redisUrl);

  await Promise.all(
    sessionIdsToDelete
      .filter((sessionId) => sessionId !== context.sessionId)
      .map((sessionId) => store.delete(sessionId)),
  );

  await store.set(context.sessionId, context.session);

  response.cookies.set({
    httpOnly: true,
    maxAge: SESSION_TTL_SECONDS,
    name: SESSION_COOKIE_NAME,
    path: "/",
    sameSite: "lax",
    secure: config.isProduction,
    value: createSignedSessionId(context.sessionId, config.sessionSecret),
  });

  return response;
};

export const rotateSession = (context: SessionContext): void => {
  context.sessionIdsToDelete ??= [];
  context.sessionIdsToDelete.push(context.sessionId);
  context.hasSessionCookie = false;
  context.sessionId = createSessionId();
};

export const destroySession = async (
  response: NextResponse,
  context: SessionContext,
): Promise<NextResponse> => {
  const config = getConfig();
  const store = getSessionStore(config.redisUrl);

  await store.delete(context.sessionId);
  response.cookies.delete(SESSION_COOKIE_NAME);

  if (config.isProduction) {
    response.headers.set("Cache-Control", "no-store");
  }

  return response;
};
