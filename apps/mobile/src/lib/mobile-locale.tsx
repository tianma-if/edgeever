import { DEFAULT_MEMO_TITLE, getMemoSaveErrorReasonKey } from "@edgeever/shared";
import { de, enUS, es, fr, ja, pl, ru, zhCN, zhTW } from "@edgeever/shared/i18n";
import { resolveSupportedLocale } from "@edgeever/shared/i18n/locales";
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  readMobileLocalePreference,
  writeMobileLocalePreference,
  type MobileLocalePreference,
} from "./preferences";

type SupportedMobileLocale = "zh-CN" | "zh-TW" | "en-US" | "es" | "de" | "fr" | "ja" | "pl" | "ru";
export type MobileLocale = SupportedMobileLocale;
type MobileLocaleContextValue = {
  preference: MobileLocalePreference;
  resolvedLocale: SupportedMobileLocale;
  setPreference: (preference: MobileLocalePreference) => void;
  translate: (value: string) => string;
};

type TranslationPair = { source: string; target: string; pattern?: RegExp; placeholders?: string[] };

const mobileOnlyTranslations = new Map<string, string>([
  ["确定", "OK"],
  ["好的", "OK"],
  ["登录", "Sign in"],
  ["删除失败", "Could not delete"],
  ["删除中", "Deleting"],
  ["恢复中", "Restoring"],
  ["恢复失败", "Could not restore"],
  ["创建失败", "Could not create"],
  ["请重试", "Please try again"],
  ["请检查网络后重试", "Check your network and try again"],
  ["当前无法连接实例，请稍后重试", "Cannot reach the instance right now. Try again later."],
  ["换个关键词再试", "Try a different keyword"],
  ["没有找到匹配笔记", "No matching notes"],
  ["重试加载", "Retry loading"],
  ["请先创建一个笔记本", "Create a notebook first"],
  ["附件上传失败", "Could not upload the attachment"],
  ["保存中", "Saving"],
  ["准备中", "Preparing"],
  ["本地草稿", "Local draft"],
  ["未保存", "Not saved"],
  ["缺少笔记数据，无法打开富文本编辑器", "The note data is missing, so the rich text editor cannot open."],
  ["笔记加载失败", "Could not load the note"],
  ["进入编辑并聚焦标题", "Starts editing and moves focus to the title"],
  ["编辑笔记标题", "Edit note title"],
  ["更改笔记所属笔记本", "Change the note's notebook"],
  ["选择历史记录后可预览并恢复。", "Select a version to preview and restore it."],
  ["当前无法读取附件。", "The attachment cannot be read right now."],
  ["当前无法读取资源。", "The resource cannot be read right now."],
  ["请等待笔记同步完成。", "Wait for the note to finish syncing."],
  ["资源读取失败", "Could not read the resource"],
  ["已取消下载", "Download canceled"],
  ["当前设备无法打开系统分享面板", "This device cannot open the system share sheet"],
  ["登录成功但服务端没有返回移动端会话。请确认服务端已更新到支持 App 登录的版本。", "Signed in, but the server did not return a mobile session. Make sure the server is updated to a version that supports app sign-in."],
  ["新建笔记本", "New notebook"],
  ["创建笔记本", "Create notebook"],
  ["笔记本名称", "Notebook name"],
  ["顶层笔记本", "Top level"],
  ["位于「{{name}}」下", "Under {{name}}"],
  ["暂无笔记本", "No notebooks"],
  ["先创建一个笔记本，再开始记录。", "Create a notebook to start taking notes."],
  ["创建笔记本失败，请重试", "Could not create the notebook. Try again."],
  ["连接尚未就绪", "Connection is not ready"],
  ["笔记本已创建", "Notebook created"],
  ["本机缓存更新失败，正在重新同步。", "The local cache could not update. Syncing again now."],
  ["本级暂无笔记", "No notes directly in this notebook"],
  ["无法保存“父笔记本中显示子笔记本笔记”设置，请稍后重试", "Could not save the \"Show notes from sub-notebooks\" setting. Please try again."],
  ["子笔记本中还有 {{count}} 条笔记。可以打开子笔记本查看，或在设置中开启“父笔记本中显示子笔记本笔记”。", "Its sub-notebooks still contain {{count}} notes. Open a sub-notebook to see them, or turn on \"Show notes from sub-notebooks\" in Settings."],
  ["返回", "Back"],
  ["关闭对话框", "Close dialog"],
  ["切换到深色模式", "Switch to dark mode"],
  ["切换到浅色模式", "Switch to light mode"],
  ["完成编辑", "Finish editing"],
  ["完成新建笔记", "Finish creating note"],
  ["Markdown 源代码编辑", "Edit Markdown source"],
  ["资源", "Resources"],
  ["笔记列表操作", "Note list actions"],
  ["搜索", "Search"],
  ["搜索标题、正文或标签", "Search titles, content, or tags"],
  ["输入关键词开始搜索", "Enter a keyword to search"],
  ["搜索本机同步缓存，结果会即时显示", "Search the local synced cache with instant results"],
  ["笔记操作", "Note actions"],
  ["AI 笔记助手", "AI note assistant"],
  ["版本历史", "Version history"],
  ["分享笔记", "Share note"],
  ["分享为图片", "Share as image"],
  ["选择笔记", "Select note"],
  ["复制笔记 ID", "Copy note ID"],
  ["同步后可复制笔记 ID", "Copy note ID after sync"],
  ["笔记 ID 已复制", "Note ID copied"],
  ["复制笔记 ID 失败", "Could not copy note ID"],
  ["分享失败", "Could not share"],
  ["无法创建分享链接，请检查网络后重试。", "Could not create a share link. Check your connection and try again."],
  ["同步冲突", "Sync conflict"],
  ["同步失败", "Sync failed"],
  ["待同步", "Pending sync"],
  ["已同步", "Synced"],
  ["立即同步", "Sync now"],
  ["查看同步状态并立即重试", "View sync status and retry now"],
  ["本地改动还在等待上传到云端。可立即重试同步。", "Local changes are waiting to upload. You can retry sync now."],
  ["本地改动未能上传到云端。可立即重试同步。", "Local changes could not upload. You can retry sync now."],
  ["本地改动未能上传到云端。内容仍保存在本机，可立即重试。", "Local changes could not upload. They remain on this device and you can retry now."],
  ["本地改动待上传。下拉刷新或点此可立即同步。", "Local changes are pending upload. Pull to refresh or tap to sync now."],
  ["查看并处理同步冲突", "Review and resolve the sync conflict"],
  ["云端笔记已在其他标签页、设备，或离线期间被更新，本地草稿无法直接覆盖。可先复制本地草稿，再采用云端版本后继续编辑。", "The cloud note was updated in another tab, on another device, or while you were offline. Copy your local draft, then use the cloud version before editing again."],
  ["云端笔记已在其他标签页、设备，或离线期间被更新。可先复制本地草稿，再采用云端版本后继续编辑。", "The cloud note was updated in another tab, on another device, or while you were offline. Copy your local draft, then use the cloud version before editing again."],
  ["查看历史", "View history"],
  ["使用云端版本", "Use cloud version"],
  ["采用云端并重新加载", "Use cloud and reload"],
  ["采用云端版本失败", "Could not use the cloud version"],
  ["复制本地草稿", "Copy local draft"],
  ["本地草稿已复制到剪贴板。", "Local draft copied to the clipboard."],
  ["没有可复制的本地草稿。", "There is no local draft to copy."],
  ["已复制", "Copied"],
  ["更多", "More"],
  ["加载失败", "Failed to load"],
  ["请稍后重试", "Please try again later"],
  ["重试", "Retry"],
  ["图片上传失败", "Image upload failed"],
  ["请检查网络连接后重试", "Check your connection and try again"],
  ["添加图片或附件", "Add image or attachment"],
  ["选择拍照、相册或设备文件", "Take a photo or choose from your library or device"],
  ["关闭图片来源选择", "Close image source picker"],
  ["拍照", "Take photo"],
  ["从相册选择", "Choose from library"],
  ["选择文件", "Choose file"],
  ["需要相机权限", "Camera access required"],
  ["允许 EdgeEver 使用相机后，才能直接拍照插入笔记。", "Allow EdgeEver to use the camera to take photos and insert them into notes."],
  ["相机权限已被关闭。请前往系统设置允许 EdgeEver 使用相机。", "Camera access is disabled. Open system settings and allow EdgeEver to use the camera."],
  ["前往设置", "Open settings"],
  ["系统未能恢复上次选择的图片，请重试", "The system could not restore the previously selected image. Please try again."],
  ["退出新建笔记？", "Exit the new note?"],
  ["内容已自动保存为本地草稿，下次新建时会继续恢复。", "The content is saved as a local draft and will be restored the next time you create a note."],
  ["继续编辑", "Keep editing"],
  ["放弃草稿", "Discard draft"],
  ["保留并退出", "Keep and exit"],
  ["丢弃本地变更？", "Discard local changes?"],
  ["此操作会移除这条待同步记录，不会修改服务端笔记。", "This removes the queued local change without modifying the server note."],
  ["丢弃", "Discard"],
  ["正在同步新笔记", "New note is syncing"],
  ["首次同步完成后即可上传本地图片；图片链接现在就可以直接粘贴到正文。", "Local images can be uploaded after the first sync. Image links can already be pasted into the note."],
  ["保存更改？", "Save changes?"],
  ["当前笔记有未保存修改。", "This note has unsaved changes."],
  ["放弃修改", "Discard changes"],
  ["无法打开资源", "Unable to open resource"],
  ["系统没有可用应用打开此链接。", "No installed app can open this link."],
  ["已删除笔记不能上传附件，请先恢复笔记", "Deleted notes cannot receive attachments. Restore the note first."],
  ["图片预览", "Image preview"],
  ["放大", "Zoom in"],
  ["缩小", "Zoom out"],
  ["上一张", "Previous image"],
  ["下一张", "Next image"],
  ["打开原文件", "Open original file"],
  ["密码已更新", "Password updated"],
  ["下次登录请使用新密码。", "Use the new password the next time you sign in."],
  ["编辑笔记", "Edit note"],
  ["所在笔记本", "Notebook"],
  ["笔记标题", "Note title"],
  ["笔记标签", "Note tags"],
  ["选择笔记本", "Choose notebook"],
  ["点选已有标签，或输入名称创建新标签", "Select existing tags or enter a name to create a new one"],
  ["按标签筛选", "Filter by tag"],
  ["选择一个标签，只查看带有该标签的笔记", "Choose a tag to view only notes with that tag"],
  ["搜索标签", "Search tags"],
  ["没有匹配的标签", "No matching tags"],
  ["搜索或输入新标签", "Search or enter a new tag"],
  ["没有匹配的现有标签，可直接新建", "No matching tags. You can create a new one."],
  ["新建", "Create"],
  ["{{count}} 条笔记", "{{count}} notes"],
  ["刷新 Token", "Refresh tokens"],
  ["Token 名称", "Token name"],
  ["没有正文预览", "No content preview"],
  ["原生运行时启动", "Native runtime startup"],
  ["启动至 JS 执行", "Launch to JavaScript execution"],
  ["启动至会话/缓存就绪", "Launch to session/cache ready"],
  ["启动至工作区首帧", "Launch to workspace first frame"],
  ["启动至列表数据就绪", "Launch to list data ready"],
  ["启动至交互空闲", "Launch to interaction idle"],
  ["最近一次本地编辑器启动", "Latest local editor startup"],
  ["正在启动编辑器", "Starting editor"],
  ["编辑器启动时间过长", "The editor is taking too long to start"],
  ["正在准备本地编辑器，笔记内容是安全的。", "Preparing the local editor. Your note is safe."],
  ["本地编辑器未能及时启动，可以重试或返回，当前草稿不会丢失。", "The local editor did not start in time. You can retry or go back; your current draft will not be lost."],
  ["暂不可用", "Unavailable"],
  ["尚未记录", "Not recorded"],
  ["正在搜索", "Searching"],
  ["退出搜索", "Exit search"],
  ["重置", "Reset"],
  ["置顶", "Pinned"],
  ["有标签", "Tagged"],
  ["无标签", "Untagged"],
  ["正在同步笔记", "Syncing your notes"],
  ["正在准备首次同步…", "Preparing your notes for the first sync…"],
  ["正在加载笔记", "Loading notes"],
  ["正在加载笔记本和笔记…", "Loading notebooks and notes…"],
  ["同步已暂停", "Sync paused"],
  ["已加载的笔记仍可使用，请检查网络后重试。", "Loaded notes remain available. Check your connection and retry."],
  ["已选择 {{count}} 条", "{{count}} selected"],
  ["{{count}} 条结果", "Results: {{count}}"],
  ["筛选：{{filter}} · {{count}} 条", "Filter: {{filter}} · {{count}} notes"],
  ["已加载 {{loaded}} / {{total}} 条笔记", "Loaded {{loaded}} of {{total}} notes"],
  ["从模板新建", "New from template"],
  ["模板", "Templates"],
  ["选择一个模板快速开始。所有模板都可以在网页端修改或删除。", "Choose a template to get started. Every template can be edited or deleted on the web."],
  ["模板暂时无法加载，请稍后重试。", "Templates could not load. Please try again later."],
  ["暂无模板。可在网页端新建模板，或将常用笔记另存为模板。", "No templates yet. Create one or save a note as a template on the web."],
  ["正在加载模板", "Loading templates"],
  ["新建笔记", "New note"],
  ["选择创建方式", "Choose how to create"],
  ["空白笔记", "Blank note"],
  ["从空白页开始记录", "Start with an empty page"],
  ["使用会议纪要、周报等预设结构", "Use meeting notes, weekly reviews, and more"],
  ["模板", "Template"],
  ["应用模板？", "Apply template?"],
  ["当前内容将被模板内容替换。", "The current content will be replaced by the template."],
  ["替换", "Replace"],
  ["关闭", "Close"],
  ["修改后会保留当前设备登录，并退出其他设备上的登录会话。", "Keeps this device signed in and signs out other sessions."],
  ["添加标签", "Add tags"],
  ["正在生成智能标签", "Generating smart tags"],
  ["智能标签生成失败", "Could not generate smart tags"],
  ["智能标签已添加", "Smart tags added"],
  ["没有找到适合这篇笔记的新标签。", "No new tags fit this note."],
  ["没有匹配的笔记本", "No matching notebooks"],
  ["偏好设置", "Preferences"],
  ["切换产品界面的显示语言。", "Choose the language used in the app."],
  ["上传大图时在本地压缩，节省资源占用。", "Compress large images on this device before upload."],
  ["已恢复上次未完成的本地草稿", "Restored your unfinished local draft"],
  ["连接你的自托管笔记空间", "Connect to your self-hosted notes"],
  ["首次登录密码", "Password for first sign-in"],
  ["GitHub 仓库", "GitHub repository"],
  ["操作失败，请稍后再试", "Something went wrong. Please try again."],
  ["正在剪藏文章", "Clipping article"],
  ["正在提取标题、正文和图片链接…", "Extracting the title, body, and image links…"],
  ["正文剪藏失败", "Article extraction failed"],
  ["已保留文章链接，你可以稍后重新分享重试。", "The article link was kept. Share it again later to retry."],
  ["页面加载完成，但没有找到可剪藏的正文。", "The page finished loading, but there was no article text to clip."],
  ["微信文章加载超时。", "The WeChat article took too long to load."],
  ["没有找到可剪藏的正文。", "No article text was found to clip."],
  ["无法解析微信文章正文。", "Could not read the WeChat article text."],
  ["微信文章加载失败。", "Could not load the WeChat article."],
  ["微信文章请求失败（HTTP {{status}}）。", "The WeChat article request failed (HTTP {{status}})."],
  ["无法读取分享图片", "Could not read the shared image"],
  ["请重新分享后再试。", "Share it again and retry."],
  ["无法保存图片", "Unable to save images"],
  ["请先在 EdgeEver 中创建一个笔记本。", "Create a notebook in EdgeEver first."],
  ["分享的图片", "Shared image"],
  ["分享的图片（{{count}} 张）", "Shared images ({{count}})"],
  ["无法读取分享内容", "Could not read the shared content"],
  ["分享内容里没有可识别的网页链接或图片。", "The shared content has no recognizable web link or image."],
  ["无法保存剪藏", "Unable to save clip"],
  ["剪藏失败", "Could not clip the page"],
  ["无法读取分享的网页，请稍后重试。", "Could not read the shared page. Try again later."],
  ["编辑笔记标题：{{title}}", "Edit note title: {{title}}"],
  ["新建标签 {{name}}", "Create tag {{name}}"],
  ["标签 {{name}}", "Tag {{name}}"],
  ["{{label}}，发现新版本", "{{label}}, update available"],
  ["附件读取不完整，请重新选择文件", "The attachment could not be read completely. Choose the file again."],
]);

