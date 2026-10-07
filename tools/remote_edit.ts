import { tool } from "@opencode-ai/plugin";
import { assertSafeWritePath, sshExec, q } from "./lib.ts";

export default tool({
  description:
    "Edits a remote file replacing oldString with newString (1 occurrence unless replaceAll). Safe zone while testing.",
  args: {
    filePath: tool.schema.string().describe("Remote path (safe zone while testing)"),
    oldString: tool.schema.string().describe("Exact text to replace"),
    newString: tool.schema.string().describe("Replacement text"),
    replaceAll: tool.schema.boolean().optional().describe("Replace all (default false)"),
  },
  async execute(args) {
    assertSafeWritePath(args.filePath);
    if (!args.oldString) throw new Error("empty oldString: nothing to replace");
    if (args.oldString === args.newString) throw new Error("oldString == newString: no changes");
    const oB64 = Buffer.from(args.oldString, "utf8").toString("base64");
    const nB64 = Buffer.from(args.newString, "utf8").toString("base64");
    const mode = args.replaceAll ? "all" : "one";
    // Remote python3 does the exact replacement + occurrence validation (no blind sed -i)
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
      if (m.includes("exit 11")) throw new Error("oldString not found on remote");
      if (m.includes("exit 12"))
        throw new Error("oldString occurs multiple times; use replaceAll=true or more context");
      throw e;
    }
  },
});
