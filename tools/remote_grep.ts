import { tool } from "@opencode-ai/plugin";
import { sshExec, q, remoteWorkspace } from "./lib.ts";

export default tool({
  description: "Busca texto en el remoto (rg o grep, solo lectura)",
  args: {
    pattern: tool.schema.string().describe("Regex/texto a buscar"),
    path: tool.schema.string().optional().describe("Archivo o dir remoto (default workspace)"),
  },
  async execute(args) {
    const p = args.path ?? remoteWorkspace();
    const cmd =
      `(rg -n --no-heading ${q(args.pattern)} ${q(p)} 2>/dev/null || ` +
      `grep -rn ${q(args.pattern)} ${q(p)} 2>/dev/null) | head -n 100`;
    const out = await sshExec(cmd);
    return out.trim() || "(sin coincidencias)";
  },
});
