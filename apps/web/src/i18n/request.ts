import { getRequestConfig } from 'next-intl/server';
import { hasLocale } from 'next-intl';
import { routing } from './routing';

export default getRequestConfig(async ({ requestLocale }) => {
  // `requestLocale` is a promise in next-intl 4, and it can be undefined for a
  // request that never matched a locale — which is a 404, not a crash.
  const requested = await requestLocale;

  if (!requested || !hasLocale(routing.locales, requested)) {
    return { locale: routing.defaultLocale };
  }

  return {
    locale: requested,
    messages: (await import(`../../messages/${requested}.json`)).default,
  };
});
