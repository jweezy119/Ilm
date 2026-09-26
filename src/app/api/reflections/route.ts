import { NextRequest } from "next/server";

import { ensureUserScope, parseVerseKey, runUserAction } from "@/lib/data";
import { getSession } from "@/lib/session";
import { mutationError, withSessionJson } from "@/lib/route-helpers";

export const dynamic = "force-dynamic";

const toReference = (verseKey: string) => {
  const [chapterId, verseNumber] = verseKey.split(":").map((item) => Number(item));

  return {
    chapterId,
    from: verseNumber,
    to: verseNumber,
  };
};

export async function POST(request: NextRequest) {
  const sessionContext = await getSession(request);
  const scopeCheck = ensureUserScope(sessionContext.session, "post");

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
      message: "Write a reflection before posting.",
      status: 400,
    });
  }

  if (!verseKey) {
    return mutationError(sessionContext, {
      message: "Use a verse key like 2:255.",
      status: 400,
    });
  }

  const result = await runUserAction(sessionContext.session, (serverClient) =>
    serverClient.quranReflect.v1.posts.create({
      body,
      references: [toReference(verseKey)],
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
    data: result.data,
    message: "Reflection posted.",
    ok: true,
  });
}
