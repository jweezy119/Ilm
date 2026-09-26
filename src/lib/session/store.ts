import crypto from "node:crypto";

import { createClient, type RedisClientType } from "redis";

import { SESSION_TTL_MS, SESSION_TTL_SECONDS } from "@/lib/constants";

export interface StoredSession {
  authError?: string | null;
  flashNotice?: { message: string; type: "error" | "success" } | null;
  oauth?: {
    codeVerifier: string;
    nonce: string;
    state: string;
  } | null;
  oidcLogoutIdTokenHint?: string | null;
  userSession?: Record<string, unknown> | null;
}

interface SessionStore {
  delete: (id: string) => Promise<void>;
  get: (id: string) => Promise<StoredSession | null>;
  set: (id: string, value: StoredSession) => Promise<void>;
  summary: string;
}

export class MemorySessionStore implements SessionStore {
  private readonly cache = new Map<
    string,
    { expiresAt: number; value: StoredSession }
  >();

  summary = "Example in-process session store";

  private pruneExpired(now = Date.now()): void {
    this.cache.forEach((current, id) => {
      if (now > current.expiresAt) {
        this.cache.delete(id);
      }
    });
  }

  async delete(id: string): Promise<void> {
    this.cache.delete(id);
  }

  async get(id: string): Promise<StoredSession | null> {
    const current = this.cache.get(id);

    if (!current) {
      return null;
    }

    if (Date.now() > current.expiresAt) {
      this.cache.delete(id);
      return null;
    }

    return current.value;
  }

  async set(id: string, value: StoredSession): Promise<void> {
    const now = Date.now();

    this.pruneExpired(now);

    this.cache.set(id, {
      expiresAt: now + SESSION_TTL_MS,
      value,
    });
  }
}

class RedisSessionStore implements SessionStore {
  private client: RedisClientType;

  private connectingPromise: Promise<void> | null = null;

  private readonly prefix = "qf:sess:";

  summary = "Redis-backed shared session store";

  constructor(redisUrl: string) {
    this.client = createClient({ url: redisUrl });
    this.client.on("error", (error) => {
      console.error("Redis session store error", error);
    });
  }

  private async ensureConnected() {
    if (this.client.isOpen) {
      return;
    }

    this.connectingPromise ??= this.client
      .connect()
      .then(() => undefined)
      .finally(() => {
        this.connectingPromise = null;
      });

    await this.connectingPromise;
  }

  async delete(id: string): Promise<void> {
    await this.ensureConnected();
    await this.client.del(`${this.prefix}${id}`);
  }

  async get(id: string): Promise<StoredSession | null> {
    await this.ensureConnected();
    const value = await this.client.get(`${this.prefix}${id}`);

    if (!value) {
      return null;
    }

    try {
      return JSON.parse(value) as StoredSession;
    } catch (_error) {
      return null;
    }
  }

  async set(id: string, value: StoredSession): Promise<void> {
    await this.ensureConnected();
    await this.client.set(`${this.prefix}${id}`, JSON.stringify(value), {
      EX: SESSION_TTL_SECONDS,
    });
  }
}

const memoryStore = new MemorySessionStore();
let redisStore: RedisSessionStore | null = null;

export const getSessionStore = (redisUrl?: string): SessionStore => {
  if (!redisUrl) {
    return memoryStore;
  }

  if (!redisStore) {
    redisStore = new RedisSessionStore(redisUrl);
  }

  return redisStore;
};

const sign = (sessionId: string, secret: string): string =>
  crypto.createHmac("sha256", secret).update(sessionId).digest("hex");

export const createSignedSessionId = (
  sessionId: string,
  secret: string,
): string => `${sessionId}.${sign(sessionId, secret)}`;

export const parseSignedSessionId = (
  signedValue: string | undefined,
  secret: string,
): string | null => {
  if (!signedValue) {
    return null;
  }

  const separatorIndex = signedValue.indexOf(".");
  if (separatorIndex <= 0 || separatorIndex !== signedValue.lastIndexOf(".")) {
    return null;
  }

  const sessionId = signedValue.slice(0, separatorIndex);
  const providedSignature = signedValue.slice(separatorIndex + 1);
  if (!sessionId || !providedSignature) {
    return null;
  }

  const expected = sign(sessionId, secret);
  if (!/^[a-f0-9]{64}$/i.test(providedSignature)) {
    return null;
  }

  const expectedBuffer = Buffer.from(expected, "hex");
  const providedBuffer = Buffer.from(providedSignature, "hex");

  if (
    expectedBuffer.length !== providedBuffer.length ||
    !crypto.timingSafeEqual(expectedBuffer, providedBuffer)
  ) {
    return null;
  }

  return sessionId;
};

export const createSessionId = (): string => crypto.randomUUID();