const mobileOnlyZhTW = new Map<string, string>([
  ["确定", "確定"],
  ["好的", "好的"],
  ["登录", "登入"],
  ["删除失败", "刪除失敗"],
  ["删除中", "刪除中"],
  ["恢复中", "恢復中"],
  ["恢复失败", "恢復失敗"],
  ["创建失败", "建立失敗"],
  ["请重试", "請重試"],
  ["请检查网络后重试", "請檢查網路後重試"],
  ["当前无法连接实例，请稍后重试", "當前無法連線例項，請稍後重試"],
  ["换个关键词再试", "換個關鍵詞再試"],
  ["没有找到匹配笔记", "沒有找到匹配筆記"],
  ["重试加载", "重試載入"],
  ["请先创建一个笔记本", "請先建立一個筆記本"],
  ["附件上传失败", "附件上傳失敗"],
  ["保存中", "儲存中"],
  ["准备中", "準備中"],
  ["本地草稿", "本地草稿"],
  ["未保存", "未儲存"],
  ["缺少笔记数据，无法打开富文本编辑器", "缺少筆記資料，無法開啟富文字編輯器"],
  ["笔记加载失败", "筆記載入失敗"],
  ["进入编辑并聚焦标题", "進入編輯並聚焦標題"],
  ["编辑笔记标题", "編輯筆記標題"],
  ["更改笔记所属笔记本", "更改筆記所屬筆記本"],
  ["选择历史记录后可预览并恢复。", "選擇歷史記錄後可預覽並恢復。"],
  ["当前无法读取附件。", "當前無法讀取附件。"],
  ["当前无法读取资源。", "當前無法讀取資源。"],
  ["请等待笔记同步完成。", "請等待筆記同步完成。"],
  ["资源读取失败", "資源讀取失敗"],
  ["已取消下载", "已取消下載"],
  ["当前设备无法打开系统分享面板", "當前裝置無法開啟系統分享面板"],
  ["登录成功但服务端没有返回移动端会话。请确认服务端已更新到支持 App 登录的版本。", "登入成功但服務端沒有返回移動端會話。請確認服務端已更新到支援 App 登入的版本。"],
  ["新建笔记本", "新建筆記本"],
  ["创建笔记本", "建立筆記本"],
  ["笔记本名称", "筆記本名稱"],
  ["顶层笔记本", "頂層筆記本"],
  ["位于「{{name}}」下", "位於「{{name}}」下"],
  ["暂无笔记本", "暫無筆記本"],
  ["先创建一个笔记本，再开始记录。", "先建立一個筆記本，再開始記錄。"],
  ["创建笔记本失败，请重试", "建立筆記本失敗，請重試"],
  ["连接尚未就绪", "連線尚未就緒"],
  ["笔记本已创建", "筆記本已建立"],
  ["本机缓存更新失败，正在重新同步。", "本機快取更新失敗，正在重新同步。"],
  ["本级暂无笔记", "本級暫無筆記"],
  ["无法保存“父笔记本中显示子笔记本笔记”设置，请稍后重试", "無法儲存“父筆記本中顯示子筆記本筆記”設定，請稍後重試"],
  ["子笔记本中还有 {{count}} 条笔记。可以打开子笔记本查看，或在设置中开启“父笔记本中显示子笔记本笔记”。", "子筆記本中還有 {{count}} 條筆記。可以開啟子筆記本檢視，或在設定中開啟“父筆記本中顯示子筆記本筆記”。"],
  ["返回", "返回"],
  ["关闭对话框", "關閉對話方塊"],
  ["切换到深色模式", "切換到深色模式"],
  ["切换到浅色模式", "切換到淺色模式"],
  ["完成编辑", "完成編輯"],
  ["完成新建笔记", "完成新建筆記"],
  ["Markdown 源代码编辑", "Markdown 原始碼編輯"],
  ["资源", "資源"],
  ["笔记列表操作", "筆記列表操作"],
  ["搜索", "搜尋"],
  ["搜索标题、正文或标签", "搜尋標題、正文或標籤"],
  ["输入关键词开始搜索", "輸入關鍵詞開始搜尋"],
  ["搜索本机同步缓存，结果会即时显示", "搜尋本機同步快取，結果會即時顯示"],
  ["笔记操作", "筆記操作"],
  ["AI 笔记助手", "AI 筆記助手"],
  ["版本历史", "版本歷史"],
  ["分享笔记", "分享筆記"],
  ["分享为图片", "分享為圖片"],
  ["选择笔记", "選擇筆記"],
  ["复制笔记 ID", "複製筆記 ID"],
  ["同步后可复制笔记 ID", "同步後可複製筆記 ID"],
  ["笔记 ID 已复制", "筆記 ID 已複製"],
  ["复制笔记 ID 失败", "複製筆記 ID 失敗"],
  ["分享失败", "分享失敗"],
  ["无法创建分享链接，请检查网络后重试。", "無法建立分享連結，請檢查網路後重試。"],
  ["同步冲突", "同步衝突"],
  ["同步失败", "同步失敗"],
  ["待同步", "待同步"],
  ["已同步", "已同步"],
  ["立即同步", "立即同步"],
  ["查看同步状态并立即重试", "檢視同步狀態並立即重試"],
  ["本地改动还在等待上传到云端。可立即重试同步。", "本地改動還在等待上傳到雲端。可立即重試同步。"],
  ["本地改动未能上传到云端。可立即重试同步。", "本地改動未能上傳到雲端。可立即重試同步。"],
  ["本地改动未能上传到云端。内容仍保存在本机，可立即重试。", "本地改動未能上傳到雲端。內容仍儲存在本機，可立即重試。"],
  ["本地改动待上传。下拉刷新或点此可立即同步。", "本地改動待上傳。下拉重新整理或點此可立即同步。"],
  ["查看并处理同步冲突", "檢視並處理同步衝突"],
  ["云端笔记已在其他标签页、设备，或离线期间被更新，本地草稿无法直接覆盖。可先复制本地草稿，再采用云端版本后继续编辑。", "雲端筆記已在其他標籤頁、裝置，或離線期間被更新，本地草稿無法直接覆蓋。可先複製本地草稿，再採用雲端版本後繼續編輯。"],
  ["云端笔记已在其他标签页、设备，或离线期间被更新。可先复制本地草稿，再采用云端版本后继续编辑。", "雲端筆記已在其他標籤頁、裝置，或離線期間被更新。可先複製本地草稿，再採用雲端版本後繼續編輯。"],
  ["查看历史", "檢視歷史"],
  ["使用云端版本", "使用雲端版本"],
  ["采用云端并重新加载", "採用雲端並重新載入"],
  ["采用云端版本失败", "採用雲端版本失敗"],
  ["复制本地草稿", "複製本地草稿"],
  ["本地草稿已复制到剪贴板。", "本地草稿已複製到剪貼簿。"],
  ["没有可复制的本地草稿。", "沒有可複製的本地草稿。"],
  ["已复制", "已複製"],
  ["更多", "更多"],
  ["加载失败", "載入失敗"],
  ["请稍后重试", "請稍後重試"],
  ["重试", "重試"],
  ["图片上传失败", "圖片上傳失敗"],
  ["请检查网络连接后重试", "請檢查網路連線後重試"],
  ["添加图片或附件", "新增圖片或附件"],
  ["选择拍照、相册或设备文件", "選擇拍照、相簿或裝置檔案"],
  ["关闭图片来源选择", "關閉圖片來源選擇"],
  ["拍照", "拍照"],
  ["从相册选择", "從相簿選擇"],
  ["选择文件", "選擇檔案"],
  ["需要相机权限", "需要相機許可權"],
  ["允许 EdgeEver 使用相机后，才能直接拍照插入笔记。", "允許 EdgeEver 使用相機後，才能直接拍照插入筆記。"],
  ["相机权限已被关闭。请前往系统设置允许 EdgeEver 使用相机。", "相機許可權已被關閉。請前往系統設定允許 EdgeEver 使用相機。"],
  ["前往设置", "前往設定"],
  ["系统未能恢复上次选择的图片，请重试", "系統未能恢復上次選擇的圖片，請重試"],
  ["退出新建笔记？", "退出新建筆記？"],
  ["内容已自动保存为本地草稿，下次新建时会继续恢复。", "內容已自動儲存為本地草稿，下次新建時會繼續恢復。"],
  ["继续编辑", "繼續編輯"],
  ["放弃草稿", "放棄草稿"],
  ["保留并退出", "保留並退出"],
  ["丢弃本地变更？", "丟棄本地變更？"],
  ["此操作会移除这条待同步记录，不会修改服务端笔记。", "此操作會移除這條待同步記錄，不會修改服務端筆記。"],
  ["丢弃", "丟棄"],
  ["正在同步新笔记", "正在同步新筆記"],
  ["首次同步完成后即可上传本地图片；图片链接现在就可以直接粘贴到正文。", "首次同步完成後即可上傳本地圖片；圖片連結現在就可以直接貼上到正文。"],
  ["保存更改？", "儲存更改？"],
  ["当前笔记有未保存修改。", "當前筆記有未儲存修改。"],
  ["放弃修改", "放棄修改"],
  ["无法打开资源", "無法開啟資源"],
  ["系统没有可用应用打开此链接。", "系統沒有可用應用開啟此連結。"],
  ["已删除笔记不能上传附件，请先恢复笔记", "已刪除筆記不能上傳附件，請先恢復筆記"],
  ["图片预览", "圖片預覽"],
  ["放大", "放大"],
  ["缩小", "縮小"],
  ["上一张", "上一張"],
  ["下一张", "下一張"],
  ["打开原文件", "開啟原檔案"],
  ["密码已更新", "密碼已更新"],
  ["下次登录请使用新密码。", "下次登入請使用新密碼。"],
  ["编辑笔记", "編輯筆記"],
  ["所在笔记本", "所在筆記本"],
  ["笔记标题", "筆記標題"],
  ["笔记标签", "筆記標籤"],
  ["选择笔记本", "選擇筆記本"],
  ["点选已有标签，或输入名称创建新标签", "點選已有標籤，或輸入名稱建立新標籤"],
  ["按标签筛选", "按標籤篩選"],
  ["选择一个标签，只查看带有该标签的笔记", "選擇一個標籤，只檢視帶有該標籤的筆記"],
  ["搜索标签", "搜尋標籤"],
  ["没有匹配的标签", "沒有匹配的標籤"],
  ["搜索或输入新标签", "搜尋或輸入新標籤"],
  ["没有匹配的现有标签，可直接新建", "沒有匹配的現有標籤，可直接新建"],
  ["新建", "新建"],
  ["{{count}} 条笔记", "{{count}} 條筆記"],
  ["刷新 Token", "重新整理 Token"],
  ["Token 名称", "Token 名稱"],
  ["没有正文预览", "沒有正文預覽"],
  ["原生运行时启动", "原生執行時啟動"],
  ["启动至 JS 执行", "啟動至 JS 執行"],
  ["启动至会话/缓存就绪", "啟動至會話/快取就緒"],
  ["启动至工作区首帧", "啟動至工作區首幀"],
  ["启动至列表数据就绪", "啟動至列表資料就緒"],
  ["启动至交互空闲", "啟動至互動空閒"],
  ["最近一次本地编辑器启动", "最近一次本地編輯器啟動"],
  ["正在启动编辑器", "正在啟動編輯器"],
  ["编辑器启动时间过长", "編輯器啟動時間過長"],
  ["正在准备本地编辑器，笔记内容是安全的。", "正在準備本地編輯器，筆記內容是安全的。"],
  ["本地编辑器未能及时启动，可以重试或返回，当前草稿不会丢失。", "本地編輯器未能及時啟動，可以重試或返回，當前草稿不會丟失。"],
  ["暂不可用", "暫不可用"],
  ["尚未记录", "尚未記錄"],
  ["正在搜索", "正在搜尋"],
  ["退出搜索", "退出搜尋"],
  ["重置", "重置"],
  ["置顶", "置頂"],
  ["有标签", "有標籤"],
  ["无标签", "無標籤"],
  ["正在同步笔记", "正在同步筆記"],
  ["正在准备首次同步…", "正在準備首次同步…"],
  ["正在加载笔记", "正在載入筆記"],
  ["正在加载笔记本和笔记…", "正在載入筆記本和筆記…"],
  ["同步已暂停", "同步已暫停"],
  ["已加载的笔记仍可使用，请检查网络后重试。", "已載入的筆記仍可使用，請檢查網路後重試。"],
  ["已选择 {{count}} 条", "已選擇 {{count}} 條"],
  ["{{count}} 条结果", "{{count}} 條結果"],
  ["筛选：{{filter}} · {{count}} 条", "篩選：{{filter}} · {{count}} 條"],
  ["已加载 {{loaded}} / {{total}} 条笔记", "已載入 {{loaded}} / {{total}} 條筆記"],
  ["从模板新建", "從模板新建"],
  ["模板", "模板"],
  ["选择一个模板快速开始。所有模板都可以在网页端修改或删除。", "選擇一個模板快速開始。所有模板都可以在網頁端修改或刪除。"],
  ["模板暂时无法加载，请稍后重试。", "模板暫時無法載入，請稍後重試。"],
  ["暂无模板。可在网页端新建模板，或将常用笔记另存为模板。", "暫無模板。可在網頁端新建模板，或將常用筆記另存為模板。"],
  ["正在加载模板", "正在載入模板"],
  ["新建笔记", "新建筆記"],
  ["选择创建方式", "選擇建立方式"],
  ["空白笔记", "空白筆記"],
  ["从空白页开始记录", "從空白頁開始記錄"],
  ["使用会议纪要、周报等预设结构", "使用會議紀要、週報等預設結構"],
  ["模板", "模板"],
  ["应用模板？", "應用模板？"],
  ["当前内容将被模板内容替换。", "當前內容將被模板內容替換。"],
  ["替换", "替換"],
  ["关闭", "關閉"],
  ["修改后会保留当前设备登录，并退出其他设备上的登录会话。", "修改後會保留當前裝置登入，並退出其他裝置上的登入會話。"],
  ["添加标签", "新增標籤"],
  ["正在生成智能标签", "正在生成智慧標籤"],
  ["智能标签生成失败", "智慧標籤生成失敗"],
  ["智能标签已添加", "智慧標籤已新增"],
  ["没有找到适合这篇笔记的新标签。", "沒有找到適合這篇筆記的新標籤。"],
  ["没有匹配的笔记本", "沒有匹配的筆記本"],
  ["偏好设置", "偏好設定"],
  ["切换产品界面的显示语言。", "切換產品介面的顯示語言。"],
  ["上传大图时在本地压缩，节省资源占用。", "上傳大圖時在本地壓縮，節省資源佔用。"],
  ["已恢复上次未完成的本地草稿", "已恢復上次未完成的本地草稿"],
  ["连接你的自托管笔记空间", "連線你的自託管筆記空間"],
  ["首次登录密码", "首次登入密碼"],
  ["GitHub 仓库", "GitHub 倉庫"],
  ["操作失败，请稍后再试", "操作失敗，請稍後再試"],
  ["正在剪藏文章", "正在剪藏文章"],
  ["正在提取标题、正文和图片链接…", "正在提取標題、正文和圖片連結…"],
  ["正文剪藏失败", "正文剪藏失敗"],
  ["已保留文章链接，你可以稍后重新分享重试。", "已保留文章連結，你可以稍後重新分享重試。"],
  ["页面加载完成，但没有找到可剪藏的正文。", "頁面載入完成，但沒有找到可剪藏的正文。"],
  ["微信文章加载超时。", "微信文章載入超時。"],
  ["没有找到可剪藏的正文。", "沒有找到可剪藏的正文。"],
  ["无法解析微信文章正文。", "無法解析微信文章正文。"],
  ["微信文章加载失败。", "微信文章載入失敗。"],
  ["微信文章请求失败（HTTP {{status}}）。", "微信文章請求失敗（HTTP {{status}}）。"],
  ["无法读取分享图片", "無法讀取分享圖片"],
  ["请重新分享后再试。", "請重新分享後再試。"],
  ["无法保存图片", "無法儲存圖片"],
  ["请先在 EdgeEver 中创建一个笔记本。", "請先在 EdgeEver 中建立一個筆記本。"],
  ["分享的图片", "分享的圖片"],
  ["分享的图片（{{count}} 张）", "分享的圖片（{{count}} 張）"],
  ["无法读取分享内容", "無法讀取分享內容"],
  ["分享内容里没有可识别的网页链接或图片。", "分享內容裡沒有可識別的網頁連結或圖片。"],
  ["无法保存剪藏", "無法儲存剪藏"],
  ["剪藏失败", "剪藏失敗"],
  ["无法读取分享的网页，请稍后重试。", "無法讀取分享的網頁，請稍後重試。"],
  ["编辑笔记标题：{{title}}", "編輯筆記標題：{{title}}"],
  ["新建标签 {{name}}", "新建標籤 {{name}}"],
  ["标签 {{name}}", "標籤 {{name}}"],
  ["{{label}}，发现新版本", "{{label}}，發現新版本"],
  ["附件读取不完整，请重新选择文件", "附件讀取不完整，請重新選擇檔案"],
]);

