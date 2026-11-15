# 网页端 CloudFlare ImgBed

[English](2026-11-14-web-imgbed.md)

网页端现在可以直接配置、测试并上传到 HTTPS CloudFlare ImgBed。此次 PicGo / PicList 仍仅支持桌面端，不包含 Android、iOS 原生客户端。

- 图床必须在 `/api/channels` 和 `/upload` 上允许 EdgeEver 来源及 `Authorization` 请求头跨域访问，预检不能依赖浏览器 Cookie；请求拒绝重定向。
- Token 与设置仅存于当前浏览器的 localStorage，不同步、不经过 EdgeEver 后端。
- 外部图床仍须测试成功后才能保存。测试会写入一张小 PNG，再次测试可能产生重复图片。
- 指定渠道名称时，先检查渠道是否存在，再测试上传；测试强制关闭 ImgBed 服务端重试。实际上传的重试开关仍控制 ImgBed 自身重试策略。
- 网络或跨域失败不自动重传，也不静默改存；用户选择重试、改存 EdgeEver 或取消。切换笔记会取消等待中的选择。
- 网页与桌面共用 ImgBed 协议包；桌面仍使用原 Node 传输、DNS/主机检查和 IPC 失败队列。
- 外部图片仍不纳入 EdgeEver 备份，笔记中已有的图片链接保持原样。

风险：浏览器读不到响应时，图片可能已上传，主动重试可能产生重复图片。回滚：切回内置图床或恢复网页端能力开关。不引入数据库迁移或凭据同步。

验证由新增浏览器适配器测试、现有桌面协议测试、类型检查和 Web 构建覆盖。真实 ImgBed 部署及跨域配置、Safari/Firefox、原生移动端和 Windows/Linux 打包桌面端上传尚未验证。

已完成：81 项相关测试；`bun run typecheck`、`bun run typecheck:mobile`、`bun run build:web`；冻结锁文件安装；Node 加载桌面适配器。Chrome 已确认测试/加载渠道按钮可用、HTTPS 地址提示正常、连接失败后仍不能保存；未保存测试配置。语言目录测试存在基线已有的波兰语 `plugins.restoreFailed` 键顺序失败，已从 HEAD 复现；新增键在九种语言中均已补齐。
