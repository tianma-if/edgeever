# EdgeEver 场景与实操指南

整理 EdgeEver 在日常工作、学习和知识管理中的核心场景与操作工作流。

## 目录

### 核心工作区与沉浸创作
- [1. 经典三栏工作区与沉浸排版写作](#1-经典三栏工作区与沉浸排版写作)

### 全渠道内容采集与剪藏
- [2. 微信聊天记录归档与整理](#2-微信聊天记录归档与整理)
- [3. 手机端剪藏微信公众号文章](#3-手机端剪藏微信公众号文章)
- [4. 移动端图片分享转存笔记](#4-移动端图片分享转存笔记)
- [5. 小红书图文笔记剪藏](#5-小红书图文笔记剪藏)
- [6. X (Twitter) 推文与引用剪藏](#6-x-twitter-推文与引用剪藏)
- [7. 知乎回答与文章剪藏](#7-知乎回答与文章剪藏)
- [8. Reddit 讨论帖剪藏](#8-reddit-讨论帖剪藏)

### AI 增强与多维数据组织
- [9. AI 对话生成思维导图、流程图与架构图](#9-ai-对话生成思维导图流程图与架构图)
- [10. AI 生成结构化信息图（时间线、对比矩阵、象限图等）](#10-ai-生成结构化信息图时间线对比矩阵象限图等)
- [11. AI 对话构建多维表格](#11-ai-对话构建多维表格)
- [12. 多维表格生成公开收集表单](#12-多维表格生成公开收集表单)
- [13. 连接本机 Agent (ACP) 实现笔记协同](#13-连接本机-agent-acp-实现笔记协同)

### 排版与多渠道分发
- [14. 笔记导出多主题长图与代码卡片](#14-笔记导出多主题长图与代码卡片)
- [15. 笔记制作社交媒体海报与封面](#15-笔记制作社交媒体海报与封面)
- [16. 复制笔记至微信公众号排版](#16-复制笔记至微信公众号排版)

### 开放生态与插件扩展
- [17. 开放插件 API 与自定义插件开发](#17-开放插件-api-与自定义插件开发)

---

## 核心工作区与沉浸创作

### 1. 经典三栏工作区与沉浸排版写作

EdgeEver 采用「目录树 · 笔记列表 · 编辑区」三栏布局：

- **专注模式**：侧边栏支持拖拽调宽与折叠，随时切换全屏专注写作。
- **混合编辑**：主编辑区支持所见即所得（WYSIWYG）与 Markdown 语法混写。

| 三栏工作区布局 |
:---:
| ![EdgeEver 经典三栏工作区与沉浸排版编辑效果](assets/best-practices/original-image/class-three-pane/image.png) |

---

## 全渠道内容采集与剪藏

### 2. 微信聊天记录归档与整理

在微信中多选对话点击「合并转发」，在「转发到其他应用」中选择 **EdgeEver**，自动转换为结构化笔记。

- **格式解析**：解析发言人、时间轴、微信表情与超链接。
- **资源转存**：图片内嵌展示，文档与音视频（如 `.xlsx`、`.pdf`、`.mp4`）转为附件并支持全文检索。

| 1. 微信合并转发至 EdgeEver | 2. 结构化笔记预览 |
| :---: | :---: |
| ![微信转发到其他应用选择 EdgeEver](assets/best-practices/original-image/wechat-chat-message-import/select-export.png) | ![EdgeEver 导入后的微信聊天记录笔记效果](assets/best-practices/original-image/wechat-chat-message-import/import-as-note.png) |

---

### 3. 手机端剪藏微信公众号文章

在微信中阅读文章时，点击右上角菜单选择「用 EdgeEver 打开」即可完成剪藏。

- 提取标题、正文结构与配图，转换为清晰的 Markdown 笔记。

| 1. 选择「用 EdgeEver 打开」 | 2. 内容提取中 | 3. 剪藏生成的 Markdown 笔记 |
| :---: | :---: | :---: |
| ![微信文章分享菜单选择用EdgeEver打开](assets/best-practices/original-image/app-share/wechat-article/share-enter.jpg) | ![EdgeEver正在剪藏文章提取中](assets/best-practices/original-image/app-share/wechat-article/sharing.jpg) | ![生成排版工整的微信文章笔记](assets/best-practices/original-image/app-share/wechat-article/in-note.jpg) |

---

### 4. 移动端图片分享转存笔记

在任意手机应用中通过系统分享面板选择 **EdgeEver**，后台自动上传原图并创建以「分享的图片」为标题的笔记。

| 1. 分享图片 | 2. 选择 EdgeEver | 3. 生成图片笔记 |
| :---: | :---: | :---: |
| ![社媒App点击图片分享](assets/best-practices/original-image/app-share/socia-image/share-enter.jpg) | ![系统分享面板选择EdgeEver](assets/best-practices/original-image/app-share/socia-image/sharing.jpg) | ![自动生成笔记并上传图片](assets/best-practices/original-image/app-share/socia-image/share-in-note.jpg) |

---

### 5. 小红书图文笔记剪藏

使用 EdgeEver Web Clipper 插件在小红书笔记页面右键点击「保存笔记到 EdgeEver」。

- 提取标题、话题标签、正文、发布时间与原文链接。
- 多图内容自动排版为多栏画廊。

| 1. 右键菜单剪藏 |
| :---: |
| ![右键保存小红书笔记到 EdgeEver](assets/best-practices/original-image/web-clipper/xiaohongshu/xiaohongshu.png) |

| 2. 多栏画廊笔记效果 |
| :---: |
| ![EdgeEver 剪藏后的小红书笔记多栏画廊效果](assets/best-practices/original-image/web-clipper/xiaohongshu/xiaohongshu-in-note.png) |

---

### 6. X (Twitter) 推文与引用剪藏

使用 EdgeEver Web Clipper 插件在推文上右键点击「保存推文到 EdgeEver」。

- 提取作者、推文正文、外链、引用推文（Quote Tweet）及附带图集。
- 自动渲染为多栏画廊排版。

| 1. 右键保存推文 |
| :---: |
| ![右键保存推文到 EdgeEver](assets/best-practices/original-image/web-clipper/twitter/twitter.png) |

| 2. 包含引用与图集的笔记效果 |
| :---: |
| ![EdgeEver 剪藏后的 X 推文笔记效果](assets/best-practices/original-image/web-clipper/twitter/twitter-in-note.png) |

---

### 7. 知乎回答与文章剪藏

在知乎目标回答或文章处右键点击「保存回答/文章到 EdgeEver」。

- 解析问题标题、作者、正文、发布时间与原始链接，生成问答结构笔记。

| 1. 右键保存回答/文章 |
| :---: |
| ![右键保存知乎回答到 EdgeEver](assets/best-practices/original-image/web-clipper/zhihu/zhihu.png) |

| 2. 问答结构笔记预览 |
| :---: |
| ![EdgeEver 剪藏后的知乎回答笔记效果](assets/best-practices/original-image/web-clipper/zhihu/zhihu-in-note.png) |

---

### 8. Reddit 讨论帖剪藏

在 Reddit 帖子处右键点击「保存所选内容到 EdgeEver」。

- 捕获帖子标题、所属版块（Subreddit，如 `r/AskReddit`）、作者、时间戳及链接，保留社区元数据。

| 1. 右键保存帖子 |
| :---: |
| ![右键保存 Reddit 帖子到 EdgeEver](assets/best-practices/original-image/web-clipper/reddit/reddit.png) |

| 2. 包含社区元数据的笔记预览 |
| :---: |
| ![EdgeEver 剪藏后的 Reddit 帖子笔记效果](assets/best-practices/original-image/web-clipper/reddit/reddit-in-note.png) |

---

## AI 增强与多维数据组织

### 9. AI 对话生成思维导图、流程图与架构图

在 AI 伴随助手（或连接的本地 Agent）中输入自然语言指令（如“帮我生成一个关于大语言模型的思维导图 / 流程图 / 架构图”），在笔记内直接生成可交互图表。

- 支持节点拖拽编辑、自动布局、条件分支与系统拓扑展示。

| 1. 交互式思维导图 |
| :---: |
| ![AI对话生成可编辑思维导图](assets/best-practices/original-image/ai-diagram/ai-mindmap.png) |

| 2. 标准流程图 |
| :---: |
| ![AI对话生成可编辑流程图](assets/best-practices/original-image/ai-diagram/ai-flowchart.png) |

| 3. 系统架构图 |
| :---: |
| ![AI对话生成可编辑系统架构图](assets/best-practices/original-image/ai-diagram/ai-architecture.png) |

---

### 10. AI 生成结构化信息图（时间线、对比矩阵、象限图等）

利用内置模板库，在 AI 助手对话中描述要呈现的主题与重点，快速生成结构化视觉笔记。

- 涵盖时间线、对比矩阵、四象限、层级图等模板。
- 支持对话微调内容，或直接导出为矢量图。

| 1. 技术演进路线信息图 |
| :---: |
| ![AI生成大模型技术演进路线信息图](assets/best-practices/original-image/ai-diagram/ai-infographic-ai-roadmap.png) |

| 2. 发展历程时间线信息图 |
| :---: |
| ![AI生成字节跳动发展历程时间线信息图](assets/best-practices/original-image/ai-diagram/ai-infographic-bytedance.png) |

---

### 11. AI 对话构建多维表格

在 AI 助手中发送自然语言指令（如“生成自媒体选题库”或“生成员工信息登记表”），自动搭建多维数据表。

- 自动配置单选标签、文本、日期、链接等字段类型。
- 自动填充初始示例数据，支持视图切换、筛选排序与 CSV 导出。

| 1. 选题库多维表格 |
| :---: |
| ![AI生成自媒体选题库多维表格](assets/best-practices/original-image/database-note/database-hot-select.png) |

| 2. 员工信息多维表格 |
| :---: |
| ![AI生成员工信息登记多维表格](assets/best-practices/original-image/database-note/database-employee-register.png) |

---

### 12. 多维表格生成公开收集表单

在多维表格顶部点击「表单收集」，将当前数据表转为公开在线表单。

- 填写者无需登录即可通过浏览器提交。
- 提交的数据实时同步写入对应多维表格。

| 1. 开启「表单收集」 | 2. 在线表单填报页面 |
| :---: | :---: |
| ![多维表格顶部点击表单收集按钮](assets/best-practices/original-image/database-note/database-form-create.png) | ![对外公开的在线表单填报界面](assets/best-practices/original-image/database-note/database-form-online.png) |

---

### 13. 连接本机 Agent (ACP) 实现笔记协同

EdgeEver 支持 **ACP (Agent Client Protocol)** 协议，允许桌面端连接本机运行的各类 AI Agent（如 Codex、Claude Code、DeepSeek Harness、Antigravity 等）。

- **本地授权**：授予本地 Agent 当前账号笔记的安全读写权限。
- **伴随对话**：在笔记右侧栏直接协同，执行代码推理、长文总结与知识库检索。

| 1. 设置中心连接本地 Agent (ACP) | 2. 笔记侧边栏协同交互 |
| :---: | :---: |
| ![设置中心连接本机 Agent (ACP) 列表](assets/best-practices/original-image/acp/acp-support-list.png) | ![右侧 AI 伴随助手与本机 Agent 协同问答](assets/best-practices/original-image/acp/acp-support-list-dialog.png) |

---

## 排版与多渠道分发

### 14. 笔记导出多主题长图与代码卡片

使用「分享为图片」功能，将笔记排版为高分辨率长图或卡片。

- **多款卡片样式**：内置 8 款卡片主题（透明质感、金句、书摘、备忘录等），支持字体与版式微调，一键导出高清长图或复制至剪贴板。
- **技术代码卡片**：专属代码主题内置 macOS 窗口控件、行号与等宽代码排版。

| 1. 「透明」等多款卡片主题预览 | 2. 字体风格与排版微调 |
| :---: | :---: |
| ![EdgeEver 分享为图片透明主题卡片预览](assets/best-practices/original-image/note-export-image/clear-theme.png) | ![EdgeEver 分享为图片字体与主题排版调整](assets/best-practices/original-image/note-export-image/code-theme.png) |

---

### 15. 笔记制作社交媒体海报与封面

在笔记操作菜单中选择「制作海报」（或通过「新建 → 海报」），将笔记标题与要点导入海报设计工作台。

- 提供 40+ 款设计模板，支持小红书 3:4、朋友圈 1:1 及横版等画幅。
- 画布中可自由调整排版、配色与装饰元素，支持导出高分辨率图片。

| 海报设计工作台与模板库 |
:---:
| ![EdgeEver 海报设计工作台与丰富设计模板](assets/best-practices/original-image/poster/ai-generate-poster.png) |

---

### 16. 复制笔记至微信公众号排版

在笔记菜单中选择「复制到公众号 / 博客」，将笔记转换为内联 CSS 样式的富文本。

- 粘贴至微信公众号后台，完整保留表格、引用块、代码块、列表及字体样式。

| 1. 复制到公众号 / 博客 |
| :---: |
| ![EdgeEver 笔记菜单点击复制到公众号](assets/best-practices/original-image/wechat-article-copy-to/right-menu.png) |

| 2. 公众号后台编辑器粘贴效果 |
| :---: |
| ![微信公众号后台粘贴后的排版效果](assets/best-practices/original-image/wechat-article-copy-to/show-in-wechat-editor.png) |

---

## 开放生态与插件扩展

### 17. 开放插件 API 与自定义插件开发

EdgeEver 内置插件扩展管理，支持通过 GitHub 仓库或 Manifest 地址一键安装，配置在 Web 与桌面端跨设备隔离同步。

- **核心 API 能力**：提供文档双向读写、自定义 DOM 面板/嵌入块、统一设置、隔离存储以及调用工作区已配置的 AI 模型。
- **官方开源参考范式**：
  - **待办任务 ([EdgeEver Tasks](https://github.com/tianma-if/edgeever-tasks))**：跨笔记自动汇总 Markdown 待办，支持状态过滤与一键定位跳转。
  - **AI RSS 订阅助手 ([EdgeEver AI RSS](https://github.com/tianma-if/edgeever-ai-rss))**：抓取订阅源并结合 AI 生成分类每日简报。
- 更多规范与指南详见 [EdgeEver 插件开发指南](plugin-development.zh-CN.md)。

| 1. 插件与主题管理中心 |
| :---: |
| ![EdgeEver 插件市场与官方插件管理](assets/best-practices/original-image/plugin/official-in.png) |

| 2. 插件 API 体系与开发文档 |
| :---: |
| ![EdgeEver 插件开发 API 命名空间与规范文档](assets/best-practices/original-image/plugin/plugin-api.png) |
