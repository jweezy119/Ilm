import { NextRequest } from "next/server";

import { DEFAULT_BOOKMARK_MUSHAF } from "@/lib/constants";
import { ensureUserScope, normalizeMutationPayload, parsePositiveInteger, runUserAction } from "@/lib/data";
import { getSession } from "@/lib/session";
import { mutationError, withSessionJson } from "@/lib/route-helpers";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const sessionContext = await getSession(request);
  const scopeCheck = ensureUserScope(sessionContext.session, "bookmark");

  if (!scopeCheck.ok) {
    return mutationError(sessionContext, scopeCheck);
  }

  const payload = (await request.json().catch(() => ({}))) as {
    chapterNumber?: number | string;
    verseNumber?: number | string;
  };

  const chapterNumber = parsePositiveInteger(payload.chapterNumber);
  const verseNumber = parsePositiveInteger(payload.verseNumber);

  if (!chapterNumber || !verseNumber) {
    return mutationError(sessionContext, {
      message: "Enter valid chapter and verse numbers before creating a bookmark.",
      status: 400,
    });
  }

  const result = await runUserAction(sessionContext.session, (serverClient) =>
    serverClient.auth.v1.bookmarks.create({
      key: chapterNumber,
      mushaf: DEFAULT_BOOKMARK_MUSHAF,
      type: "ayah",
      verseNumber,
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
    item: normalizeMutationPayload.bookmark(result.data),
    message: "Bookmark created.",
    ok: true,
  });
}
