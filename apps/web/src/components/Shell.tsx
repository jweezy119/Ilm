'use client';

import { useLocale, useTranslations } from 'next-intl';
import { Link, usePathname, usePathname as useLocalizedPathname } from '@/i18n/navigation';
import {
  BookOpen,
  Sun,
  Moon,
  Sparkles,
  Settings,
  ArrowLeftRight,
  Search,
  PanelLeftClose,
  PanelLeftOpen,
  Activity,
  Plus,
  Languages,
  Compass,
  Bookmark,
} from 'lucide-react';
import { routing, LOCALE_NAMES } from '@/i18n/routing';
import { useEffect, useState } from 'react';
import { useTheme } from './ThemeProvider';
import { useUiStore, useComparisonStore, useSearchStore } from '@/store';

/**
 * Nav items carry a message key, not a label.
 *
 * The label is looked up per locale, so the rail is translated without every page
 * having to pass a translated string into the shell.
 */
const NAV = [
  { href: '/', key: 'search', icon: Search },
  { href: '/read', key: 'read', icon: BookOpen },
  { href: '/journey', key: 'journey', icon: Compass },
  { href: '/topics', key: 'topics', icon: Compass },
  { href: '/library', key: 'library', icon: Bookmark },
  { href: '/explore', key: 'explore', icon: Sparkles },
  { href: '/compare', key: 'compare', icon: ArrowLeftRight },
  { href: '/settings', key: 'settings', icon: Settings },
] as const;

/**
 * Language switcher.
 *
 * A `<select>` rather than a menu: three options do not justify a popover, and a
 * native control is keyboard- and screen-reader-correct for free. It navigates
 * rather than swapping a cookie, because the language is part of the URL here and
 * a shared link has to carry it.
 */
