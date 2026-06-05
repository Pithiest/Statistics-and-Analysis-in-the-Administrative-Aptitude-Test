# AGENT.md

## 项目定位

这是 `xc.pithiest.cn` 使用的行测训练统计系统。产品原则是：

- 本机优先保存，空间码用于跨设备自动同步。
- 保留录入、计时、模板、诊断、复盘、台账、导入导出等完整能力。
- 精简代码和重复说明，不删减有效训练功能。
- 数据工作台优先支持快速判断下一步训练动作。
- 电脑、笔记本、平板和手机均可完整使用。

## 部署链路

- 正式站点：`https://xc.pithiest.cn`
- GitHub：`Pithiest/Statistics-and-Analysis-in-the-Administrative-Aptitude-Test`
- 发布分支：`行测的统计与分析`
- Vercel 由 GitHub 更新自动触发部署。
- `src/` 和 `public/` 的部署源码通过 Supabase payload 下发，key 为 `pithiest-xingce-source-v5`。
- Vercel 构建先执行 `scripts/prepare-source.mjs`，再执行 TypeScript 和 Vite 构建。

## 常用命令

```powershell
npm test
npm run typecheck
npm run build:local
npm run source:pack
npm run preview
```

`npm run build` 会先从 Supabase 恢复部署源码，适合 Vercel；本地改造验证使用 `npm run build:local`，避免远端旧 payload 覆盖未发布改动。

## 数据与指标

- 模块和小题型只允许使用 `src/model.ts` 中的既有配置，不凭空修改考试内容。
- 旧数据导入必须经过模块和小题型归一化，不能把言语、判断、资料、数量或常识误判为全模块测试。
- 模块健康度上限固定为 100，由正确率、配速、样本量、训练新鲜度和复盘完成度共同计算。
- 无训练日期的正确率和配速使用 `null`，图表连接空值，不把缺失数据画成 0。
- 常识诊断必须始终显示政治理论、法律常识、科技人文、经济管理、综合卷/混刷，即使某项暂无样本。
- 首页对比口径为最近 7 天和此前 7 天；所有百分比和健康度都要限制在 `0-100`。

## 同步约束

- 普通切页、筛选、弹层、主题切换和计时器操作不得触发上传。
- 仅训练记录、复盘状态、模板、目标或其他持久设置真实变化后标记待同步。
- 本机变化 10 秒合并上传；页面聚焦、网络恢复和后台拉取至少间隔 2 分钟。
- 保存先写本机，云端失败不能阻塞录入。
- 同步状态要区分本机已保存、等待同步、同步中、已同步、离线和错误。
- 不在日志、截图、文档或提交信息中记录真实空间码及其明文数据。

## 界面约束

- 总览使用高密度数据工作台，不回退为低信息密度卡片堆。
- 关键层级为：今日行动、核心信号、趋势、模块健康矩阵、训练编排、复盘与错因。
- 诊断页要能直接切换模块、题型和时间范围，并完整展示小题型健康表。
- 台账桌面端使用紧凑表格，移动端使用可扫描记录行，不允许页面横向溢出。
- 署名使用低调的 `Pithiest巨献`，放在侧栏或设置页角落，不放在主标题旁。
- 动效只用于切页、状态变化和图表进入，避免大面积漂浮、弹跳或廉价渐变。

## 性能与稳定性

- 首页保持单一主入口；`Views.tsx`、`Charts.tsx` 和 `cloudSync.ts` 按需加载。
- 首帧先渲染轻量状态，再异步读取本机记录，避免存储访问阻塞白屏。
- `index.html` 保留与正式界面一致的加载壳，并在 React 接管前恢复主题。
- Service Worker 页面请求使用 network-first，静态哈希资源长期缓存。
- 本地存储读写必须捕获异常，兼容隐私模式、配额不足和存储禁用。
- Vercel 的 HTML 保持短缓存并允许 CDN stale-while-revalidate；哈希资源使用 immutable。

## 不要删除

- `deploy-source.json`（本地兜底；仓库没有该文件时会保留仓库现有源码继续构建）
- `scripts/prepare-source.mjs`
- `scripts/build-source-payload.mjs`
- `src/`、`public/`、`index.html`
- `vite.config.ts`、`vercel.json`
- `package.json`、`tsconfig*.json`
- `tests/`

`dist/` 可以重建，但本地预览运行时不要删除。

## 每次重要改动

1. 先运行模型测试和 TypeScript 检查。
2. 使用 `npm run build:local` 验证本地真实源码。
3. 用浏览器验证桌面、笔记本、平板、手机，以及录入、诊断、台账、设置和暗色主题。
4. 检查无横向溢出、控制台错误和加载失败。
5. 使用 `npm run source:pack` 更新 `deploy-source.json`。
6. 先更新 Supabase source payload，再更新 GitHub 分支触发 Vercel。
7. 部署后验证 `https://xc.pithiest.cn` 的首屏、刷新、Service Worker 和移动端。
