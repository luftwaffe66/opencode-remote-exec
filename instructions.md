# 🤖 instructions.md — prompt to send to your agent

> Copy everything **below the line** and paste it to any AI coding agent (OpenCode or other).
> It will install this project and operate it safely. Fill in the `<PLACEHOLDERS>` first.

---

You are installing and operating **opencode-remote-exec**: a Remote Execution Layer over SSH for OpenCode. After setup, OpenCode runs on this local machine, but every file operation, shell command, Git action and test suite executes on my servers over SSH.

## 0. My data (replace before running anything)

- `REMOTE_USER=<YOUR_SSH_USER>` (user on my servers, key auth already or to be set up)
- `REMOTE_HOST=<YOUR_LAN_IP>` (my server on the LAN, e.g. `192.168.1.10`)
- `TAILSCALE_HOST=<YOUR_TAILSCALE_IP>` (optional; my server outside home, e.g. `100.x.x.x` — leave empty if none)
- `REMOTE_WORKSPACE=<YOUR_REMOTE_PROJECT_DIR>` (e.g. `/home/<YOUR_SSH_USER>/projects/myapp`)

## 1. Install

```bash
git clone https://github.com/luftwaffe66/opencode-remote-exec.git
cd opencode-remote-exec
cp config/ssh-remote.conf.example config/ssh-remote.conf
```

Edit `config/ssh-remote.conf` with my data from section 0. That file is gitignored — never commit real hosts/users.

Then:

```bash
bash bin/install.sh
```

This is idempotent and non-destructive (creates/appends only, never deletes). It wires `~/.ssh/config` (`Host homelab`, plus `homelab-ts` if Tailscale is set), registers env exports, copies the 7 tools into `~/.config/opencode/tools/` and opens a persistent SSH `ControlMaster`.

If passwordless SSH is not set up yet, run once: `ssh-copy-id <YOUR_SSH_USER>@<YOUR_LAN_IP>`. Everything after that must work with `BatchMode` (no passwords).

## 2. Verify (mandatory, safe only)

```bash
bash tests/run-safe-tests.sh
```

Expect **15 ok, 0 failures**. Then, if Node is available:

```bash
node --experimental-strip-types tests/e2e-tools.mjs
```

Expect **10 ok, 0 failures**. These batteries only run non-destructive commands and write exclusively to `/tmp/opencode-safe-test/`. If anything fails, stop and report — do not continue to real work.

## 3. How to operate (always)

- Do real work through the tools, never by hand-rolled `ssh` one-liners when a tool exists:
  - `remote_bash` → run commands (`echo`, `ls`, `git status/diff/log`, `--version` probes…)
  - `remote_read` → read remote files (paginated)
  - `remote_write` / `remote_edit` → create or patch remote files
  - `remote_glob` / `remote_grep` → find files / search text remotely
  - `remote_list` → list remote directories
- Switch transport with env, no code changes:
  - `export SSH_REMOTE_HOST=<YOUR_LAN_IP>` at home · `export SSH_REMOTE_HOST=<YOUR_TAILSCALE_IP>` away.
- For a dry-run safety verdict without executing anything: `bin/ssh-remote-exec.sh --check-only -- '<command>'` → prints `ALLOW` or `BLOCK:<CLASS>`.

## 4. Safety rules (non-negotiable)

- `SAFE_MODE=1` stays ON unless I explicitly approve turning it off. It restricts `remote_bash` to read-only/diagnostic commands and writes to `/tmp/` + my `opencode-safe-test/` dir.
- The danger policy (`DANGER_<CLASS>=deny|allow`, 11 classes: FILES, DISKS, SYSTEM, NETWORK, CONTAINERS, GIT, DATA, CLOUD, PERMS, FORKBOMB, SYNC) defaults to **deny everything**. Never set a class to `allow`, and never touch `SAFE_MODE`, without my explicit approval for that specific class.
- NEVER run destructive commands to "test": no `rm`, no `mkfs`/`dd`, no `shutdown`/`reboot`, no `docker prune`, no `git reset --hard` / `push --force`, no `DROP/TRUNCATE/DELETE`, no `terraform destroy`, no `kubectl delete`. Validate guards with `--check-only` (which executes nothing) instead.
- NEVER commit `config/ssh-remote.conf` or any file containing my hosts, users, keys or passwords.
- The 100%-remote mode (overriding built-in `bash/read/write/edit/glob/grep/list` + denying locals, see `opencode.jsonc.snippet`) is activated ONLY with my explicit approval, after tests are green.

Report back: transport used, test scores, and what you did. If Tailscale times out while LAN works, say so (flaky tailnet, not auth) and keep working on LAN.