const mobileOnlyJapanese = new Map<string, string>([
  ["确定", "OK"],
  ["好的", "OK"],
  ["登录", "ログイン"],
  ["删除失败", "削除できませんでした"],
  ["删除中", "削除しています"],
  ["恢复中", "復元しています"],
  ["恢复失败", "復元できませんでした"],
  ["创建失败", "作成できませんでした"],
  ["请重试", "再試行してください"],
  ["请检查网络后重试", "ネットワークを確認して再試行してください"],
  ["当前无法连接实例，请稍后重试", "現在インスタンスに接続できません。しばらくしてから再試行してください。"],
  ["换个关键词再试", "別のキーワードで試してください"],
  ["没有找到匹配笔记", "一致するノートはありません"],
  ["重试加载", "再読み込み"],
  ["请先创建一个笔记本", "先にノートブックを作成してください"],
  ["附件上传失败", "添付をアップロードできませんでした"],
  ["保存中", "保存しています"],
  ["准备中", "準備しています"],
  ["本地草稿", "ローカル下書き"],
  ["未保存", "未保存"],
  ["缺少笔记数据，无法打开富文本编辑器", "ノートのデータがないため、リッチテキストエディタを開けません。"],
  ["笔记加载失败", "ノートを読み込めませんでした"],
  ["进入编辑并聚焦标题", "編集を開始してタイトルにフォーカスします"],
  ["编辑笔记标题", "ノートのタイトルを編集"],
  ["更改笔记所属笔记本", "ノートのノートブックを変更"],
  ["选择历史记录后可预览并恢复。", "履歴を選ぶとプレビューして復元できます。"],
  ["当前无法读取附件。", "現在添付を読み込めません。"],
  ["当前无法读取资源。", "現在リソースを読み込めません。"],
  ["请等待笔记同步完成。", "ノートの同期が終わるまでお待ちください。"],
  ["资源读取失败", "リソースを読み込めませんでした"],
  ["已取消下载", "ダウンロードをキャンセルしました"],
  ["当前设备无法打开系统分享面板", "この端末ではシステムの共有シートを開けません"],
  ["登录成功但服务端没有返回移动端会话。请确认服务端已更新到支持 App 登录的版本。", "サインインしましたが、サーバーがモバイルセッションを返しませんでした。サーバーがアプリのサインインに対応したバージョンに更新されているか確認してください。"],
  ["新建笔记本", "新しいノートブック"],
  ["创建笔记本", "ノートブックを作成"],
  ["笔记本名称", "ノートブック名"],
  ["顶层笔记本", "最上位"],
  ["位于「{{name}}」下", "「{{name}}」の下"],
  ["暂无笔记本", "ノートブックがありません"],
  ["先创建一个笔记本，再开始记录。", "ノートブックを作成して記録を始めましょう。"],
  ["创建笔记本失败，请重试", "ノートブックを作成できませんでした。再試行してください。"],
  ["连接尚未就绪", "接続の準備ができていません"],
  ["笔记本已创建", "ノートブックを作成しました"],
  ["本机缓存更新失败，正在重新同步。", "端末のキャッシュを更新できませんでした。再同期しています。"],
  ["本级暂无笔记", "このノートブック直下にノートはありません"],
  ["无法保存“父笔记本中显示子笔记本笔记”设置，请稍后重试", "「サブノートブックのノートを表示」の設定を保存できませんでした。しばらくしてから再試行してください。"],
  ["子笔记本中还有 {{count}} 条笔记。可以打开子笔记本查看，或在设置中开启“父笔记本中显示子笔记本笔记”。", "サブノートブックにはまだ {{count}} 件のノートがあります。サブノートブックを開くか、設定で「サブノートブックのノートを表示」をオンにしてください。"],
  ["返回", "戻る"],
  ["关闭对话框", "ダイアログを閉じる"],
  ["切换到深色模式", "ダークモードに切り替え"],
  ["切换到浅色模式", "ライトモードに切り替え"],
  ["完成编辑", "編集を終える"],
  ["完成新建笔记", "ノート作成を終える"],
  ["Markdown 源代码编辑", "Markdown ソースを編集"],
  ["资源", "リソース"],
  ["笔记列表操作", "ノート一覧の操作"],
  ["搜索", "検索"],
  ["搜索标题、正文或标签", "タイトル、本文、タグを検索"],
  ["输入关键词开始搜索", "キーワードを入力して検索"],
  ["搜索本机同步缓存，结果会即时显示", "端末内の同期キャッシュを検索し、結果をすぐ表示します"],
  ["笔记操作", "ノート操作"],
  ["AI 笔记助手", "AI ノートアシスタント"],
  ["版本历史", "版履歴"],
  ["分享笔记", "ノートを共有"],
  ["分享为图片", "画像として共有"],
  ["选择笔记", "ノートを選択"],
  ["复制笔记 ID", "ノート ID をコピー"],
  ["同步后可复制笔记 ID", "同期後にノート ID をコピー"],
  ["笔记 ID 已复制", "ノート ID をコピーしました"],
  ["复制笔记 ID 失败", "ノート ID をコピーできませんでした"],
  ["分享失败", "共有できませんでした"],
  ["无法创建分享链接，请检查网络后重试。", "共有リンクを作成できませんでした。接続を確認して再試行してください。"],
  ["同步冲突", "同期の競合"],
  ["同步失败", "同期に失敗しました"],
  ["待同步", "同期待ち"],
  ["已同步", "同期済み"],
  ["立即同步", "今すぐ同期"],
  ["查看同步状态并立即重试", "同期状態を見て今すぐ再試行"],
  ["本地改动还在等待上传到云端。可立即重试同步。", "ローカルの変更はまだアップロード待ちです。今すぐ同期を再試行できます。"],
  ["本地改动未能上传到云端。可立即重试同步。", "ローカルの変更をアップロードできませんでした。今すぐ同期を再試行できます。"],
  ["本地改动未能上传到云端。内容仍保存在本机，可立即重试。", "ローカルの変更をアップロードできませんでした。内容は端末に残っており、今すぐ再試行できます。"],
  ["本地改动待上传。下拉刷新或点此可立即同步。", "ローカルの変更はアップロード待ちです。下に引くか、ここをタップして今すぐ同期できます。"],
  ["查看并处理同步冲突", "同期の競合を確認して解消"],
  ["云端笔记已在其他标签页、设备，或离线期间被更新，本地草稿无法直接覆盖。可先复制本地草稿，再采用云端版本后继续编辑。", "クラウド上のノートが他のタブ、他の端末、またはオフライン中に更新されたため、ローカル下書きで上書きできません。先に下書きをコピーし、クラウド版を採用してから編集を続けてください。"],
  ["云端笔记已在其他标签页、设备，或离线期间被更新。可先复制本地草稿，再采用云端版本后继续编辑。", "クラウド上のノートが他のタブ、他の端末、またはオフライン中に更新されました。先に下書きをコピーし、クラウド版を採用してから編集を続けてください。"],
  ["查看历史", "履歴を見る"],
  ["使用云端版本", "クラウド版を使う"],
  ["采用云端并重新加载", "クラウド版を使って再読み込み"],
  ["采用云端版本失败", "クラウド版を使えませんでした"],
  ["复制本地草稿", "ローカル下書きをコピー"],
  ["本地草稿已复制到剪贴板。", "ローカル下書きをクリップボードにコピーしました。"],
  ["没有可复制的本地草稿。", "コピーできるローカル下書きはありません。"],
  ["已复制", "コピーしました"],
  ["更多", "その他"],
  ["加载失败", "読み込めませんでした"],
  ["请稍后重试", "しばらくしてから再試行してください"],
  ["重试", "再試行"],
  ["图片上传失败", "画像のアップロードに失敗しました"],
  ["请检查网络连接后重试", "接続を確認して再試行してください"],
  ["添加图片或附件", "画像または添付を追加"],
  ["选择拍照、相册或设备文件", "撮影、ライブラリ、またはファイルから選ぶ"],
  ["关闭图片来源选择", "画像ソースの選択を閉じる"],
  ["拍照", "写真を撮る"],
  ["从相册选择", "ライブラリから選ぶ"],
  ["选择文件", "ファイルを選ぶ"],
  ["需要相机权限", "カメラの許可が必要です"],
  ["允许 EdgeEver 使用相机后，才能直接拍照插入笔记。", "カメラで撮影してノートに入れるには、EdgeEver のカメラ使用を許可してください。"],
  ["相机权限已被关闭。请前往系统设置允许 EdgeEver 使用相机。", "カメラの許可がオフです。システム設定で EdgeEver のカメラ使用を許可してください。"],
  ["前往设置", "設定を開く"],
  ["系统未能恢复上次选择的图片，请重试", "前回選んだ画像をシステムが復元できませんでした。再試行してください。"],
  ["退出新建笔记？", "新しいノートを閉じますか？"],
  ["内容已自动保存为本地草稿，下次新建时会继续恢复。", "内容はローカル下書きとして保存済みで、次に新規作成するときに復元されます。"],
  ["继续编辑", "編集を続ける"],
  ["放弃草稿", "下書きを捨てる"],
  ["保留并退出", "残して閉じる"],
  ["丢弃本地变更？", "ローカルの変更を捨てますか？"],
  ["此操作会移除这条待同步记录，不会修改服务端笔记。", "この操作は同期待ちの記録だけを消し、サーバー上のノートは変更しません。"],
  ["丢弃", "捨てる"],
  ["正在同步新笔记", "新しいノートを同期しています"],
  ["首次同步完成后即可上传本地图片；图片链接现在就可以直接粘贴到正文。", "初回同期のあとでローカル画像をアップロードできます。画像リンクは今すぐ本文に貼れます。"],
  ["保存更改？", "変更を保存しますか？"],
  ["当前笔记有未保存修改。", "このノートには未保存の変更があります。"],
  ["放弃修改", "変更を捨てる"],
  ["无法打开资源", "リソースを開けません"],
  ["系统没有可用应用打开此链接。", "このリンクを開けるアプリがありません。"],
  ["已删除笔记不能上传附件，请先恢复笔记", "削除済みノートには添付をアップロードできません。先に復元してください。"],
  ["图片预览", "画像プレビュー"],
  ["放大", "拡大"],
  ["缩小", "縮小"],
  ["上一张", "前の画像"],
  ["下一张", "次の画像"],
  ["打开原文件", "元のファイルを開く"],
  ["密码已更新", "パスワードを更新しました"],
  ["下次登录请使用新密码。", "次回のログインから新しいパスワードを使ってください。"],
  ["编辑笔记", "ノートを編集"],
  ["所在笔记本", "ノートブック"],
  ["笔记标题", "ノートのタイトル"],
  ["笔记标签", "ノートのタグ"],
  ["选择笔记本", "ノートブックを選ぶ"],
  ["点选已有标签，或输入名称创建新标签", "既存のタグを選ぶか、名前を入力して新規作成"],
  ["按标签筛选", "タグで絞り込み"],
  ["选择一个标签，只查看带有该标签的笔记", "タグを選ぶと、そのタグのノートだけを表示します"],
  ["搜索标签", "タグを検索"],
  ["没有匹配的标签", "一致するタグはありません"],
  ["搜索或输入新标签", "検索するか、新しいタグを入力"],
  ["没有匹配的现有标签，可直接新建", "一致する既存タグはありません。新規作成できます。"],
  ["新建", "作成"],
  ["{{count}} 条笔记", "{{count}} 件のノート"],
  ["刷新 Token", "トークンを更新"],
  ["Token 名称", "トークン名"],
  ["没有正文预览", "本文プレビューはありません"],
  ["原生运行时启动", "ネイティブ実行環境の起動"],
  ["启动至 JS 执行", "JS 実行までの起動"],
  ["启动至会话/缓存就绪", "セッション/キャッシュ準備までの起動"],
  ["启动至工作区首帧", "ワークスペース初回描画までの起動"],
  ["启动至列表数据就绪", "一覧データ準備までの起動"],
  ["启动至交互空闲", "操作可能になるまでの起動"],
  ["最近一次本地编辑器启动", "直近のローカルエディタ起動"],
  ["正在启动编辑器", "エディタを起動しています"],
  ["编辑器启动时间过长", "エディタの起動に時間がかかっています"],
  ["正在准备本地编辑器，笔记内容是安全的。", "ローカルエディタを準備しています。ノートの内容は失われません。"],
  ["本地编辑器未能及时启动，可以重试或返回，当前草稿不会丢失。", "ローカルエディタが時間内に起動しませんでした。再試行するか戻ってください。下書きは失われません。"],
  ["暂不可用", "利用できません"],
  ["尚未记录", "未記録"],
  ["正在搜索", "検索中"],
  ["退出搜索", "検索を終了"],
  ["重置", "リセット"],
  ["置顶", "ピン留め"],
  ["有标签", "タグあり"],
  ["无标签", "タグなし"],
  ["正在同步笔记", "ノートを同期しています"],
  ["正在准备首次同步…", "初回同期を準備しています…"],
  ["正在加载笔记", "ノートを読み込んでいます"],
  ["正在加载笔记本和笔记…", "ノートブックとノートを読み込んでいます…"],
  ["同步已暂停", "同期を一時停止しました"],
  ["已加载的笔记仍可使用，请检查网络后重试。", "読み込み済みのノートは使えます。接続を確認して再試行してください。"],
  ["已选择 {{count}} 条", "{{count}} 件を選択"],
  ["{{count}} 条结果", "結果: {{count}} 件"],
  ["筛选：{{filter}} · {{count}} 条", "絞り込み: {{filter}} · {{count}} 件"],
  ["已加载 {{loaded}} / {{total}} 条笔记", "{{loaded}} / {{total}} 件のノートを読み込み済み"],
  ["从模板新建", "テンプレートから作成"],
  ["模板", "テンプレート"],
  ["选择一个模板快速开始。所有模板都可以在网页端修改或删除。", "テンプレートを選んで始めます。テンプレートの編集と削除はウェブからできます。"],
  ["模板暂时无法加载，请稍后重试。", "テンプレートを読み込めませんでした。しばらくしてから再試行してください。"],
  ["暂无模板。可在网页端新建模板，或将常用笔记另存为模板。", "テンプレートはまだありません。ウェブで作成するか、よく使うノートをテンプレートとして保存できます。"],
  ["正在加载模板", "テンプレートを読み込んでいます"],
  ["新建笔记", "新しいノート"],
  ["选择创建方式", "作成方法を選ぶ"],
  ["空白笔记", "空白のノート"],
  ["从空白页开始记录", "空白のページから書き始める"],
  ["使用会议纪要、周报等预设结构", "会議メモや週報などの型を使う"],
  ["应用模板？", "テンプレートを適用しますか？"],
  ["当前内容将被模板内容替换。", "現在の内容はテンプレートの内容に置き換わります。"],
  ["替换", "置き換え"],
  ["关闭", "閉じる"],
  ["修改后会保留当前设备登录，并退出其他设备上的登录会话。", "この端末のログインは維持し、他の端末のセッションは終了します。"],
  ["添加标签", "タグを追加"],
  ["正在生成智能标签", "スマートタグを生成しています"],
  ["智能标签生成失败", "スマートタグを生成できませんでした"],
  ["智能标签已添加", "スマートタグを追加しました"],
  ["没有找到适合这篇笔记的新标签。", "このノートに合う新しいタグはありません。"],
  ["没有匹配的笔记本", "一致するノートブックはありません"],
  ["偏好设置", "環境設定"],
  ["切换产品界面的显示语言。", "アプリの表示言語を切り替えます。"],
  ["上传大图时在本地压缩，节省资源占用。", "大きな画像はアップロード前にこの端末で圧縮し、容量を抑えます。"],
  ["已恢复上次未完成的本地草稿", "前回の未完成の下書きを復元しました"],
  ["连接你的自托管笔记空间", "セルフホストのノートスペースに接続"],
  ["首次登录密码", "初回ログインのパスワード"],
  ["GitHub 仓库", "GitHub リポジトリ"],
  ["操作失败，请稍后再试", "操作に失敗しました。しばらくしてから再試行してください。"],
  ["正在剪藏文章", "記事を取り込んでいます"],
  ["正在提取标题、正文和图片链接…", "タイトル、本文、画像リンクを抽出しています…"],
  ["正文剪藏失败", "本文を取り込めませんでした"],
  ["已保留文章链接，你可以稍后重新分享重试。", "記事リンクは残してあります。あとから再共有してやり直せます。"],
  ["页面加载完成，但没有找到可剪藏的正文。", "ページの読み込みは終わりましたが、取り込める本文がありません。"],
  ["微信文章加载超时。", "WeChat 記事の読み込みがタイムアウトしました。"],
  ["没有找到可剪藏的正文。", "取り込める本文が見つかりません。"],
  ["无法解析微信文章正文。", "WeChat 記事の本文を読み取れませんでした。"],
  ["微信文章加载失败。", "WeChat 記事を読み込めませんでした。"],
  ["微信文章请求失败（HTTP {{status}}）。", "WeChat 記事のリクエストに失敗しました（HTTP {{status}}）。"],
  ["无法读取分享图片", "共有された画像を読み取れませんでした"],
  ["请重新分享后再试。", "もう一度共有してから再試行してください。"],
  ["无法保存图片", "画像を保存できませんでした"],
  ["请先在 EdgeEver 中创建一个笔记本。", "先に EdgeEver でノートブックを作成してください。"],
  ["分享的图片", "共有された画像"],
  ["分享的图片（{{count}} 张）", "共有された画像（{{count}} 枚）"],
  ["无法读取分享内容", "共有された内容を読み取れませんでした"],
  ["分享内容里没有可识别的网页链接或图片。", "共有された内容に、認識できるウェブリンクも画像もありません。"],
  ["无法保存剪藏", "クリップを保存できませんでした"],
  ["剪藏失败", "ページを取り込めませんでした"],
  ["无法读取分享的网页，请稍后重试。", "共有されたページを読み取れませんでした。しばらくしてから再試行してください。"],
  ["编辑笔记标题：{{title}}", "ノートのタイトルを編集: {{title}}"],
  ["新建标签 {{name}}", "タグ {{name}} を作成"],
  ["标签 {{name}}", "タグ {{name}}"],
  ["{{label}}，发现新版本", "{{label}}、アップデートがあります"],
  ["附件读取不完整，请重新选择文件", "添付ファイルを最後まで読み込めませんでした。ファイルを選び直してください。"],
]);

