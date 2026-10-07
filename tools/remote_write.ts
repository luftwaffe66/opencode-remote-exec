import { tool } from "@opencode-ai/plugin";
import { assertSafeWritePath, sshExec, q } from "./lib.ts";

export default tool({
  description:
    "Writes (creates/overwrites) a file on the remote server. SAFE_MODE=1: /tmp/ and your opencode-safe-test dir only (see config).",
  args: {
    filePath: tool.schema.string().describe("Remote destination path (safe zone while testing)"),
    content: tool.schema.string().describe("Full content to write"),
  },
  async execute(args) {
    assertSafeWritePath(args.filePath);
    // Safe transport: local base64 -> remote decode (avoids quoting). Only mkdir -p of parent + write.
    const b64 = Buffer.from(args.content, "utf8").toString("base64");
    const cmd =
      `mkdir -p $(dirname ${q(args.filePath)}) && ` +
      `echo ${q(b64)} | base64 -d > ${q(args.filePath)} && wc -c ${q(args.filePath)}`;
    return await sshExec(cmd);
  },
});
