import { NextRequest } from "next/server";

import { ensureUserScope, normalizeMutationPayload, runUserAction } from "@/lib/data";
import { getSession } from "@/lib/session";
import { mutationError, withSessionJson } from "@/lib/route-helpers";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const sessionContext = await getSession(request);
  const scopeCheck = ensureUserScope(sessionContext.session, "collection");

  if (!scopeCheck.ok) {
    return mutationError(sessionContext, scopeCheck);
  }

  const payload = (await request.json().catch(() => ({}))) as {
    name?: string;
  };
  const name = String(payload.name ?? "").trim();

  if (!name) {
    return mutationError(sessionContext, {
      message: "Enter a collection name before saving.",
      status: 400,
    });
  }

  const result = await runUserAction(sessionContext.session, (serverClient) =>
    serverClient.auth.v1.collections.create({ name }),
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
    item: normalizeMutationPayload.collection(result.data),
    message: "Collection created.",
    ok: true,
  });
}
