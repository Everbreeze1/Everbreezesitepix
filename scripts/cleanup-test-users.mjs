/** Deletes any leftover disposable atk_/vic_ test accounts from a failed run. */
import { readFileSync } from "node:fs";

const env = {};
for (const line of readFileSync("apps/api/.env", "utf8").split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}
const web = {};
for (const line of readFileSync(".env", "utf8").split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
  if (m) web[m[1]] = m[2].replace(/^["']|["']$/g, "");
}
const URL = web.VITE_SUPABASE_URL;
const KEY = env.EVERLUMEN_SUPABASE_SERVICE_ROLE_KEY;
const H = { apikey: KEY, Authorization: `Bearer ${KEY}` };

let page = 1;
let deleted = 0;
while (page < 20) {
  const r = await fetch(`${URL}/auth/v1/admin/users?page=${page}&per_page=200`, { headers: H });
  const j = await r.json().catch(() => ({}));
  const users = j.users ?? [];
  if (!users.length) break;
  for (const u of users) {
    if (/^(atk|vic|probe)_/.test(u.email ?? "")) {
      await fetch(`${URL}/auth/v1/admin/users/${u.id}`, { method: "DELETE", headers: H });
      console.log("deleted", u.email);
      deleted++;
    }
  }
  page++;
}
console.log(`\ndone - removed ${deleted} disposable test account(s)`);
