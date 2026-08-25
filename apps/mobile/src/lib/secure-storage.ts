import AsyncStorage from "@react-native-async-storage/async-storage";
import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";

/**
 * Encrypted session storage for the Supabase client.
 *
 * Supabase persists the whole session (access token, refresh token, and the
 * user object) under one key. The refresh token in there is a long-lived
 * credential: anything holding it can mint access tokens until it is revoked.
 * It has no business sitting in AsyncStorage, which is a plain unencrypted
 * file that any process reading the app sandbox can open.
 *
 * SecureStore puts it in the iOS Keychain / Android Keystore instead. The catch
 * is the size cap: Android warns past 2048 bytes and can refuse the write, and
 * a Supabase session with a populated `user_metadata` clears that easily. So
 * values are split across numbered keys and reassembled on read.
 */

/** Conservative: the documented Android ceiling is 2048 bytes. */
const MAX_CHUNK_BYTES = 1536;

/** Marks a stored value as a manifest rather than the value itself. */
const MANIFEST_PREFIX = "__chunked__:";

const encoder = new TextEncoder();

function byteLength(value: string): number {
  return encoder.encode(value).length;
}

/**
 * Split on UTF-8 byte size without ever cutting a surrogate pair in half.
 *
 * Splitting by `String.prototype.slice` at a fixed length can leave a lone
 * surrogate at a chunk boundary. Concatenation would put it back together, but
 * the halves have to survive a round trip through native storage first, and a
 * lone surrogate is not valid UTF-8 to encode on the way there.
 */
function chunk(value: string): string[] {
  const chunks: string[] = [];
  let current = "";
  let currentBytes = 0;

  for (const char of value) {
    const size = byteLength(char);
    if (currentBytes + size > MAX_CHUNK_BYTES && current.length > 0) {
      chunks.push(current);
      current = "";
      currentBytes = 0;
    }
    current += char;
    currentBytes += size;
  }

  if (current.length > 0) chunks.push(current);
  return chunks.length > 0 ? chunks : [""];
}

function chunkKey(key: string, index: number): string {
  return `${key}__${index}`;
}

/**
 * SecureStore is native-only. On web (`expo start --web`) it does not exist, so
 * fall back rather than crash the bundle on import. Web is a development
 * convenience here, never a shipping target.
 */
const secureStoreAvailable = Platform.OS !== "web";

async function secureGet(key: string): Promise<string | null> {
  if (!secureStoreAvailable) return AsyncStorage.getItem(key);
  return SecureStore.getItemAsync(key);
}

async function secureSet(key: string, value: string): Promise<void> {
  if (!secureStoreAvailable) return AsyncStorage.setItem(key, value);
  return SecureStore.setItemAsync(key, value);
}

async function secureDelete(key: string): Promise<void> {
  if (!secureStoreAvailable) return AsyncStorage.removeItem(key);
  return SecureStore.deleteItemAsync(key);
}

async function readChunkCount(key: string): Promise<number | null> {
  const head = await secureGet(key);
  if (head === null) return null;
  if (!head.startsWith(MANIFEST_PREFIX)) return null;
  const count = Number.parseInt(head.slice(MANIFEST_PREFIX.length), 10);
  return Number.isFinite(count) && count > 0 ? count : null;
}

/** Remove chunk keys from `from` upward until one is missing. */
async function clearChunksFrom(key: string, from: number): Promise<void> {
  for (let i = from; ; i += 1) {
    const existing = await secureGet(chunkKey(key, i));
    if (existing === null) return;
    await secureDelete(chunkKey(key, i));
  }
}

async function getItem(key: string): Promise<string | null> {
  const count = await readChunkCount(key);

  if (count === null) {
    const direct = await secureGet(key);
    if (direct !== null) return direct;

    /*
     * Nothing in SecureStore. Before reporting a miss, look for a session left
     * behind by the AsyncStorage-backed client this replaced, and move it
     * across. Without this, shipping the fix silently signs out every existing
     * install, which reads as a bug to whoever is holding the phone.
     */
    const legacy = await AsyncStorage.getItem(key);
    if (legacy === null) return null;
    await setItem(key, legacy);
    await AsyncStorage.removeItem(key);
    return legacy;
  }

  const parts: string[] = [];
  for (let i = 0; i < count; i += 1) {
    const part = await secureGet(chunkKey(key, i));
    // A partially written value is unusable. Treat it as absent so the caller
    // re-authenticates instead of parsing a truncated session.
    if (part === null) return null;
    parts.push(part);
  }
  return parts.join("");
}

async function setItem(key: string, value: string): Promise<void> {
  const previousCount = await readChunkCount(key);

  if (byteLength(value) <= MAX_CHUNK_BYTES) {
    await secureSet(key, value);
    if (previousCount !== null) await clearChunksFrom(key, 0);
    return;
  }

  const parts = chunk(value);
  // Write chunks before the manifest, so an interrupted write leaves the old
  // manifest pointing at old chunks rather than a manifest pointing at nothing.
  for (let i = 0; i < parts.length; i += 1) {
    await secureSet(chunkKey(key, i), parts[i]);
  }
  await secureSet(key, `${MANIFEST_PREFIX}${parts.length}`);
  await clearChunksFrom(key, parts.length);
}

async function removeItem(key: string): Promise<void> {
  const count = await readChunkCount(key);
  await secureDelete(key);
  if (count !== null) await clearChunksFrom(key, 0);
  await AsyncStorage.removeItem(key);
}

/** Storage adapter shaped for `createClient({ auth: { storage } })`. */
export const secureStorage = {
  getItem,
  setItem,
  removeItem,
};
