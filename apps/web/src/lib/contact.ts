/** The address that means "nobody configured contact for this deployment". */
export const UNCONFIGURED_CONTACT = 'hello@example.com';

/**
 * A real contact address, or an empty string.
 *
 * The placeholder is recognised here rather than in the page so that a reader
 * never sees it: a mailto that reaches nobody is worse than an honest notice,
 * and a privacy request sent to it is a request nobody acts on. Deployed builds
 * refuse to ship with it at all (see next.config.js).
 */
export function contactAddress(): string {
  const value = (process.env.NEXT_PUBLIC_CONTACT_EMAIL ?? '').trim();
  return value && value !== UNCONFIGURED_CONTACT ? value : '';
}
