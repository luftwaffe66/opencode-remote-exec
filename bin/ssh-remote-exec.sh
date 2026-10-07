#!/usr/bin/env bash
# ssh-remote-exec.sh — wrapper SSH SEGURO (doble capa con lib.ts)
# Uso: ssh-remote-exec.sh [--workdir DIR] -- <comando...>
#      echo "pwd" | ssh-remote-exec.sh
# Reglas:
#  1. SIEMPRE bloquea patrones destructivos (aunque SAFE_MODE=0).
#  2. Si SAFE_MODE=1, solo permite allowlist de lectura/diagnóstico.
#  3. Nunca usa comandos destructivos internamente (solo ssh, printf, cat, ls...).
set -euo pipefail

CONF_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../config" && pwd)"
# shellcheck disable=SC1091
[ -f "$CONF_DIR/ssh-remote.conf" ] && source "$CONF_DIR/ssh-remote.conf"

# Transporte seleccionable sin contraseña (solo user+host vía llave ed25519).
# Configura tus datos en config/ssh-remote.conf (ver .example) o exporta:
#   SSH_REMOTE_HOST=192.168.1.10  -> LAN | SSH_REMOTE_HOST=100.x.x.x -> Tailscale
# Aliases SSH_REMOTE_* tienen prioridad sobre REMOTE_* del conf.
REMOTE_HOST="${SSH_REMOTE_HOST:-${REMOTE_HOST:-192.0.2.10}}"
REMOTE_USER="${SSH_REMOTE_USER:-${REMOTE_USER:-tu_usuario}}"
REMOTE_PORT="${SSH_REMOTE_PORT:-${REMOTE_PORT:-22}}"
REMOTE_WORKSPACE="${SSH_REMOTE_WORKSPACE:-${REMOTE_WORKSPACE:-/home/${REMOTE_USER:-tu_usuario}}}"
SAFE_MODE="${SAFE_MODE:-1}"

WORKDIR="$REMOTE_WORKSPACE"
ARGS=()
while [[ $# -gt 0 ]]; do
  case "$1" in
    --workdir) WORKDIR="$2"; shift 2 ;;
    --) shift; ARGS+=("$@"); break ;;
    *) ARGS+=("$1"); shift ;;
  esac
