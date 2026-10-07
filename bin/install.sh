#!/usr/bin/env bash
# install.sh — NON-destructive installer (idempotent: creates/appends only, never deletes)
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"
CONF="$ROOT/config/ssh-remote.conf"

# 0. Create the real config from the template if missing (your data stays gitignored)
if [[ ! -f "$CONF" ]]; then
  cp "$ROOT/config/ssh-remote.conf.example" "$CONF"
  echo "[info] created $CONF from the template — EDIT it with your data before continuing"
fi
# shellcheck disable=SC1091
source "$CONF"

echo "== opencode-ssh-remote installer (non-destructive) =="
mkdir -p ~/.ssh ~/.config/opencode/tools
chmod 700 ~/.ssh
touch ~/.ssh/config && chmod 600 ~/.ssh/config

# 1. ~/.ssh/config — LAN block (only if missing)
if grep -q "^Host homelab$" ~/.ssh/config 2>/dev/null; then
  echo "[ok] ~/.ssh/config already has Host homelab (touching nothing)"
else
  cat >> ~/.ssh/config <<EOF

Host homelab
  HostName $REMOTE_HOST
  User $REMOTE_USER
  Port $REMOTE_PORT
  IdentityFile ~/.ssh/id_ed25519
  ControlMaster auto
  ControlPath ~/.ssh/cm-%r@%h:%p
  ControlPersist 600
  StrictHostKeyChecking accept-new
  ConnectTimeout 5
EOF
  echo "[ok] added Host homelab to ~/.ssh/config"
fi

# 1b. ~/.ssh/config — Tailscale block (only when TAILSCALE_HOST is set and missing)
if [[ -n "${TAILSCALE_HOST:-}" && "$TAILSCALE_HOST" != *x* ]]; then
  if grep -q "^Host homelab-ts$" ~/.ssh/config 2>/dev/null; then
    echo "[ok] ~/.ssh/config already has Host homelab-ts (touching nothing)"
  else
    cat >> ~/.ssh/config <<EOF

Host homelab-ts
  HostName $TAILSCALE_HOST
  User ${TAILSCALE_USER:-$REMOTE_USER}
  Port $REMOTE_PORT
  IdentityFile ~/.ssh/id_ed25519
  ControlMaster auto
  ControlPath ~/.ssh/cm-%r@%h:%p
  ControlPersist 600
  StrictHostKeyChecking accept-new
  ConnectTimeout 8
EOF
    echo "[ok] added Host homelab-ts to ~/.ssh/config"
  fi
else
  echo "[skip] TAILSCALE_HOST empty in config — skipping homelab-ts (set your 100.x IP to enable it)"
fi

# 2. Exports for the TypeScript tools (they read process.env) — idempotent block in ~/.bashrc
MARK="# >>> opencode-ssh-remote >>>"
if grep -q "$MARK" ~/.bashrc 2>/dev/null; then
  echo "[ok] exports already in ~/.bashrc (touching nothing)"
else
  cat >> ~/.bashrc <<EOF

$MARK
export SSH_REMOTE_HOST="$REMOTE_HOST"
export SSH_REMOTE_USER="$REMOTE_USER"
export SSH_REMOTE_PORT="$REMOTE_PORT"
# export SSH_REMOTE_HOST="\$TAILSCALE_HOST"  # away from home: switch to your Tailscale IP
# <<< opencode-ssh-remote <<<
EOF
  echo "[ok] exports added to ~/.bashrc (reload with: source ~/.bashrc)"
fi

# 3. Copy remote_* tools into ~/.config/opencode/tools/ (only overwrites remote_*, never local bash/read)
cp "$ROOT/tools/"*.ts ~/.config/opencode/tools/
echo "[ok] tools copied to ~/.config/opencode/tools/:"
ls -1 ~/.config/opencode/tools/ | grep remote_ || true

# 4. +x wrappers
chmod +x "$ROOT/bin/"*.sh "$ROOT/tests/"*.sh
echo "[ok] +x permissions applied"

# 5. Open a persistent ControlMaster (no-op if one exists)
ssh -O check homelab 2>/dev/null && echo "[ok] ControlMaster already running" || (ssh -fN homelab && echo "[ok] ControlMaster started" || echo "[warn] could not start ControlMaster, falling back to per-call connections (works the same)")

echo ""
echo "Next: bash $ROOT/tests/run-safe-tests.sh"
