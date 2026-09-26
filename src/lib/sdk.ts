import "server-only";

import { getConfig } from "@/lib/env";
import type { StoredSession } from "@/lib/session/store";

type UnknownRecord = Record<string, unknown>;

interface OAuth2PublicClient {
  v1: {
    authorizeUrl: (params: UnknownRecord) => string;
  };
}

interface OAuth2ServerClient {
  v1: {
    exchangeCode: (params: {
      code: string;
      codeVerifier: string;
      redirectUri: string;
    }) => Promise<unknown>;
    getUserInfo: () => Promise<unknown>;
    refresh: () => Promise<unknown>;
  };
}

interface ServerAuthClient {
  v1: {
    bookmarks: {
      create: (payload: UnknownRecord) => Promise<unknown>;
      list: (params: UnknownRecord) => Promise<unknown>;
      remove: (bookmarkId: string) => Promise<unknown>;
    };
    collections: {
      create: (payload: { name: string }) => Promise<unknown>;
      list: (params: UnknownRecord) => Promise<unknown>;
      remove: (collectionId: string) => Promise<unknown>;
    };
    goals: {
      create: (payload: UnknownRecord) => Promise<unknown>;
      getTodaysPlan: () => Promise<unknown>;
      remove: (goalId: string) => Promise<unknown>;
      update: (goalId: string, payload: UnknownRecord) => Promise<unknown>;
    };
    notes: {
      create: (payload: UnknownRecord) => Promise<unknown>;
      list: () => Promise<unknown>;
      remove: (noteId: string) => Promise<unknown>;
    };
    preferences: {
      get: () => Promise<unknown>;
      update: (payload: UnknownRecord) => Promise<unknown>;
    };
  };
}

interface ServerContentClient {
  v4: {
    chapters: {
      get: (chapterId: string) => Promise<unknown>;
      list: () => Promise<unknown>;
    };
    verses: {
      byChapter: (chapterId: string, params: UnknownRecord) => Promise<unknown>;
    };
  };
}

interface ServerSearchClient {
  v1: {
    query: (params: UnknownRecord) => Promise<unknown>;
  };
}

interface ServerQuranReflectClient {
  v1: {
    posts: {
      create: (payload: UnknownRecord) => Promise<unknown>;
      feed: (params: UnknownRecord) => Promise<unknown>;
    };
    users: {
      profile: () => Promise<unknown>;
    };
  };
}

export interface PublicClient {
  oauth2: OAuth2PublicClient;
}

export interface ServerClient {
  auth: ServerAuthClient;
  content: ServerContentClient;
  oauth2: OAuth2ServerClient;
  quranReflect: ServerQuranReflectClient;
  search: ServerSearchClient;
}

interface RuntimeSplitSdk {
  createPublicClient: (options: UnknownRecord) => PublicClient;
  createServerClient: (options: UnknownRecord) => ServerClient;
}

const dynamicImport = new Function(
  "modulePath",
  "return import(modulePath)",
) as (modulePath: string) => Promise<Record<string, unknown>>;

let cachedSdk: RuntimeSplitSdk | null = null;

const loadRuntimeSplitSdk = async (): Promise<RuntimeSplitSdk> => {
  if (cachedSdk) {
    return cachedSdk;
  }

  try {
    const publicModule = await dynamicImport("@quranjs/api/public");
    const serverModule = await dynamicImport("@quranjs/api/server");
    const createPublicClient = publicModule.createPublicClient;
    const createServerClient = serverModule.createServerClient;

    if (typeof createPublicClient !== "function") {
      throw new Error("createPublicClient is not available.");
    }

    if (typeof createServerClient !== "function") {
      throw new Error("createServerClient is not available.");
    }

    cachedSdk = {
      createPublicClient: createPublicClient as (
        options: UnknownRecord,
      ) => PublicClient,
      createServerClient: createServerClient as (
        options: UnknownRecord,
      ) => ServerClient,
    };

    return cachedSdk;
  } catch (_error) {
    throw new Error(
      "The installed @quranjs/api package does not expose @quranjs/api/public and @quranjs/api/server yet. Install a local SDK build with `npm run sdk:local -- /path/to/api-js/packages/api`, or install a published runtime-split release.",
    );
  }
};

const createLiveSafeFetch = (fetchImpl: typeof fetch) => async (url: string, options?: RequestInit) => {
  const requestUrl = new URL(String(url));

  if (requestUrl.pathname.endsWith("/v1/collections")) {
    const sortBy = requestUrl.searchParams.get("sort_by");

    if (sortBy) {
      requestUrl.searchParams.delete("sort_by");
      requestUrl.searchParams.set("sortBy", sortBy);
    }
  }

  if (requestUrl.pathname.endsWith("/v1/bookmarks")) {
    const mushafId = requestUrl.searchParams.get("mushaf_id");

    if (mushafId) {
      requestUrl.searchParams.delete("mushaf_id");
      requestUrl.searchParams.set("mushafId", mushafId);
    }
  }

  return fetchImpl(requestUrl.toString(), options);
};

interface SessionStorageAdapter {
  clearSession: () => void;
  getSession: () => Record<string, unknown> | null;
  setSession: (userSession: Record<string, unknown> | null) => void;
}

const createSessionStorageAdapter = (session: StoredSession): SessionStorageAdapter => ({
  clearSession: () => {
    session.userSession = null;
    session.oidcLogoutIdTokenHint = null;
  },
  getSession: () => session.userSession ?? null,
  setSession: (userSession) => {
    session.userSession = userSession;

    if (!userSession) {
      session.oidcLogoutIdTokenHint = null;
      return;
    }

    const idToken = userSession.idToken;
    if (typeof idToken === "string" && idToken) {
      session.oidcLogoutIdTokenHint = idToken;
    }
  },
});

export const createClients = async (session: StoredSession) => {
  const config = getConfig();
  const runtimeSdk = await loadRuntimeSplitSdk();

  const sharedConfig = {
    clientId: config.clientId,
    fetch: createLiveSafeFetch(globalThis.fetch),
    services: config.services,
    storage: createSessionStorageAdapter(session),
    userSession: session.userSession ?? null,
  };

  return {
    publicClient: runtimeSdk.createPublicClient({
      ...sharedConfig,
      clientType: "confidential-proxy",
    }),
    serverClient: runtimeSdk.createServerClient({
      ...sharedConfig,
      clientSecret: config.clientSecret,
    }),
  };
};

export const getSearchModeQuick = async (): Promise<string> => {
  try {
    const runtimeModule = await dynamicImport("@quranjs/api");
    const searchMode = runtimeModule.SearchMode as
      | { Quick?: unknown }
      | undefined;

    return typeof searchMode?.Quick === "string"
      ? searchMode.Quick
      : "quick";
  } catch (_error) {
    return "quick";
  }
};
