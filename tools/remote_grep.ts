import { tool } from "@opencode-ai/plugin";
import { sshExec, q, remoteWorkspace } from "./lib.ts";

export default tool({
  description: "Searches text on the remote (rg or grep, read-only)",
  args: {
    pattern: tool.schema.string().describe("Regex/text to search"),
    path: tool.schema.string().optional().describe("Remote file or dir (default workspace)"),
    server: tool.schema.string().optional().describe("Server from ssh-remote.env (omit = default server). Unknown names are rejected without executing."),
  },
  async execute(args) {
    const p = args.path ?? remoteWorkspace(args.server);
    const cmd =
      `(rg -n --no-heading ${q(args.pattern)} ${q(p)} 2>/dev/null || ` +
      `grep -rn ${q(args.pattern)} ${q(p)} 2>/dev/null) | head -n 100`;
    const out = await sshExec(cmd, undefined, args.server);
    return out.trim() || "(no matches)";
  },
});