const mobileOnlyPolish = new Map<string, string>([
  ["确定", "OK"],
  ["好的", "OK"],
  ["登录", "Zaloguj się"],
  ["删除失败", "Nie udało się usunąć"],
  ["删除中", "Usuwanie"],
  ["恢复中", "Przywracanie"],
  ["恢复失败", "Nie udało się przywrócić"],
  ["创建失败", "Nie udało się utworzyć"],
  ["请重试", "Spróbuj ponownie"],
  ["请检查网络后重试", "Sprawdź sieć i spróbuj ponownie"],
  ["当前无法连接实例，请稍后重试", "Nie można teraz połączyć się z instancją. Spróbuj ponownie później."],
  ["换个关键词再试", "Spróbuj innego słowa kluczowego"],
  ["没有找到匹配笔记", "Brak pasujących notatek"],
  ["重试加载", "Wczytaj ponownie"],
  ["请先创建一个笔记本", "Najpierw utwórz notatnik"],
  ["附件上传失败", "Nie udało się przesłać załącznika"],
  ["保存中", "Zapisywanie"],
  ["准备中", "Przygotowywanie"],
  ["本地草稿", "Wersja robocza na urządzeniu"],
  ["未保存", "Nie zapisano"],
  ["缺少笔记数据，无法打开富文本编辑器", "Brak danych notatki, więc nie można otworzyć edytora tekstu sformatowanego."],
  ["笔记加载失败", "Nie udało się wczytać notatki"],
  ["进入编辑并聚焦标题", "Rozpoczyna edycję i przenosi fokus na tytuł"],
  ["编辑笔记标题", "Edytuj tytuł notatki"],
  ["更改笔记所属笔记本", "Zmień notatnik tej notatki"],
  ["选择历史记录后可预览并恢复。", "Wybierz wersję, aby ją podejrzeć i przywrócić."],
  ["当前无法读取附件。", "Nie można teraz odczytać załącznika."],
  ["当前无法读取资源。", "Nie można teraz odczytać zasobu."],
  ["请等待笔记同步完成。", "Poczekaj na zakończenie synchronizacji notatki."],
  ["资源读取失败", "Nie udało się odczytać zasobu"],
  ["已取消下载", "Pobieranie anulowane"],
  ["当前设备无法打开系统分享面板", "Na tym urządzeniu nie można otworzyć systemowego okna udostępniania"],
  ["登录成功但服务端没有返回移动端会话。请确认服务端已更新到支持 App 登录的版本。", "Zalogowano, ale serwer nie zwrócił sesji mobilnej. Upewnij się, że serwer jest zaktualizowany do wersji obsługującej logowanie w aplikacji."],
  ["新建笔记本", "Nowy notatnik"],
  ["创建笔记本", "Utwórz notatnik"],
  ["笔记本名称", "Nazwa notatnika"],
  ["顶层笔记本", "Najwyższy poziom"],
  ["位于「{{name}}」下", "W notatniku „{{name}}”"],
  ["暂无笔记本", "Brak notatników"],
  ["先创建一个笔记本，再开始记录。", "Utwórz notatnik, aby zacząć robić notatki."],
  ["创建笔记本失败，请重试", "Nie udało się utworzyć notatnika. Spróbuj ponownie."],
  ["连接尚未就绪", "Połączenie nie jest jeszcze gotowe"],
  ["笔记本已创建", "Notatnik utworzony"],
  ["本机缓存更新失败，正在重新同步。", "Nie udało się zaktualizować lokalnej pamięci podręcznej. Trwa ponowna synchronizacja."],
  ["本级暂无笔记", "Brak notatek bezpośrednio w tym notatniku"],
  ["无法保存“父笔记本中显示子笔记本笔记”设置，请稍后重试", "Nie udało się zapisać ustawienia „Pokazuj notatki z podnotatników”. Spróbuj ponownie później."],
  ["子笔记本中还有 {{count}} 条笔记。可以打开子笔记本查看，或在设置中开启“父笔记本中显示子笔记本笔记”。", "Notatki w podnotatnikach: {{count}}. Otwórz podnotatnik, aby je zobaczyć, lub włącz w ustawieniach opcję „Pokazuj notatki z podnotatników”."],
  ["返回", "Wstecz"],
  ["关闭对话框", "Zamknij okno"],
  ["切换到深色模式", "Przełącz na ciemny motyw"],
  ["切换到浅色模式", "Przełącz na jasny motyw"],
  ["完成编辑", "Zakończ edycję"],
  ["完成新建笔记", "Zakończ tworzenie notatki"],
  ["Markdown 源代码编辑", "Edytuj źródło Markdown"],
  ["资源", "Zasoby"],
  ["笔记列表操作", "Działania na liście notatek"],
  ["搜索", "Szukaj"],
  ["搜索标题、正文或标签", "Szukaj w tytułach, treści lub tagach"],
  ["输入关键词开始搜索", "Wpisz słowo kluczowe, aby wyszukać"],
  ["搜索本机同步缓存，结果会即时显示", "Przeszukuj lokalną kopię zsynchronizowanych notatek z natychmiastowymi wynikami"],
  ["笔记操作", "Działania na notatce"],
  ["AI 笔记助手", "Asystent AI notatek"],
  ["版本历史", "Historia wersji"],
  ["分享笔记", "Udostępnij notatkę"],
  ["分享为图片", "Udostępnij jako obraz"],
  ["选择笔记", "Wybierz notatkę"],
  ["复制笔记 ID", "Kopiuj ID notatki"],
  ["同步后可复制笔记 ID", "ID notatki można skopiować po synchronizacji"],
  ["笔记 ID 已复制", "Skopiowano ID notatki"],
  ["复制笔记 ID 失败", "Nie udało się skopiować ID notatki"],
  ["分享失败", "Nie udało się udostępnić"],
  ["无法创建分享链接，请检查网络后重试。", "Nie udało się utworzyć linku udostępniania. Sprawdź połączenie i spróbuj ponownie."],
  ["同步冲突", "Konflikt synchronizacji"],
  ["同步失败", "Synchronizacja nie powiodła się"],
  ["待同步", "Oczekuje na synchronizację"],
  ["已同步", "Zsynchronizowano"],
  ["立即同步", "Synchronizuj teraz"],
  ["查看同步状态并立即重试", "Zobacz stan synchronizacji i spróbuj ponownie"],
  ["本地改动还在等待上传到云端。可立即重试同步。", "Lokalne zmiany czekają na przesłanie. Możesz teraz ponowić synchronizację."],
  ["本地改动未能上传到云端。可立即重试同步。", "Nie udało się przesłać lokalnych zmian. Możesz teraz ponowić synchronizację."],
  ["本地改动未能上传到云端。内容仍保存在本机，可立即重试。", "Nie udało się przesłać lokalnych zmian. Pozostają na tym urządzeniu i możesz teraz spróbować ponownie."],
  ["本地改动待上传。下拉刷新或点此可立即同步。", "Lokalne zmiany czekają na przesłanie. Przeciągnij w dół lub dotknij, aby zsynchronizować teraz."],
  ["查看并处理同步冲突", "Przejrzyj i rozwiąż konflikt synchronizacji"],
  ["云端笔记已在其他标签页、设备，或离线期间被更新，本地草稿无法直接覆盖。可先复制本地草稿，再采用云端版本后继续编辑。", "Notatka w chmurze została zmieniona w innej karcie, na innym urządzeniu lub gdy byłeś offline, więc lokalny szkic nie może jej nadpisać. Skopiuj lokalny szkic, a potem użyj wersji z chmury i kontynuuj edycję."],
  ["云端笔记已在其他标签页、设备，或离线期间被更新。可先复制本地草稿，再采用云端版本后继续编辑。", "Notatka w chmurze została zmieniona w innej karcie, na innym urządzeniu lub gdy byłeś offline. Skopiuj lokalny szkic, a potem użyj wersji z chmury i kontynuuj edycję."],
  ["查看历史", "Zobacz historię"],
  ["使用云端版本", "Użyj wersji z chmury"],
  ["采用云端并重新加载", "Użyj wersji z chmury i wczytaj ponownie"],
  ["采用云端版本失败", "Nie udało się użyć wersji z chmury"],
  ["复制本地草稿", "Kopiuj lokalny szkic"],
  ["本地草稿已复制到剪贴板。", "Skopiowano lokalny szkic do schowka."],
  ["没有可复制的本地草稿。", "Brak lokalnego szkicu do skopiowania."],
  ["已复制", "Skopiowano"],
  ["更多", "Więcej"],
  ["加载失败", "Nie udało się wczytać"],
  ["请稍后重试", "Spróbuj ponownie później"],
  ["重试", "Spróbuj ponownie"],
  ["图片上传失败", "Nie udało się przesłać obrazu"],
  ["请检查网络连接后重试", "Sprawdź połączenie i spróbuj ponownie"],
  ["添加图片或附件", "Dodaj obraz lub załącznik"],
  ["选择拍照、相册或设备文件", "Zrób zdjęcie lub wybierz z galerii albo z plików urządzenia"],
  ["关闭图片来源选择", "Zamknij wybór źródła obrazu"],
  ["拍照", "Zrób zdjęcie"],
  ["从相册选择", "Wybierz z galerii"],
  ["选择文件", "Wybierz plik"],
  ["需要相机权限", "Wymagany dostęp do aparatu"],
  ["允许 EdgeEver 使用相机后，才能直接拍照插入笔记。", "Zezwól EdgeEver na używanie aparatu, aby robić zdjęcia i wstawiać je do notatek."],
  ["相机权限已被关闭。请前往系统设置允许 EdgeEver 使用相机。", "Dostęp do aparatu jest wyłączony. Otwórz ustawienia systemu i zezwól EdgeEver na używanie aparatu."],
  ["前往设置", "Otwórz ustawienia"],
  ["系统未能恢复上次选择的图片，请重试", "System nie mógł przywrócić ostatnio wybranego obrazu. Spróbuj ponownie."],
  ["退出新建笔记？", "Zamknąć nową notatkę?"],
  ["内容已自动保存为本地草稿，下次新建时会继续恢复。", "Treść zapisano jako lokalny szkic. Zostanie przywrócona przy następnym tworzeniu notatki."],
  ["继续编辑", "Kontynuuj edycję"],
  ["放弃草稿", "Odrzuć szkic"],
  ["保留并退出", "Zachowaj i zamknij"],
  ["丢弃本地变更？", "Odrzucić lokalne zmiany?"],
  ["此操作会移除这条待同步记录，不会修改服务端笔记。", "Usuwa to oczekującą lokalną zmianę bez modyfikowania notatki na serwerze."],
  ["丢弃", "Odrzuć"],
  ["正在同步新笔记", "Trwa synchronizacja nowej notatki"],
  ["首次同步完成后即可上传本地图片；图片链接现在就可以直接粘贴到正文。", "Lokalne obrazy można przesłać po pierwszej synchronizacji. Linki do obrazów możesz wkleić do treści już teraz."],
  ["保存更改？", "Zapisać zmiany?"],
  ["当前笔记有未保存修改。", "Ta notatka ma niezapisane zmiany."],
  ["放弃修改", "Odrzuć zmiany"],
  ["无法打开资源", "Nie można otworzyć zasobu"],
  ["系统没有可用应用打开此链接。", "Żadna zainstalowana aplikacja nie może otworzyć tego linku."],
  ["已删除笔记不能上传附件，请先恢复笔记", "Do usuniętej notatki nie można przesyłać załączników. Najpierw ją przywróć."],
  ["图片预览", "Podgląd obrazu"],
  ["放大", "Powiększ"],
  ["缩小", "Pomniejsz"],
  ["上一张", "Poprzedni obraz"],
  ["下一张", "Następny obraz"],
  ["打开原文件", "Otwórz oryginalny plik"],
  ["密码已更新", "Zaktualizowano hasło"],
  ["下次登录请使用新密码。", "Przy następnym logowaniu użyj nowego hasła."],
  ["编辑笔记", "Edytuj notatkę"],
  ["所在笔记本", "Notatnik"],
  ["笔记标题", "Tytuł notatki"],
  ["笔记标签", "Tagi notatki"],
  ["选择笔记本", "Wybierz notatnik"],
  ["点选已有标签，或输入名称创建新标签", "Wybierz istniejące tagi lub wpisz nazwę, aby utworzyć nowy"],
  ["按标签筛选", "Filtruj według tagu"],
  ["选择一个标签，只查看带有该标签的笔记", "Wybierz tag, aby zobaczyć tylko notatki z tym tagiem"],
  ["搜索标签", "Szukaj tagów"],
  ["没有匹配的标签", "Brak pasujących tagów"],
  ["搜索或输入新标签", "Szukaj lub wpisz nowy tag"],
  ["没有匹配的现有标签，可直接新建", "Brak pasujących tagów. Możesz utworzyć nowy."],
  ["新建", "Utwórz"],
  ["{{count}} 条笔记", "Notatki: {{count}}"],
  ["刷新 Token", "Odśwież tokeny"],
  ["Token 名称", "Nazwa tokenu"],
  ["没有正文预览", "Brak podglądu treści"],
  ["原生运行时启动", "Uruchamianie natywnego środowiska"],
  ["启动至 JS 执行", "Od uruchomienia do wykonania JavaScript"],
  ["启动至会话/缓存就绪", "Od uruchomienia do gotowości sesji/pamięci podręcznej"],
  ["启动至工作区首帧", "Od uruchomienia do pierwszej klatki obszaru roboczego"],
  ["启动至列表数据就绪", "Od uruchomienia do gotowości danych listy"],
  ["启动至交互空闲", "Od uruchomienia do gotowości na interakcję"],
  ["最近一次本地编辑器启动", "Ostatnie uruchomienie lokalnego edytora"],
  ["正在启动编辑器", "Uruchamianie edytora"],
  ["编辑器启动时间过长", "Uruchamianie edytora trwa zbyt długo"],
  ["正在准备本地编辑器，笔记内容是安全的。", "Przygotowywanie lokalnego edytora. Twoja notatka jest bezpieczna."],
  ["本地编辑器未能及时启动，可以重试或返回，当前草稿不会丢失。", "Lokalny edytor nie uruchomił się na czas. Spróbuj ponownie lub wróć – bieżący szkic nie zostanie utracony."],
  ["暂不可用", "Niedostępne"],
  ["尚未记录", "Nie zarejestrowano"],
  ["正在搜索", "Wyszukiwanie"],
  ["退出搜索", "Zamknij wyszukiwanie"],
  ["重置", "Resetuj"],
  ["置顶", "Przypięte"],
  ["有标签", "Z tagami"],
  ["无标签", "Bez tagów"],
  ["正在同步笔记", "Synchronizowanie notatek"],
  ["正在准备首次同步…", "Przygotowywanie pierwszej synchronizacji…"],
  ["正在加载笔记", "Wczytywanie notatek"],
  ["正在加载笔记本和笔记…", "Wczytywanie notatników i notatek…"],
  ["同步已暂停", "Synchronizacja wstrzymana"],
  ["已加载的笔记仍可使用，请检查网络后重试。", "Wczytane notatki są nadal dostępne. Sprawdź połączenie i spróbuj ponownie."],
  ["已选择 {{count}} 条", "Zaznaczono: {{count}}"],
  ["{{count}} 条结果", "Wyniki: {{count}}"],
  ["筛选：{{filter}} · {{count}} 条", "Filtr: {{filter}} · notatki: {{count}}"],
  ["已加载 {{loaded}} / {{total}} 条笔记", "Wczytane notatki: {{loaded}} z {{total}}"],
  ["从模板新建", "Nowa z szablonu"],
  ["模板", "Szablony"],
  ["选择一个模板快速开始。所有模板都可以在网页端修改或删除。", "Wybierz szablon, aby szybko zacząć. Każdy szablon można edytować lub usunąć w wersji webowej."],
  ["模板暂时无法加载，请稍后重试。", "Nie udało się wczytać szablonów. Spróbuj ponownie później."],
  ["暂无模板。可在网页端新建模板，或将常用笔记另存为模板。", "Brak szablonów. Utwórz szablon w wersji webowej lub zapisz notatkę jako szablon."],
  ["正在加载模板", "Wczytywanie szablonów"],
  ["新建笔记", "Nowa notatka"],
  ["选择创建方式", "Wybierz sposób tworzenia"],
  ["空白笔记", "Pusta notatka"],
  ["从空白页开始记录", "Zacznij od pustej strony"],
  ["使用会议纪要、周报等预设结构", "Użyj gotowych struktur, np. notatek ze spotkań czy podsumowań tygodnia"],
  ["应用模板？", "Zastosować szablon?"],
  ["当前内容将被模板内容替换。", "Bieżąca treść zostanie zastąpiona treścią szablonu."],
  ["替换", "Zastąp"],
  ["关闭", "Zamknij"],
  ["修改后会保留当前设备登录，并退出其他设备上的登录会话。", "To urządzenie pozostanie zalogowane, a pozostałe sesje zostaną wylogowane."],
  ["添加标签", "Dodaj tagi"],
  ["正在生成智能标签", "Generowanie inteligentnych tagów"],
  ["智能标签生成失败", "Nie udało się wygenerować inteligentnych tagów"],
  ["智能标签已添加", "Dodano inteligentne tagi"],
  ["没有找到适合这篇笔记的新标签。", "Brak nowych tagów pasujących do tej notatki."],
  ["没有匹配的笔记本", "Brak pasujących notatników"],
  ["偏好设置", "Preferencje"],
  ["切换产品界面的显示语言。", "Wybierz język interfejsu aplikacji."],
  ["上传大图时在本地压缩，节省资源占用。", "Kompresuj duże obrazy na tym urządzeniu przed przesłaniem."],
  ["已恢复上次未完成的本地草稿", "Przywrócono niedokończony lokalny szkic"],
  ["连接你的自托管笔记空间", "Połącz się ze swoimi samodzielnie hostowanymi notatkami"],
  ["首次登录密码", "Hasło do pierwszego logowania"],
  ["GitHub 仓库", "Repozytorium GitHub"],
  ["操作失败，请稍后再试", "Coś poszło nie tak. Spróbuj ponownie."],
  ["正在剪藏文章", "Zapisywanie artykułu"],
  ["正在提取标题、正文和图片链接…", "Wyodrębnianie tytułu, treści i linków do obrazów…"],
  ["正文剪藏失败", "Nie udało się wyodrębnić treści artykułu"],
  ["已保留文章链接，你可以稍后重新分享重试。", "Link do artykułu został zachowany. Udostępnij go ponownie później, aby spróbować jeszcze raz."],
  ["页面加载完成，但没有找到可剪藏的正文。", "Strona się wczytała, ale nie znaleziono treści artykułu do zapisania."],
  ["微信文章加载超时。", "Wczytywanie artykułu WeChat trwało zbyt długo."],
  ["没有找到可剪藏的正文。", "Nie znaleziono treści artykułu do zapisania."],
  ["无法解析微信文章正文。", "Nie udało się odczytać treści artykułu WeChat."],
  ["微信文章加载失败。", "Nie udało się wczytać artykułu WeChat."],
  ["微信文章请求失败（HTTP {{status}}）。", "Żądanie artykułu WeChat nie powiodło się (HTTP {{status}})."],
  ["无法读取分享图片", "Nie udało się odczytać udostępnionego obrazu"],
  ["请重新分享后再试。", "Udostępnij ponownie i spróbuj jeszcze raz."],
  ["无法保存图片", "Nie można zapisać obrazów"],
  ["请先在 EdgeEver 中创建一个笔记本。", "Najpierw utwórz notatnik w EdgeEver."],
  ["分享的图片", "Udostępniony obraz"],
  ["分享的图片（{{count}} 张）", "Udostępnione obrazy ({{count}})"],
  ["无法读取分享内容", "Nie udało się odczytać udostępnionej treści"],
  ["分享内容里没有可识别的网页链接或图片。", "Udostępniona treść nie zawiera rozpoznawalnego linku ani obrazu."],
  ["无法保存剪藏", "Nie można zapisać wycinka"],
  ["剪藏失败", "Nie udało się zapisać strony"],
  ["无法读取分享的网页，请稍后重试。", "Nie udało się odczytać udostępnionej strony. Spróbuj ponownie później."],
  ["编辑笔记标题：{{title}}", "Edytuj tytuł notatki: {{title}}"],
  ["新建标签 {{name}}", "Utwórz tag {{name}}"],
  ["标签 {{name}}", "Tag {{name}}"],
  ["{{label}}，发现新版本", "{{label}}, dostępna aktualizacja"],
  ["附件读取不完整，请重新选择文件", "Nie udało się odczytać całego załącznika. Wybierz plik ponownie."],
]);

