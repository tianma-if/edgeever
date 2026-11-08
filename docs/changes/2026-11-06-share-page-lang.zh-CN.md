# 分享笔记首个 HTML 响应的语言标记

[English](2026-11-06-share-page-lang.md)

关联 Issue：#814

## 问题与结果

公开笔记分享的首个 HTML 响应基于 Web 应用外壳生成，外壳声明了 `<html lang="zh-CN">`。服务端输出的笔记无论使用何种语言都会继承这一语言，服务端添加的英文文字（“Updated … UTC”“Published with EdgeEver”）也被标记为中文。只读取该响应的链接预览、爬虫、AI 助手和屏幕阅读器因此获得了错误的语言信息。

现在服务端输出的文章会明确标记各部分：

- 笔记标题（`<h1>`）和正文（`<pre>`）使用 `lang=""`，视为未知语言，不再继承 `zh-CN`；
- 更新时间、“Published with EdgeEver”页脚以及 “Shared note” 默认标题使用 `lang="en"`。

应用外壳及其 `<html lang>` 不变。根据访问者的 `Accept-Language` 选择页面语言将另行讨论。该业务代码由 Cloudflare 与 Docker 共用。

## 验证

- `apps/api/src/share-page.test.mjs` 新增回归测试，覆盖这些属性以及无标题时的默认标题。
- 使用本分支的自托管构建，通过 `curl` 检查了分享链接的首个 HTML 响应。

## 回滚

还原 `share-page.ts`。不涉及数据或设置变更。
