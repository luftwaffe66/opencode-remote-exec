import { tool } from "@opencode-ai/plugin";
import { sshExec, q } from "./lib.ts";

export default tool({
  description: "Lee un archivo del servidor remoto por SSH (equivale a cat, solo lectura)",
  args: {
    filePath: tool.schema.string().describe("Ruta absoluta remota, ej. /tmp/opencode-safe-test/hola.txt"),
    offset: tool.schema.number().optional().describe("Línea inicial (1-based) para paginar"),
    limit: tool.schema.number().optional().describe("Nº máx de líneas (default 2000)"),
  },
  async execute(args) {
    const off = args.offset ?? 1;
    const lim = args.limit ?? 2000;
    // sed -n 'off,+lim p' evita cargar archivos gigantes; todo lectura.
    const cmd = `sed -n '${off},$((off + lim - 1))p' ${q(args.filePath)} | cat -A | sed 's/\\$$//' | head -n ${lim}; echo "---"; wc -l ${q(args.filePath)}`;
    // Versión simple y robusta: sed + wc (ambos allowlisted)
    const simple = `sed -n '${off},${off + lim - 1}p' ${q(args.filePath)}`;
    return await sshExec(simple);
  },
});
