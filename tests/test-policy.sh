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

echo ""
echo "== RESULT: $PASS passed, $FAIL failed =="
[ "$FAIL" -eq 0 ]
