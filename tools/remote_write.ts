import { tool } from "@opencode-ai/plugin";
import { assertSafeWritePath, sshExec, q } from "./lib.ts";

export default tool({
  description:
    "Escribe (crea/sobrescribe) un archivo en el servidor remoto. SAFE_MODE=1: solo en /tmp/ y en tu dir opencode-safe-test (ver config).",
  args: {
    filePath: tool.schema.string().describe("Ruta remota destino (zona segura en pruebas)"),
    content: tool.schema.string().describe("Contenido completo a escribir"),
  },
  async execute(args) {
    assertSafeWritePath(args.filePath);
    // Transporte seguro: base64 local -> decode remoto (evita quoting). Solo mkdir -p del padre + tee.
    const b64 = Buffer.from(args.content, "utf8").toString("base64");
    const cmd =
      `mkdir -p $(dirname ${q(args.filePath)}) && ` +
      `echo ${q(b64)} | base64 -d > ${q(args.filePath)} && wc -c ${q(args.filePath)}`;
    return await sshExec(cmd);
  },
});
