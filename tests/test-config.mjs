// test-config.mjs — .env loader + server selection (NO server needed).
// Run: node tests/test-config.mjs   (expects 12 ok, 0 failures)
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const LIB = pathToFileURL(path.join(process.cwd(), "tools/lib.ts")).href;
const lib = await import(LIB);

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "ssh-env-test-"));
process.env.SSH_REMOTE_ENV_FILE = path.join(TMP, "test.env");
const writeEnv = (t) => fs.writeFileSync(process.env.SSH_REMOTE_ENV_FILE, t);
const cleanProcEnv = () => {
  for (const k of ["SSH_REMOTE_HOST", "SSH_REMOTE_USER", "SSH_REMOTE_PORT", "SSH_REMOTE_WORKSPACE"]) delete process.env[k];
};
cleanProcEnv();

let pass = 0, fail = 0;
const ok = (n) => { console.log(`✅ ${n}`); pass++; };
const bad = (n, e) => { console.log(`❌ ${n} — ${e}`); fail++; };
const eq = (n, a, b) => (JSON.stringify(a) === JSON.stringify(b) ? ok(n) : bad(n, `got ${JSON.stringify(a)} want ${JSON.stringify(b)}`));
const throws = async (n, fn, want) => {
  try { await fn(); bad(n, "did NOT throw"); }
  catch (e) { String(e?.message ?? e).includes(want) ? ok(n) : bad(n, `wrong error: ${String(e?.message ?? e).slice(0, 120)}`); }
};

// 1. Parsing: comments, export prefix, quotes, inline comments.
writeEnv(`# comment
export SSH_DEFAULT_SERVER=casa
SSH_CASA_HOST=192.168.100.6 # lan
SSH_CASA_PORT='22'
SSH_CASA_USER="server"
SSH_CASA_WORKSPACE=/home/server # ws
`);
eq("1 default server", lib.resolveServer().name, "casa");
eq("1 host parsed", lib.resolveServer().host, "192.168.100.6");
eq("1 port unquoted", lib.resolveServer().port, "22");
eq("1 user unquoted", lib.resolveServer().user, "server");
eq("1 workspace inline-comment stripped", lib.resolveServer().workspace, "/home/server");

// 2. Explicit selection + second server + key path expansion.
writeEnv(`SSH_DEFAULT_SERVER=casa
SSH_CASA_HOST=192.168.100.6
SSH_FUERA_HOST=100.72.153.2
SSH_FUERA_USER=server
SSH_FUERA_KEY_PATH=~/.ssh/id_ed25519
`);
eq("2 explicit fuera", lib.resolveServer("fuera").host, "100.72.153.2");
eq("2 keypath expanded", lib.resolveServer("FUERA").keyPath, os.homedir() + "/.ssh/id_ed25519");
eq("2 knownServers", lib.knownServers(), ["casa", "fuera"]);

// 3. Unknown server rejected, never executed.
await throws("3 unknown rejected", () => lib.resolveServer("noexiste"), "Unknown SSH server");
await throws("3 unknown lists known", () => lib.resolveServer("noexiste"), "casa");

// 4. Incomplete config (no HOST) rejected.
writeEnv(`SSH_DEFAULT_SERVER=roto
SSH_ROTO_PORT=22
`);
await throws("4 missing HOST rejected", () => lib.resolveServer(), "has no SSH_ROTO_HOST");

// 5. Plaintext passwords forbidden.
writeEnv(`SSH_DEFAULT_SERVER=casa
SSH_CASA_HOST=192.168.100.6
SSH_CASA_PASSWORD=hunter2
`);
await throws("5 password key rejected", () => lib.resolveServer(), "forbidden");

// 6. Timeouts: defaults + custom + invalid fallback.
writeEnv(`SSH_DEFAULT_SERVER=casa
SSH_CASA_HOST=192.168.100.6
`);
eq("6 default timeouts", [lib.resolveServer().connectTimeout, lib.resolveServer().commandTimeout], ["5", "120"]);
writeEnv(`SSH_DEFAULT_SERVER=casa
SSH_CASA_HOST=192.168.100.6
SSH_CASA_CONNECT_TIMEOUT=9
SSH_COMMAND_TIMEOUT=45
`);
eq("6 custom timeouts", [lib.resolveServer().connectTimeout, lib.resolveServer().commandTimeout], ["9", "45"]);
writeEnv(`SSH_DEFAULT_SERVER=casa
SSH_CASA_HOST=192.168.100.6
SSH_COMMAND_TIMEOUT=banana
`);
eq("6 invalid falls back", lib.resolveServer().commandTimeout, "120");

// 7. No secrets leak into errors or configs.
writeEnv(`SSH_DEFAULT_SERVER=casa
SSH_CASA_HOST=192.168.100.6
`);
const errText = await Promise.resolve().then(() => lib.resolveServer("fantasma")).catch((e) => String(e?.message ?? e));
eq("7 unknown error names server not values", errText.includes("fantasma") && !errText.includes("192.168"), true);

// 8. Backward compat: no .env file + legacy env => legacy resolution.
fs.rmSync(process.env.SSH_REMOTE_ENV_FILE);
process.env.SSH_REMOTE_HOST = "192.168.100.6";
process.env.SSH_REMOTE_USER = "server";
const leg = lib.resolveServer();
eq("8 legacy host", leg.host, "192.168.100.6");
eq("8 legacy name", leg.name, "default");
delete process.env.SSH_REMOTE_HOST;
delete process.env.SSH_REMOTE_USER;

// 9. No .env + no legacy env => built-in placeholders (current default).
eq("9 placeholder host", lib.resolveServer().host, "192.0.2.10");

fs.rmSync(TMP, { recursive: true, force: true });
console.log(`\n== ${pass} ok, ${fail} failures ==`);
process.exit(fail ? 1 : 0);
