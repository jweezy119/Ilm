import { NextRequest } from "next/server";

import { ensureUserScope, runUserAction } from "@/lib/data";
import { getSession } from "@/lib/session";
import { mutationError, withSessionJson } from "@/lib/route-helpers";

export const dynamic = "force-dynamic";

export async function PUT(
  request: NextRequest,
  context: { params: { goalId: string } },
) {
  const sessionContext = await getSession(request);
  const scopeCheck = ensureUserScope(sessionContext.session, "goal");

  if (!scopeCheck.ok) {
    return mutationError(sessionContext, scopeCheck);
  }

  const payload = (await request.json().catch(() => ({}))) as {
    payload?: Record<string, unknown>;
  };
  const goalPayload = payload.payload;

  if (!goalPayload || Object.keys(goalPayload).length === 0) {
    return mutationError(sessionContext, {
      message: "Provide a goal payload before updating.",
      status: 400,
    });
  }

  const result = await runUserAction(sessionContext.session, (serverClient) =>
    serverClient.auth.v1.goals.update(context.params.goalId, goalPayload),
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
    message: "Goal updated.",
    ok: true,
  });
}

export async function DELETE(
  request: NextRequest,
  context: { params: { goalId: string } },
) {
  const sessionContext = await getSession(request);
  const scopeCheck = ensureUserScope(sessionContext.session, "goal");

  if (!scopeCheck.ok) {
    return mutationError(sessionContext, scopeCheck);
  }

  const result = await runUserAction(sessionContext.session, (serverClient) =>
    serverClient.auth.v1.goals.remove(context.params.goalId),
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
    deletedId: context.params.goalId,
    message: "Goal deleted.",
    ok: true,
  });
}
