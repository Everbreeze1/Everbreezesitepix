const base = require("./app.json");

/**
 * Dynamic config, layered on top of `app.json`.
 *
 * `app.json` stays the source of truth for everything static, and this file
 * adds only the values that must not be committed. Expo prefers this file when
 * both exist, so the spread below is load-bearing: dropping a key here drops it
 * from the build.
 *
 * **The Google Maps Android key.** `react-native-maps` renders through Google
 * Maps on Android, and without a key the map view is a grey rectangle with the
 * Google watermark on it and no error anywhere. iOS uses Apple Maps and needs
 * nothing. The key is a build-time value, not a runtime one, so it cannot come
 * from `EXPO_PUBLIC_*` at render time the way the Supabase URL does: it has to
 * be baked into `AndroidManifest.xml` when the native project is generated.
 *
 * Set `EXPO_PUBLIC_GOOGLE_MAPS_ANDROID_KEY` in `apps/mobile/.env` locally, and
 * as an EAS secret for real builds. Absent, the app still builds and every
 * other screen works; the map screen detects the gap and says so rather than
 * showing an empty grey box that reads as a bug.
 *
 * The key is restricted to this Android package and the Maps SDK in the Google
 * Cloud console, which is what makes shipping it inside the APK acceptable. It
 * is not a secret in the sense the API's service-role key is: every Android app
 * that draws a Google map carries one, and it is readable from any installed
 * APK. The restriction is the control, not the concealment.
 */
const googleMapsKey = process.env.EXPO_PUBLIC_GOOGLE_MAPS_ANDROID_KEY ?? "";

module.exports = () => ({
  ...base.expo,
  android: {
    ...base.expo.android,
    // Omitted entirely when unset rather than written as an empty string. An
    // empty key makes the Maps SDK log an authorisation failure at runtime;
    // no key at all is the honest state and is what the map screen checks for.
    ...(googleMapsKey ? { config: { googleMaps: { apiKey: googleMapsKey } } } : {}),
  },
  extra: {
    ...(base.expo.extra ?? {}),
    /*
     * Mirrored into `extra` so the running app can tell whether the native side
     * was given a key, without trying to read the manifest. `Constants` is the
     * only channel between build-time config and JavaScript.
     */
    googleMapsConfigured: Boolean(googleMapsKey),
  },
});
