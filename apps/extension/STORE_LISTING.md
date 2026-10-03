# Chrome Web Store listing

## Product details

- Name: `EdgeEver Web Clipper`
- Primary language: `中文（简体）`
- Category: `Workflow & Planning`
- Homepage: `https://edgeever.org/`
- Support URL: `https://github.com/tianma-if/edgeever/issues`
- Privacy policy: `https://edgeever.org/privacy/`

## Localized listings

- `中文（简体）`: Primary language
- `English`: Localized listing

Select the matching language in the Chrome Web Store developer dashboard and enter the corresponding copy below. Store listing localization is separate from the extension's packaged `_locales` messages.

The detailed descriptions below are the 0.1.9 text resubmitted on 2026-10-02. An earlier draft stacked every site name in the opening sentence and repeated those names in the closing paragraph. Chrome Web Store rejected it immediately as excessive keywords (violation reference Yellow Argon). Keep each site in one feature line. The Japanese listing uses the English detailed description. The short summary still comes from the packaged `_locales` `extensionDescription`.

## Upload files

- Package: `store-assets/edgeever-web-clipper-v0.1.9.zip`
- Store icon: `public/icons/icon-128.png`
- Screenshot: `store-assets/screenshot-options-1280x800.jpg`
- Small promo tile: `store-assets/promo-small-440x280.jpg`

### 中文（简体）

#### Summary

将当前网页、选中文字、右键图片、X 推文、Reddit 帖子、小红书笔记、知乎回答或文章，或 GitHub 仓库保存到你自托管的 EdgeEver 实例。

#### Detailed description

EdgeEver Web Clipper 可以把当前网页，或你选中的那一部分，保存到自托管的 EdgeEver 实例。

主要功能：

- 自动提取文章正文，并转换为便于搜索和编辑的 Markdown。
- 选中一段文字后右键，选择“保存所选内容到 EdgeEver”，只保存这段文字。
- 在图片上右键，选择“保存图片到 EdgeEver”，把图片文件存成一条新笔记。
- 在 X 上右键推文，保存展开后的全文和已经显示的图片。
- 在小红书上保存笔记的标题、正文和图片，不写入评论。
- 在知乎上保存指针下的回答或文章，包括标题、作者、正文和图片，不写入评论。
- 在 Reddit 上右键帖子，保存标题、作者、社区、正文、链接和图片，不写入评论。
- 在 GitHub 仓库页上保存地址和简介；页面上有主页、语言、许可证和话题时一并写入。
- 这些命令直接出现在右键菜单的第一级。
- 笔记会保留来源和剪藏时间。
- 可选择默认笔记本，并自动添加 web-clip 标签。
- 内容只发送到你配置的 EdgeEver 实例。

使用前，请在插件设置中填写实例地址和 API Token。插件只会在你使用保存命令后读取当前标签页。图片若无法由页面直接交出，才会再请求该图片所在网站的访问权限。

EdgeEver 是开源、自托管的现代笔记工作区。项目主页与源代码：https://github.com/tianma-if/edgeever

### English

#### Summary

Save a webpage, selected text, a right-clicked image, an X post, a Reddit post, a Xiaohongshu note, a Zhihu answer or article, or a GitHub repository to your self-hosted EdgeEver.

#### Detailed description

EdgeEver Web Clipper saves the current page, or the part of it you choose, to your self-hosted EdgeEver instance.

Key features:

- Extract article content automatically and convert it to searchable, editable Markdown.
- Select text, right-click, and choose “Save selection to EdgeEver” to store that passage only.
- Right-click an image and choose “Save image to EdgeEver” to store the image file as a new note.
- On X, right-click the post and save the expanded text with the photos already shown.
- On Xiaohongshu, save the note title, text, and photos. Comments are left out.
- On Zhihu, save the answer or article under the pointer, including its title, author, text, and photos. Comments are left out.
- On Reddit, right-click a post to save its title, author, community, text, links, and images. Comments are left out.
- On a GitHub repository page, save the address and description, plus the homepage, language, license, and topics when the page shows them.
- These commands stay on the top-level right-click menu.
- The note keeps its source and the time it was clipped.
- Select a default notebook and add the web-clip tag automatically.
- The page is sent only to the EdgeEver instance you configure.

Before using the extension, enter your instance URL and API token in the extension settings. The extension reads the current tab only after you use a save command. It asks for access to an image's site only when that page cannot provide the image file.

EdgeEver is an open-source, self-hosted modern notes workspace. Project homepage and source code: https://github.com/tianma-if/edgeever

## Privacy practices

### Single purpose

Save the current webpage, user-selected text, a user-chosen image, one X post, one Reddit post, one Xiaohongshu note, one Zhihu answer or article, or one GitHub repository card to the self-hosted EdgeEver instance explicitly configured by the user.

### Permission justifications

- `activeTab`: Read the active page only after the user clicks the extension's save action or chooses a save command for selected text, an image, an X post, a Reddit post, a Xiaohongshu note, a Zhihu item, or a GitHub repository.
- `contextMenus`: Add one top-level item for the thing the user right-clicked: selected text, an image, an X post, a Reddit post, a Xiaohongshu note, a Zhihu answer or article, or a GitHub repository page. It runs only after the user selects that item.
- `scripting`: Inject the packaged capture script into the active page after the user initiates a capture.
- `storage`: Store the user's EdgeEver instance URL, API token, and default notebook ID locally.
- Optional host permissions: API calls go only to the EdgeEver instance the user approves. If a page cannot provide an image file, the extension asks for that image's site, or for all sites when the user chooses that option, and uses the access only to download the chosen image. Saving from an X or Xiaohongshu feed may ask for site access to identify the item under the pointer. On Zhihu and Reddit, a content script only remembers the item under the pointer. Its content is read after the user chooses the save command. If that listener is unavailable, the extension asks the user to right-click the same item again.

Each permission justification field accepts at most 1,000 characters. The host text above is the wording saved with the 0.1.9 draft.

### Data disclosures

The extension handles authentication information, website content, and web browsing activity. These data are used only for the user-triggered clipping feature. Page content is processed locally and sent directly to the user's configured EdgeEver instance. The developer does not receive or retain it.

- Data is not sold or transferred to third parties outside the approved use case.
- Data is not used for purposes unrelated to the extension's single purpose.
- Data is not used for creditworthiness or lending.
- No remote code is used.

## Distribution

- Visibility: Public
- Regions: All regions supported by the Chrome Web Store
- Defer publish: Off, unless a manual launch date is desired
