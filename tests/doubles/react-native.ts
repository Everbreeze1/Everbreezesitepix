/**
 * The sliver of `react-native` the testable modules touch.
 *
 * `secure-storage.ts` reads `Platform.OS` only to decide whether SecureStore
 * exists at all, so this is deliberately tiny rather than a general shim.
 */
export const Platform = { OS: "ios" as "ios" | "android" | "web" };
