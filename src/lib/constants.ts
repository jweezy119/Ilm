export const DEFAULT_BOOKMARK_MUSHAF = 4;
export const DEFAULT_FEED_QUERY = {
  limit: 5,
  page: 1,
  tab: "feed",
} as const;
export const LIST_PREVIEW_LIMIT = 8;
export const SESSION_COOKIE_NAME = "qf.sid";
export const SESSION_EXPIRED_MESSAGE = "Session expired. Sign in again.";
export const SESSION_TTL_MS = 24 * 60 * 60 * 1000;
export const SESSION_TTL_SECONDS = Math.ceil(SESSION_TTL_MS / 1000);
