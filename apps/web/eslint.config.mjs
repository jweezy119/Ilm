import nextCoreWebVitals from 'eslint-config-next/core-web-vitals';
import nextTypescript from 'eslint-config-next/typescript';

/**
 * Flat config. Next 16 removed `next lint` and the `eslint` key in next.config.js,
 * so linting is eslint's own CLI against this file.
 */
const config = [
  {
    /*
     * The generated fallback-voice engine is excluded along with the usual
     * machinery. It is a 1.8 MB minified bundle produced by
     * apps/api/scripts/build-robotic-voice.mjs, and linting it produced four
     * thousand warnings about code nobody wrote and cannot change. It is also
     * already covered where it matters — the artifact is asserted on by
     * robotic-voice.test.ts, and its behaviour is verified in a real browser.
     */
    ignores: [
      '.next/**',
      'node_modules/**',
      'next-env.d.ts',
      'public/vendor/**',
    ],
  },
  ...nextCoreWebVitals,
  ...nextTypescript,
  {
    rules: {
      // The idiomatic client-fetch shape is `useEffect(() => { setLoading(true);
      // fetch().then(setState) }, [dep])`. The rule objects to the synchronous
      // setState, but removing it means either an await before the first paint or
      // a rewrite onto a data library. Kept as a warning so the rest of lint runs.
      'react-hooks/set-state-in-effect': 'warn',
    },
  },
];

export default config;
