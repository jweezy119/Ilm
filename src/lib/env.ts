import { DEFAULT_OAUTH2_BASE_URL } from "@/lib/oauth";

const REQUIRED_ENV_VARS = [
  "APP_BASE_URL",
  "CLIENT_ID",
  "CLIENT_SECRET",
  "SESSION_SECRET",
] as const;

const getRequired = (key: string): string => {
  const value = process.env[key];
  if (!value) {
    throw new Error(`Missing required environment variable: ${key}`);
  }

  return value;
};

const getOptional = (key: string): string | undefined => {
  const value = process.env[key];
  return value ? value : undefined;
};

const toPositiveInt = (value: string | undefined, fallback: number): number => {
  if (!value) {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return fallback;
  }

  return parsed;
};

export const parseTranslationIds = (value: string | undefined): number[] => {
  if (!value) {
    return [131];
  }

  const parsed = value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => Number.parseInt(item, 10))
    .filter((item) => Number.isInteger(item) && item > 0);

  return parsed.length > 0 ? parsed : [131];
};

const buildServiceOverrides = () => {
  const services = {
    authBaseUrl: getOptional("AUTH_BASE_URL"),
    contentBaseUrl: getOptional("CONTENT_BASE_URL"),
    gatewayUrl: getOptional("GATEWAY_URL"),
    oauth2BaseUrl: getOptional("OAUTH2_BASE_URL") ?? getOptional("TOKEN_HOST"),
    quranReflectBaseUrl: getOptional("QURAN_REFLECT_BASE_URL"),
    searchBaseUrl: getOptional("SEARCH_BASE_URL"),
  };

  const entries = Object.entries(services).filter(([, value]) =>
    Boolean(value),
  );
  if (entries.length === 0) {
    return undefined;
  }

  return Object.fromEntries(entries);
};

export interface RuntimeConfig {
  appBaseUrl: string;
  clientId: string;
  clientSecret: string;
  defaultReaderChapter: string;
  isProduction: boolean;
  oauth2BaseUrl: string;
  redisUrl?: string;
  scopes: string;
  services?: {
    authBaseUrl?: string;
    contentBaseUrl?: string;
    gatewayUrl?: string;
    oauth2BaseUrl?: string;
    quranReflectBaseUrl?: string;
    searchBaseUrl?: string;
  };
  sessionSecret: string;
  translationIds: number[];
}

let cachedConfig: RuntimeConfig | null = null;

export const getConfig = (): RuntimeConfig => {
  if (cachedConfig) {
    return cachedConfig;
  }

  for (const key of REQUIRED_ENV_VARS) {
    getRequired(key);
  }

  const services = buildServiceOverrides();

  cachedConfig = {
    appBaseUrl: getRequired("APP_BASE_URL"),
    clientId: getRequired("CLIENT_ID"),
    clientSecret: getRequired("CLIENT_SECRET"),
    defaultReaderChapter: String(
      toPositiveInt(getOptional("DEFAULT_READER_CHAPTER"), 1),
    ),
    isProduction: process.env.NODE_ENV === "production",
    oauth2BaseUrl: services?.oauth2BaseUrl ?? DEFAULT_OAUTH2_BASE_URL,
    redisUrl: getOptional("REDIS_URL"),
    scopes:
      getOptional("SCOPES") ??
      "openid offline_access user note collection bookmark goal preference post comment",
    services,
    sessionSecret: getRequired("SESSION_SECRET"),
    translationIds: parseTranslationIds(getOptional("TRANSLATION_IDS")),
  };

  return cachedConfig;
};
