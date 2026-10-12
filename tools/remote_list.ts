import { tool } from "@opencode-ai/plugin";
import { sshExec, q, remoteWorkspace } from "./lib.ts";

export default tool({
  description: "Lists a remote directory (ls -la, read-only)",
  args: {
    path: tool.schema.string().optional().describe("Remote dir (default workspace)"),
    server: tool.schema.string().optional().describe("Server from ssh-remote.env (omit = default server). Unknown names are rejected without executing."),
  },
  async execute(args) {
    const p = args.path ?? remoteWorkspace(args.server);
    return await sshExec(`ls -la ${q(p)}`, undefined, args.server);
  },
});
