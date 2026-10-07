#!/usr/bin/env bash
# install.sh — instalador NO destructivo (idempotente, solo crea/añade, nunca borra)
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"
CONF="$ROOT/config/ssh-remote.conf"

# 0. Crea config real desde la plantilla si no existe (tus datos quedan en .gitignore)
if [[ ! -f "$CONF" ]]; then
  cp "$ROOT/config/ssh-remote.conf.example" "$CONF"
  echo "[info] creado $CONF desde el ejemplo — EDÍTALO con tus datos antes de continuar"
fi
# shellcheck disable=SC1091
source "$CONF"

echo "== opencode-ssh-remote installer (no destructivo) =="
mkdir -p ~/.ssh ~/.config/opencode/tools
chmod 700 ~/.ssh
touch ~/.ssh/config && chmod 600 ~/.ssh/config

# 1. ~/.ssh/config — bloque LAN (solo si no existe)
if grep -q "^Host homelab$" ~/.ssh/config 2>/dev/null; then
  echo "[ok] ~/.ssh/config ya contiene Host homelab (no toco nada)"
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
  echo "[ok] añadido bloque Host homelab a ~/.ssh/config"
fi

# 1b. ~/.ssh/config — bloque Tailscale (solo si TAILSCALE_HOST configurado y no existe)
if [[ -n "${TAILSCALE_HOST:-}" && "$TAILSCALE_HOST" != *x* ]]; then
  if grep -q "^Host homelab-ts$" ~/.ssh/config 2>/dev/null; then
    echo "[ok] ~/.ssh/config ya contiene Host homelab-ts (no toco nada)"
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
    echo "[ok] añadido bloque Host homelab-ts a ~/.ssh/config"
  fi
else
  echo "[skip] TAILSCALE_HOST vacío en config — omito homelab-ts (pon tu IP 100.x para activarlo)"
fi

# 2. Exports para las tools TypeScript (leen process.env) — bloque idempotente en ~/.bashrc
MARK="# >>> opencode-ssh-remote >>>"
if grep -q "$MARK" ~/.bashrc 2>/dev/null; then
  echo "[ok] exports ya presentes en ~/.bashrc (no toco nada)"
else
  cat >> ~/.bashrc <<EOF

$MARK
export SSH_REMOTE_HOST="$REMOTE_HOST"
export SSH_REMOTE_USER="$REMOTE_USER"
export SSH_REMOTE_PORT="$REMOTE_PORT"
# export SSH_REMOTE_HOST="\$TAILSCALE_HOST"  # fuera de casa: cambia a tu IP Tailscale
# <<< opencode-ssh-remote <<<
EOF
  echo "[ok] exports añadidos a ~/.bashrc (recarga con: source ~/.bashrc)"
fi

# 3. Copia tools remote_* a ~/.config/opencode/tools/ (sobrescribe solo remote_*, jamás toca bash/read locales)
cp "$ROOT/tools/"*.ts ~/.config/opencode/tools/
echo "[ok] tools copiados a ~/.config/opencode/tools/:"
ls -1 ~/.config/opencode/tools/ | grep remote_ || true

# 4. chmod +x wrappers
chmod +x "$ROOT/bin/"*.sh "$ROOT/tests/"*.sh
echo "[ok] permisos +x aplicados"

# 5. Abre ControlMaster persistente (no falla si ya existe)
ssh -O check homelab 2>/dev/null && echo "[ok] ControlMaster ya activo" || (ssh -fN homelab && echo "[ok] ControlMaster iniciado" || echo "[warn] no se pudo iniciar ControlMaster, se usará conexión por llamada (funciona igual)")

echo ""
echo "Siguiente: bash $ROOT/tests/run-safe-tests.sh"
