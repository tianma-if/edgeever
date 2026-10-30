# CloudFlare ImgBed 图床（桌面端）

[English](2026-10-30-desktop-imgbed-image-host.md)

## 问题与结果

实现 [Issue #734](https://github.com/tianma-if/edgeever/issues/734)。自建了 [CloudFlare ImgBed](https://github.com/MarSeventh/CloudFlare-ImgBed) 的桌面端用户，过去必须借助 PicList 中转才能使用。现在"设置 → 图床"新增第三个选项"CloudFlare ImgBed"，与内置图床、PicGo / PicList 并列。与 PicGo 一样，桌面端负责上传新插入的图片，并把返回的链接写入笔记。同时放宽了 PicGo / PicList 的地址要求：从"路径必须是 `/upload`"改为"以 `/upload` 结尾"，经过反向代理的 PicList（如 `https://nas.example.com/piclist/upload`）也能使用。

## 行为

| 编号 | 行为 | 验收 |
| --- | --- | --- |
| B01 | 设置项包括 ImgBed 地址（站点根地址或 `…/upload`）、具有 `upload` 权限的 API Token、可选的上传目录、ImgBed 的文件命名方式（`default`、`index`、`origin`、`short`）、上传渠道（`telegram`、`cfr2`、`s3`、`discord`、`huggingface`、`webdav`）以及服务端压缩。渠道和压缩的默认值与 ImgBed 接口一致：`telegram`，压缩开启。与 PicGo 一样，测试连接成功后才能保存。 | 桌面端 `imgbed.test.mjs`：地址与 Token 规范化。 |
| B02 | 上传目录支持 PicList 占位符 `{Y}` `{y}` `{m}` `{d}` `{h}` `{i}` `{s}` `{ms}` `{timestamp}` `{timestampS}` `{uuid}` `{str-N}`，以及 EdgeEver 的 `{memoId}`（接收图片的笔记）。日期按上传者本地时区计算。不支持的占位符、多余的花括号和非法字符会在保存前被拒绝；展开后最长可能超过主进程 200 字符上限的目录也会被拒绝（每个占位符按最长取值计算，`{memoId}` 最多 64 个字符），避免测试连接通过、带真实笔记 ID 上传时才失败；设置页显示展开后的预览。 | Web 端 `imgbed.test.mjs`。 |
| B03 | 上传时发送 `POST {地址}/upload?uploadChannel=…&serverCompress=…&uploadNameType=…&uploadFolder=…`，带 `Authorization: Bearer <token>`，图片放在 `file` 字段。ImgBed 返回 `publicUrl` 时写入该链接，否则用 ImgBed 地址解析 `src`。只接受单个不含账号密码的 http(s) 链接。 | 桌面端 `imgbed.test.mjs`。 |
| B04 | ImgBed 没有心跳接口，测试连接会向配置的目录上传一张名为 `edgeever-connection-test.png` 的 1×1 透明 PNG，设置页对此有说明。 | 桌面端 `imgbed.test.mjs`。 |
| B05 | ImgBed 与 PicGo 共用同一个上传队列和现有的失败对话框（重试 / 改存 EdgeEver / 取消），文案按 ImgBed 区分。Token 被拒（HTTP 401/403）时会给出提示，且不回显 Token。 | 桌面端 `imgbed.test.mjs`、`picgo.test.mjs`。 |
| B06 | PicGo / PicList 地址的路径只要以 `/upload` 结尾即可，测试连接调用同级的 `…/heartbeat`。其他地址规则（不能带查询参数、片段、账号密码，不能是链路本地或云元数据地址）保持不变。 | 桌面端 `picgo.test.mjs`。 |

## 范围与限制

- 与 PicGo 一样仅支持桌面端，Web 端显示"仅桌面端可用"。
- 不支持删除 ImgBed 上的图片：链接写入笔记后，EdgeEver 无法判断是否还有其他笔记在使用它。
- Token 与 PicGo 服务密钥一样保存在渲染进程的本地存储中，并随每次上传发送，请使用 HTTPS 地址。
- ImgBed 上的图片不包含在 EdgeEver 备份中。

## 风险与回滚

只改动桌面端的渲染进程和主进程，不涉及服务端、API、存储或 Migration。继续使用"内置图床"的用户不受影响。PicGo 地址规则有所放宽，但主机检查保持不变。回滚：把"设置 → 图床"切回内置图床，或回退此改动。

未验证：针对真实 ImgBed 实例和经反向代理的 PicList 的上传；Windows 和 Linux 桌面端的交互检查；日语、波兰语、俄语文案未经母语者审校。
