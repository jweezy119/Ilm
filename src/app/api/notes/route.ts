import { NextRequest } from "next/server";

import { ensureUserScope, normalizeMutationPayload, parseVerseKey, runUserAction } from "@/lib/data";
import { getSession } from "@/lib/session";
import { mutationError, withSessionJson } from "@/lib/route-helpers";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const sessionContext = await getSession(request);
  const scopeCheck = ensureUserScope(sessionContext.session, "note");

  if (!scopeCheck.ok) {
    return mutationError(sessionContext, scopeCheck);
  }

  const payload = (await request.json().catch(() => ({}))) as {
    body?: string;
    verseKey?: string;
  };

  const body = String(payload.body ?? "").trim();
  const verseKey = parseVerseKey(payload.verseKey);

  if (!body) {
    return mutationError(sessionContext, {
      message: "Enter a note body before saving.",
      status: 400,
    });
  }

  if (!verseKey) {
    return mutationError(sessionContext, {
      message: "Use a verse key like 1:1.",
      status: 400,
    });
  }

  const result = await runUserAction(sessionContext.session, (serverClient) =>
    serverClient.auth.v1.notes.create({
      body,
      ranges: [`${verseKey}-${verseKey}`],
      saveToQR: false,
    }),
  );

  if (result.sessionExpired) {
    return mutationError(sessionContext, {
      message: result.error ?? "Session expired.",
      signedOut: true,
      status: 401,
    });
  }

  if (result.error) {
    return mutationError(sessionContext, {
      message: result.error,
      status: 400,
    });
  }

  return withSessionJson(sessionContext, {
    item: normalizeMutationPayload.note(result.data),
    message: "Note created.",
    ok: true,
  });
}
