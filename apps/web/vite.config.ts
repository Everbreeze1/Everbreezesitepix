import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, loadEnv, type PluginOption } from "vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import tsConfigPaths from "vite-tsconfig-paths";

const appRoot = path.dirname(fileURLToPath(import.meta.url));
const monorepoRoot = path.resolve(appRoot, "../..");

export default defineConfig(async ({ command, mode }) => {
  // Secrets / Vite env live at monorepo root (`.env`, `.dev.vars`).
  const env = {
    ...loadEnv(mode, monorepoRoot, "VITE_"),
    ...loadEnv(mode, appRoot, "VITE_"),
  };
  const envDefine: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    envDefine[`import.meta.env.${key}`] = JSON.stringify(value);
  }

  const plugins: PluginOption[] = [
    tailwindcss(),
    tsConfigPaths({ projects: [path.join(appRoot, "tsconfig.json")] }),
    tanstackStart({
      server: { entry: "server" },
      importProtection: {
        behavior: "error",
        client: {
          files: ["**/server/**"],
          specifiers: ["server-only"],
        },
      },
    }),
  ];

  if (command === "build") {
    const { nitro } = await import("nitro/vite");
    plugins.push(
      nitro({
        preset: "vercel",
      }),
    );
  }

  plugins.push(viteReact());

  return {
    envDir: monorepoRoot,
    define: envDefine,
    resolve: {
      alias: { "@": path.join(appRoot, "src") },
      dedupe: [
        "react",
        "react-dom",
        "react/jsx-runtime",
        "react/jsx-dev-runtime",
        "@tanstack/react-query",
        "@tanstack/query-core",
      ],
    },
    optimizeDeps: {
      include: [
        "react",
        "react-dom",
        "react-dom/client",
        "react/jsx-runtime",
        "react/jsx-dev-runtime",
        "@supabase/supabase-js",
        "@radix-ui/react-label",
        "sonner",
      ],
    },
    server: {
      host: true,
      port: 8080,
      watch: {
        /**
         * Never watch build output.
         *
         * `nitro({ preset: "vercel" })` above writes `apps/web/.vercel/output/`
         * on every `npm run build`. If a dev server is then started while those
         * files are still held open - routine on Windows - chokidar throws
         * `EBUSY: resource busy or locked` on one of them (in practice
         * `static/apple-touch-icon.png`). That surfaces as an unhandled `error`
         * event on FSWatcher, which kills the whole dev process rather than
         * degrading, so the symptom is a dev server that dies seconds after
         * "ready" with no obvious cause.
         *
         * These are generated artifacts and gitignored; nothing under them ever
         * needs to trigger an HMR update.
         */
        ignored: ["**/.vercel/**", "**/.nitro/**", "**/.output/**", "**/dist/**"],
      },
    },
    plugins,
  };
});
