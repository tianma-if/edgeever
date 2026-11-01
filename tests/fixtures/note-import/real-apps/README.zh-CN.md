# 来源应用真实导出

[English](README.md)

Obsidian/Joplin 样本于 2026-10-29 在 macOS arm64 的独立本地测试库生成；Evernote 样本于 2026-10-31 使用测试账号单独新建并导出。正文与附件均为自行编写的数据，不含个人知识库、账号信息或应用安装包。

- **Obsidian 1.14.5**：通过官方 CLI 和 Vault API 创建 6 篇笔记及 5 个源附件。`obsidian-1.14.5.zip` 将原生 Vault 目录连同外层目录和 `.obsidian` 配置打包。Obsidian 直接保存原始 Markdown，无需另行导出。
- **Joplin 3.7.21**：在应用内批准 Data API 访问后，创建 3 层笔记本中的 5 篇笔记。由已安装的桌面应用将该笔记本导出为 JEX、RAW、Markdown 和带 Front Matter 的 Markdown；ZIP 只对原始导出目录增加外层目录并打包，未修改导出内容。不包含默认欢迎笔记本。
- **Evernote 11.40.2**：通过桌面编辑器新建一篇测试笔记，再从笔记菜单导出原始 `evernote-11.40.2.enex`，未修改导出字节。包含标题、表格、代码块、原生已勾选/未勾选清单、两个标签及 PNG、SVG、PDF、文本、ZIP 附件。导出时取消作者属性，不包含账号资料；原始创建/修改时间分别为 `2026-10-31T03:38:38Z` / `2026-10-31T03:41:05Z`。

`assets/` 是三个来源共用的独立预期原字节。Obsidian/Joplin 各引用 5 个源文件，PNG 被两篇笔记复用，因此各导入 6 个笔记所属资源；Evernote 单篇笔记导入 5 个资源。语料包括中文、空格、字面百分号、ZIP 附件、空笔记、表格、待办、代码、图片链接和 30 个标签。Obsidian/Joplin 来源元数据主动设为创建时间 `2020-01-02T03:04:05Z`、修改时间 `2021-02-03T04:05:06Z`。Joplin 普通 Markdown 不导出标签和时间，这些缺失值沿用导入器的既有默认值。

运行真实 HTTP、SQLite 和附件读回用例：

```sh
bun test tests/note-import.integration.test.mjs --test-name-pattern 'real desktop-app exports'
```

原有自行构造的 ENEX 边界样本仍位于相邻的 `evernote/` 目录。
