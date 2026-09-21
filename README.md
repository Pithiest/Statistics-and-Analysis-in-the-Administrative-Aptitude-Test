# 行测训练统计系统 · xc.pithiest.cn

这里是 **xc.pithiest.cn 的完整工程根目录**。以后在 Codex 中打开 `/Users/pithiest/good_things` 即可继续维护；源码、Git 历史、部署配置与操作记录都在此处，不再套一层 `xingce-statistics` 目录。

- 正式网站：[xc.pithiest.cn](https://xc.pithiest.cn)
- GitHub：[Pithiest/Statistics-and-Analysis-in-the-Administrative-Aptitude-Test](https://github.com/Pithiest/Statistics-and-Analysis-in-the-Administrative-Aptitude-Test)
- 发布分支：`行测的统计与分析`
- 当前工程版本：`3.4.0`
- 协作规则：[AGENTS.md](AGENTS.md)
- 最近恢复记录：[2026-09-21 访问与同步检查](docs/operations/xc-repair-2026-09-21.md)
- 本轮更新记录：[3.4.0 界面与稳定性验收](docs/operations/ui-update-2026-09-21.md)

2026-09-21 已恢复暂停的 Supabase 服务，并确认网站当时可访问；用户随后确认网站恢复。此前另一台设备的整站连接超时未在本机复现，不能将其原因直接归为 Supabase 暂停。3.4.0 的界面更新与本地浏览器验收已完成；线上发布仍需核对对应 GitHub 检查、Vercel 部署和正式域名实际入口，详见本轮更新记录。

## 网站如何使用

网站提供训练录入、计时与快捷模板、训练总览、模块诊断、错题复盘、训练台账，以及 JSON 导入导出和 CSV 导出。

训练先保存在当前浏览器。需要多设备同步时，在各设备的设置页使用相同空间码。空间码是访问对应同步数据的凭据，应自行保管；网站没有要求创建账号的登录流程。切换浏览器、设备或域名不会自动继承原浏览器的本机数据。

在清理浏览器数据、迁移设备或做大范围数据整理前，先从设置页导出 JSON。源码仓库和下面的工程备份只保存程序文件，不包含浏览器中的个人训练记录。

## 工程位置与目录

| 位置 | 用途 |
| --- | --- |
| `src/` | 页面、样式、图表、训练数据模型与同步逻辑 |
| `public/`、`index.html` | 网站入口、图标、安装信息与离线缓存 |
| `tests/` | 数据模型与统计口径回归测试 |
| `scripts/` | 历史源码打包与恢复工具 |
| `package.json`、`vite.config.ts`、`vercel.json` | 开发、构建与托管配置 |
| `.github/workflows/` | 只读验证测试、类型检查与构建，不再恢复或推回云端源码 |
| `docs/operations/` | 按日期保存的恢复、维护与验收记录 |
| `docs/reference/xingce-data-preview.png` | 仅在本机保留的旧版截图，用于历史对照 |
| `.local-backups/` | 本机工程备份，已从 Git 排除 |

工程整理前的完整备份是 `.local-backups/xingce-before-ui-20260921.tar.gz`，包含当时的源码和 Git 目录。备份用于需要时人工恢复，不应直接覆盖正在维护的工程。

旧 Supabase 源码包另存为 `.local-backups/supabase-source-20260921.json`。本次已比对其中 12 个文件，与搬迁前 Git 源码完全相同，没有发现云端独有改动。两个备份都只在本机保留，不包含个人训练数据导出。

## 本地开发与验证

在工程根目录使用 Node.js `22.18.0` 或更新版本与 npm。已保存依赖锁定文件，首次使用先安装锁定依赖：

```sh
npm ci
npm run dev
```

开发服务默认监听本机 `127.0.0.1`。根据改动范围执行验证：

```sh
npm test
npm run typecheck
npm run build
npm run preview
```

`dev`、`build` 和 `build:local` 都直接使用当前 Git 工作目录中的源码。`build:local` 保留为 `build` 的同功能入口；`preview` 打开构建结果。源码检查或构建通过后，还需要从浏览器实际验证受影响的入口。

正常开发、构建和发布均不从 Supabase 下载源码。`scripts/prepare-source.mjs` 不带 `--restore` 时直接退出，不写文件。历史恢复仅通过 `npm run source:restore` 显式执行；它会覆盖源码包列出的本地文件并处理包内删除清单，运行前应保留当前改动并确认恢复目标。`npm run source:pack` 仅把当前 `src/` 与 `public/` 打包为本地 `deploy-source.json`，不会自动上传。

## 部署关系

Vercel 托管网页，正式域名为 `xc.pithiest.cn`；GitHub 保存可维护源码，发布分支更新关联 Vercel 部署。Supabase 项目 `atwsraivphybkfmyeubd` 提供空间码同步。

Vercel 配置使用 `npm ci` 安装、`npm run build` 构建并发布 `dist/`。原 `materialize-source.yml` 文件现为 **Verify source** 工作流，只有仓库读取权限，运行测试、类型检查和构建，不再生成或推回源码提交。

历史部署使用 Supabase 表 `xingce_sync` 中的 `pithiest-xingce-source-v5` 保存源码包。它与个人训练同步数据共用表，但用途不同，现在只保留作手动恢复来源。显式恢复会优先读取云端包，其次尝试本地 `deploy-source.json`，两者都不存在时保留仓库源码。普通界面维护无需更新该云端源码包。

发布后应打开正式域名，检查受影响页面、刷新、加载资源与手机布局。GitHub 或 Vercel 的成功状态表示构建发布成功，不代替真实入口验收，也不证明所有网络环境都可访问。

## 数据与维护边界

- 本机数据和同步设置由浏览器保存，代码恢复或工程归档不等于数据备份。
- Supabase 故障可能造成同步失败；应用会保留本机数据。整站超时还需分别检查域名、网络路径和前端资源。
- 检查接口可使用无记录返回的只读请求。未经明确需要，不读取、解密、上传或改写真实训练内容。
- `.env`、访问令牌、真实空间码与个人训练导出文件不提交到 Git，不写入日志、截图或公开文档。
- 本机备份与历史截图予以保留。需要恢复源码时先保留当前工作，再核对备份范围。

具体改动约束与验证要求统一见 [AGENTS.md](AGENTS.md)。旧文件名 [AGENT.md](AGENT.md) 仅保留兼容指针。
