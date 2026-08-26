import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import tseslint from "typescript-eslint";

/**
 * Hooks linting for `apps/mobile`, run on its own.
 *
 * The root config ignores `apps/mobile/**` alongside `apps/api/**`, so nothing
 * had ever checked the app's components. That is the one class of bug neither
 * `tsc` nor a Metro bundle can see: a hook called conditionally type-checks,
 * bundles, and then crashes the screen the first time the condition flips.
 *
 * Separate from the root config rather than folded into it, deliberately. The
 * root run includes `eslint-plugin-prettier`, which reports every line of a
 * CRLF checkout as an error; adding a few thousand of those would bury exactly
 * the findings this exists to surface. Only the hooks rules run here.
 */
export default tseslint.config(
  {
    ignores: ["apps/mobile/node_modules/**", "apps/mobile/.expo/**", "apps/mobile/dist/**"],
  },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ["apps/mobile/**/*.{ts,tsx}"],
    languageOptions: {
      ecmaVersion: 2022,
      globals: {
        ...globals.browser,
        ...globals.node,
        // React Native's build-time flag, injected by Metro rather than declared.
        __DEV__: "readonly",
      },
    },
    plugins: { "react-hooks": reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
      /*
       * The recommended TypeScript set is noisy about things this codebase does
       * on purpose (`as never` casts against generated Supabase types, empty
       * catch blocks that are documented as deliberate). Hooks correctness is
       * what this run is for; the type checker already covers the rest.
       */
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_" }],
      "@typescript-eslint/no-empty-object-type": "off",
      "no-empty": "off",
    },
  },
);
