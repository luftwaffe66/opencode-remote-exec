import { tool } from "@opencode-ai/plugin";
import { sshExec, q, remoteWorkspace } from "./lib.ts";

export default tool({
  description: "Finds files on the remote by glob pattern (read-only, via find)",
  args: {
    pattern: tool.schema.string().describe("Glob pattern, e.g. '*.ts' or 'src/**/*.py'"),
    baseDir: tool.schema.string().optional().describe("Remote base dir (default workspace)"),
  },
  async execute(args) {
    const base = args.baseDir ?? remoteWorkspace();
    // find without -delete/-exec: 100% reads. -name with a simple pattern.
    const name = args.pattern.includes("/") ? args.pattern.split("/").pop()! : args.pattern;
    const cmd = `find ${q(base)} -maxdepth 6 -name ${q(name)} 2>/dev/null | head -n 100`;
    const out = await sshExec(cmd);
    return out.trim() || "(no matches)";
  },
});
