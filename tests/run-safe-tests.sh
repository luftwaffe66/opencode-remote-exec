#!/usr/bin/env bash
# run-safe-tests.sh — batería SOLO con comandos no destructivos.
# Prohibido: rm, dd, mkfs, shutdown, docker-prune, git reset --hard, etc.
# Todo write ocurre en /tmp/opencode-safe-test/ (zona segura, sin datos personales)
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"
# shellcheck disable=SC1091
source "$ROOT/config/ssh-remote.conf"
EXEC="$ROOT/bin/ssh-remote-exec.sh"
chmod +x "$EXEC"

PASS=0; FAIL=0
ok() { echo "✅ $1"; PASS=$((PASS+1)); }
bad() { echo "❌ $1 — $2"; FAIL=$((FAIL+1)); }

echo "== 1. Conectividad (echo/whoami/hostname/pwd) =="
"$EXEC" -- 'echo SSH_SMOKE_OK' | grep -q SSH_SMOKE_OK && ok "echo remoto" || bad "echo remoto" "sin salida"
"$EXEC" -- 'whoami; hostname; pwd' && ok "whoami/hostname/pwd" || bad "whoami" "ssh falló"

echo "== 2. Lectura (ls/cat/git) =="
"$EXEC" -- 'ls -la ~ | head -n 10' && ok "ls remoto" || bad "ls" "falló"
"$EXEC" -- 'git --version; python3 --version; node --version' && ok "versiones" || bad "versiones" "falló"

echo "== 3. Guardia destructiva DEBE bloquear (prueba negativa, no ejecuta nada) =="
for evil in "rm -rf /tmp/x" "sudo shutdown now" "mkfs.ext4 /dev/sda1" "dd if=/dev/zero of=/dev/sda" "git reset --hard" "docker system prune -f" "terraform destroy -auto-approve" ":(){ :|:& };:"; do
  if "$EXEC" -- "$evil" >/dev/null 2>&1; then bad "bloqueo '$evil'" "¡SE EJECUTÓ (grave)!"; else ok "bloqueado '$evil'"; fi
done

echo "== 4. Zona segura de escritura (mkdir/cat/echo en /tmp + opencode-safe-test) =="
SAFE_DIR="/tmp/opencode-safe-test"
ssh -o BatchMode=yes -o ConnectTimeout=5 -o StrictHostKeyChecking=accept-new "$REMOTE_USER@$REMOTE_HOST" "mkdir -p '$SAFE_DIR' '/tmp' && echo 'hola-remote-ok' > '$SAFE_DIR/hola.txt' && cat '$SAFE_DIR/hola.txt'" | grep -q hola-remote-ok && ok "write+read zona segura" || bad "zona segura" "falló"
ssh -o BatchMode=yes -o ConnectTimeout=5 -o StrictHostKeyChecking=accept-new "$REMOTE_USER@$REMOTE_HOST" "ls -la '$SAFE_DIR' | head -n 10" && ok "ls zona segura" || bad "ls zona" "falló"
ssh -o BatchMode=yes -o ConnectTimeout=5 -o StrictHostKeyChecking=accept-new "$REMOTE_USER@$REMOTE_HOST" "grep -rn 'hola' '$SAFE_DIR' | head; find '$SAFE_DIR' -maxdepth 2 -name '*.txt' | head" && ok "grep+find zona segura" || bad "grep/find" "falló"

echo ""
echo "== RESULTADO: $PASS ok, $FAIL fallos =="
[ "$FAIL" -eq 0 ]
