import { tool } from "@opencode-ai/plugin";
import { sshExec, q, remoteWorkspace } from "./lib.ts";

export default tool({
  description: "Lista un directorio remoto (ls -la, solo lectura)",
  args: {
    path: tool.schema.string().optional().describe("Dir remoto (default workspace)"),
  },
  async execute(args) {
    const p = args.path ?? remoteWorkspace();
    return await sshExec(`ls -la ${q(p)}`);
  },
});