function LanguageSwitcher({ collapsed }: { collapsed: boolean }) {
  const t = useTranslations('language');
  const locale = useLocale();
  const pathname = useLocalizedPathname();

  return (
    <div className={collapsed ? 'grid place-items-center' : ''}>
      <label className="sr-only" htmlFor="ilm-locale">
        {t('label')}
      </label>
      <div className="relative">
        {!collapsed ? (
          <Languages
            className="pointer-events-none absolute inset-y-0 start-2 my-auto h-4 w-4 text-fg-faint"
            aria-hidden
          />
        ) : null}
        <select
          id="ilm-locale"
          value={locale}
          onChange={(event) => {
            const next = event.target.value as (typeof routing.locales)[number];
            // Same page, new language. A plain router.push would drop the query
            // string, which here is the search term — switching language mid
            // search should not clear the search.
            window.location.assign(`/${next}${pathname === '/' ? '' : pathname}`);
          }}
          className={[
            'h-9 w-full appearance-none rounded-lg border border-line bg-panel text-sm text-fg outline-none',
            'focus-visible:ring-2 focus-visible:ring-accent',
            collapsed ? 'w-9 px-0 text-center text-xs' : 'ps-8 pe-2',
          ].join(' ')}
          title={t('switchTo', { language: LOCALE_NAMES[locale] })}
        >
          {routing.locales.map((l) => (
            <option key={l} value={l} lang={l}>
              {LOCALE_NAMES[l]}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}

/**
 * The application shell: a persistent left rail and one scrolling column.
 *
 * The rail used to be a top bar, which meant that on a page of forty results the
 * only way back to Compare or Settings was to scroll to the top and then across.
 * Keeping navigation fixed is the difference between the app feeling like a
 * document and feeling like a tool.
 *
 * The rail collapses to icons, and on a phone it becomes an overlay, because a
 * fixed column is not affordable at 390px wide.
 */
export function Shell({ children }: { children: React.ReactNode }) {
  const { resolvedTheme, setTheme } = useTheme();
  const t = useTranslations('nav');
  // Strip the locale prefix before comparing. usePathname from next-intl already
  // removes it, which is the point of importing it instead of next/navigation.
  const pathname = usePathname();
  const stored = useUiStore((s) => s.theme);
  const count = useComparisonStore((s) => s.passageKeys.length);
  const recent = useSearchStore((s) => s.recent);
  const clearRecent = useSearchStore((s) => s.clearRecent);

  // The rail's width is a preference, not layout: it survives navigation, and it
  // survives a reload, which is the whole reason to store it at all.
  const collapsed = useUiStore((s) => s.railCollapsed);
  const toggleCollapsed = useUiStore((s) => s.toggleRail);
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    if (stored !== 'system' && stored !== resolvedTheme) setTheme(stored);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stored]);

  // The drawer is closed by the links themselves rather than by watching the
  // pathname: an effect that calls setState synchronously re-renders the whole
  // shell on every navigation, and the links already know when they are used.

  return (
    <div className="flex min-h-screen bg-bg">
      {/* The rail. Fixed rather than sticky so the column beside it can scroll
          independently, which is what makes the app feel like an app. */}
      <aside
        className={[
          'fixed inset-y-0 start-0 z-50 flex shrink-0 flex-col border-e border-line bg-bg transition-[width,transform] duration-200',
          collapsed ? 'w-[68px]' : 'w-[264px]',
          mobileOpen ? 'translate-x-0 shadow-2xl' : '-translate-x-full lg:translate-x-0',
        ].join(' ')}
      >
        <div className={['flex h-14 shrink-0 items-center border-b border-line', collapsed ? 'justify-center px-2' : 'gap-2 px-4'].join(' ')}>
          <Link href="/" onClick={() => setMobileOpen(false)} className="flex min-w-0 items-center gap-2.5" aria-label={t('home')}>
            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-accent text-accent-fg">
              <BookOpen className="h-4 w-4" />
            </span>
            {!collapsed ? (
              <span className="truncate text-[17px] font-medium tracking-tight">
                Ilm
                <span className="ml-1.5 text-xs text-fg-faint" dir="rtl">
                  علم
                </span>
              </span>
            ) : null}
          </Link>
        </div>

        <div className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto px-3 py-3">
          <Link
            href="/"
            onClick={() => setMobileOpen(false)}
            className={['btn btn-secondary justify-start', collapsed ? 'px-0' : ''].join(' ')}
            title={t('newSearch')}
          >
            <Plus className="h-4 w-4 shrink-0" />
            {!collapsed ? t('newSearch') : null}
          </Link>

          <nav className="mt-1 flex flex-col gap-0.5" aria-label={t('main')}>
            {NAV.map((item) => {
              const active = item.href === '/' ? pathname === '/' : pathname.startsWith(item.href);
              const Icon = item.icon;
              const label = t(item.key);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={active ? 'page' : undefined}
                  title={collapsed ? label : undefined}
                  onClick={() => setMobileOpen(false)}
                  className={`rail-item ${active ? 'rail-item-active' : ''} ${collapsed ? 'justify-center px-0' : ''}`}
                >
                  <Icon className="h-[18px] w-[18px] shrink-0" />
                  {!collapsed ? <span className="truncate">{label}</span> : null}
                  {!collapsed && item.href === '/compare' && count > 0 ? (
                    <span className="ms-auto rounded-full bg-accent px-1.5 text-[10px] font-semibold text-accent-fg tabular-nums">
                      {count}
                    </span>
                  ) : null}
                </Link>
              );
            })}
          </nav>

          {/* Recent searches. In a chat-shaped tool the recent list is the thing
              people reach for most, and it belongs beside navigation rather than
              in the middle of the results. */}
          {!collapsed && recent.length > 0 ? (
            <div className="mt-5 min-h-0 flex-1">
              <div className="mb-1 flex items-center justify-between px-3">
                <span className="text-[11px] font-medium uppercase tracking-wider text-fg-faint">{t('recent')}</span>
                <button
                  type="button"
                  onClick={clearRecent}
                  className="rounded px-1 text-[11px] text-fg-faint transition-colors hover:text-fg"
                >
                  {t('clear')}
                </button>
              </div>
              <ul className="space-y-0.5">
                {recent.map((term) => (
                  <li key={term}>
                    <Link
                      href={`/?q=${encodeURIComponent(term)}`}
                      onClick={() => setMobileOpen(false)}
                      className="rail-item py-1.5 text-[13px]"
                      title={term}
                    >
                      <span className="truncate">{term}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>

        <div className={`shrink-0 border-t border-line p-3 ${collapsed ? 'flex flex-col items-center gap-1' : ''}`}>
          <div className={collapsed ? '' : 'mb-2'}>
            <LanguageSwitcher collapsed={collapsed} />
          </div>
          {!collapsed ? (
            <p className="mb-1 px-2 text-[11px] leading-relaxed text-fg-faint">
              {t('disclaimer')}
            </p>
          ) : null}
          <div className={['flex items-center gap-1', collapsed ? 'flex-col' : 'justify-between'].join(' ')}>
            <a href="/api/health" target="_blank" rel="noreferrer" className="icon-btn" title={t('apiStatus')}>
              <Activity className="h-4 w-4" />
            </a>
            <button
              type="button"
              onClick={() => setTheme(resolvedTheme === 'dark' ? 'light' : 'dark')}
              className="icon-btn"
              aria-label={resolvedTheme === 'dark' ? t('switchToLight') : t('switchToDark')}
              title={resolvedTheme === 'dark' ? t('lightTheme') : t('darkTheme')}
            >
              {resolvedTheme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </button>
            <button
              type="button"
              onClick={toggleCollapsed}
              className="icon-btn hidden lg:grid"
              aria-label={collapsed ? t('expandSidebar') : t('collapseSidebar')}
              title={collapsed ? t('expandSidebar') : t('collapseSidebar')}
            >
              {collapsed ? <PanelLeftOpen className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
            </button>
          </div>
        </div>
      </aside>

      {/* Scrim behind the mobile drawer. */}
      {mobileOpen ? (
        <div
          className="fixed inset-0 z-40 bg-black/40 lg:hidden"
          onClick={() => setMobileOpen(false)}
          aria-hidden
        />
      ) : null}

      <div className={`flex min-w-0 flex-1 flex-col transition-[padding] duration-200 ${collapsed ? 'lg:ps-[68px]' : 'lg:ps-[264px]'}`}>
        {/* The mobile-only trigger for the drawer. */}
        <div className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b border-line bg-bg/85 px-3 backdrop-blur lg:hidden">
          <button
            type="button"
            onClick={() => setMobileOpen(true)}
            className="icon-btn"
            aria-label={t('openNavigation')}
          >
            <PanelLeftOpen className="h-5 w-5" />
          </button>
          <Link href="/" className="flex items-center gap-2">
            <span className="grid h-7 w-7 place-items-center rounded-lg bg-accent text-accent-fg">
              <BookOpen className="h-3.5 w-3.5" />
            </span>
            <span className="font-medium">Ilm</span>
          </Link>
        </div>

        <main className="min-w-0 flex-1">{children}</main>
      </div>
    </div>
  );
}

/**
 * A page inside the shell, with the standard measure and gutters.
 *
 * The shell no longer carries padding of its own, because the search page needs a
 * different measure (a narrow reading column with a composer pinned under it) and
 * the comparison page needs the full width of the window. One container, declared
 * per page, is easier to reason about than padding that every page has to undo.
 */
export function Page({ children, wide = false }: { children: React.ReactNode; wide?: boolean }) {
  return (
    <Shell>
      <div className={`mx-auto w-full px-5 py-10 sm:px-8 ${wide ? 'max-w-[1600px]' : 'max-w-4xl'}`}>{children}</div>
    </Shell>
  );
}

export function PageHeader({ title, description, action }: { title: string; description?: string; action?: React.ReactNode }) {
  return (
    <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        <h1 className="text-2xl font-medium tracking-tight">{title}</h1>
        {description ? <p className="mt-1.5 max-w-2xl text-sm leading-relaxed text-fg-muted">{description}</p> : null}
      </div>
      {action}
    </div>
  );
}

export function Empty({ icon: Icon = Sparkles, title, children }: { icon?: typeof Sparkles; title: string; children?: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed border-line px-6 py-16 text-center">
      <span className="mx-auto mb-4 grid h-11 w-11 place-items-center rounded-full bg-panel text-fg-muted">
        <Icon className="h-5 w-5" />
      </span>
      <p className="text-[15px] font-medium">{title}</p>
      {children ? <div className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-fg-muted">{children}</div> : null}
    </div>
  );
}
