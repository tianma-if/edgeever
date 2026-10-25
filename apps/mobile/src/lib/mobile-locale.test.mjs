import { describe, expect, test } from "bun:test";
import { localizeMissingNotebookName, localizeUntitledMemoTitle, toMobileSyncErrorSourceText, translateMobileText } from "./mobile-locale.tsx";

describe("mobile locale translation", () => {
  test("keeps Chinese copy unchanged for the Chinese locale", () => {
    expect(translateMobileText("正在同步笔记", "zh-CN")).toBe("正在同步笔记");
  });

  test("translates mobile-only static copy", () => {
    expect(translateMobileText("正在同步笔记", "en-US")).toBe("Syncing your notes");
    expect(translateMobileText("从相册选择", "en-US")).toBe("Choose from library");
    expect(translateMobileText("正在同步笔记", "ja")).toBe("ノートを同期しています");
    expect(translateMobileText("从相册选择", "ja")).toBe("ライブラリから選ぶ");
    expect(translateMobileText("正在同步笔记", "pl")).toBe("Synchronizowanie notatek");
    expect(translateMobileText("从相册选择", "pl")).toBe("Wybierz z galerii");
  });

  test("translates the buttons, statuses and errors that were shown in Chinese for every locale", () => {
    // These literals reach users through LocalizedText, Alert and Pressable,
    // which only translate copy that has a dictionary entry.
    const copy = [
      "确定", "好的", "登录", "删除失败", "删除中", "恢复中", "恢复失败", "创建失败", "请重试",
      "请检查网络后重试", "当前无法连接实例，请稍后重试", "换个关键词再试", "没有找到匹配笔记", "重试加载",
      "请先创建一个笔记本", "附件上传失败", "保存中", "准备中", "本地草稿", "未保存",
      "缺少笔记数据，无法打开富文本编辑器", "笔记加载失败", "进入编辑并聚焦标题", "编辑笔记标题",
      "更改笔记所属笔记本", "选择历史记录后可预览并恢复。", "当前无法读取附件。", "当前无法读取资源。",
      "请等待笔记同步完成。", "资源读取失败", "已取消下载", "当前设备无法打开系统分享面板",
      "登录成功但服务端没有返回移动端会话。请确认服务端已更新到支持 App 登录的版本。",
    ];
    // Japanese writes "unsaved" with the same characters as Chinese.
    const sameInJapanese = new Set(["未保存"]);
    for (const locale of ["en-US", "ja", "pl", "ru"]) {
      const untranslated = copy.filter((value) => translateMobileText(value, locale) === value
        && !(locale === "ja" && sameInJapanese.has(value)));
      expect({ locale, untranslated }).toEqual({ locale, untranslated: [] });
    }
    expect(translateMobileText("登录", "pl")).toBe("Zaloguj się");
    expect(translateMobileText("确定", "zh-CN")).toBe("确定");
  });

  test("prefers specific mobile-only templates over broader templates", () => {
    expect(translateMobileText("已加载 12 / 40 条笔记", "en-US")).toBe("Loaded 12 of 40 notes");
    expect(translateMobileText("筛选：Pinned · 3 条", "en-US")).toBe("Filter: Pinned · 3 notes");
    expect(translateMobileText("已加载 12 / 40 条笔记", "pl")).toBe("Wczytane notatki: 12 z 40");
    expect(translateMobileText("筛选：Przypięte · 3 条", "pl")).toBe("Filtr: Przypięte · notatki: 3");
  });

  test("uses shared translations for the descendant preference", () => {
    expect(translateMobileText("父笔记本中显示子笔记本笔记", "en-US")).toBe("Show notes from sub-notebooks");
    expect(translateMobileText("父笔记本中显示子笔记本笔记", "ja")).toBe("サブノートブックのノートを表示");
    expect(translateMobileText("是否在父笔记本中显示子笔记本中的笔记", "en-US")).toBe("Show notes from sub-notebooks in parent notebooks");
  });

  test("translates the hidden sub-notebook notes hint", () => {
    const hint = "子笔记本中还有 5 条笔记。可以打开子笔记本查看，或在设置中开启“父笔记本中显示子笔记本笔记”。";
    expect(translateMobileText(hint, "en-US"))
      .toBe("Its sub-notebooks still contain 5 notes. Open a sub-notebook to see them, or turn on \"Show notes from sub-notebooks\" in Settings.");
    expect(translateMobileText(hint, "ja"))
      .toBe("サブノートブックにはまだ 5 件のノートがあります。サブノートブックを開くか、設定で「サブノートブックのノートを表示」をオンにしてください。");
    expect(translateMobileText(hint, "pl"))
      .toBe("Notatki w podnotatnikach: 5. Otwórz podnotatnik, aby je zobaczyć, lub włącz w ustawieniach opcję „Pokazuj notatki z podnotatników”.");
    expect(translateMobileText("本级暂无笔记", "en-US")).toBe("No notes directly in this notebook");
    expect(translateMobileText("无法保存“父笔记本中显示子笔记本笔记”设置，请稍后重试", "en-US"))
      .toBe("Could not save the \"Show notes from sub-notebooks\" setting. Please try again.");
  });

  test("prefers specific shared templates over broader mobile-only templates", () => {
    expect(translateMobileText("永久删除 3 条笔记", "en-US")).toBe("Delete 3 notes permanently");
    expect(translateMobileText("当前：Inbox，3 条笔记", "en-US")).toBe("Current: Inbox, 3 notes");
  });

  test("translates the mixed English explanations from the Android locale report", () => {
    expect(translateMobileText("修改后会保留当前设备登录，并退出其他设备上的登录会话。", "en-US"))
      .toBe("Keeps this device signed in and signs out other sessions.");
    expect(translateMobileText("修改后会保留当前设备登录，并退出其他设备上的登录会话。", "ja"))
      .toBe("この端末のログインは維持し、他の端末のセッションは終了します。");
    expect(translateMobileText("添加标签", "en-US")).toBe("Add tags");
    expect(translateMobileText("没有找到适合这篇笔记的新标签。", "en-US")).toBe("No new tags fit this note.");
    expect(translateMobileText("切换产品界面的显示语言。", "en-US")).toBe("Choose the language used in the app.");
    expect(translateMobileText("当前密码不正确。", "en-US")).toBe("The current password is incorrect.");
    expect(translateMobileText("修改中...", "ja")).toBe("変更中...");
    expect(translateMobileText("正在剪藏文章", "en-US")).toBe("Clipping article");
    expect(translateMobileText("剪藏失败", "ja")).toBe("ページを取り込めませんでした");
    expect(translateMobileText("正文剪藏失败", "en-US")).toBe("Article extraction failed");
    expect(translateMobileText("微信文章请求失败（HTTP 404）。", "en-US")).toBe("The WeChat article request failed (HTTP 404).");
    expect(translateMobileText("分享的图片（2 张）", "ja")).toBe("共有された画像（2 枚）");
    expect(translateMobileText("分享的图片（2 张）", "pl")).toBe("Udostępnione obrazy (2)");
    expect(translateMobileText("剪藏失败", "pl")).toBe("Nie udało się zapisać strony");
    expect(translateMobileText("修改后会保留当前设备登录，并退出其他设备上的登录会话。", "pl"))
      .toBe("To urządzenie pozostanie zalogowane, a pozostałe sesje zostaną wylogowane.");
    expect(translateMobileText("来源：https://example.com", "en-US")).toBe("来源：https://example.com");
  });

  test("localizes only the default untitled title and the missing-notebook fallback", () => {
    expect(localizeUntitledMemoTitle("", "en-US")).toBe("Untitled note");
    expect(localizeUntitledMemoTitle("无标题笔记", "en-US")).toBe("Untitled note");
    expect(localizeUntitledMemoTitle("无标题笔记", "ja")).toBe("無題のノート");
    expect(localizeUntitledMemoTitle("  无标题笔记  ", "zh-CN")).toBe("无标题笔记");
    expect(localizeUntitledMemoTitle("会议记录", "en-US")).toBe("会议记录");
    expect(localizeMissingNotebookName("en-US")).toBe("Uncategorized");
    expect(localizeMissingNotebookName("ja")).toBe("未分類");
    expect(localizeMissingNotebookName("pl")).toBe("Nieprzypisane");
    expect(localizeMissingNotebookName("ru")).toBe("Без блокнота");
    expect(localizeMissingNotebookName("zh-CN")).toBe("未分类");
  });

  test("localizes the suspicious overwrite sync error the server reports in English", () => {
    const source = toMobileSyncErrorSourceText("Save blocked because the title changed while most of the note content disappeared.");
    expect(translateMobileText(source, "pl")).toStartWith("Zapis zablokowany");
    expect(translateMobileText(source, "en-US")).toStartWith("Save blocked: the title changed");
    expect(translateMobileText(source, "zh-CN")).toStartWith("已阻止保存");
    expect(toMobileSyncErrorSourceText("Network request failed")).toBe("Network request failed");
    expect(toMobileSyncErrorSourceText(null)).toBeNull();
  });
});
