// Fails if a tracked env-style file contains anything other than public client config,
// or if any tracked file contains a recognisable server secret.
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";

const SECRET_PATTERNS = [
  /sk-(?:proj-)?[A-Za-z0-9_-]{20,}/,
  /gh[pousr]_[A-Za-z0-9]{30,}/,
  /github_pat_[A-Za-z0-9_]{30,}/,
  /sb_secret_[A-Za-z0-9_-]{10,}/,
  /-----BEGIN (?:RSA |EC )?PRIVATE KEY-----/,
  /^\s*(?:export\s+)?SUPABASE_SERVICE_ROLE_KEY=\S+/m,
];
const ALLOWED_ENV_KEYS = /^(VITE_)?SUPABASE_(PROJECT_ID|PUBLISHABLE_KEY|URL)$/;

const tracked = execSync("git ls-files", { encoding: "utf8" }).split("\n").filter(Boolean);
const problems = [];
for (const file of tracked) {
  if (/(^|\/)\.env(\..*)?$/.test(file) && !file.endsWith(".env.example")) {
    for (const line of readFileSync(file, "utf8").split("\n")) {
      const key = line.split("=")[0]?.trim();
      if (!key || key.startsWith("#")) continue;
      if (!ALLOWED_ENV_KEYS.test(key)) problems.push(`${file}: non-public key ${key}`);
    }
  }
  if (/\.(png|jpg|jpeg|ico|webp|lock|woff2?)$/.test(file) || file === "bun.lock") continue;
  let text = "";
  try {
    text = readFileSync(file, "utf8");
  } catch {
    continue;
  }
  for (const pattern of SECRET_PATTERNS) {
    if (pattern.test(text)) problems.push(`${file}: matches secret pattern ${pattern.source.slice(0, 24)}…`);
  }
}
if (problems.length) {
  console.error("Env/secret safety check FAILED:\n" + problems.map((p) => `- ${p}`).join("\n"));
  process.exit(1);
}
console.log(`Env/secret safety check passed (${tracked.length} tracked files).`);