const flattenStrings = (value: unknown, prefix = "", output = new Map<string, string>()) => {
  if (typeof value === "string") {
    output.set(prefix, value);
    return output;
  }
  if (!value || typeof value !== "object") {
    return output;
  }
  for (const [key, child] of Object.entries(value)) {
    flattenStrings(child, prefix ? `${prefix}.${key}` : key, output);
  }
  return output;
};

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const createTranslationPair = (source: string, target: string): TranslationPair => {
  const placeholders: string[] = [];
  const patternSource = escapeRegExp(source).replace(/\\\{\\\{(\w+)\\\}\\\}/g, (_match, placeholder: string) => {
    placeholders.push(placeholder);
    return "(.+?)";
  });
  return {
    source,
    target,
    pattern: placeholders.length > 0 ? new RegExp(`^${patternSource}$`) : undefined,
    placeholders,
  };
};
const zhStrings = flattenStrings(zhCN);
const zhTWStrings = flattenStrings(zhTW);
const enStrings = flattenStrings(enUS);
const jaStrings = flattenStrings(ja);
const plStrings = flattenStrings(pl);
const ruStrings = flattenStrings(ru);
const esStrings = flattenStrings(es);
const deStrings = flattenStrings(de);
const frStrings = flattenStrings(fr);

const buildTranslationPairs = (targets: Map<string, string>) =>
  Array.from(zhStrings.entries()).flatMap(([key, source]) => {
    const target = targets.get(key);
    if (!target || source === target) {
      return [];
    }
    return [createTranslationPair(source, target)];
  });

