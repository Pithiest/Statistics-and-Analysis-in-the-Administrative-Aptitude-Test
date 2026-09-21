# 粉笔网页登录协议：调查与服务端接入边界

调查日期：2026-09-21。只读取官方公开页面/脚本，并创建未扫码的临时二维码、查询一次待扫码状态。没有使用本机 Cookie，没有提交账号、密码或验证码，没有完成真实用户登录。临时登录令牌仅在请求进程内存中使用，未保存到本文件、日志或仓库。

## 结论与公开来源

官方网页目前具有粉笔 App 扫码登录流程，可由服务端为每名用户维持独立短期扫码事务；现有证据只验证到“待扫码”。扫码确认后能否在部署环境持续读取本人题库，需要由用户完成一次扫码再验收。它是粉笔自己网站使用的 Cookie 登录协议，不应宣传成官方第三方 OAuth 或已获授权的开放 API。

本次实际读取的官方文件：

- [粉笔题库入口](https://www.fenbi.com/spa/tiku/)
- [题库当期主程序 main.e674e84b126bdf16.js](https://nodestatic.fbstatic.cn/weblts_spa_online/tiku/main.e674e84b126bdf16.js)：`renderQrcode`、`queryQrcodeStatus`、`handleQrcodeStatusChange`、`getUsersInfo`、`genDeviceSid`。
- [粉笔官网入口](https://www.fenbi.com/)
- [官网当期主程序 main-N27TX2P7.js](https://nodestatic.fbstatic.cn/weblts_spa_online/page/main-N27TX2P7.js)：`getQRCode`、`getQRCodeStatus`、`QRCodeStatusChangeHandler`、`createDeviceSID` 与登录接口映射。
- [官方用户协议](https://depot.fenbi.com/fenbi-user-agreement/index.html)与[隐私政策](https://depot.fenbi.com/fenbi-privacy/index.html)：两个链接由官网登录组件直接引用，本机 HTTP 读取成功。

官方网页的可观察实现只证明接口存在。此次未发现第三方应用注册、可申请 scope、第三方 redirect URI 或令牌刷新授权协议；有限调查不能证明粉笔没有任何合作接口。用户协议 3.6 对未经书面授权的软件与服务改编、镜像等使用设有限制，4.1 要求妥善保管账号并限制分享。多人网站不能把复用内部接口称为粉笔官方合作或稳定性承诺；商业或公开服务需要另核对官方许可。

## 扫码接口

| 操作 | 请求 | 可观察响应 |
| --- | --- | --- |
| 生成二维码 | `GET https://ke.fenbi.com/qrcode-login/api/gen_code?random=<随机数>` | `{code:1,msg:string,data:{lgtoken:string,codeContent:string}}` |
| 查询扫码状态 | `POST https://ke.fenbi.com/qrcode-login/api/query_code_status`，JSON `{lgtoken}` | `{code:1,msg:string,data:number}` |
| 读取当前账号 | `GET https://login.fenbi.com/api/users/info` | 题库程序直接读取 `userId` 与显示名 `identity`；真实登录响应尚待扫码验收 |

网站必须直接把 `codeContent` 交给二维码编码器，不能把轮询用的 `lgtoken` 当作二维码正文。两个值都属于短期登录事务，不写运行日志、分析事件或公开 URL。服务端仅向创建该事务的当前网站用户返回二维码内容与状态。

官网状态枚举：`0` 过期、`1` 待扫码、`2` 已扫码待确认、`3` 已授权、`4` 已取消、`5` 失败、`6` 网络错误。官方网页每 2 秒轮询；取消、失败或过期时显示刷新状态。网站应限制一次事务的寿命与轮询次数，不能无限轮询或把“已扫码”当作“已连接”。

2026-09-21 未登录实测：生成和一次查询均为 HTTP 200，业务 `code=1`，查询 `data=1`。两步均没有 `Set-Cookie`，Cookie jar 为空；没有人扫描或确认。以 `Origin: https://xc.pithiest.cn` 请求生成接口时，响应包含对应 `Access-Control-Allow-Origin` 和 `Access-Control-Allow-Credentials: true`，但此行为不等于第三方接入授权。

官网还暴露 `GET https://login.fenbi.com/api/users/current`。本次无登录态读取返回 HTTP 401，只设置了主机范围的 `acw_tc` 风控 Cookie；这不能用作登录证明。`/info` 的字段依据是官方题库 `userInfo.userId` 与 `userInfo.identity` 读取逻辑，不接受调用方提供账号 ID，也不猜测其他响应字段。

## Cookie、CSRF 和设备验证

官方客户端的上述请求携带 credentials。扫码状态达到 `3` 后，应读取该响应全部 `Set-Cookie`，维持服务器 Cookie jar，再调用官方 `/info` 验证身份。只在得到可信 `userId` 后，才把粉笔账号绑定到该扫码事务所属的网站用户。

目前没有实测授权成功响应，因此不能提前断言 `sess`、`persistent` 等 Cookie 的返回位置、有效期或 Domain。应遵守每个 Cookie 的实际 Domain、Path、Max-Age/Expires；仅 `Domain=fenbi.com` 的 Cookie 可按规则跨 `ke`、`login`、`tiku` 发送。`ke.fenbi.com` 的 host-only Cookie 不能扩域。不得自行复制 Cookie 到不匹配域，也不得把粉笔 Cookie 转发给网站浏览器。

现有 provider 中 `domain` 带前导点表示 Domain Cookie，否则为 host-only；`expires` 是 Unix 毫秒。只允许 HTTPS 和固定官方 API 主机，禁止重定向。每次官方响应都会原地更新传入的 Cookie jar，调用方需要将更新后的 jar 私密保存。题目 CDN 请求不携带 Cookie、Authorization、Origin 或 Referer。

扫码函数没有观察到显式 CSRF 参数。官网包包含 Angular 常规 XSRF 支持，但绝对地址请求不走该相对地址拦截逻辑；这不足以证明服务端没有其他校验。自己的网站仍必须将扫码事务绑定到网站会话，并校验 Origin、事务所有者和短期状态，防止把他人的扫码确认绑定给当前账号。

题库请求会附带公开版本参数。官方客户端遇到 HTTP 453 时，才在浏览器调用 `/api/users/device/sid/create`，提交 `pf`、`startupId` 与真实浏览器指纹（canvas、WebGL、屏幕等），将服务端返回的设备标识保存为 `deviceSid`。官网 SDK 明确限制此设备创建逻辑在浏览器中运行。不能在服务端伪造浏览器指纹或把 `device_id` Cookie 直接冒充该设备标识。

官方客户端将 HTTP 430/432 交给人工验证组件，453 交给设备验证。provider 对这些状态停止读取并返回 `VERIFICATION_REQUIRED`，对 401/403 返回 `AUTH_REQUIRED`，对 429 返回 `RATE_LIMITED`。不得绕过验证、反复试密码或通过重建会话持续冲击限制。

## 多人网站服务端约束

- 网站用户会话、扫码事务、粉笔 Cookie jar、错题和复盘数据必须按同一个内部 owner 隔离。需要服务器强制所有者验证；仅前端筛选或用户传入 `providerId` 不成立。
- 若 Edge Function 使用 `verify_jwt=false`，业务路由仍必须校验自有会话。关闭平台 JWT 校验不等于允许匿名读取、绑定、同步或取消他人账号。
- 数据库凭据和 Cookie 只在后端使用；匿名数据库角色不能列举这些数据。原有训练空间码行不应兼作全体同学的公共题库。
- 每个用户单独串行同步并持有租约。当前错题树决定可请求题号范围，每批最多 10 题，只读题干、解析与个人答案，不提交答题、不改变粉笔进度、不删除粉笔错题。
- 会话失效应保留网站已有复盘并提示重新扫码。云端定时读取可以脱离个人电脑运行，但无法保证粉笔会话永不过期或永久允许数据中心访问。

## 仍需真实扫码后的验收

1. 授权响应 Cookie 名称、作用域和有效期；不保存或展示实际值。
2. 持同一合法 jar 成功读取 `/info`，得到账号标识并正确绑定到网站用户。
3. 在部署所在地读取本人错题树、题目批次与个人答案，核对覆盖而不修改粉笔数据。
4. 两个独立网站用户之间不能读取、绑定、取消或替换对方连接；过期、取消、重放的扫码事务失效。
5. 断连、认证过期、部分失败和限流时保存正确状态，并保留已有题库与复盘。

本文件只记录公开协议及验证边界，不包含任何实际账号、题目、Cookie、二维码令牌或用户导出。
