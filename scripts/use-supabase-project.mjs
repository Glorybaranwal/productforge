// `pnpm env:supabase --ref <project-ref> --pooler-host <host>` — points .env.local at a Supabase
// project (ADR-024). Secrets are typed here, hidden, so they never pass through chat or shell
// history. The old .env.local is kept as .env.local.bak-<time> (git-ignored, owner-only).
import { chmodSync, copyFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { createInterface } from "node:readline/promises";
import { parseArgs } from "node:util";

const { values: args } = parseArgs({
  options: { ref: { type: "string" }, "pooler-host": { type: "string" } },
});
const ref = args.ref ?? "";
const poolerHost = args["pooler-host"] ?? "";
if (!/^[a-z0-9]{20}$/.test(ref) || !/^[a-z0-9.-]+\.pooler\.supabase\.com$/.test(poolerHost)) {
  console.error(
    "Usage: pnpm env:supabase --ref <20-character project ref> --pooler-host <aws-….pooler.supabase.com>",
  );
  process.exit(1);
}

async function ask(question) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await rl.question(question);
  rl.close();
  return answer.trim();
}

/** Reads a line without echoing it. */
function askHidden(question) {
  return new Promise((resolve) => {
    const { stdin, stdout } = process;
    stdout.write(question);
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding("utf8");
    let value = "";
    const onData = (chunk) => {
      for (const ch of chunk) {
        if (ch === "\r" || ch === "\n") {
          stdin.setRawMode(false);
          stdin.pause();
          stdin.off("data", onData);
          stdout.write("\n");
          resolve(value.trim());
          return;
        }
        if (ch === "\u0003") process.exit(130); // Ctrl+C
        if (ch === "\u007f")
          value = value.slice(0, -1); // Backspace
        else value += ch;
      }
    };
    stdin.on("data", onData);
  });
}

const password = await askHidden("Database password (hidden): ");
const publishableKey = await ask("Publishable key (sb_publishable_…): ");
const secretKey = await askHidden("Secret key (sb_secret_…, hidden): ");
if (!password) throw new Error("The database password is empty.");
if (!publishableKey.startsWith("sb_publishable_")) throw new Error("That isn't a publishable key.");
if (!secretKey.startsWith("sb_secret_")) throw new Error("That isn't a secret key.");

const user = `postgres.${ref}`;
const pass = encodeURIComponent(password);
const settings = {
  NEXT_PUBLIC_SUPABASE_URL: `https://${ref}.supabase.co`,
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: publishableKey,
  SUPABASE_SECRET_KEY: secretKey,
  // Runtime: transaction pooler. Migrations: session pooler (ADR-005, ADR-019).
  DATABASE_URL: `postgresql://${user}:${pass}@${poolerHost}:6543/postgres`,
  DATABASE_DIRECT_URL: `postgresql://${user}:${pass}@${poolerHost}:5432/postgres`,
};

const file = ".env.local";
let lines = [];
if (existsSync(file)) {
  const backup = `${file}.bak-${new Date().toISOString().replace(/[:.]/g, "-")}`;
  copyFileSync(file, backup);
  chmodSync(backup, 0o600);
  console.log(`Saved the previous settings as ${backup}`);
  lines = readFileSync(file, "utf8").split("\n");
}
for (const [key, value] of Object.entries(settings)) {
  const line = `${key}=${value}`;
  const at = lines.findIndex((l) => l.startsWith(`${key}=`));
  if (at === -1) lines.push(line);
  else lines[at] = line;
}
writeFileSync(file, `${lines.join("\n").replace(/\n+$/, "")}\n`);
chmodSync(file, 0o600);
console.log(
  `✓ .env.local now points at ${ref} (${poolerHost}). Next: pnpm db:migrate && pnpm db:check`,
);
