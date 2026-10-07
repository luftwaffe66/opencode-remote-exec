import { tool } from "@opencode-ai/plugin";
import { sshExec, q, remoteWorkspace } from "./lib.ts";

export default tool({
  description: "Busca archivos en el remoto por patrón glob (solo lectura, via find)",
  args: {
    pattern: tool.schema.string().describe("Patrón glob, ej. '*.ts' o 'src/**/*.py'"),
    baseDir: tool.schema.string().optional().describe("Dir base remota (default workspace)"),
  },
  async execute(args) {
    const base = args.baseDir ?? remoteWorkspace();
    // find sin -delete/-exec: 100% lectura. -name con patrón simple.
    const name = args.pattern.includes("/") ? args.pattern.split("/").pop()! : args.pattern;
    const cmd = `find ${q(base)} -maxdepth 6 -name ${q(name)} 2>/dev/null | head -n 100`;
    const out = await sshExec(cmd);
    return out.trim() || "(sin coincidencias)";
  },
});