const zhTWTranslationPairs = buildTranslationPairs(zhTWStrings);
const enTranslationPairs = buildTranslationPairs(enStrings);
const jaTranslationPairs = buildTranslationPairs(jaStrings);
const plTranslationPairs = buildTranslationPairs(plStrings);
const ruTranslationPairs = buildTranslationPairs(ruStrings);
const esTranslationPairs = buildTranslationPairs(esStrings);
const deTranslationPairs = buildTranslationPairs(deStrings);
const frTranslationPairs = buildTranslationPairs(frStrings);

const exactZhTWTranslations = new Map(
  zhTWTranslationPairs.filter((pair) => !pair.pattern).map((pair) => [pair.source, pair.target]),
);
const exactEnglishTranslations = new Map(
  enTranslationPairs.filter((pair) => !pair.pattern).map((pair) => [pair.source, pair.target]),
);
const exactJapaneseTranslations = new Map(
  jaTranslationPairs.filter((pair) => !pair.pattern).map((pair) => [pair.source, pair.target]),
);
const exactPolishTranslations = new Map(
  plTranslationPairs.filter((pair) => !pair.pattern).map((pair) => [pair.source, pair.target]),
);
const exactRussianTranslations = new Map(
  ruTranslationPairs.filter((pair) => !pair.pattern).map((pair) => [pair.source, pair.target]),
);
const exactSpanishTranslations = new Map(
  esTranslationPairs.filter((pair) => !pair.pattern).map((pair) => [pair.source, pair.target]),
);
const exactGermanTranslations = new Map(
  deTranslationPairs.filter((pair) => !pair.pattern).map((pair) => [pair.source, pair.target]),
);
const exactFrenchTranslations = new Map(
  frTranslationPairs.filter((pair) => !pair.pattern).map((pair) => [pair.source, pair.target]),
);

