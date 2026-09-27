'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { BookOpen, Sun, Moon, Scale, Sparkles, Settings, ArrowLeftRight } from 'lucide-react';
import { useEffect } from 'react';
import { useTheme } from './ThemeProvider';
import { useUiStore, useComparisonStore } from '@/store';

const NAV = [
  { href: '/', label: 'Search' },
  { href: '/explore', label: 'Explore' },
  { href: '/compare', label: 'Compare' },
  { href: '/settings', label: 'Settings' },
];

export function Shell({ children }: { children: React.ReactNode }) {
  const { resolvedTheme, setTheme } = useTheme();
  const pathname = usePathname();
  const stored = useUiStore((s) => s.theme);
  const count = useComparisonStore((s) => s.passageKeys.length);

  // Keep the provider in sync with the persisted preference.
  useEffect(() => {
    if (stored !== 'system' && stored !== resolvedTheme) setTheme(stored);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stored]);

  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-40 border-b border-ink-200/70 bg-paper/85 backdrop-blur dark:border-ink-800 dark:bg-paper-950/85">
        <div className="mx-auto flex h-14 max-w-7xl items-center gap-4 px-4 sm:px-6">
          <Link href="/" className="flex items-center gap-2 font-semibold">
            <span className="grid h-8 w-8 place-items-center rounded-lg bg-emerald-800 text-white dark:bg-emerald-600">
              <BookOpen className="h-4 w-4" />
            </span>
            <span className="text-lg">Ilm</span>
            <span className="hidden text-xs text-ink-500 sm:inline" dir="rtl">
              علم
            </span>
          </Link>

          <nav className="ml-2 flex items-center gap-1 text-sm" aria-label="Main">
            {NAV.map((item) => {
              const active = item.href === '/' ? pathname === '/' : pathname.startsWith(item.href);
              const Icon = item.href === '/explore' ? Sparkles : item.href === '/compare' ? ArrowLeftRight : item.href === '/settings' ? Settings : null;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={active ? 'page' : undefined}
                  className={`flex items-center gap-1.5 rounded-md px-2.5 py-1.5 transition-colors ${
                    active ? 'bg-ink-900 text-white dark:bg-ink-100 dark:text-ink-950' : 'text-ink-600 hover:bg-ink-100 dark:text-ink-300 dark:hover:bg-ink-800'
                  }`}
                >
                  {Icon ? <Icon className="h-3.5 w-3.5" /> : null}
                  {item.label}
                  {item.href === '/compare' && count > 0 ? (
                    <span className="rounded-full bg-emerald-700 px-1.5 text-[10px] font-semibold text-white">{count}</span>
                  ) : null}
                </Link>
              );
            })}
          </nav>

          <div className="ml-auto flex items-center gap-2">
            <a
              href="/api/health"
              target="_blank"
              rel="noreferrer"
              className="hidden text-xs text-ink-500 hover:text-ink-800 sm:inline dark:hover:text-ink-200"
            >
              API status
            </a>
            <button
              type="button"
              onClick={() => setTheme(resolvedTheme === 'dark' ? 'light' : 'dark')}
              className="grid h-8 w-8 place-items-center rounded-md text-ink-600 hover:bg-ink-100 dark:text-ink-300 dark:hover:bg-ink-800"
              aria-label={resolvedTheme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
            >
              {resolvedTheme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 sm:px-6">{children}</main>

      <footer className="border-t border-ink-200/70 py-6 text-center text-xs text-ink-500 dark:border-ink-800 dark:text-ink-400">
        <p>
          Ilm · Quran · Torah · Talmud · Old Testament · New Testament
        </p>
        <p className="mt-1">
          Connections are weighted scores from Jev (TypeSafe) judgments, not generated interpretations.
        </p>
      </footer>
    </div>
  );
}

export function PageHeader({ title, description, action }: { title: string; description?: string; action?: React.ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {description ? <p className="mt-1 max-w-2xl text-sm text-ink-600 dark:text-ink-400">{description}</p> : null}
      </div>
      {action}
    </div>
  );
}

export function Empty({ icon: Icon = Scale, title, children }: { icon?: typeof Scale; title: string; children?: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed border-ink-300 py-16 text-center dark:border-ink-700">
      <Icon className="mx-auto mb-4 h-8 w-8 text-ink-400" />
      <p className="font-medium">{title}</p>
      {children ? <div className="mx-auto mt-2 max-w-md text-sm text-ink-600 dark:text-ink-400">{children}</div> : null}
    </div>
  );
}
