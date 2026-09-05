import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { catalog, destination, site } from "./catalog.mjs";

const apps = await catalog();
async function exists(url) {
  const parsed = new URL(url, site);
  if (parsed.origin !== site) return;
  let file = path.join(destination, decodeURIComponent(parsed.pathname));
  const info = await stat(file);
  if (info.isDirectory()) file = path.join(file, "index.html");
  await stat(file);
}
async function walk(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`发布目录包含符号链接：${file}`);
    if (entry.isDirectory()) files.push(...(await walk(file)));
    else files.push(file);
  }
  return files;
}
const files = await walk(destination);
for (const file of files) {
  if (/^\.env(?:\.|$)/.test(path.basename(file)) || file.includes("/.openai/"))
    throw new Error(`发布目录包含非应用文件：${file}`);
  if (file.endsWith(".html")) {
    const text = await readFile(file, "utf8");
    if (/\{\{[A-Z_]+\}\}/.test(text)) throw new Error(`未替换模板内容：${file}`);
    for (const match of text.matchAll(/(?:src|href)="(\/[^"\s]*)"/g)) await exists(match[1]);
  }
}
for (const app of apps) {
  await exists(`/apps/${app.slug}/`);
  if (app.build === "vite") {
    const html = await readFile(path.join(destination, "apps", app.slug, "index.html"), "utf8");
    if (!html.includes(`/apps/${app.slug}/assets/`))
      throw new Error(`${app.name} 资源没有使用独立子目录。`);
    for (const file of files.filter(
      (f) => f.startsWith(path.join(destination, "apps", app.slug)) && f.endsWith(".js"),
    )) {
      const js = await readFile(file, "utf8");
      for (const match of js.matchAll(/["'`](\/apps\/[^"'`\s]+\.(?:js|wasm|css))["'`]/g))
        await exists(match[1]);
      if (/new Worker\([^;]*file:\/\//.test(js))
        throw new Error(`${app.name} Worker 包含 file URL。`);
    }
  }
}
await exists("/404.html");
await exists("/sitemap.xml");
console.log(`发布检查通过：${apps.length} 个应用，${files.length} 个静态文件。`);
