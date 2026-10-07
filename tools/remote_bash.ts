import { tool } from "@opencode-ai/plugin";
import { assertSafeBash, sshExec, remoteWorkspace } from "./lib.ts";

export default tool({
  description:
    "Runs a command on the remote server over SSH. SAFE_MODE=1 allows read-only/diagnostic commands only; the granular danger policy (11 classes, deny by default) always applies.",
  args: {
    command: tool.schema.string().describe("Command to run on the remote server"),
    workdir: tool.schema
      .string()
      .optional()
      .describe("Remote working directory (default: your remote workspace)"),
  },
  async execute(args) {
    assertSafeBash(args.command);
    const out = await sshExec(args.command, args.workdir ?? remoteWorkspace());
    return out.trimEnd() || "(no output)";
  },
});
