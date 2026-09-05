# boomyao 的工具箱

集中发布可直接使用和分享的浏览器小应用。

- 首页：https://boomyao.github.io/
- 顺奏：https://boomyao.github.io/apps/legato/

## 目录

```text
apps.json              应用目录与首页文案
site/                  首页模板、样式、分享交互与 404 页面
apps/<slug>/           各应用独立源码与依赖
scripts/               安装、构建、产物检查、本地预览
.github/workflows/     GitHub Pages 自动发布
_site/                 汇总后的静态产物，不提交
```

## 本地开发

需要 Node.js 22.13 或更高版本。

```sh
npm run setup
npm run build
npm run check
npm run preview
```

预览地址为 `http://127.0.0.1:5184/`，同时覆盖首页和所有应用子目录。仅调试顺奏时使用 `npm --prefix apps/legato run dev`，访问命令输出地址下的 `/apps/legato/`。首页不依赖 JavaScript 即可浏览和打开应用；复制分享链接需要 JavaScript，剪贴板不可用时提供可选中的链接。

## 添加新应用

1. 在 `apps/<slug>/` 创建独立应用，slug 使用小写英文与短横线，并提供返回 `/` 的链接。
2. Vite 应用设置 `base: '/apps/<slug>/'`，保留 `package-lock.json`，提供 `npm run build`，输出到 `dist/`。无构建需求的应用把发布文件放进 `public/`。
3. 在 `apps.json` 增加条目，填写名称、说明、图标、适用环境与真实的数据处理方式。`build` 使用 `vite` 或 `static`，图标放在发布目录根部。
4. 安装、构建并检查。首页卡片、应用路径和 sitemap 自动生成。没有完成的应用不要登记在公开目录。
5. 推送到 `main` 后，GitHub Actions 会构建整个工具箱并发布；构建或检查失败会阻止新版发布。

GitHub Pages 使用 GitHub Actions 作为发布来源，上传目录为 `_site/`。历史提交保留在仓库中，构建只使用当前应用与首页源码。应用之间各自打包，避免共享根目录资源造成 Worker、WASM 或样式冲突。

## 数据与许可

顺奏的视频解码、分析与导出在访问者本机执行，不把文件发送到本站服务器。分享应用链接不会包含用户的素材或剪辑记录。浏览器本地保存受域名隔离；从旧站迁移剪辑时，需先在旧站保存 `.legato.json`，在新站选择相同原片后载入该记录。

各应用单独声明许可；顺奏与其 Rubber Band 依赖沿用 GPL-2.0，详见 `apps/legato/LICENSE` 和 `apps/legato/public/licenses.txt`。
