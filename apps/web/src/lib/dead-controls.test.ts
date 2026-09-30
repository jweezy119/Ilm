import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Catches the class of bug that is invisible to every other check.
 *
 * A control that renders and does nothing. Not one of these was found by a failing
 * test, a type error, or a 500 — all of them passed compilation, the type checker and
 * the suite, and were found by looking at the running page:
 *
 *   - /read rendered the five corpus pills with no `onText` prop, so `onText?.(id)`
 *     was a no-op. Clicking the way to reach another tradition did nothing at all.
 *   - "Compare beside this" added a passage to a tray instead of opening a
 *     comparison, so the label promised adjacency and delivered a counter.
 *   - The narrowing control on the landing page fired a request but no state
 *     changed, because the handler closed over a stale list.
 *
 * The first is statically detectable and that is what this checks: an event handler
 * that calls its callback optionally. `onText?.(id)` compiles, types, and does
 * nothing when the prop is absent — which is exactly the failure, and it is a
 * mistake that only shows itself in a browser.
 *
 * So: a component must not both declare a callback prop as optional and call it
 * optionally. Either the prop is required — and then forgetting to pass it is a type
 * error — or it is optional and the component owes the caller a way to see the
 * affordance. Optional-and-optional-call is the one combination that fails silently.
 */

const SRC = join(__dirname, '..');

function tsxFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry.startsWith('.')) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) tsxFiles(full, acc);
    else if (full.endsWith('.tsx')) acc.push(full);
  }
  return acc;
}

const files = tsxFiles(SRC).filter((f) => !f.includes('.next'));

interface OptionalCall {
  file: string;
  line: number;
  prop: string;
  text: string;
}

/** Every `foo?.(` that appears inside an `on*={...}` handler. */
function optionalHandlerCalls(): OptionalCall[] {
  const found: OptionalCall[] = [];

  for (const file of files) {
    const lines = readFileSync(file, 'utf8').split('\n');
    lines.forEach((line, i) => {
      // Inside an event handler, on a prop that the component receives.
      if (!/\bon[A-Z][A-Za-z]*=/.test(line) && !/\bon[A-Z][A-Za-z]*=\{\(/.test(line)) return;

      // Walk the braces of the handler so a call on a following line counts too.
      const handlerStart = line.search(/=\{/);
      if (handlerStart === -1) return;
      let depth = 0;
      let text = '';
      for (let j = i; j < Math.min(i + 12, lines.length); j += 1) {
        text += (j === i ? line.slice(handlerStart) : lines[j]) + '\n';
        for (const ch of lines[j] + (j === i ? line.slice(handlerStart) : '')) {
          if (ch === '{') depth += 1;
          if (ch === '}') depth -= 1;
        }
        if (depth <= 0 && j > i) break;
      }

      for (const m of text.matchAll(/\b(on[A-Z][A-Za-z]*)\?\.\(/g)) {
        found.push({
          file: file.replace(SRC, ''),
          line: i + 1,
          prop: m[1],
          text: line.trim().slice(0, 110),
        });
      }
    });
  }

  return found;
}

describe('dead controls', () => {
  it('has no event handler that calls its callback optionally', () => {
    /*
     * The failure this exists for. `/read` rendered its corpus pills with
     *
     *     onClick={() => onText?.(id)}
     *
     * because one call site passed the prop and the other did not. The pills looked
     * live, the types were fine, and clicking the control that selects a corpus did
     * nothing. Nothing in the build could see it.
     */
    const found = optionalHandlerCalls();

    expect(
      found,
      `These handlers call a callback optionally, so they silently do nothing when the prop is not passed:\n${found
        .map((f) => `  ${f.file}:${f.line}  ${f.prop}  ${f.text}`)
        .join('\n')}`
    ).toEqual([]);
  });

});
