import { NextResponse } from "next/server";

import { getConfig } from "@/lib/env";
import { commitSession, destroySession, type SessionContext } from "@/lib/session";

export const getAppUrl = (path = "/"): string =>
  new URL(path, getConfig().appBaseUrl).toString();

export const getCallbackUrl = (): string =>
  getAppUrl("/callback");

export const getLogoutRedirectUrl = (): string =>
  getAppUrl("/callback");

export const withSessionJson = async (
  context: SessionContext,
  payload: unknown,
  status = 200,
): Promise<NextResponse> => {
  const response = NextResponse.json(payload, { status });
  return commitSession(response, context);
};

export const withSessionRedirect = async (
  context: SessionContext,
  url: string,
  status: 302 | 307 = 302,
): Promise<NextResponse> => {
  const response = NextResponse.redirect(url, status);
  return commitSession(response, context);
};

export const withDestroyedSessionRedirect = async (
  context: SessionContext,
  url: string,
): Promise<NextResponse> => {
  const response = NextResponse.redirect(url);
  return destroySession(response, context);
};

export const mutationError = async (
  context: SessionContext,
  details: {
    gatingMessage?: string | null;
    message: string;
    signedOut?: boolean;
    status?: number;
  },
): Promise<NextResponse> =>
  withSessionJson(
    context,
    {
      gatingMessage: details.gatingMessage ?? null,
      message: details.message,
      ok: false,
      signedOut: Boolean(details.signedOut),
    },
    details.status ?? 400,
  );
