# Firefox Add-ons Submission

## Listing

- Name: EdgeEver Web Clipper
- Summary: Save a webpage, selected text, an image, an X post, a Reddit post, a Xiaohongshu note, a Zhihu answer or article, or a GitHub repository to your EdgeEver instance.
- Category: Bookmarks
- Homepage: https://edgeever.org
- Support: https://github.com/tianma-if/edgeever/issues
- Privacy policy: https://edgeever.org/en/privacy

## Description

EdgeEver Web Clipper saves the current webpage, selected text, a right-clicked image, an X post, a Reddit post, a Xiaohongshu note, a Zhihu answer or article, or a GitHub repository's address and description directly to the self-hosted EdgeEver instance you configure.

- Extract readable article content, or right-click selected text and save that passage only.
- Right-click an image and save that image file as a new note. From Google Search, the note records Google Search and the keyword.
- On X, right-click the post text and save the full post, including text behind Show more, plus photos already shown.
- On Xiaohongshu, right-click the note text and save the title, text, and photos. Comments are left out.
- On Zhihu, right-click the answer or article text and save the title, author, text, and photos. Comments are left out. On a feed or question page, the item under the pointer is saved.
- On Reddit, right-click a post and save its title, author, community, text, links, and images. Comments are left out.
- On a GitHub repository page or code tree, right-click the page background, the description, or the README text and save the repository address and description.
- These commands stay on the top-level right-click menu.
- Convert captured HTML to Markdown locally.
- Choose a default EdgeEver notebook.
- Send content directly to your instance without an EdgeEver-operated relay.
- No advertising, analytics, tracking, or telemetry.

Before using the extension, enter your EdgeEver instance URL and API token in the extension settings. The extension reads and sends page content only after you choose a clip or save command, including **Save Reddit post to EdgeEver**.

## Data collection and transmission

- `authenticationInfo`: the API token is sent only to the EdgeEver instance configured by the user.
- `browsingActivity`: the current page URL is included in the note created by the user.
- `websiteContent`: the selected text, extracted article body, or image file is included in the note created by the user.

The project maintainers do not receive or retain this data. Instance settings are stored in the browser's local extension storage.

## Reviewer notes

1. Open the extension settings.
2. Enter the provided review EdgeEver instance URL and API token.
3. Choose **Test connection**, select a notebook, and save.
4. Open a normal HTTP or HTTPS webpage.
5. Open the extension, choose **Clip current page**, and verify that the success message appears.
6. On a normal webpage, select a passage, right-click it, choose **Save selection to EdgeEver**, and verify the note contains that passage and the page link.
7. On a normal webpage, right-click an image, choose **Save image to EdgeEver**, and verify the new note contains the image.
8. Open one X post page, right-click the post text (not a photo), choose **Save post to EdgeEver**, and verify the note contains the post text and the post link.
9. Open one GitHub repository page, right-click the description or README text, choose **Save repository info to EdgeEver**, and verify the note contains the repository address and description.
10. Open one Xiaohongshu note, right-click the note text (not a photo), choose **Save note to EdgeEver**, and verify the note contains the title, text, and source link.
11. Open one Zhihu answer or article, right-click the text (not a photo), choose **Save answer or article to EdgeEver**, and verify the note contains the title, text, and source link.
12. Open one Reddit post, right-click the post text, choose **Save Reddit post to EdgeEver**, and verify the note contains the title, author, community, and source link without comments.
13. Verify the created notes in the review EdgeEver instance.

Restricted browser pages, extension stores, built-in PDF viewers, and other privileged pages cannot be captured.

## Reproducible build

Requirements:

- Bun 1.3.14 or later
- Node.js 20 or later, required by `web-ext`

Commands:

```sh
bun install --frozen-lockfile
bun run test:extension
bun run build:extension:firefox
bun run lint:extension:firefox
```

The reviewable source is the repository source before Vite bundling. Third-party packages are installed from the npm registry through the committed Bun lockfile.

## 中文商店说明

EdgeEver 网页剪藏插件可将当前网页、选中的文字、右键选中的图片、X 上的一条推文、Reddit 上的一条帖子、小红书上的一篇笔记，或知乎上的一篇回答或文章直接保存到用户配置的自托管 EdgeEver 实例。

- 提取适合阅读的文章正文。选中文字后右键，只保存这一段。
- 在图片上右键，把图片文件存成一条新笔记。从 Google 搜索保存时，笔记记录“Google 搜索”和关键词。
- 在 X 上右键推文正文。长文会先展开“显示更多”，再保存全文和已经显示的图片。
- 在小红书笔记正文上右键，保存标题、正文和图片。评论不会写入。
- 在知乎回答或文章正文上右键，保存标题、作者、正文和图片。评论不会写入。首页和问题页保存的是指针下的那一篇。
- 在 Reddit 帖子正文上右键，保存标题、作者、社区、正文、链接和图片，不写入评论。
- 这些命令直接出现在右键菜单的第一级。
- 在浏览器本地将 HTML 转换为 Markdown。
- 可选择默认 EdgeEver 笔记本。
- 数据直接发送到用户自己的实例，不经过 EdgeEver 中转服务。
- 不包含广告、分析、追踪或遥测。

使用前，请在插件设置中填写 EdgeEver 实例地址和 API Token。插件只会在用户选择剪藏或保存命令（包括“保存 Reddit 帖子到 EdgeEver”）后读取并发送网页内容。
