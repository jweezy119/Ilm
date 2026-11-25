/**
 * A configured donation/checkout URL, or an empty string.
 *
 * Only HTTPS is accepted: a payment link sent over plain HTTP is worse than no
 * link at all. The value is read from a NEXT_PUBLIC_ variable because it is
 * inlined into the bundle at build time, so it must be present when the web
 * image is built, not only when it starts.
 */
export function supportUrl(): string {
  const value = (process.env.NEXT_PUBLIC_SUPPORT_URL ?? '').trim();
  return value.startsWith('https://') ? value : '';
}
