import { tool } from "@opencode-ai/plugin";
import { sshExec, q, remoteWorkspace } from "./lib.ts";

export default tool({
  description: "Lists a remote directory (ls -la, read-only)",
  args: {
    path: tool.schema.string().optional().describe("Remote dir (default workspace)"),
  },
  async execute(args) {
    const p = args.path ?? remoteWorkspace();
    return await sshExec(`ls -la ${q(p)}`);
  },
});
