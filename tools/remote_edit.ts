import { tool } from "@opencode-ai/plugin";
import { assertSafeWritePath, sshExec, q } from "./lib.ts";

export default tool({
  description:
    "Edita un archivo remoto reemplazando oldString por newString (1 ocurrencia salvo replaceAll). Zona segura en pruebas.",
  args: {
    filePath: tool.schema.string().describe("Ruta remota (zona segura en pruebas)"),
    oldString: tool.schema.string().describe("Texto exacto a reemplazar"),
    newString: tool.schema.string().describe("Texto de reemplazo"),
    replaceAll: tool.schema.boolean().optional().describe("Reemplazar todas (default false)"),
  },
  async execute(args) {
    assertSafeWritePath(args.filePath);
    if (!args.oldString) throw new Error("oldString vacío: nada que reemplazar");
    if (args.oldString === args.newString) throw new Error("oldString == newString: sin cambios");
    const oB64 = Buffer.from(args.oldString, "utf8").toString("base64");
    const nB64 = Buffer.from(args.newString, "utf8").toString("base64");
    const mode = args.replaceAll ? "all" : "one";
    // Python3 en remoto hace reemplazo exacto + validación de ocurrencias (sin sed -i destructivo a ciegas)
    const pyB64 = Buffer.from(
      [
        "import base64,sys",
        `p=${q(args.filePath)}`,
        `old=base64.b64decode('${oB64}').decode('utf8')`,
        `new=base64.b64decode('${nB64}').decode('utf8')`,
        "src=open(p,encoding='utf8').read()",
        "n=src.count(old)",
        "print(f'OCCURRENCES={n}')",
        "import sys as _s",
        "_m='" + mode + "'",
        "if n==0: _s.exit(11)",
        "if n>1 and _m!='all': _s.exit(12)",
        "open(p,'w',encoding='utf8').write(src.replace(old,new) if _m=='all' else src.replace(old,new,1))",
        "print('EDIT_OK')",
      ].join("\n"),
      "utf8"
    ).toString("base64");
    const cmd = `python3 -c "import base64;exec(base64.b64decode('${pyB64}').decode())"`;
    try {
      return await sshExec(cmd);
    } catch (e: any) {
      const m = String(e?.message ?? e);
      if (m.includes("exit 11")) throw new Error("oldString no encontrado en remoto");
      if (m.includes("exit 12"))
        throw new Error("oldString aparece múltiples veces; usa replaceAll=true o más contexto");
      throw e;
    }
  },
});
