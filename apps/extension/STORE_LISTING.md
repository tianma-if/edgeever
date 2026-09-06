# Chrome Web Store listing

## Product details

- Name: `EdgeEver Web Clipper`
- Primary language: `中文（简体）`
- Category: `Workflow & Planning`
- Homepage: `https://edgeever.org/`
- Support URL: `https://github.com/tianma-if/edgeever/issues`
- Privacy policy: `https://edgeever.org/privacy`

## Localized listings

- `中文（简体）`: Primary language
- `English`: Localized listing

Select the matching language in the Chrome Web Store developer dashboard and enter the corresponding copy below. Store listing localization is separate from the extension's packaged `_locales` messages.

## Upload files

- Package: `store-assets/edgeever-web-clipper-v0.1.5.zip`
- Store icon: `public/icons/icon-128.png`
- Screenshot: `store-assets/screenshot-options-1280x800.jpg`
- Small promo tile: `store-assets/promo-small-440x280.jpg`

### 中文（简体）

#### Summary

将当前网页或选中内容保存到你自托管的 EdgeEver 实例。

#### Detailed description

EdgeEver Web Clipper 可以把当前网页或你选中的内容保存到自托管的 EdgeEver 实例。

主要功能：

- 自动提取文章正文，并转换为便于搜索和编辑的 Markdown。
- 优先保存你在页面中选中的内容。
- 在笔记中保留原始标题、来源网址和剪藏时间。
- 可选择默认笔记本，并自动添加 `web-clip` 标签。
- 网页内容直接发送到你配置的 EdgeEver 实例，不经过开发者的中转服务器。

使用前，请在插件设置中填写 EdgeEver 实例地址和 API Token。插件只会在你点击“剪藏当前网页”后读取当前标签页，并仅向你授权的 EdgeEver 实例申请网络访问权限。

EdgeEver 是开源、自托管的现代笔记工作区。项目主页与源代码：https://github.com/tianma-if/edgeever

### English

#### Summary

Save the current webpage or selected content to your self-hosted EdgeEver instance.

#### Detailed description

EdgeEver Web Clipper saves the current webpage or selected content to your self-hosted EdgeEver instance.

Key features:

- Extract article content automatically and convert it to searchable, editable Markdown.
- Prefer content selected on the page when a selection is available.
- Preserve the original title, source URL, and clipping time in the note.
- Select a default notebook and add the `web-clip` tag automatically.
- Send webpage content directly to your configured EdgeEver instance without a developer-operated relay server.

Before using the extension, enter your EdgeEver instance URL and API token in the extension settings. The extension reads the current tab only after you click “Clip current page” and requests network access only for the EdgeEver instance you authorize.

EdgeEver is an open-source, self-hosted modern notes workspace. Project homepage and source code: https://github.com/tianma-if/edgeever

## Privacy practices

### Single purpose

Save the current webpage or user-selected content to the self-hosted EdgeEver instance explicitly configured by the user.

### Permission justifications

- `activeTab`: Read the active page only after the user clicks the extension's save action.
- `scripting`: Inject the packaged content extraction script into the active page after the user initiates a capture.
- `storage`: Store the user's EdgeEver instance URL, API token, and default notebook ID locally.
- Optional host permissions: Send API requests only to the EdgeEver instance origin configured and approved by the user.

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
