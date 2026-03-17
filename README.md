# Personal Blog

一个 Astro 站点。

## 本地开发

```sh
pnpm install
pnpm dev
```

## 检查与构建

```sh
pnpm check
pnpm build
```

## 自动化

仓库内置了两条 GitHub Actions 工作流：

- `ci.yml`: 在 `push` 和 `pull_request` 时运行 `pnpm check` 与 `pnpm build`
- `deploy.yml`: 在 `main` 分支 push 时构建并发布到 GitHub Pages

发布工作流会自动兼容两种 Pages 路径：

- 用户主页仓库：`<owner>.github.io`
- 项目主页仓库：`<owner>.github.io/<repo>/`

首次启用前，需要在 GitHub 仓库设置里打开 Pages，并选择 `GitHub Actions` 作为 source。
