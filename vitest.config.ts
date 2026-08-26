import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const path = (rel: string) => fileURLToPath(new URL(rel, import.meta.url));

export default defineConfig({
  /*
   * The automatic JSX runtime, so a test can render a component.
   *
   * esbuild defaults to the classic `React.createElement` transform, which
   * needs React in scope in every file - the app never imports it, because Vite
   * configures this for the app build. Without it here, a .test.tsx compiles and
   * then throws "React is not defined" at render.
   */
  esbuild: { jsx: "automatic" },
  test: {
    include: ["tests/**/*.test.ts", "tests/**/*.test.tsx"],
    environment: "node",
  },
  /*
   * The two aliases the web app's own imports use.
   *
   * Tests import app modules by relative path (`../apps/web/src/lib/...`), and
   * that works right up until the module being imported has an import of its
   * own written the way the app writes them. Without these, a pure, perfectly
   * testable helper becomes untestable the moment it needs a shared type, and
   * the workaround is always the wrong one: duplicate the logic into the test,
   * or push the helper somewhere it does not belong.
   *
   * Kept in step with the `paths` block in apps/web/tsconfig.json.
   */
  resolve: {
    /*
     * Anchored patterns, not bare strings. A string `find` matches as a prefix,
     * so `"@everlumen/shared"` swallows `@everlumen/shared/team-permissions` too and
     * rewrites it to `.../src/index.ts/team-permissions`. The subpath exports in
     * packages/shared/package.json already resolve on their own, so the alias
     * has to stop at the bare specifier.
     */
    alias: [
      { find: /^@everlumen\/shared$/, replacement: path("./packages/shared/src/index.ts") },
      /*
       * Test doubles for the two native modules the mobile offline layer
       * imports. They cannot load in Node, and a bare `vi.mock("expo-sqlite")`
       * inside `tests/` does not help: the package is installed under
       * `apps/mobile`, so the specifier does not resolve from here and the mock
       * registers against an id nothing matches. Aliasing resolves it.
       *
       * The SQLite double runs the app's real SQL against `node:sqlite`, so the
       * queue's claim and backoff behaviour is tested rather than imitated.
       */
      { find: /^expo-sqlite$/, replacement: path("./tests/doubles/expo-sqlite.ts") },
      { find: /^expo-crypto$/, replacement: path("./tests/doubles/expo-crypto.ts") },
      /*
       * The same treatment for the modules `src/lib/secure-storage.ts` pulls
       * in. That file holds the Supabase refresh token, splits it to fit
       * SecureStore's size cap, and migrates it off AsyncStorage, so it is
       * worth testing against a store that behaves like the real one rather
       * than not testing at all.
       */
      { find: /^expo-secure-store$/, replacement: path("./tests/doubles/expo-secure-store.ts") },
      {
        find: /^@react-native-async-storage\/async-storage$/,
        replacement: path("./tests/doubles/async-storage.ts"),
      },
      { find: /^react-native$/, replacement: path("./tests/doubles/react-native.ts") },
      { find: /^expo-file-system$/, replacement: path("./tests/doubles/expo-file-system.ts") },
      { find: /^@\//, replacement: `${path("./apps/web/src")}/` },
    ],
  },
});
