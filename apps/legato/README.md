# 顺奏 · Legato

纯前端的演奏视频编辑器。导入后自动整理节奏、较长等待与首尾，再集中试听确认疑难片段，导出音画同步的视频。原片在本机处理；分享网址不分享素材。

公开地址：https://boomyao.github.io/apps/legato/

## 开发

```sh
npm ci
npm run dev
npm run build
```

从已有 React 编辑器迁移到 Vite 静态入口，保留原来的分析、时间映射、Rubber Band R3 WebAssembly、Mediabunny / WebCodecs 导出与本地剪辑记录。静态资源统一在 `/apps/legato/` 下加载。可从仓库根目录构建整个工具箱。

支持 5 分钟、500 MB 以内素材；具体编码格式取决于浏览器，建议使用桌面版 Chrome / Edge。自动方案是声学规则推断，不识别完整乐谱，不自动补音或可靠纠正错音，不能保证一次达到人工精修听感。

最近五段视频的剪辑参数保存在当前浏览器，重新选择同一原片即可恢复。视频不存入这些记录。跨域名或跨浏览器迁移时，先下载旧剪辑记录，再在新站载入相同原片与记录。

应用沿用 GPL-2.0，详见 LICENSE。第三方声明在 public/licenses.txt 中。公开源码与部署版本一起更新。
