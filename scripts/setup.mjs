import { spawnSync } from "node:child_process";
import path from "node:path";
import { catalog, root } from "./catalog.mjs";

for (const app of await catalog()) {
  if (app.build === "static") continue;
  const result = spawnSync(
    process.platform === "win32" ? "npm.cmd" : "npm",
    ["ci", "--no-audit", "--no-fund"],
    { cwd: path.join(root, "apps", app.slug), stdio: "inherit" },
  );
  if (result.error || result.status !== 0)
    throw new Error(`${app.name} 安装失败。`, { cause: result.error });
}
