import { tool } from "@opencode-ai/plugin";
import { sshExec, q } from "./lib.ts";

export default tool({
  description: "Reads a file from the remote server over SSH (like cat, read-only)",
  args: {
    filePath: tool.schema.string().describe("Absolute remote path, e.g. /tmp/opencode-safe-test/hello.txt"),
    offset: tool.schema.number().optional().describe("First line (1-based) for paging"),
    limit: tool.schema.number().optional().describe("Max lines (default 2000)"),
  },
  async execute(args) {
    const off = args.offset ?? 1;
    const lim = args.limit ?? 2000;
    // sed keeps huge files paged; read-only end to end.
    return await sshExec(`sed -n '${off},${off + lim - 1}p' ${q(args.filePath)}`);
  },
});
