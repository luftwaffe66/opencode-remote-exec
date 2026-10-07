import path from "path";
import os from "os";

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
  GIT: [/\bgit\s+push\b.*--force/i, /\bgit\s+reset\s+--hard\b/i, /\bgit\s+clean\s+-f\b/i, /\bgit\s+branch\s+-D\b/],
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
  /^(echo|printf|pwd|whoami|hostname|who|id|uname|date|uptime|ls|cat|head|tail|wc|file|stat|realpath|basename|dirname|git\s+(status|diff|log|branch|remote|rev-parse|--version)|node\s+--version|npm\s+--version|python3?\s+--version|[a-zA-Z0-9_.-]+\s+--version|rg\s|grep\s|find\s|fd\s|lsb_release|df\s|du\s|free\s|which\s|env\s)/;

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
        .replace(/^[A-Za-z_][A-Za-z0-9_]*=("[^"]*"|'[^']*'|\S+)\s+/, "")
        .replace(/^cd\s+[^;]+/, "")
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

export function sshArgs(): string[] {
  return [
    "-p", REMOTE_PORT,
    "-o", "BatchMode=yes",
    "-o", "ConnectTimeout=5",
    "-o", "StrictHostKeyChecking=accept-new",
    "-o", "ControlMaster=auto",
    "-o", `ControlPath=${CONTROL_PATH}`,
    "-o", "ControlPersist=600",
  ];
}

export function sshTarget(): string {
  return `${REMOTE_USER}@${REMOTE_HOST}`;
}

export function remoteWorkspace(): string {
  return REMOTE_WORKSPACE;
}

/** Runs an already-validated command remotely. Returns stdout. */
export async function sshExec(cmd: string, workdir?: string): Promise<string> {
  const wd = workdir ?? remoteWorkspace();
  // No local shell: pass everything as a single string to remote ssh with a prior cd.
  const wrapped = `cd '${wd.replace(/'/g, "'\\''")}' 2>/dev/null || cd ~; ${cmd}`;
  const proc = Bun.spawn(
    ["ssh", ...sshArgs(), sshTarget(), wrapped],
    { stdout: "pipe", stderr: "pipe" }
  );
  const [out, err, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (code !== 0) throw new Error(`SSH exit ${code}\nSTDOUT:\n${out}\nSTDERR:\n${err}`);
  return out;
}

/** POSIX shellQuote for one argument */
export function q(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}
