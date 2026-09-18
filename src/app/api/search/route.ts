import { NextRequest } from "next/server";

import { loadSearchData } from "@/lib/data";
import { getSession } from "@/lib/session";
import { withSessionJson } from "@/lib/route-helpers";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const sessionContext = await getSession(request);
  const payload = await loadSearchData(
    sessionContext.session,
    request.nextUrl.searchParams.get("query"),
  );

  return withSessionJson(sessionContext, payload);
}
