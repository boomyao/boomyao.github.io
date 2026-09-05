import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { catalog, root, destination, site, repository, escapeHtml as e } from "./catalog.mjs";

const apps = await catalog();
await rm(destination, { recursive: true, force: true });
await mkdir(destination, { recursive: true });
await cp(path.join(root, "site/public"), destination, { recursive: true });
for (const app of apps) {
  const cwd = path.join(root, "apps", app.slug);
  if (app.build !== "static") {
    const result = spawnSync(process.platform === "win32" ? "npm.cmd" : "npm", ["run", "build"], {
      cwd,
      stdio: "inherit",
    });
    if (result.error || result.status !== 0)
      throw new Error(`${app.name} 构建失败。`, { cause: result.error });
  }
  const output = path.join(cwd, app.build === "static" ? "public" : "dist");
  await readFile(path.join(output, "index.html"));
  await readFile(path.join(output, app.icon));
  await cp(output, path.join(destination, "apps", app.slug), { recursive: true });
}
const arrow =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M5 19 19 5M5 5h14v14"/></svg>';
const link =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="m10 13 4-4M8 16l-1 1a4 4 0 0 1-6-6l4-4a4 4 0 0 1 6 0m2 2 1-1a4 4 0 0 1 6 6l-4 4a4 4 0 0 1-6 0" transform="translate(1 0)"/></svg>';
const cards = apps
  .map((app, index) => {
    const url = `/apps/${app.slug}/`;
    return `<article class="app-card">
    <div class="app-identity"><span class="app-number">${String(index + 1).padStart(2, "0")}</span><img class="app-icon" src="${url}${e(app.icon)}" alt="" width="64" height="64"><span class="app-category">${e(app.category)}</span></div>
    <div class="app-body"><div class="app-title"><h2><a href="${url}">${e(app.name)}</a></h2><span class="app-subtitle">${e(app.subtitle)}</span><span class="app-status">${e(app.status)}</span></div><p class="app-description">${e(app.description)}</p><p class="app-detail">${e(app.detail)}</p><div class="app-meta"><span><span class="local-dot" aria-hidden="true"></span>${e(app.privacy)}</span><span>${e(app.compatibility)}</span></div></div>
    <div class="app-actions"><a class="open-app" href="${url}">打开应用 ${arrow}</a><button class="share-app" type="button" data-share="${site}${url}" data-name="${e(app.name)}">${link}复制分享链接</button></div>
  </article>`;
  })
  .join("\n");
const template = await readFile(path.join(root, "site/index.html"), "utf8");
await writeFile(
  path.join(destination, "index.html"),
  template
    .replaceAll("{{APP_COUNT}}", String(apps.length).padStart(2, "0"))
    .replace("{{APP_CARDS}}", cards)
    .replaceAll("{{REPOSITORY}}", repository),
);
await writeFile(path.join(destination, ".nojekyll"), "");
await writeFile(
  path.join(destination, "robots.txt"),
  `User-agent: *\nAllow: /\nSitemap: ${site}/sitemap.xml\n`,
);
await writeFile(
  path.join(destination, "sitemap.xml"),
  `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${["/", ...apps.map((app) => `/apps/${app.slug}/`)].map((route) => `<url><loc>${site}${route}</loc></url>`).join("")}</urlset>\n`,
);
console.log(`已构建 ${apps.length} 个应用：${destination}`);
