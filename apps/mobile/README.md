# Everlumen mobile (`@everlumen/mobile`)

The React Native field app: capture photos on site, work checklists, record walkthroughs, and keep working when there is no signal.

Plan and phase breakdown: [`docs/mobile-plan.md`](../../docs/mobile-plan.md).
API contract: [`docs/api.md`](../../docs/api.md). Data boundaries: [`docs/data-access.md`](../../docs/data-access.md).

## Stack

Expo SDK 57 (React Native 0.86, React 19.2), expo-router for file-based routing, TanStack Query v5 for server state, and Supabase for auth plus RLS reads.

## Setup

```bash
cd apps/mobile
cp .env.example .env      # then fill in the publishable key
npm install
npm start
```

Press `i` for an iOS simulator, `a` for an Android emulator, or scan the QR code with Expo Go on a physical device.

**This folder installs on its own.** It is deliberately outside the root `workspaces` array, so running `npm install` at the repo root does nothing for it. The `@everlumen/*` packages resolve through `file:` links, and Metro is pointed at the monorepo root by `metro.config.js`.

## Environment

All three variables are public by nature and end up readable inside the app bundle. **Never put a service-role key or a third-party API secret here**; those live in `apps/api` (see [`docs/ops.md`](../../docs/ops.md)).

| Variable                                         | Purpose                                                  |
| ------------------------------------------------ | -------------------------------------------------------- |
| `EXPO_PUBLIC_EVERLUMEN_SUPABASE_URL`             | Supabase project URL                                     |
| `EXPO_PUBLIC_EVERLUMEN_SUPABASE_PUBLISHABLE_KEY` | Supabase anon/publishable key                            |
| `EXPO_PUBLIC_API_BASE_URL`                       | Origin serving `/v1`, for example `https://everlumen.co` |

For EAS builds these come from the profile's `env` block in `eas.json`, except the publishable key, which is set once per environment with `eas env:create`.

## Checks

```bash
npm run typecheck    # tsc --noEmit
```

## Builds

`eas.json` defines three profiles. All of them need an EAS project first: run `eas init` and replace `extra.eas.projectId` in `app.json`, which currently reads `replace-me`.

| Profile       | Command                                          | Produces                                                        |
| ------------- | ------------------------------------------------ | --------------------------------------------------------------- |
| `development` | `eas build --profile development --platform ios` | Dev client, internal distribution, iOS simulator build included |
| `preview`     | `eas build --profile preview --platform all`     | Installable QA build against the production API                 |
| `production`  | `eas build --profile production --platform all`  | Store submission, auto-incrementing build number                |

## Layout

```text
app/          expo-router routes, kept thin
src/api/      per-domain data access, mirrors apps/web/src/features/*
src/lib/      supabase client, /v1 client, secure storage, query client
src/theme/    design tokens, converted from the web brand palette
src/components/
```

Session tokens go to the iOS Keychain and Android Keystore through `src/lib/secure-storage.ts`, never to AsyncStorage.
