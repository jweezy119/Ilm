import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  ALL_TEXTS,
  migrateSearchState,
  partializeSearchState,
  useSearchStore,
} from './index';

describe('landing page & search reset guards', () => {
  it('clears active query and response while keeping recent search history', () => {
    const store = useSearchStore.getState();
    store.setQuery('mercy');
    store.remember('mercy');
    store.clear();

    const after = useSearchStore.getState();
    expect(after.query).toBe('');
    expect(after.response).toBeNull();
    expect(after.recent).toContain('mercy');
  });

  it('excludes active query and response from persisted state and strips stale v1 storage', () => {
    const persisted = partializeSearchState({
      ...useSearchStore.getState(),
      query: 'stale query',
      response: { results: [] } as never,
      activeTexts: ALL_TEXTS,
      recent: ['mercy'],
    } as never);

    expect('query' in persisted).toBe(false);
    expect('response' in persisted).toBe(false);
    expect(persisted.recent).toEqual(['mercy']);

    const migrated = migrateSearchState({
      query: 'old stuck search',
      response: { results: [{ id: '1' }] },
      activeTexts: ['quran'],
      recent: ['mercy', 'light'],
    });
    expect('query' in migrated).toBe(false);
    expect('response' in migrated).toBe(false);
    expect(migrated.activeTexts).toEqual(['quran']);
    expect(migrated.recent).toEqual(['mercy', 'light']);
  });

  it('clears search state from Shell home/new-search links and clean / URLs', () => {
    const shell = readFileSync(resolve(__dirname, '../components/Shell.tsx'), 'utf8');
    const home = readFileSync(resolve(__dirname, '../app/[locale]/page.tsx'), 'utf8');

    expect(shell).toContain('const clearSearch = useSearchStore((s) => s.clear);');
    expect(shell).toContain('clearSearch();');
    expect(home).toContain('clear();');
    expect(home).toContain('resetToHome');
  });
});
