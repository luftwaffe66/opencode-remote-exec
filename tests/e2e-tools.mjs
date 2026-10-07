// e2e-tools.mjs — E2E validation of the 7 tools via Bun.spawn stub -> real SSH (safe only)
import { spawn } from "node:child_process";
import { Readable } from "node:stream";
import { homedir } from "node:os";
import { join } from "node:path";

// Minimal Bun.spawn polyfill used by lib.ts
globalThis.Bun = {
  spawn(cmdArr, opts) {
    const p = spawn(cmdArr[0], cmdArr.slice(1), { stdio: ["ignore", "pipe", "pipe"] });
    const toWeb = (nodeStream) =>
      new ReadableStream({
        start(c) {
          nodeStream.on("data", (d) => c.enqueue(d));
          nodeStream.on("end", () => c.close());
        },
      });
    return {
      stdout: toWeb(p.stdout),
      stderr: toWeb(p.stderr),
      exited: new Promise((res) => p.on("close", (code) => res(code ?? 1))),
    };
  },
};

const TOOLS = join(homedir(), ".config/opencode/tools/") + "/";
let pass = 0, fail = 0;
const ok = (n, v) => { console.log(`✅ ${n}: ${String(v).slice(0, 120)}`); pass++; };
const bad = (n, e) => { console.log(`❌ ${n}: ${String(e).slice(0, 300)}`); fail++; };

async function run(name, arg) {
  const mod = await import(TOOLS + name + ".ts");
  const tool = mod.default;
  // tool() helper: @opencode-ai/plugin tool exposes { execute, ... }
  try {
    if (typeof tool?.execute === "function") return await tool.execute(arg, { directory: "/tmp", worktree: "/tmp", agent: "test", sessionID: "t", messageID: "m" });
    if (typeof tool === "function") return await tool(arg);
    return await tool(arg);
  } catch (e) { throw e; }
}

try { ok("remote_bash echo", await run("remote_bash", { command: "echo E2E_OK" })); } catch (e) { bad("remote_bash", e.message); }
try { ok("remote_write hello", await run("remote_write", { filePath: "/tmp/opencode-safe-test/hello.txt", content: "hello-remote-ok\n" })); } catch (e) { bad("remote_write hello", e.message); }
try { ok("remote_list", await run("remote_list", { path: "/tmp/opencode-safe-test" })); } catch (e) { bad("remote_list", e.message); }
try { ok("remote_read", await run("remote_read", { filePath: "/tmp/opencode-safe-test/hello.txt" })); } catch (e) { bad("remote_read", e.message); }
try { ok("remote_write", await run("remote_write", { filePath: "/tmp/opencode-safe-test/e2e.txt", content: "hello e2e\n" })); } catch (e) { bad("remote_write", e.message); }
try { ok("remote_read e2e", await run("remote_read", { filePath: "/tmp/opencode-safe-test/e2e.txt" })); } catch (e) { bad("remote_read e2e", e.message); }
try { ok("remote_edit", await run("remote_edit", { filePath: "/tmp/opencode-safe-test/e2e.txt", oldString: "hello e2e", newString: "hello-edited" })); } catch (e) { bad("remote_edit", e.message); }
try { ok("remote_grep", await run("remote_grep", { pattern: "hello", path: "/tmp/opencode-safe-test" })); } catch (e) { bad("remote_grep", e.message); }
try { ok("remote_glob", await run("remote_glob", { pattern: "*.txt", baseDir: "/tmp/opencode-safe-test" })); } catch (e) { bad("remote_glob", e.message); }
// Negatives: must BLOCK without touching the network
try { await run("remote_bash", { command: "rm -rf /tmp/x" }); bad("negative rm", "did NOT block"); } catch (e) { ok("negative rm blocked", e.message.slice(0, 80)); }
try { await run("remote_write", { filePath: "/etc/passwd", content: "x" }); bad("negative write /etc", "did NOT block"); } catch (e) { ok("negative write blocked", e.message.slice(0, 80)); }

console.log(`\nE2E: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
