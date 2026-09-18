import { NextRequest } from "next/server";

import { loadBootstrapData } from "@/lib/data";
import { withSessionJson } from "@/lib/route-helpers";
import { getSession } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const sessionContext = await getSession(request);
  const payload = await loadBootstrapData(
    sessionContext.session,
    sessionContext.storeSummary,
  );

  return withSessionJson(sessionContext, payload);
}
