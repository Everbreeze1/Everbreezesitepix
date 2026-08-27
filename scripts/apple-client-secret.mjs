#!/usr/bin/env node
/**
 * Generates the "Sign in with Apple" client secret that Supabase's Apple
 * provider expects. Reads a .p8 signing key, writes a JWT to stdout, and
 * touches nothing else.
 *
 *   node scripts/apple-client-secret.mjs ~/Downloads/AuthKey_8342B58MKK.p8
 *
 * Pipe it straight to the clipboard so the secret never lands in scrollback:
 *
 *   node scripts/apple-client-secret.mjs AuthKey_8342B58MKK.p8 | pbcopy    # macOS
 *   node scripts/apple-client-secret.mjs AuthKey_8342B58MKK.p8 | clip      # Windows
 *
 * Two traps this exists to avoid.
 *
 * The Supabase field is labelled "Secret key" and sits directly under the
 * Services ID, which reads like it wants the .p8 file contents. It does not.
 * It wants this JWT, signed by the .p8. Pasting the key itself is rejected
 * with "Secret key should be a JWT", which does not explain what to do instead.
 *
 * Apple caps the token's lifetime at six months and will not accept a longer
 * exp. When it lapses, web sign-in fails silently: the button keeps rendering,
 * because use-auth-providers.tsx only asks whether the provider is enabled, not
 * whether its secret still verifies. Re-run this before the printed date.
 */
import { createSign } from "node:crypto";
import { readFileSync } from "node:fs";
import { basename } from "node:path";

/*
 * From Apple Developer -> Membership details, and the Services ID created
 * under Identifiers. CLIENT_ID is deliberately the Services ID and not the
 * bundle identifier `com.everlumen.app`: the bundle id belongs in the native
 * iOS flow, and putting it here produces an invalid_client from Apple that
 * looks nothing like a configuration mistake.
 */
const TEAM_ID = "38M73Z7VLA";
const CLIENT_ID = "com.everlumen.web";

// Apple's own ceiling is 15777000s (roughly 182 days). Stay just inside it.
const MAX_LIFETIME_SECONDS = 15_552_000; // 180 days

const keyPath = process.argv[2];
if (!keyPath) {
  console.error("usage: node scripts/apple-client-secret.mjs <AuthKey_XXXXXXXXXX.p8>");
  process.exit(1);
}

/*
 * Apple names the download AuthKey_<KEY_ID>.p8, so the key id is already in
 * the filename. Reading it from there removes a copy-paste step that is easy
 * to get wrong and produces a signature Apple rejects without saying why.
 */
const keyId = process.argv[3] ?? basename(keyPath).replace(/^AuthKey_/, "").replace(/\.p8$/, "");
if (!/^[A-Z0-9]{10}$/.test(keyId)) {
  console.error(`Could not read a key id from "${basename(keyPath)}".`);
  console.error("Pass it explicitly: node scripts/apple-client-secret.mjs <key.p8> <KEY_ID>");
  process.exit(1);
}

let privateKey;
try {
  privateKey = readFileSync(keyPath, "utf8");
} catch {
  console.error(`Cannot read ${keyPath}`);
  console.error("Apple lets you download a .p8 once. If it is lost, register a new key.");
  process.exit(1);
}

const now = Math.floor(Date.now() / 1000);
const exp = now + MAX_LIFETIME_SECONDS;

const encode = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
const header = encode({ alg: "ES256", kid: keyId, typ: "JWT" });
const payload = encode({
  iss: TEAM_ID,
  iat: now,
  exp,
  aud: "https://appleid.apple.com",
  sub: CLIENT_ID,
});

const signer = createSign("SHA256");
signer.update(`${header}.${payload}`);
/*
 * `ieee-p1363` is load-bearing. Node signs ECDSA as DER by default, and a DER
 * signature in a JWT is silently wrong: it is valid base64, the token looks
 * well formed, and Apple simply answers invalid_client. JOSE requires the raw
 * r||s pair, which is what this flag produces.
 */
const signature = signer.sign({ key: privateKey, dsaEncoding: "ieee-p1363" }, "base64url");

// stdout carries the secret and nothing else, so `| pbcopy` stays clean.
process.stdout.write(`${header}.${payload}.${signature}\n`);

console.error(`team ${TEAM_ID}  key ${keyId}  client ${CLIENT_ID}`);
console.error(`expires ${new Date(exp * 1000).toISOString().slice(0, 10)} - regenerate before then`);
