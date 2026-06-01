# AGENT.md

## 项目定位

这是 `xc.pithiest.cn` 使用的行测训练统计系统。核心目标是：本机优先保存、空间码自动同步、跨设备可用、移动端友好，并尽量减少首屏请求和 Supabase/Vercel 消耗。

## 当前部署链路

- 正式站点：`https://xc.pithiest.cn`
- 代码仓库：`Pithiest/Statistics-and-Analysis-in-the-Administrative-Aptitude-Test`
- 当前分支：`行测的统计与分析`
- Vercel 由 GitHub 更新自动触发部署。
- `src/` 和 `public/` 的真实源码通过 Supabase payload 下发，key 是 `pithiest-xingce-source-v5`。
- Vercel 构建时先执行 `scripts/prepare-source.mjs`，再执行 `tsc && vite build`。

## 本地命令

优先使用项目自带脚本：

```powershell
npm run build
npm run preview
```

如果本机没有全局 Node，可以使用 Codex bundled Node：

```powershell
& 'C:\Users\ljh73\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' .\node_modules\typescript\bin\tsc --noEmit
& 'C:\Users\ljh73\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' .\node_modules\vite\bin\vite.js build
```

## 不能随便删除

- `deploy-source.json`：远端 Supabase payload 拉取失败时的本地兜底源码包。
- `scripts/prepare-source.mjs`：Vercel 构建前恢复源码用。
- `src/`、`public/`、`index.html`、`vite.config.ts`、`vercel.json`、`package.json`、`tsconfig*.json`。
- `node_modules/`：本地验证依赖，除非明确要重装。
- `dist/`：构建产物，可以重建；如果正在本地预览，先不要删。

## 可以清理

- 工作区里的验证截图，例如 `xc-*.png`、`phone-*.png`、`desktop-*.png`。
- Vite 临时日志，例如 `vite.out.log`、`vite.err.log`、`vite-preview.out.log`、`vite-preview.err.log`。
- 一次性 GitHub API payload 或临时调试文件。

清理时只删明确文件，不用递归通配符清空目录。

## 性能与稳定策略

- 首屏只保留一个主 JS 入口；图表按可视区域懒加载。
- 非首屏业务页放在 `src/Views.tsx`，录入、诊断、复盘、台账、设置点击后才加载。
- React 首帧先用轻量默认状态渲染，再在下一帧读取本机数据，避免大体量 `localStorage` 阻塞首屏。
- Supabase 同步、PBKDF2 和 AES 加密逻辑放在 `src/cloudSync.ts`，只有设置空间码并实际同步时才动态加载。
- `index.html` 保留内联 loading shell，避免慢网时白屏；12 秒未进入应用时显示刷新恢复入口。
- `vercel.json` 对 `/` 和 `/index.html` 使用短时 `CDN-Cache-Control`，浏览器仍保持 `max-age=0`，兼顾首访速度和上线更新。
- CSS 使用 preload/onload，JS 使用高优先级。
- `sw.js` 使用 network-first 页面策略，并在安装时预热入口资源。
- 本地数据读写必须 try/catch，避免隐私模式、配额满、存储被禁用时页面崩掉。
- 同步只在真实数据变化后触发，避免普通切页、筛选、计时器按钮消耗 Supabase。
- 题型覆盖度由 `model.ts` 统一计算，首页展示均衡指数、久未训练题型和下一步学习计划。

## 每次重要改动后

1. 更新这份文件中受影响的部署、同步、性能或验证说明。
2. 运行 TypeScript 和 Vite build。
3. 用桌面和手机视口验证首屏、切页、录入、台账、设置页。
4. 如果改了 `src/` 或 `public/`，先更新 Supabase payload，再更新 GitHub 触发 Vercel。
5. 部署后检查 `https://xc.pithiest.cn` 首屏、Service Worker、控制台错误和移动端横向溢出。
