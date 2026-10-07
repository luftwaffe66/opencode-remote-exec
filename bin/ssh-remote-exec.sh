#!/usr/bin/env bash
# ssh-remote-exec.sh — SAFE SSH wrapper (double layer with lib.ts)
# Usage: ssh-remote-exec.sh [--workdir DIR] [--check-only] -- <command...>
#      echo "pwd" | ssh-remote-exec.sh
#      ssh-remote-exec.sh --check-only -- 'rm -rf /tmp/x'  # => BLOCK:FILES (runs nothing)
# Rules:
#  1. Granular danger policy: 11 classes, deny by default, configurable (see below).
#  2. With SAFE_MODE=1, only the read-only/diagnostic allowlist is permitted.
#  3. Never uses destructive commands internally (only ssh, printf, cat, ls...).
set -euo pipefail

CONF_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../config" && pwd)"
# shellcheck disable=SC1091
[ -f "$CONF_DIR/ssh-remote.conf" ] && source "$CONF_DIR/ssh-remote.conf"

# Passwordless transport (user+host only, via ed25519 key).
# Put your data in config/ssh-remote.conf (see .example) or export:
#   SSH_REMOTE_HOST=192.168.1.10  -> LAN | SSH_REMOTE_HOST=100.x.x.x -> Tailscale
# SSH_REMOTE_* aliases take priority over the conf's REMOTE_*.
REMOTE_HOST="${SSH_REMOTE_HOST:-${REMOTE_HOST:-192.0.2.10}}"
REMOTE_USER="${SSH_REMOTE_USER:-${REMOTE_USER:-your_user}}"
REMOTE_PORT="${SSH_REMOTE_PORT:-${REMOTE_PORT:-22}}"
REMOTE_WORKSPACE="${SSH_REMOTE_WORKSPACE:-${REMOTE_WORKSPACE:-/home/${REMOTE_USER:-your_user}}}"
SAFE_MODE="${SAFE_MODE:-1}"

WORKDIR="$REMOTE_WORKSPACE"
CHECK_ONLY=0
ARGS=()
while [[ $# -gt 0 ]]; do
  case "$1" in
    --workdir) WORKDIR="$2"; shift 2 ;;
    --check-only) CHECK_ONLY=1; shift ;;
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
  echo "ssh-remote-exec: empty command, nothing to run" >&2
  exit 2
fi

# Normalize once for policy checks: collapse `git -C <dir>` / `git -c k=v`
# global flags (workdir travels separately). Raw $CMD still runs/shows.
CHECK_CMD="$(printf '%s' "$CMD" | sed -E 's/git[[:space:]]+-C[[:space:]]+"[^"]*"/git/g; s/git[[:space:]]+-C[[:space:]]+[^[:space:];|&]+/git/g; s/git[[:space:]]+-c[[:space:]]+[^[:space:];|&]+/git/g')"

# ── LAYER 1: granular danger policy ──
# 11 classes, deny by default. Configure in conf: DANGER_<CLASS>=deny|allow,
# or in env: SSH_REMOTE_DANGER_<CLASS>=deny|allow (env wins).
# Classes: FILES DISKS SYSTEM NETWORK CONTAINERS GIT DATA CLOUD PERMS FORKBOMB SYNC
# Operator extra: DANGER_EXTRA / SSH_REMOTE_DANGER_EXTRA (ERE regex, extra deny).
CLASSES="FILES DISKS SYSTEM NETWORK CONTAINERS GIT DATA CLOUD PERMS FORKBOMB SYNC"

danger_pattern() {
  case "$1" in
    FILES)      printf '%s' '(^|[[:space:];|&($])rm([[:space:];]|$)|shred|find[[:space:]].*-delete|find[[:space:]].*-exec[[:space:]]+rm|mv[[:space:]]+.*/[[:space:]]*/dev/null' ;;
    DISKS)      printf '%s' 'mkfs|dd[[:space:]].*of=|fdisk|parted|> */dev/sd|> */dev/nvme' ;;
    SYSTEM)     printf '%s' 'shutdown|reboot|halt|poweroff|init[[:space:]]+[06]|systemctl[[:space:]]+(stop|disable|mask|poweroff|reboot)|service[[:space:]]+[a-z].*stop|kill[[:space:]]+-9[[:space:]]+1|pkill[[:space:]]+(-9[[:space:]]+)?.*(init|systemd|sshd)' ;;
    NETWORK)    printf '%s' 'iptables|nft[[:space:]]' ;;
    CONTAINERS) printf '%s' 'docker[[:space:]]+(rm|rmi|prune|system)|podman[[:space:]]+.*prune' ;;
    GIT)        printf '%s' 'git[[:space:]]+push.*--force|git[[:space:]]+reset[[:space:]]+--hard|git[[:space:]]+clean[[:space:]]+-f|git[[:space:]]+branch[[:space:]]+-D' ;;
    DATA)       printf '%s' 'dropdb|DROP[[:space:]]+DATABASE|TRUNCATE[[:space:]]|DELETE[[:space:]]+FROM' ;;
    CLOUD)      printf '%s' 'terraform[[:space:]]+destroy|kubectl[[:space:]]+delete|helm[[:space:]]+uninstall|aws[[:space:]]+s3[[:space:]]+rm|gcloud.*delete|az[[:space:]].*delete' ;;
    PERMS)      printf '%s' 'chmod[[:space:]]+-R[[:space:]]+777[[:space:]]+/|chown[[:space:]]+-R.*/[[:space:]]*$|userdel|groupdel|passwd[[:space:]]+-d' ;;
    FORKBOMB)   printf '%s' ': *\( *\) *\{' ;;
    SYNC)       printf '%s' 'rsync[[:space:]].*--delete.*/[[:space:]]*$' ;;
  esac
}

