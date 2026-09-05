import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

export const root = fileURLToPath(new URL("..", import.meta.url));
export const site = "https://boomyao.github.io";
export const repository = "https://github.com/boomyao/boomyao.github.io";
export const destination = path.join(root, "_site");
export const escapeHtml = (value) =>
  String(value).replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c],
  );

export async function catalog() {
  const apps = JSON.parse(await readFile(path.join(root, "apps.json"), "utf8"));
  if (!Array.isArray(apps) || !apps.length) throw new Error("apps.json 必须包含可用应用。");
  const slugs = new Set();
  for (const app of apps) {
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(app.slug) || slugs.has(app.slug))
      throw new Error("应用 slug 无效或重复。");
    slugs.add(app.slug);
    for (const field of [
      "name",
      "subtitle",
      "category",
      "description",
      "detail",
      "privacy",
      "compatibility",
      "status",
      "updated",
    ]) {
      if (typeof app[field] !== "string" || !app[field].trim())
        throw new Error(`${app.slug} 缺少 ${field}。`);
    }
    if (!["vite", "static"].includes(app.build))
      throw new Error(`${app.slug} 的构建方式不受支持。`);
    if (!/^[a-zA-Z0-9_-]+\.(svg|png|webp)$/.test(app.icon))
      throw new Error(`${app.slug} 的图标路径无效。`);
  }
  return apps;
}
