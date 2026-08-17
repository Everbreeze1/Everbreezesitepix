import js from "@eslint/js";
import eslintPluginPrettier from "eslint-plugin-prettier/recommended";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    /*
     * Build output, not source. `.vercel` and `.tanstack` are the two that were
     * missing: CI never sees them (fresh checkout, and Build runs after Lint),
     * but a developer who has run `npm run build` once has a full bundle sitting
     * in `apps/web/.vercel/output`, and linting it took `npm run lint` from 13
     * seconds to over ten minutes locally. Both are already in `.gitignore`.
     */
    ignores: [
      "dist",
      ".output",
      "apps/web/.output",
      ".vinxi",
      // `**/` prefixed, unlike the entries above: these live under `apps/web`,
      // not the root, which is the same reason `apps/web/.output` needs its own
      // line next to `.output`.
      "**/.vercel/**",
      "**/.tanstack/**",
      "apps/api/**",
      "apps/mobile/**",
      "packages/**",
    ],
  },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "server-only",
              message:
                "TanStack Start does not use the Next.js `server-only` package. Rename the module to `*.server.ts` or mark it with `@tanstack/react-start/server-only`.",
            },
          ],
        },
      ],
      "react-refresh/only-export-components": ["warn", { allowConstantExport: true }],
      "@typescript-eslint/no-unused-vars": "off",
      /*
       * `any` is a warning, not an error - deliberately, and with a way out.
       *
       * There are 756 of these across 84 files, and they are overwhelmingly not
       * laziness: `packages/db/src/database.ts` is stale (it describes 18 tables
       * for a schema with 50+, and is missing live columns such as
       * `projects.deleted_at`), so almost every Supabase call is written as
       * `(supabase as any).from(...)` to get past types that would otherwise
       * reject correct code. Making this an error fails CI on every run, which
       * trains everyone to ignore the pipeline; leaving it off entirely hides
       * the debt. A warning keeps it counted and visible.
       *
       * The fix is upstream, not here: regenerate the DB types
       * (`supabase gen types typescript --linked > packages/db/src/database.ts`,
       * see LAUNCH.md §1.4), then the casts can come out file by file and this
       * can go back to "error".
       */
      "@typescript-eslint/no-explicit-any": "warn",
      /*
       * Empty `catch {}` is the house idiom for best-effort cleanup that must
       * not mask the real error - stopping a MediaRecorder that may already be
       * stopped, revoking an object URL, deleting a storage blob after a failed
       * insert. All 30 occurrences are catch blocks. Every other kind of empty
       * block stays an error.
       */
      "no-empty": ["error", { allowEmptyCatch: true }],
    },
  },
  {
    files: ["apps/web/src/features/**/*.{ts,tsx}", "apps/web/src/components/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "@sitepix/api/http",
              message:
                "HTTP handlers are server-only. Use `@sitepix/api-client` or `@/features/<domain>/api`.",
            },
          ],
          patterns: [
            {
              group: ["**/apps/api/src/**"],
              message:
                "Do not import API internals from UI. Use `@/features/<domain>/api` or `@sitepix/api-client`.",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["apps/web/src/routes/_app.*.tsx"],
    rules: {
      "max-lines": ["warn", { max: 80, skipBlankLines: true, skipComments: true }],
    },
  },
  eslintPluginPrettier,
);
