import path from "path";
import os from "os";

// Config centralizada vía variables de entorno (ver config/ssh-remote.conf.example).
// Los defaults son PLACEHOLDERS no enrutables (RFC 5737): configura tus datos reales
// con bin/install.sh o exportando SSH_REMOTE_HOST / SSH_REMOTE_USER.
const REMOTE_HOST = process.env.SSH_REMOTE_HOST ?? "192.0.2.10";
const REMOTE_USER = process.env.SSH_REMOTE_USER ?? "tu_usuario";
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

const SAFE_BASH_ALLOW =
  /^(echo|printf|pwd|whoami|hostname|who|id|uname|date|uptime|ls|cat|head|tail|wc|file|stat|realpath|basename|dirname|git\s+(status|diff|log|branch|remote|rev-parse|--version)|node\s+--version|npm\s+--version|python3?\s+--version|[a-zA-Z0-9_.-]+\s+--version|rg\s|grep\s|find\s|fd\s|lsb_release|df\s|du\s|free\s|which\s|env\s)/;

const SAFE_WRITE_PREFIXES = ["/tmp/", `/home/${REMOTE_USER}/opencode-safe-test/`, `/home/${REMOTE_USER}/tmp/`];

export function assertSafeBash(cmd: string) {
  for (const re of BLOCKED) {
    if (re.test(cmd)) throw new Error(`⛔ Bloqueado (destructivo ${re}): ${cmd.slice(0, 200)}`);
  }
  if (SAFE_MODE) {
    // Valida cada segmento separado por ; && || | (permite "a --version; b --version")
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
          `⛔ SAFE_MODE=1: solo lectura/diagnóstico en pruebas. Segmento rechazado: ${seg.slice(0, 200)}`
        );
    }
  }
}

export function assertSafePath(p: string) {
  for (const re of BLOCKED) {
    if (re.test(p)) throw new Error(`⛔ Path bloqueado: ${p}`);
  }
  if (p.includes("..") && SAFE_MODE) {
    // .. permitido solo si el resultado sigue dentro de prefijos seguros; chequeo simple:
    const norm = path.posix.normalize(p);
    const ok = SAFE_WRITE_PREFIXES.some((pre) => norm.startsWith(pre));
    if (!ok) throw new Error(`⛔ SAFE_MODE: path con .. fuera de zona segura: ${p}`);
    return;
  }
  if (SAFE_MODE) {
    const ok = SAFE_WRITE_PREFIXES.some((pre) => p.startsWith(pre));
    // Lectura permite cualquier path; escritura exige prefijo. Esta fn se usa para ambos:
    // exportamos helper separado para escritura estricta.
  }
}

export function assertSafeWritePath(p: string) {
  for (const re of BLOCKED) {
    if (re.test(p)) throw new Error(`⛔ Path bloqueado: ${p}`);
  }
  if (SAFE_MODE) {
    const norm = path.posix.normalize(p);
    const ok = SAFE_WRITE_PREFIXES.some((pre) => norm.startsWith(pre));
    if (!ok)
      throw new Error(
        `⛔ SAFE_MODE=1: escritura solo en ${SAFE_WRITE_PREFIXES.join(", ")}. Recibido: ${p}`
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

/** Ejecuta comando remoto ya validado. Retorna stdout. */
export async function sshExec(cmd: string, workdir?: string): Promise<string> {
  const wd = workdir ?? remoteWorkspace();
  // Sin shell local: pasamos todo como un único string al ssh remoto con cd previo.
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

/** shellQuote POSIX para un argumento */
export function q(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}
