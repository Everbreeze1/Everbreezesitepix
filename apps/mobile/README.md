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

For EAS builds these come from the profile's `env` block in `eas.json`, except the publishable key, which lives in EAS environment variables. It is already set for all three environments; `eas env:list --environment development` shows it. To change it, use `eas env:set` (`eas env:create` is deprecated).

## Checks

```bash
npm run typecheck    # tsc --noEmit
```

From the repo root, the two checks that catch what `tsc` cannot:

```bash
npx eslint -c eslint.mobile.config.js apps/mobile   # hooks rules, run separately from the root config
cd apps/mobile && npx expo export --platform android  # Metro resolution and bundle size
```

## Builds

`eas.json` defines three profiles. The EAS project exists: **@everlumen1/everlumen**, and `extra.eas.projectId` in `app.json` points at it.

**EAS builds from the committed git state, not your working tree.** Uncommitted work is silently absent from the build, which is a confusing way to lose an afternoon. Commit first.

**Android only for now.** An iOS device build needs an Apple Developer Program membership for provisioning, and an iOS simulator build needs macOS to run it.

| Profile       | Command                                          | Produces                                                        |
| ------------- | ------------------------------------------------ | --------------------------------------------------------------- |
| `development` | `eas build --profile development --platform ios` | Dev client, internal distribution, iOS simulator build included |
| `preview`     | `eas build --profile preview --platform all`     | Installable QA build against the production API                 |
| `production`  | `eas build --profile production --platform all`  | Store submission, auto-incrementing build number                |

## Layout

```text
app/(app)/(tabs)/   the four tab screens: projects, gallery, activity, account
app/(app)/          everything pushed on top of them, kept thin
src/ui/             the UI kit. Build screens from these
src/api/            per-domain data access, mirrors apps/web/src/features/*
src/lib/            supabase client, /v1 client, secure storage, query client
src/theme/          design tokens, converted from the web brand palette
src/components/     app-specific pieces that are not primitives
```

### The UI kit

`src/ui` is this app's answer to `apps/web/src/components/ui`. Import from `@/ui`:

```tsx
import { Button, Card, EmptyState, ListRow, PageHeader } from "@/ui";
import { Camera, MapPin } from "@/ui/icons";
```

Two rules, both load-bearing:

1. **Build screens out of the kit, and when a piece is missing add it to the kit rather than to the screen.** A screen with a `StyleSheet.create` full of borders and radii is what the kit exists to replace. Before it, all 24 files had one and the app had nine different bordered boxes with six different radii.
2. **Icons come from `@/ui/icons`, never from `lucide-react-native`.** Metro does not tree-shake, so importing from the package barrel ships all ~1600 icons: it took the Android bundle from 3.7MB to 6.2MB when it was measured. `tests/mobile-icon-imports.test.ts` fails the build if that import comes back. To add an icon, add one line to `src/ui/icons.ts`.

Session tokens go to the iOS Keychain and Android Keystore through `src/lib/secure-storage.ts`, never to AsyncStorage.