const mobileZhTWTemplateTranslations: TranslationPair[] = Array.from(mobileOnlyZhTW.entries())
  .filter(([source]) => source.includes("{{"))
  .map(([source, target]) => createTranslationPair(source, target));
const mobileTemplateTranslations: TranslationPair[] = Array.from(mobileOnlyTranslations.entries())
  .filter(([source]) => source.includes("{{"))
  .map(([source, target]) => createTranslationPair(source, target));
const mobileJapaneseTemplateTranslations: TranslationPair[] = Array.from(mobileOnlyJapanese.entries())
  .filter(([source]) => source.includes("{{"))
  .map(([source, target]) => createTranslationPair(source, target));
const mobilePolishTemplateTranslations: TranslationPair[] = Array.from(mobileOnlyPolish.entries())
  .filter(([source]) => source.includes("{{"))
  .map(([source, target]) => createTranslationPair(source, target));

const zhTWTemplateTranslations = [
  ...mobileZhTWTemplateTranslations,
  ...zhTWTranslationPairs.filter((pair) => pair.pattern),
].sort((left, right) => right.source.length - left.source.length);
const englishTemplateTranslations = [
  ...mobileTemplateTranslations,
  ...enTranslationPairs.filter((pair) => pair.pattern),
].sort((left, right) => right.source.length - left.source.length);
const japaneseTemplateTranslations = [
  ...mobileJapaneseTemplateTranslations,
  ...jaTranslationPairs.filter((pair) => pair.pattern),
].sort((left, right) => right.source.length - left.source.length);
const polishTemplateTranslations = [
  ...mobilePolishTemplateTranslations,
  ...plTranslationPairs.filter((pair) => pair.pattern),
].sort((left, right) => right.source.length - left.source.length);
const russianTemplateTranslations = ruTranslationPairs
  .filter((pair) => pair.pattern)
  .sort((left, right) => right.source.length - left.source.length);
