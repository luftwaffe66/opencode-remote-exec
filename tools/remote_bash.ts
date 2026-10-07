import { tool } from "@opencode-ai/plugin";
import { assertSafeBash, sshExec, remoteWorkspace } from "./lib.ts";

export default tool({
  description:
    "Ejecuta un comando READ-ONLY en el homelab por SSH (SAFE_MODE=1: echo/pwd/ls/cat/grep/git status...; bloquea rm/shutdown/docker-prune/git-reset-hard, etc.)",
  args: {
    command: tool.schema.string().describe("Comando a ejecutar en el servidor remoto"),
    workdir: tool.schema
      .string()
      .optional()
      .describe("Directorio remoto de trabajo (default: tu workspace remoto)"),
  },
  async execute(args) {
    assertSafeBash(args.command);
    const out = await sshExec(args.command, args.workdir ?? remoteWorkspace());
    return out.trimEnd() || "(sin salida)";
  },
});
