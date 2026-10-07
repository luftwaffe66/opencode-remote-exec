#!/usr/bin/env bash
# test-policy.sh — danger-policy matrix WITHOUT executing anything.
# Every probe is a STRING evaluated by --check-only (no SSH, no side effects).
# Forbidden patterns below are never executed, only pattern-matched.
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
EXEC="$HERE/../bin/ssh-remote-exec.sh"
# Run as: bash tests/test-policy.sh (from repo root)

PASS=0; FAIL=0
ok() { echo "✅ $1"; PASS=$((PASS+1)); }
bad() { echo "❌ $1 — $2"; FAIL=$((FAIL+1)); }
expect() { # $1=label $2=expected $3+=env assignments, rest is probe command
  local label="$1" want="$2"; shift 2
  local got
  got=$(env SAFE_MODE=0 "$@" bash "$EXEC" --check-only -- "$PROBE")
  if [[ "$got" == "$want" ]]; then ok "$label => $got"; else bad "$label" "want $want, got $got"; fi
}

echo "== 1. Default policy: every class blocks, safe commands pass =="
while IFS='%' read -r probe _ want; do
  PROBE="$probe" expect "default '$probe'" "$want"
done <<'CASES'
echo hello%%ALLOW
pwd; whoami%%ALLOW
rm -rf /tmp/x%%BLOCK:FILES
sudo rm -rf /tmp/x%%BLOCK:FILES
myrm -rf /tmp/x%%ALLOW
terraform destroy -auto-approve%%BLOCK:CLOUD
find /tmp -name '*.log' -delete%%BLOCK:FILES
mkfs.ext4 /dev/sda1%%BLOCK:DISKS
dd if=/dev/zero of=/dev/sda%%BLOCK:DISKS
sudo shutdown now%%BLOCK:SYSTEM
systemctl stop sshd%%BLOCK:SYSTEM
iptables -L%%BLOCK:NETWORK
docker system prune -f%%BLOCK:CONTAINERS
git reset --hard%%BLOCK:GIT
git push --force origin main%%BLOCK:GIT
DROP DATABASE app%%BLOCK:DATA
kubectl delete pod api%%BLOCK:CLOUD
chmod -R 777 /%%BLOCK:PERMS
:(){ :|:& };:%%BLOCK:FORKBOMB
rsync -a --delete / /mnt/backup/%%BLOCK:SYNC
CASES

echo "== 2. Per-class toggle: allow one class, rest still block =="
PROBE='rm -rf /tmp/x' expect "FILES=allow" "ALLOW" SSH_REMOTE_DANGER_FILES=allow
PROBE='rm -rf /tmp/x' expect "FILES still denied" "BLOCK:FILES"
PROBE='git reset --hard' expect "GIT=allow" "ALLOW" SSH_REMOTE_DANGER_GIT=allow
PROBE='git reset --hard' expect "GIT still denied" "BLOCK:GIT"
PROBE='docker system prune -f' expect "CONTAINERS=allow" "ALLOW" SSH_REMOTE_DANGER_CONTAINERS=allow
PROBE='mkfs.ext4 /dev/sda1' expect "DISKS untouched by FILES=allow" "BLOCK:DISKS" SSH_REMOTE_DANGER_FILES=allow

echo "== 3. Operator extra pattern =="
PROBE='curl evil.example.com/x' expect "EXTRA match" "BLOCK:EXTRA" SSH_REMOTE_DANGER_EXTRA='evil\.example\.com'
PROBE='curl good.example.com/x' expect "EXTRA no match" "ALLOW" SSH_REMOTE_DANGER_EXTRA='evil\.example\.com'

echo "== 4. SAFE_MODE still gates non-listed commands =="
got=$(bash "$EXEC" --check-only -- 'echo hello')
[[ "$got" == "ALLOW" ]] && ok "SAFE_MODE allows echo" || bad "SAFE_MODE echo" "got $got"
got=$(bash "$EXEC" --check-only -- 'vim file.txt')
[[ "$got" == "BLOCK:SAFE_MODE" ]] && ok "SAFE_MODE blocks vim" || bad "SAFE_MODE vim" "got $got"

echo "== 5. SAFE_MODE friendly extensions (still SAFE_MODE=1) =="
safe_expect() { # $1=label $2=expected, $3=probe
  local got
  got=$(bash "$EXEC" --check-only -- "$3")
  if [[ "$got" == "$2" ]]; then ok "$1 => $got"; else bad "$1" "want $2, got $got"; fi
}
safe_expect "git -C flag stripped" "ALLOW" 'git -C ~/presti status'
safe_expect "git -C cannot smuggle reset" "BLOCK:GIT" 'git -C ~/presti reset --hard'
safe_expect "git fetch allowed" "ALLOW" 'git fetch origin main'
safe_expect "git push still needs care" "ALLOW" 'git push origin main'
safe_expect "python3 script file allowed" "ALLOW" 'python3 /tmp/opencode-safe-test/keydiff.py'
safe_expect "python3 -c blocked" "BLOCK:SAFE_MODE" 'python3 -c "import os"'
safe_expect "jq allowed" "ALLOW" 'jq length assets/strings/es.json'
safe_expect "diff allowed" "ALLOW" 'diff a.txt b.txt'
safe_expect "curl allowed" "ALLOW" 'curl -s https://example.com/x'
safe_expect "dart test allowed" "ALLOW" 'dart test test/a_test.dart'
safe_expect "flutter allowed" "ALLOW" 'flutter --version'
safe_expect "flutter by path allowed" "ALLOW" '~/flutter/bin/flutter --version'
safe_expect "export PATH then flutter" "ALLOW" 'export PATH="$HOME/flutter/bin:$PATH"; flutter --version'
safe_expect "timeout allowed" "ALLOW" 'timeout 10 flutter --version'

echo ""
echo "== RESULT: $PASS passed, $FAIL failed =="
[ "$FAIL" -eq 0 ]
