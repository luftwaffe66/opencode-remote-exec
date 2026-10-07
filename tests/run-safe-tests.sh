#!/usr/bin/env bash
# run-safe-tests.sh — NON-destructive battery only.
# Forbidden: rm, dd, mkfs, shutdown, docker-prune, git reset --hard, etc.
# All writes land in /tmp/opencode-safe-test/ (safe zone, no personal data)
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"
# shellcheck disable=SC1091
source "$ROOT/config/ssh-remote.conf"
EXEC="$ROOT/bin/ssh-remote-exec.sh"
chmod +x "$EXEC"
# Always invoke via bash: the portable shebang (#!/usr/bin/env bash) may not
# exist on minimal systems, while `bash` is guaranteed by install.sh.
run() { bash "$EXEC" "$@"; }

PASS=0; FAIL=0
ok() { echo "✅ $1"; PASS=$((PASS+1)); }
bad() { echo "❌ $1 — $2"; FAIL=$((FAIL+1)); }

echo "== 1. Connectivity (echo/whoami/hostname/pwd) =="
run -- 'echo SSH_SMOKE_OK' | grep -q SSH_SMOKE_OK && ok "remote echo" || bad "remote echo" "no output"
run -- 'whoami; hostname; pwd' && ok "whoami/hostname/pwd" || bad "whoami" "ssh failed"

echo "== 2. Reads (ls/cat/git) =="
run -- 'ls -la ~ | head -n 10' && ok "remote ls" || bad "ls" "failed"
run -- 'git --version; python3 --version; node --version' && ok "versions" || bad "versions" "failed"

echo "== 3. Destructive guard MUST block (negative test, executes nothing) =="
for evil in "rm -rf /tmp/x" "sudo shutdown now" "mkfs.ext4 /dev/sda1" "dd if=/dev/zero of=/dev/sda" "git reset --hard" "docker system prune -f" "terraform destroy -auto-approve" ":(){ :|:& };:"; do
  if run -- "$evil" >/dev/null 2>&1; then bad "blocking '$evil'" "IT RAN (severe)!"; else ok "blocked '$evil'"; fi
done

echo "== 4. Safe write zone (mkdir/cat/echo in /tmp + opencode-safe-test) =="
SAFE_DIR="/tmp/opencode-safe-test"
ssh -o BatchMode=yes -o ConnectTimeout=5 -o StrictHostKeyChecking=accept-new "$REMOTE_USER@$REMOTE_HOST" "mkdir -p '$SAFE_DIR' '/tmp' && echo 'hello-remote-ok' > '$SAFE_DIR/hello.txt' && cat '$SAFE_DIR/hello.txt'" | grep -q hello-remote-ok && ok "safe-zone write+read" || bad "safe zone" "failed"
ssh -o BatchMode=yes -o ConnectTimeout=5 -o StrictHostKeyChecking=accept-new "$REMOTE_USER@$REMOTE_HOST" "ls -la '$SAFE_DIR' | head -n 10" && ok "safe-zone ls" || bad "zone ls" "failed"
ssh -o BatchMode=yes -o ConnectTimeout=5 -o StrictHostKeyChecking=accept-new "$REMOTE_USER@$REMOTE_HOST" "grep -rn 'hello' '$SAFE_DIR' | head; find '$SAFE_DIR' -maxdepth 2 -name '*.txt' | head" && ok "safe-zone grep+find" || bad "grep/find" "failed"

echo ""
echo "== RESULT: $PASS passed, $FAIL failed =="
[ "$FAIL" -eq 0 ]
