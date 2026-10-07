# 🚀 opencode-ssh-tools

> **Remote Execution Layer over SSH for OpenCode** — OpenCode runs on your local machine, all the heavy lifting happens on your servers.

[![OpenCode](https://img.shields.io/badge/OpenCode-1.18+-black?logo=openai)](https://opencode.ai)
[![Platform](https://img.shields.io/badge/Linux_%C2%B7_macOS_%C2%B7_WSL-lightgrey?logo=linux)](https://opencode.ai)
[![SSH](https://img.shields.io/badge/SSH-ed25519-blue?logo=openssh)](https://www.openssh.com)
[![Tests](https://img.shields.io/badge/tests-15%2F15-brightgreen)](#-tests)
[![License](https://img.shields.io/badge/license-MIT-yellow)](./LICENSE)

---

## ✨ What is this?

Let the agent work on your local servers over SSH, straight from its execution on your local PC. With this project **OpenCode keeps running locally**, but every file operation, shell command, Git action and test suite executes on your server over SSH.

```
┌────────────────────────────┐
│  💻 Your local PC          │
│                            │
│  OpenCode TUI              │
│  tools: remote_bash,       │
│  remote_read/write/edit,   │
│  remote_glob/grep/list     │
└─────────────┬──────────────┘
              │  SSH + ControlMaster
              │  (1 persistent connection, no password)
              ▼
┌────────────────────────────┐
│  🖥️  Your servers          │
│                            │
│  Your real projects        │
│  Git · npm/bun · Python    │
│  Docker · tests · builds   │
└────────────────────────────┘
```

No duplicated project copies. No SSHFS. No OpenCode server on the other side. Every tool is an explicit, auditable SSH operation. 🛡️

---

## 🧰 Included tools

| Tool | Does remotely | Equivalent to |
|------|---------------|---------------|
| `remote_bash` | Runs a command (safe mode) | `ssh 'cmd'` |
| `remote_read` | Reads a file (paginated) | `sed -n 'a,bp'` |
| `remote_write` | Creates/overwrites (base64 transport) | `base64 -d > file` |
| `remote_edit` | Exact replacement (validates occurrences) | surgical `python3` |
| `remote_glob` | Finds files by pattern | `find -name` |
| `remote_grep` | Searches text | `rg` / `grep -rn` |
| `remote_list` | Lists a directory | `ls -la` |

Plus the `bin/ssh-remote-exec.sh` wrapper for use outside OpenCode too. 💻

---

## 🔐 Security by design (double guard)

Two independent layers — TypeScript (`tools/lib.ts`) and Bash (`bin/ssh-remote-exec.sh`) — enforcing the same policy:

**⛔ Always blocked** (even with safe mode off):

| Category | Examples |
|----------|----------|
| Deletion | `rm`, `find -delete`, `find -exec rm`, `shred` |
| Disks | `mkfs`, `dd of=/dev/*`, `fdisk`, `parted`, `>/dev/sd*` |
| System | `shutdown`, `reboot`, `halt`, `init 0/6` |
| Services/net | `systemctl stop/disable`, `iptables`, `nft` |
| Containers | `docker rm/rmi/prune/system`, `podman prune` |
| Destructive git | `push --force`, `reset --hard`, `clean -f`, `branch -D` |
| Data | `DROP DATABASE`, `TRUNCATE`, `DELETE FROM`, `dropdb` |
| Cloud/IaC | `terraform destroy`, `kubectl delete`, `helm uninstall` |
| Classics | fork-bomb `:(){:|:&}`, `chmod -R 777 /`, `rsync --delete /` |

**🧪 `SAFE_MODE=1` (testing phase)**: `remote_bash` only allows read-only/diagnostic commands (`echo`, `ls`, `cat`, `grep`/`rg`, `find` without `-delete`, `git status/diff/log`, `--version`, `df/du/free`…) validated **per segment** (`;`, `&&`, `||`, `|`), and writes only land in `/tmp/` and your `opencode-safe-test/` dir.

---

## 📦 Installation

```bash
git clone https://github.com/luftwaffe66/opencode-ssh-tools.git
cd opencode-ssh-tools
bash bin/install.sh
```

The installer is **idempotent and non-destructive**: it only creates/appends, never deletes.

1. 📝 Creates `config/ssh-remote.conf` from the `.example` → **edit it with your data** (that file is in `.gitignore`, it never gets uploaded).
2. 🔑 Copy your key once: `ssh-copy-id user@your-server` (everything after is passwordless, `BatchMode`).
3. ⚙️ Adds `Host homelab` (+ `homelab-ts` if you configured Tailscale) to `~/.ssh/config`.
4. 🔌 Registers `SSH_REMOTE_HOST/USER/PORT` in `~/.bashrc` (the TS tools read `process.env`).
5. 🧩 Copies `remote_*.ts` into `~/.config/opencode/tools/` (never touches your local tools).
6. ⚡ Opens the persistent `ControlMaster` (zero handshake per call).

### 🔀 Dual LAN / Tailscale

```bash
export SSH_REMOTE_HOST=192.168.1.10   # 🏠 at home (LAN)
export SSH_REMOTE_HOST=100.x.x.x      # 🌍 away (your Tailscale IP)
```

---

## 🗣️ Usage in OpenCode

The tools show up as `remote_bash`, `remote_read`, etc. Just ask:

> use `remote_bash` for `pwd; ls` and `remote_list` in my workspace

### 🏁 100% remote mode (post-validation)

Only once your tests are green: create overrides in `~/.config/opencode/tools/{bash,read,write,edit,glob,grep,list}.ts` that re-export the `remote_*` ones and deny the local ones — template in [`opencode.jsonc.snippet`](./opencode.jsonc.snippet). ⚠️ Don't enable it during testing.

---

## ✅ Tests

Only non-destructive commands. All writes go to `/tmp/opencode-safe-test/`.

```bash
bash tests/run-safe-tests.sh          # shell: connectivity + reads + 8 blocks + safe zone
node --experimental-strip-types tests/e2e-tools.mjs   # real E2E of the 7 TS tools over SSH
```

Latest validation: **15/15** shell on LAN and Tailscale · **10/10** E2E · **10/10** safety guard. 🎯

---

## 🗂️ Layout

```
.
├── bin/
│   ├── ssh-remote-exec.sh   # safe SSH wrapper (blocklist + allowlist)
│   └── install.sh           # idempotent, non-destructive installer
├── config/
│   └── ssh-remote.conf.example  # template (the real one lives in .gitignore)
├── tools/
│   ├── lib.ts               # shared guard + SSH client (Bun.spawn)
│   └── remote_*.ts          # the 7 OpenCode tools
├── tests/
│   ├── run-safe-tests.sh    # safe battery, 15 checks
│   └── e2e-tools.mjs        # tool E2E via Bun.spawn stub → real SSH
├── opencode.jsonc.snippet   # 100%-remote-mode template
└── README.md
```

---

## 🆘 Troubleshooting

| Symptom | Likely cause | What to do |
|---------|--------------|------------|
| `Permission denied (publickey)` | Your key is missing on the server | `ssh-copy-id user@host` once |
| Tailscale: `Connection timed out` | Flaky Tailscale network (ping OK doesn't guarantee SSH banner) | Retry; LAN works; try `ssh -o IPQoS=none` |
| `SAFE_MODE` rejects your command | Read-only during testing | Split the command or set `SSH_REMOTE_SAFE_MODE=0` (blocklist stays on) |
| `oldString not found` in `remote_edit` | Text doesn't match exactly | Paste the exact block or use `replaceAll: true` |

---

## 📄 License

[MIT](./LICENSE) — use it, fork it, share it. A ⭐ is appreciated if it helps you.