const spanishTemplateTranslations = esTranslationPairs
  .filter((pair) => pair.pattern)
  .sort((left, right) => right.source.length - left.source.length);
const germanTemplateTranslations = deTranslationPairs
  .filter((pair) => pair.pattern)
  .sort((left, right) => right.source.length - left.source.length);
const frenchTemplateTranslations = frTranslationPairs
  .filter((pair) => pair.pattern)
  .sort((left, right) => right.source.length - left.source.length);

type LocalizedCatalog<T> = { readonly [K in keyof T]: T[K] extends string ? string : LocalizedCatalog<T[K]> };
export type MobileCatalog = LocalizedCatalog<typeof enUS>;

// Typing every locale against the English shape makes a missing key a compile error.
const mobileCatalogs: Record<SupportedMobileLocale, MobileCatalog> = {
  "zh-CN": zhCN,
  "zh-TW": zhTW,
  "en-US": enUS,
  es,
  de,
  fr,
  ja,
  pl,
  ru,
};

export const getMobileCatalog = (locale: SupportedMobileLocale): MobileCatalog => mobileCatalogs[locale];

export const formatMobileCopy = (template: string, values: Record<string, string | number>) =>
  template.replace(/\{\{(\w+)\}\}/g, (match, name: string) => (name in values ? String(values[name]) : match));

const resolveSystemLocale = (): SupportedMobileLocale =>
  resolveSupportedLocale(Intl.DateTimeFormat().resolvedOptions().locale);

const applyTemplateTranslations = (value: string, pairs: TranslationPair[]) => {
  for (const pair of pairs) {
    const match = pair.pattern?.exec(value);
    if (!match) {
      continue;
    }
    return (pair.placeholders ?? []).reduce(
      (translated, placeholder, index) => translated.replace(`{{${placeholder}}}`, match[index + 1] ?? ""),
      pair.target,
    );
  }
  return null;
};

export const translateMobileText = (value: string, locale: SupportedMobileLocale) => {
  if (locale === "zh-CN" || !/[\u3400-\u9fff]/.test(value)) {
    return value;
  }
  if (locale === "zh-TW") {
    const exact = mobileOnlyZhTW.get(value) ?? exactZhTWTranslations.get(value);
    if (exact) return exact;
    return applyTemplateTranslations(value, zhTWTemplateTranslations) ?? value;
  }
  if (locale === "ja") {
    const exact = mobileOnlyJapanese.get(value) ?? exactJapaneseTranslations.get(value);
    if (exact) return exact;
    return applyTemplateTranslations(value, japaneseTemplateTranslations) ?? value;
  }
  if (locale === "pl") {
    const exact = mobileOnlyPolish.get(value) ?? exactPolishTranslations.get(value);
    if (exact) return exact;
    return applyTemplateTranslations(value, polishTemplateTranslations) ?? value;
  }
  if (locale === "ru") {
    const exact = exactRussianTranslations.get(value);
    if (exact) return exact;
    const fromCatalog = applyTemplateTranslations(value, russianTemplateTranslations);
    if (fromCatalog) return fromCatalog;
    const english = mobileOnlyTranslations.get(value) ?? exactEnglishTranslations.get(value);
    if (english) return english;
    return applyTemplateTranslations(value, englishTemplateTranslations) ?? value;
  }
  if (locale === "es") {
    const exact = exactSpanishTranslations.get(value);
    if (exact) return exact;
    const fromCatalog = applyTemplateTranslations(value, spanishTemplateTranslations);
    if (fromCatalog) return fromCatalog;
    const english = mobileOnlyTranslations.get(value) ?? exactEnglishTranslations.get(value);
    if (english) return english;
    return applyTemplateTranslations(value, englishTemplateTranslations) ?? value;
  }
  if (locale === "de") {
    const exact = exactGermanTranslations.get(value);
    if (exact) return exact;
    const fromCatalog = applyTemplateTranslations(value, germanTemplateTranslations);
    if (fromCatalog) return fromCatalog;
    const english = mobileOnlyTranslations.get(value) ?? exactEnglishTranslations.get(value);
    if (english) return english;
    return applyTemplateTranslations(value, englishTemplateTranslations) ?? value;
  }
  if (locale === "fr") {
    const exact = exactFrenchTranslations.get(value);
    if (exact) return exact;
    const fromCatalog = applyTemplateTranslations(value, frenchTemplateTranslations);
    if (fromCatalog) return fromCatalog;
    const english = mobileOnlyTranslations.get(value) ?? exactEnglishTranslations.get(value);
    if (english) return english;
    return applyTemplateTranslations(value, englishTemplateTranslations) ?? value;
  }
  const exact = mobileOnlyTranslations.get(value) ?? exactEnglishTranslations.get(value);
  if (exact) {
    return exact;
  }
  return applyTemplateTranslations(value, englishTemplateTranslations) ?? value;
};

let currentResolvedMobileLocale: SupportedMobileLocale = resolveSystemLocale();
export const translateCurrentMobileText = (value: string) => translateMobileText(value, currentResolvedMobileLocale);

/** Maps a known English server sync error to its zh-CN source text so the localized components translate it. */
export const toMobileSyncErrorSourceText = (message: string | null) => {
  const key = message ? getMemoSaveErrorReasonKey(null, message) : null;
  return (key && zhStrings.get(key)) || message;
};

export const localizeUntitledMemoTitle = (
  title: string | null | undefined,
  locale: SupportedMobileLocale,
) => {
  const trimmed = title?.trim() ?? "";
  if (trimmed && trimmed !== DEFAULT_MEMO_TITLE) {
    return trimmed;
  }
  return translateMobileText(DEFAULT_MEMO_TITLE, locale);
};

export const localizeMissingNotebookName = (locale: SupportedMobileLocale) => {
  if (locale === "zh-TW") return "未分類";
  if (locale === "en-US") return "Uncategorized";
  if (locale === "ja") return "未分類";
  if (locale === "pl") return "Nieprzypisane";
  if (locale === "ru") return "Без блокнота";
  if (locale === "es") return "Sin clasificar";
  if (locale === "de") return "Ohne Kategorie";
  if (locale === "fr") return "Non classé";
  return "未分类";
};

const MobileLocaleContext = createContext<MobileLocaleContextValue>({
  preference: "system",
  resolvedLocale: resolveSystemLocale(),
  setPreference: () => undefined,
  translate: (value) => value,
});

export const MobileLocaleProvider = ({ children }: { children: ReactNode }) => {
  const [preference, setPreferenceState] = useState<MobileLocalePreference>("system");

  useEffect(() => {
    let active = true;
    void readMobileLocalePreference().then((storedPreference) => {
      if (active) {
        setPreferenceState(storedPreference);
      }
    });
    return () => {
      active = false;
    };
  }, []);

  const resolvedLocale = preference === "system" ? resolveSystemLocale() : preference;
  currentResolvedMobileLocale = resolvedLocale;
  const value = useMemo<MobileLocaleContextValue>(
    () => ({
      preference,
      resolvedLocale,
      setPreference: (nextPreference) => {
        setPreferenceState(nextPreference);
        void writeMobileLocalePreference(nextPreference);
      },
      translate: (text) => translateMobileText(text, resolvedLocale),
    }),
    [preference, resolvedLocale]
  );

  return <MobileLocaleContext.Provider value={value}>{children}</MobileLocaleContext.Provider>;
};

export const useMobileLocale = () => useContext(MobileLocaleContext);
