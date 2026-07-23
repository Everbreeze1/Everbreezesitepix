import js from "@eslint/js";
import eslintPluginPrettier from "eslint-plugin-prettier/recommended";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "dist",
      ".output",
      "apps/web/.output",
      ".vinxi",
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