danger_value() { # $1=CLASS -> deny|allow (env, then conf, then deny)
  local envvar="SSH_REMOTE_DANGER_$1" confvar="DANGER_$1"
  local v="${!envvar:-}"
  if [[ -z "$v" ]]; then v="${!confvar:-}"; fi
  if [[ -z "$v" ]]; then v="deny"; fi
  printf '%s' "$v"
}

HIT_CLASS=""
for cls in $CLASSES; do
  if [[ "$(danger_value "$cls")" == "allow" ]]; then continue; fi
  if printf '%s' "$CHECK_CMD" | grep -Ei -q "$(danger_pattern "$cls")"; then HIT_CLASS="$cls"; break; fi
done
EXTRA_PAT="${SSH_REMOTE_DANGER_EXTRA:-${DANGER_EXTRA:-}}"
if [[ -z "$HIT_CLASS" && -n "$EXTRA_PAT" ]]; then
  if printf '%s' "$CHECK_CMD" | grep -Ei -q "$EXTRA_PAT"; then HIT_CLASS="EXTRA"; fi
fi
if [[ -n "$HIT_CLASS" ]]; then
  if [[ "$CHECK_ONLY" == "1" ]]; then echo "BLOCK:$HIT_CLASS"; exit 3; fi
  echo "⛔ BLOCKED (class $HIT_CLASS): refusing to run: $CMD" >&2
  echo "To allow this class: DANGER_$HIT_CLASS=allow in config (requires explicit approval)." >&2
  exit 3
fi

# ── LAYER 2: safe-mode allowlist (validates EACH segment split by ; && || |) ──
if [[ "$SAFE_MODE" == "1" ]]; then
  SAFE_SEG='^(echo|printf|pwd|whoami|hostname|who|id|uname|date|uptime|ls|cat|head|tail|wc|file|stat|realpath|basename|dirname|git +(status|diff|log|branch|remote|rev-parse|ls-remote|ls-files|show|stash|tag|grep|blame|fetch|pull|clone|push|--version)|node +(--version|[^-])|npm +(--version|[^-])|python3? +(--version|[^-])|(bash|sh) +[^-]|[^[:space:]]+[[:space:]]+--version|rg +|grep +|find +|fd +|lsb_release|df +|du +|free +|which +|env +|jq +|diff +|sort +|uniq +|tr +|cut +|column +|curl +|flutter +|dart +|([^[:space:]]*/)?flutter +|([^[:space:]]*/)?dart +|go +version|timeout +|sleep +|ps([[:space:]]|$)|pgrep +|dig +|nslookup +)'
  # Normalize separators to newlines and validate segment by segment
  SEGMENTS="$(printf '%s' "$CHECK_CMD" | sed -E 's/\|\|/\n/g; s/&&/\n/g; s/;/\n/g; s/\|/\n/g')"
  REJECTED=""
  while IFS= read -r seg; do
    CORE="$(printf '%s' "$seg" | sed -E 's/^[[:space:]]*//; s/^sudo[[:space:]]+//; s/^export[[:space:]]+//; s/^[a-zA-Z0-9_]+=("[^"]*"|'"'"'[^'"'"']*'"'"'|[^[:space:];]+)[[:space:]]+//; s/^[a-zA-Z0-9_]+=("[^"]*"|'"'"'[^'"'"']*'"'"'|[^[:space:];]+)$//; s/^[[:space:]]*cd [^;]+//; s/^[[:space:]]*//')"
    [[ -z "$CORE" ]] && continue
    if ! printf '%s' "$CORE" | grep -Eq "$SAFE_SEG"; then
      REJECTED="$seg"
      break
    fi
  done <<< "$SEGMENTS"
  if [[ -n "$REJECTED" ]]; then
    if [[ "$CHECK_ONLY" == "1" ]]; then echo "BLOCK:SAFE_MODE"; exit 4; fi
    echo "⛔ SAFE_MODE=1: read-only/diagnostic commands only in testing." >&2
    echo "   Rejected command: $CMD" >&2
    echo "   Allowed: echo/ls/cat/head/tail, grep/rg/jq/diff/sort, git status/diff/log/fetch/pull/clone (+ -C), python3/node/bash script files (no -c), curl, flutter/dart, --version, df/du/free, timeout/sleep/ps." >&2
    echo "   For writes use remote_write into $SAFE_WRITE_PREFIXES" >&2
    exit 4
  fi
  # find with -delete/-exec rm already blocked above, double check
  if printf '%s' "$CMD" | grep -Eq 'find.*(-delete|-exec.*rm)'; then
    echo "⛔ destructive find blocked" >&2
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
if [[ "$CHECK_ONLY" == "1" ]]; then echo "ALLOW"; exit 0; fi
# Remote execution: safe cd + command (no destructive rm/mv/cp here)
# shellcheck disable=SC2029
ssh "${SSH_OPTS[@]}" "$REMOTE_USER@$REMOTE_HOST" "cd '$WORKDIR' 2>/dev/null || cd ~; $CMD"
