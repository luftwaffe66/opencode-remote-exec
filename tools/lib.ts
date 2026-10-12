import path from "path";
import os from "os";
import fs from "fs";

// Centralized config via env vars (see config/ssh-remote.conf.example).
// Defaults are unroutable PLACEHOLDERS (RFC 5737): set your real data
// with bin/install.sh or by exporting SSH_REMOTE_HOST / SSH_REMOTE_USER.
const REMOTE_HOST = process.env.SSH_REMOTE_HOST ?? "192.0.2.10";
const REMOTE_USER = process.env.SSH_REMOTE_USER ?? "your_user";
const REMOTE_PORT = process.env.SSH_REMOTE_PORT ?? "22";
const REMOTE_WORKSPACE = process.env.SSH_REMOTE_WORKSPACE ?? `/home/${REMOTE_USER}`;
const SAFE_MODE = (process.env.SSH_REMOTE_SAFE_MODE ?? "1") === "1";
const CONTROL_PATH = `${os.homedir()}/.ssh/cm-%r@%h:%p`;

const BLOCKED = [
  /\brm\b/i, /:\(\)\s*\{/, /\bmkfs\b/i, /\bdd\b.*\bof=/i, /\bshred\b/i,
  /\bshutdown\b/i, /\breboot\b/i, /\bhalt\b/i, /\bpoweroff\b/i, /\binit\s+[06]\b/,
  /\bfdisk\b/i, /\bparted\b/i, /\biptables\b/i, /\bnft\b/i,
  /\bsystemctl\s+(stop|disable|mask|poweroff|reboot)\b/i,
  /\bdocker\s+(rm|rmi|prune|system)\b/i, /\bpodman\b.*\bprune\b/i,
  /\bgit\s+push\b.*--force/i, /\bgit\s+reset\s+--hard\b/i, /\bgit\s+clean\s+-f\b/i, /\bgit\s+branch\s+-D\b/,
  /\bdropdb\b/i, /\bdrop\s+database\b/i, /\btruncate\b/i, /\bdelete\s+from\b/i,
  /\bterraform\s+destroy\b/i, /\bkubectl\s+delete\b/i, /\bhelm\s+uninstall\b/i,
  />\s*\/dev\/sd/, />\s*\/dev\/nvme/, /\bfind\b.*-delete/i, /\bfind\b.*-exec.*\brm\b/i,
  /\brsync\b.*--delete.*\/\s*$/i, /\buserdel\b/i,
];

// ── Granular danger policy: 11 classes, deny by default ──
// Toggle per class: SSH_REMOTE_DANGER_<CLASS>=allow|deny (env; default deny).
// Same classes/patterns as bin/ssh-remote-exec.sh. Extra operator pattern:
// SSH_REMOTE_DANGER_EXTRA='<ERE>' (additional deny).
export const DANGER_CLASSES: Record<string, RegExp[]> = {
  FILES: [/\brm\s/i, /\brm$/i, /\bshred\b/i, /\bfind\b.*-delete/i, /\bfind\b.*-exec.*\brm\b/i, /\bmv\s+.*\/\s*\/dev\/null/i],
  DISKS: [/\bmkfs\b/i, /\bdd\b.*\bof=/i, /\bfdisk\b/i, /\bparted\b/i, />\s*\/dev\/sd/, />\s*\/dev\/nvme/],
  SYSTEM: [/\bshutdown\b/i, /\breboot\b/i, /\bhalt\b/i, /\bpoweroff\b/i, /\binit\s+[06]\b/, /\bsystemctl\s+(stop|disable|mask|poweroff|reboot)\b/i, /\bservice\s+\w+\s+stop\b/i, /\bkill\s+-9\s+1\b/, /\bpkill\b.*(init|systemd|sshd)/i],
  NETWORK: [/\biptables\b/i, /\bnft\s/i],
  CONTAINERS: [/\bdocker\s+(rm|rmi|prune|system)\b/i, /\bpodman\b.*\bprune\b/i],
  GIT: [/\bgit(?:\s+-[Cc]\s+(?:"[^"]*"|'[^']*'|\S+))*\s+push\b.*--force/i, /\bgit(?:\s+-[Cc]\s+(?:"[^"]*"|'[^']*'|\S+))*\s+reset\s+--hard\b/i, /\bgit(?:\s+-[Cc]\s+(?:"[^"]*"|'[^']*'|\S+))*\s+clean\s+-f\b/i, /\bgit(?:\s+-[Cc]\s+(?:"[^"]*"|'[^']*'|\S+))*\s+branch\s+-D\b/],
  DATA: [/\bdropdb\b/i, /\bdrop\s+database\b/i, /\btruncate\b/i, /\bdelete\s+from\b/i],
  CLOUD: [/\bterraform\s+destroy\b/i, /\bkubectl\s+delete\b/i, /\bhelm\s+uninstall\b/i, /\baws\s+s3\s+rm\b/i, /\bgcloud\b.*\bdelete\b/i, /\baz\b.*\bdelete\b/i],
  PERMS: [/\bchmod\s+-R\s+777\s+\//, /\bchown\s+-R\b.*\/\s*$/i, /\buserdel\b/i, /\bgroupdel\b/i, /\bpasswd\s+-d\b/i],
  FORKBOMB: [/:\(\)\s*\{/],
  SYNC: [/\brsync\b.*--delete.*\/\s*$/i],
};

function dangerAllowed(cls: string): boolean {
  return (process.env[`SSH_REMOTE_DANGER_${cls}`] ?? "deny").toLowerCase() === "allow";
}

/** Pure verdict, no side effects: which denied classes match this command. */
export function checkBash(cmd: string): { verdict: "allow" | "block"; classes: string[] } {
  const hit: string[] = [];
  for (const [cls, patterns] of Object.entries(DANGER_CLASSES)) {
    if (dangerAllowed(cls)) continue;
    if (patterns.some((re) => re.test(cmd))) hit.push(cls);
  }
  const extra = process.env.SSH_REMOTE_DANGER_EXTRA;
  if (hit.length === 0 && extra) {
    try {
      if (new RegExp(extra, "i").test(cmd)) hit.push("EXTRA");
    } catch { /* invalid operator regex: ignore, fail-closed keeps other classes */ }
  }
  return { verdict: hit.length ? "block" : "allow", classes: hit };
}

const SAFE_BASH_ALLOW =
  /^(echo|printf|pwd|whoami|hostname|who|id|uname|date|uptime|ls|cat|head|tail|wc|file|stat|realpath|basename|dirname|git\s+(status|diff|log|branch|remote|rev-parse|ls-remote|ls-files|show|stash|tag|grep|blame|fetch|pull|clone|push|--version)|node\s+(--version|[^-])|npm\s+(--version|[^-])|python3?\s+(--version|[^-])|(bash|sh)\s+[^-]|\S+\s+--version|rg\s|grep\s|find\s|fd\s|lsb_release|df\s|du\s|free\s|which\s|env\s|jq\s|diff\s|sort\s|uniq\s|tr\s|cut\s|column\s|curl\s|wget\s+--spider\s|(\S*\/)?flutter\s|(\S*\/)?dart\s|go\s+version|timeout\s|sleep\s|ps(\s|$)|pgrep\s|dig\s|nslookup\s)/;

const SAFE_WRITE_PREFIXES = ["/tmp/", `/home/${REMOTE_USER}/opencode-safe-test/`, `/home/${REMOTE_USER}/tmp/`];

export function assertSafeBash(cmd: string) {
  const { verdict, classes } = checkBash(cmd);
  if (verdict === "block")
    throw new Error(
      `⛔ Blocked (class ${classes.join(",")} — allow with SSH_REMOTE_DANGER_<CLASS>=allow): ${cmd.slice(0, 200)}`
    );
  if (SAFE_MODE) {
    // Validates each segment split by ; && || | (allows "a --version; b --version")
    const segs = cmd.split(/\|\||&&|;|\|/).map((s) => s.trim()).filter(Boolean);
    for (let seg of segs) {
      seg = seg
        .replace(/^sudo\s+/, "")
        .replace(/^export\s+/, "")
        .replace(/^[A-Za-z_][A-Za-z0-9_]*=("[^"]*"|'[^']*'|\S+)\s+/, "")
        .replace(/^[A-Za-z_][A-Za-z0-9_]*=("[^"]*"|'[^']*'|\S+)$/, "")
        .replace(/^cd\s+[^;]+/, "")
        // git global flags don't change the verb: workdir travels separately
        .replace(/^git\s+-C\s+("[^"]*"|'[^']*'|\S+)\s+/, "git ")
        .replace(/^git\s+-c\s+\S+\s+/, "git ")
        .trim();
      if (!seg) continue;
      if (!SAFE_BASH_ALLOW.test(seg))
        throw new Error(
          `⛔ SAFE_MODE=1: read-only/diagnostic only in testing. Rejected segment: ${seg.slice(0, 200)}`
        );
    }
  }
}

export function assertSafePath(p: string) {
  for (const re of BLOCKED) {
    if (re.test(p)) throw new Error(`⛔ Blocked path: ${p}`);
  }
  if (p.includes("..") && SAFE_MODE) {
    // .. allowed only if the result stays inside the safe prefixes; simple check:
    const norm = path.posix.normalize(p);
    const ok = SAFE_WRITE_PREFIXES.some((pre) => norm.startsWith(pre));
    if (!ok) throw new Error(`⛔ SAFE_MODE: .. path outside safe zone: ${p}`);
    return;
  }
  if (SAFE_MODE) {
    const ok = SAFE_WRITE_PREFIXES.some((pre) => p.startsWith(pre));
    // Reads allow any path; writes require a prefix. This fn covers both:
    // a separate strict helper is exported for writes.
  }
}

export function assertSafeWritePath(p: string) {
  for (const re of BLOCKED) {
    if (re.test(p)) throw new Error(`⛔ Blocked path: ${p}`);
  }
  if (SAFE_MODE) {
    const norm = path.posix.normalize(p);
    const ok = SAFE_WRITE_PREFIXES.some((pre) => norm.startsWith(pre));
    if (!ok)
      throw new Error(
        `⛔ SAFE_MODE=1: writes only in ${SAFE_WRITE_PREFIXES.join(", ")}. Got: ${p}`
      );
  }
}

// ── Multi-server .env config (hot-reload: re-read per call, no restart) ──
// File: ~/.config/opencode/ssh-remote.env (0600; override path with SSH_REMOTE_ENV_FILE).
// Precedence per call: explicit server arg > SSH_DEFAULT_SERVER > legacy
// process env (SSH_REMOTE_HOST/USER/PORT/WORKSPACE) > built-in placeholders.
// Plaintext password keys anywhere in the file are rejected (fail-closed).

export interface ServerConf {
  name: string;
  host: string;
  port: string;
  user: string;
  workspace: string;
  keyPath: string;
  connectTimeout: string;
  commandTimeout: string;
}

function envFilePath(): string {
  return process.env.SSH_REMOTE_ENV_FILE ?? `${os.homedir()}/.config/opencode/ssh-remote.env`;
}

let envCache: { stamp: string; vars: Record<string, string> } | null = null;

function parseEnv(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const raw of text.split("\n")) {
    let line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    line = line.replace(/^export\s+/, "");
    const eq = line.indexOf("=");
    if (eq < 1) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    const m = val.match(/^(['"])(.*)\1$/s);
    if (m) val = m[2];
    else val = val.split(/\s+#/)[0].trim();
    if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) out[key] = val;
  }
  return out;
}

function readEnvFile(): Record<string, string> {
  try {
    const st = fs.statSync(envFilePath());
    const stamp = `${st.mtimeMs}:${st.size}`;
    if (!envCache || envCache.stamp !== stamp) {
      envCache = { stamp, vars: parseEnv(fs.readFileSync(envFilePath(), "utf8")) };
    }
    return envCache.vars;
  } catch {
    envCache = null;
    return {};
  }
}

/** Server names declared in .env via SSH_<NAME>_HOST. */
export function knownServers(): string[] {
  const vars = readEnvFile();
  const names = new Set<string>();
  for (const k of Object.keys(vars)) {
    const m = k.match(/^SSH_([A-Z0-9]+)_HOST$/);
    if (m) names.add(m[1].toLowerCase());
  }
  return [...names].sort();
}

function numOr(val: string | undefined, fallback: string): string {
  return val && /^\d+$/.test(val) ? val : fallback;
}

function expandHome(p: string): string {
  return p.replace(/^~\//, os.homedir() + "/");
}

/** Resolve which server runs this call. Never silently falls back to a
 *  different configured server: unknown names and ambiguous setups throw. */
export function resolveServer(name?: string): ServerConf {
  const vars = readEnvFile();
  for (const k of Object.keys(vars)) {
    if (/PASSWORD/i.test(k))
      throw new Error(
        `⛔ ssh-remote.env: password keys are forbidden (${k}). Use key auth (SSH_<NAME>_KEY_PATH) or an askpass helper.`
      );
  }
  const servers = knownServers();
  let picked: string | undefined;
  if (name) {
    picked = name.toLowerCase();
    if (!servers.includes(picked))
      throw new Error(
        `⛔ Unknown SSH server '${name}'. Known: ${servers.join(", ") || "(none configured)"}. Command NOT executed.`
      );
  } else {
    picked = (vars.SSH_DEFAULT_SERVER ?? "").toLowerCase() || undefined;
    if (!picked && servers.length > 0)
      throw new Error(
        `⛔ ssh-remote.env declares server(s) [${servers.join(", ")}] but no SSH_DEFAULT_SERVER is set and no server was requested. Set SSH_DEFAULT_SERVER or pass server="name". Command NOT executed.`
      );
  }
  if (picked) {
    const p = `SSH_${picked.toUpperCase()}_`;
    const host = vars[p + "HOST"] ?? "";
    if (!host) throw new Error(`⛔ Server '${picked}' has no ${p}HOST in ssh-remote.env.`);
    const user = vars[p + "USER"] || "server";
    return {
      name: picked,
      host,
      port: numOr(vars[p + "PORT"], "22"),
      user,
      workspace: vars[p + "WORKSPACE"] || `/home/${user}`,
      keyPath: vars[p + "KEY_PATH"] ? expandHome(vars[p + "KEY_PATH"]) : "",
      connectTimeout: numOr(vars.SSH_CONNECT_TIMEOUT ?? vars[p + "CONNECT_TIMEOUT"], "5"),
      commandTimeout: numOr(vars.SSH_COMMAND_TIMEOUT, "120"),
    };
  }
  // Legacy single-server behavior, byte-for-byte compatible defaults.
  return {
    name: "default",
    host: process.env.SSH_REMOTE_HOST ?? "192.0.2.10",
    port: process.env.SSH_REMOTE_PORT ?? "22",
    user: process.env.SSH_REMOTE_USER ?? "your_user",
    workspace: process.env.SSH_REMOTE_WORKSPACE ?? `/home/${process.env.SSH_REMOTE_USER ?? "your_user"}`,
    keyPath: "",
    connectTimeout: "5",
    commandTimeout: "120",
  };
}

export function sshArgs(srv?: ServerConf): string[] {
  const s = srv ?? resolveServer();
  const a = [
    "-p", s.port,
    "-o", "BatchMode=yes",
    "-o", `ConnectTimeout=${s.connectTimeout}`,
    "-o", "StrictHostKeyChecking=accept-new",
    "-o", "ControlMaster=auto",
    "-o", `ControlPath=${CONTROL_PATH}`,
    "-o", "ControlPersist=600",
  ];
  if (s.keyPath) a.push("-i", s.keyPath);
  return a;
}

export function sshTarget(srv?: ServerConf): string {
  const s = srv ?? resolveServer();
  return `${s.user}@${s.host}`;
}

export function remoteWorkspace(srv?: ServerConf): string {
  return (srv ?? resolveServer()).workspace;
}

/** Runs an already-validated command remotely. Returns stdout.
 *  server: name from ssh-remote.env (omit = default). Errors name the server. */
export async function sshExec(cmd: string, workdir?: string, server?: string): Promise<string> {
  const srv = resolveServer(server);
  const wd = workdir ?? srv.workspace;
  // No local shell: pass everything as a single string to remote ssh with a prior cd.
  const wrapped = `cd '${wd.replace(/'/g, "'\\''")}' 2>/dev/null || cd ~; ${cmd}`;
  const proc = Bun.spawn(
    ["ssh", ...sshArgs(srv), sshTarget(srv), wrapped],
    { stdout: "pipe", stderr: "pipe" }
  );
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    try {
      (proc as unknown as { kill: () => void }).kill();
    } catch { /* already exited */ }
  }, Number(srv.commandTimeout) * 1000);
  const [out, err, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  clearTimeout(timer);
  if (timedOut)
    throw new Error(
      `SSH command timeout after ${srv.commandTimeout}s on server '${srv.name}'. Partial output kept. STDOUT:\n${out}\nSTDERR:\n${err}`
    );
  if (code !== 0)
    throw new Error(`SSH exit ${code} (server '${srv.name}')\nSTDOUT:\n${out}\nSTDERR:\n${err}`);
  return out;
}

/** POSIX shellQuote for one argument */
export function q(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}