done
if [[ ${#ARGS[@]} -eq 0 && ! -t 0 ]]; then
  CMD="$(cat)"
else
  CMD="${ARGS[*]}"
fi
if [[ -z "${CMD:-}" ]]; then
  echo "ssh-remote-exec: comando vacío, nada que ejecutar" >&2
  exit 2
fi

# ── CAPA 1: blocklist destructiva (siempre activa) ──
BLOCKED_EGRESS='rm[[:space:]]|rm$|: *\( *\) *\{|mkfs|dd[[:space:]].*of=|shred|shutdown|reboot|halt|poweroff|init[[:space:]]+[06]|fdisk|parted|iptables|nft[[:space:]]|systemctl[[:space:]]+(stop|disable|mask|poweroff|reboot)|service[[:space:]]+[a-z].*stop|kill[[:space:]]+-9[[:space:]]+1|pkill[[:space:]]+(-9[[:space:]]+)?.*(init|systemd|sshd)|docker[[:space:]]+(rm|rmi|prune|system)|podman[[:space:]]+.*prune|git[[:space:]]+push.*--force|git[[:space:]]+reset[[:space:]]+--hard|git[[:space:]]+clean[[:space:]]+-f|git[[:space:]]+branch[[:space:]]+-D|dropdb|DROP[[:space:]]+DATABASE|TRUNCATE[[:space:]]|DELETE[[:space:]]+FROM|terraform[[:space:]]+destroy|kubectl[[:space:]]+delete|helm[[:space:]]+uninstall|chmod[[:space:]]+-R[[:space:]]+777[[:space:]]+/|chown[[:space:]]+-R.*/[[:space:]]*$|> */dev/sd|> */dev/nvme|userdel|groupdel|passwd[[:space:]]+-d|mv[[:space:]]+.*/[[:space:]]*/dev/null|find[[:space:]].*-delete|find[[:space:]].*-exec[[:space:]]+rm|rsync[[:space:]].*--delete.*/[[:space:]]*$|aws[[:space:]]+s3[[:space:]]+rm|gcloud.*delete|az[[:space:]].*delete'
if printf '%s' "$CMD" | grep -Ei -q "$BLOCKED_EGRESS"; then
  echo "⛔ BLOQUEADO (patrón destructivo): rehúso ejecutar: $CMD" >&2
  echo "Desbloqueo imposible en wrapper: reescribe el comando sin patrones destructivos." >&2
  exit 3
fi

# ── CAPA 2: allowlist modo seguro (valida CADA segmento separado por ; && || |) ──
if [[ "$SAFE_MODE" == "1" ]]; then
  SAFE_SEG='^(echo|printf|pwd|whoami|hostname|who|id|uname|date|uptime|ls|cat|head|tail|wc|file|stat|realpath|basename|dirname|git +(status|diff|log|branch|remote|rev-parse|--version)|node +--version|npm +--version|python3? +--version|[a-zA-Z0-9_.-]+ +--version|rg +|grep +|find +|fd +|lsb_release|df +|du +|free +|which +|env +)'
  # Normaliza separadores a newline y valida segmento a segmento
  SEGMENTS="$(printf '%s' "$CMD" | sed -E 's/\|\|/\n/g; s/&&/\n/g; s/;/\n/g; s/\|/\n/g')"
  REJECTED=""
  while IFS= read -r seg; do
    CORE="$(printf '%s' "$seg" | sed -E 's/^[[:space:]]*//; s/^sudo[[:space:]]+//; s/^[a-zA-Z0-9_]+=("[^"]*"|'"'"'[^'"'"']*'"'"'|[^[:space:];]+)[[:space:]]+//; s/^[[:space:]]*cd [^;]+//; s/^[[:space:]]*//')"
    [[ -z "$CORE" ]] && continue
    if ! printf '%s' "$CORE" | grep -Eq "$SAFE_SEG"; then
      REJECTED="$seg"
      break
    fi
  done <<< "$SEGMENTS"
  if [[ -n "$REJECTED" ]]; then
    echo "⛔ SAFE_MODE=1: solo comandos de lectura/diagnóstico en pruebas." >&2
    echo "   Comando rechazado: $CMD" >&2
    echo "   Permitidos: echo, pwd, whoami, ls, cat, head, tail, wc, grep/rg, find (sin -delete), git status/diff/log, --version, df/du/free." >&2
    echo "   Para writes usa remote_write hacia $SAFE_WRITE_PREFIXES" >&2
    exit 4
  fi
  # find con -delete/-exec rm ya bloqueado arriba, doble chequeo
  if printf '%s' "$CMD" | grep -Eq 'find.*(-delete|-exec.*rm)'; then
    echo "⛔ find destructivo bloqueado" >&2
    exit 3
  fi
fi

SSH_OPTS=(
  -p "$REMOTE_PORT"
  -o BatchMode=yes
  -o ConnectTimeout="${SSH_CONNECT_TIMEOUT:-5}"
  -o StrictHostKeyChecking=accept-new
  -o ControlMaster=auto
  -o "ControlPath=${SSH_CONTROL_PATH:-~/.ssh/cm-%r@%h:%p}"
  -o "ControlPersist=${SSH_CONTROL_PERSIST:-600}"
)
mkdir -p ~/.ssh 2>/dev/null || true
# Ejecución remota: cd seguro + comando (sin rm/mv/cp destructivos aquí)
# shellcheck disable=SC2029
ssh "${SSH_OPTS[@]}" "$REMOTE_USER@$REMOTE_HOST" "cd '$WORKDIR' 2>/dev/null || cd ~; $CMD"
