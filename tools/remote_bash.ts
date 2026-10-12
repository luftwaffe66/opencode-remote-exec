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
    server: tool.schema.string().optional().describe("Server from ssh-remote.env (omit = default server). Unknown names are rejected without executing."),
  },
  async execute(args) {
    assertSafeBash(args.command);
    const ws = args.workdir ?? remoteWorkspace(args.server);
    const out = await sshExec(args.command, ws, args.server);
    return out.trimEnd() || "(no output)";
  },
});
