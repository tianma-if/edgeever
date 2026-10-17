import { resolveSupportedLocale } from "./i18n/locales";

export type MemoTemplateSeedLocale = "zh-CN" | "en-US" | "ja" | "pl" | "cs";

export type MemoTemplateSeedTranslation = {
  title: string;
  description: string;
  contentMarkdown: string;
};

export type MemoTemplateSeed = {
  key: "quick-note" | "meeting" | "weekly-review" | "reading" | "okr";
  translationKey: "quickNote" | "meeting" | "weeklyReview" | "reading" | "okr";
  tag: string;
  translations: Record<MemoTemplateSeedLocale, MemoTemplateSeedTranslation>;
};

const seed = (
  metadata: Omit<MemoTemplateSeed, "translations">,
  zhCN: MemoTemplateSeedTranslation,
  enUS: MemoTemplateSeedTranslation,
  ja: MemoTemplateSeedTranslation,
  pl: MemoTemplateSeedTranslation,
  cs: MemoTemplateSeedTranslation,
): MemoTemplateSeed => ({
  ...metadata,
  translations: { "zh-CN": zhCN, "en-US": enUS, ja, pl, cs },
});

export const DEFAULT_MEMO_TEMPLATE_SEEDS: readonly MemoTemplateSeed[] = [
  seed(
    { key: "quick-note", translationKey: "quickNote", tag: "quick-note" },
    {
      title: "灵感速记",
      description: "快速捕捉闪念、临时灵感、资料链接与即刻行动。",
      contentMarkdown: "## 💡 闪念记录\n\n- \n\n## 📌 背景与补充说明\n\n\n\n## 🚀 下一步动作\n\n- [ ] ",
    },
    {
      title: "Quick Spark",
      description: "Capture fleeting thoughts, ideas, links, and immediate action items.",
      contentMarkdown: "## 💡 Fleeting Thoughts\n\n- \n\n## 📌 Context & Notes\n\n\n\n## 🚀 Next Actions\n\n- [ ] ",
    },
    {
      title: "ひらめきメモ",
      description: "ふとした思いつき、アイデア、リンク、すぐやることをすばやく書き留めます。",
      contentMarkdown: "## 💡 ひらめき\n\n- \n\n## 📌 背景と補足\n\n\n\n## 🚀 次のアクション\n\n- [ ] ",
    },
    {
      title: "Szybka notatka",
      description: "Zapisuj ulotne myśli, pomysły, linki i działania do natychmiastowego podjęcia.",
      contentMarkdown: "## 💡 Ulotne myśli\n\n- \n\n## 📌 Kontekst i uwagi\n\n\n\n## 🚀 Kolejne kroki\n\n- [ ] ",
    },
    {
      title: "Rychlý nápad",
      description: "Zachyťte prchavé myšlenky, nápady, odkazy a okamžité úkoly.",
      contentMarkdown: "## 💡 Prchavé myšlenky\n\n- \n\n## 📌 Kontext a poznámky\n\n\n\n## 🚀 Další kroky\n\n- [ ] ",
    },
  ),
  seed(
    { key: "meeting", translationKey: "meeting", tag: "meeting" },
    {
      title: "会议纪要",
      description: "结构化记录议题背景、核心结论与带负责人的待办事项。",
      contentMarkdown: "# 📝 会议纪要\n\n- **时间**：\n- **主持人/记录人**：\n- **参会人**：\n\n---\n\n## 🎯 会议目标\n\n- \n\n## 💬 核心讨论与决策\n\n1. **[议题 1]**\n   - 讨论要点：\n   - ✅ **决议**：\n\n2. **[议题 2]**\n   - 讨论要点：\n   - ✅ **决议**：\n\n## 📋 待办事项 (Action Items)\n\n- [ ] **[负责人]** 任务描述 (截止日期：MM-DD)\n- [ ] **[负责人]** 任务描述 (截止日期：MM-DD)\n",
    },
    {
      title: "Meeting Minutes",
      description: "Structured log for agenda, key decisions, and action items with owners.",
      contentMarkdown: "# 📝 Meeting Minutes\n\n- **Time**:\n- **Host/Recorder**:\n- **Attendees**:\n\n---\n\n## 🎯 Goal\n\n- \n\n## 💬 Discussion & Decisions\n\n1. **[Topic 1]**\n   - Points:\n   - ✅ **Decision**:\n\n2. **[Topic 2]**\n   - Points:\n   - ✅ **Decision**:\n\n## 📋 Action Items\n\n- [ ] **[Owner]** Task description (Due: MM-DD)\n- [ ] **[Owner]** Task description (Due: MM-DD)\n",
    },
    {
      title: "会議メモ",
      description: "議題の背景、主な決定、担当者つきのToDoを構造化して記録します。",
      contentMarkdown: "# 📝 会議メモ\n\n- **日時**：\n- **司会/記録**：\n- **参加者**：\n\n---\n\n## 🎯 会議の目的\n\n- \n\n## 💬 議論と決定\n\n1. **[議題 1]**\n   - ポイント：\n   - ✅ **決定**：\n\n2. **[議題 2]**\n   - ポイント：\n   - ✅ **決定**：\n\n## 📋 アクションアイテム\n\n- [ ] **[担当者]** タスク内容（期限：MM-DD）\n- [ ] **[担当者]** タスク内容（期限：MM-DD）\n",
    },
    {
      title: "Notatka ze spotkania",
      description: "Uporządkowany zapis agendy, kluczowych decyzji i zadań z osobami odpowiedzialnymi.",
      contentMarkdown: "# 📝 Notatka ze spotkania\n\n- **Termin**:\n- **Prowadzący/protokolant**:\n- **Uczestnicy**:\n\n---\n\n## 🎯 Cel\n\n- \n\n## 💬 Dyskusja i decyzje\n\n1. **[Temat 1]**\n   - Najważniejsze punkty:\n   - ✅ **Decyzja**:\n\n2. **[Temat 2]**\n   - Najważniejsze punkty:\n   - ✅ **Decyzja**:\n\n## 📋 Zadania do wykonania\n\n- [ ] **[Osoba odpowiedzialna]** Opis zadania (termin: MM-DD)\n- [ ] **[Osoba odpowiedzialna]** Opis zadania (termin: MM-DD)\n",
    },
    {
      title: "Zápis z porady",
      description: "Strukturovaný zápis programu, klíčových rozhodnutí a úkolů s odpovědnými osobami.",
      contentMarkdown: "# 📝 Zápis z porady\n\n- **Čas**:\n- **Vede/zapisuje**:\n- **Účastníci**:\n\n---\n\n## 🎯 Cíl\n\n- \n\n## 💬 Diskuse a rozhodnutí\n\n1. **[Téma 1]**\n   - Body:\n   - ✅ **Rozhodnutí**:\n\n2. **[Téma 2]**\n   - Body:\n   - ✅ **Rozhodnutí**:\n\n## 📋 Úkoly\n\n- [ ] **[Odpovědná osoba]** Popis úkolu (termín: DD. MM.)\n- [ ] **[Odpovědná osoba]** Popis úkolu (termín: DD. MM.)\n",
    },
  ),
  seed(
    { key: "weekly-review", translationKey: "weeklyReview", tag: "weekly-review" },
    {
      title: "周报与进展复盘",
      description: "梳理本周核心产出、风险卡点与下周关键优先级。",
      contentMarkdown: "# 🗓️ 工作周报\n\n## 🌟 本周核心进展 (Highlights)\n\n- [x] **[项目/功能]** 完成情况与成果说明\n- [x] **[项目/功能]** 完成情况与成果说明\n\n## 🚧 卡点与风险 (Blockers & Risks)\n\n- ⚠️ **阻塞项**：原因及所需支持\n\n## 🎯 下周优先级 (Next Week Priorities)\n\n- [ ] \n- [ ] \n- [ ] \n\n## 💡 总结与思考\n\n- \n",
    },
    {
      title: "Weekly Review & Status",
      description: "Summarize weekly highlights, blockers, and next week's key priorities.",
      contentMarkdown: "# 🗓️ Weekly Status Report\n\n## 🌟 Highlights\n\n- [x] **[Project/Feature]** Accomplishment details\n- [x] **[Project/Feature]** Accomplishment details\n\n## 🚧 Blockers & Risks\n\n- ⚠️ **Blocker**: Reason and required support\n\n## 🎯 Next Week Priorities\n\n- [ ] \n- [ ] \n- [ ] \n\n## 💡 Reflection & Insights\n\n- \n",
    },
    {
      title: "週次レビュー",
      description: "今週の成果、ブロッカー、来週の優先事項を整理します。",
      contentMarkdown: "# 🗓️ 週次レポート\n\n## 🌟 今週のハイライト\n\n- [x] **[プロジェクト/機能]** 成果の説明\n- [x] **[プロジェクト/機能]** 成果の説明\n\n## 🚧 ブロッカーとリスク\n\n- ⚠️ **ブロッカー**：原因と必要なサポート\n\n## 🎯 来週の優先事項\n\n- [ ] \n- [ ] \n- [ ] \n\n## 💡 振り返り\n\n- \n",
    },
    {
      title: "Przegląd tygodnia i postępy",
      description: "Podsumuj najważniejsze osiągnięcia tygodnia, blokery i kluczowe priorytety na kolejny tydzień.",
      contentMarkdown: "# 🗓️ Tygodniowy raport postępów\n\n## 🌟 Najważniejsze osiągnięcia\n\n- [x] **[Projekt/funkcja]** Szczegóły osiągnięcia\n- [x] **[Projekt/funkcja]** Szczegóły osiągnięcia\n\n## 🚧 Blokery i ryzyka\n\n- ⚠️ **Bloker**: Przyczyna i potrzebne wsparcie\n\n## 🎯 Priorytety na kolejny tydzień\n\n- [ ] \n- [ ] \n- [ ] \n\n## 💡 Refleksje i wnioski\n\n- \n",
    },
    {
      title: "Týdenní přehled a stav",
      description: "Shrňte úspěchy týdne, překážky a hlavní priority na příští týden.",
      contentMarkdown: "# 🗓️ Týdenní zpráva o stavu\n\n## 🌟 Hlavní úspěchy\n\n- [x] **[Projekt/funkce]** Podrobnosti o výsledku\n- [x] **[Projekt/funkce]** Podrobnosti o výsledku\n\n## 🚧 Překážky a rizika\n\n- ⚠️ **Překážka**: Důvod a potřebná pomoc\n\n## 🎯 Priority na příští týden\n\n- [ ] \n- [ ] \n- [ ] \n\n## 💡 Reflexe a postřehy\n\n- \n",
    },
  ),
  seed(
    { key: "reading", translationKey: "reading", tag: "reading" },
    {
      title: "深度阅读卡片",
      description: "提炼核心观点、精妙摘录、个人理解与关联知识卡片。",
      contentMarkdown: "# 📖 深度阅读卡片\n\n- **书名/文章**：\n- **作者/来源**：\n- **推荐指数**：⭐⭐⭐⭐⭐\n\n---\n\n## 💡 一句话总结 (Key Takeaway)\n\n> \n\n## ✍️ 核心观点与金句摘录\n\n> [摘录内容]\n> —— *原书/原文*\n\n## 🧠 我的理解与延伸思考\n\n- \n\n## 🔗 关联知识与行动\n\n- [ ] **落地实践**：\n",
    },
    {
      title: "Reading Note Card",
      description: "Extract key takeaways, quotes, reflections, and connected concepts.",
      contentMarkdown: "# 📖 Reading Note Card\n\n- **Book/Article**:\n- **Author/Source**:\n- **Rating**: ⭐⭐⭐⭐⭐\n\n---\n\n## 💡 Key Takeaway\n\n> \n\n## ✍️ Highlights & Quotes\n\n> [Quote content]\n> —— *Original Source*\n\n## 🧠 Personal Reflections\n\n- \n\n## 🔗 Action & Practice\n\n- [ ] **Action Plan**:\n",
    },
    {
      title: "読書カード",
      description: "要点、引用、自分の理解、関連する知識をまとめます。",
      contentMarkdown: "# 📖 読書カード\n\n- **書籍/記事**：\n- **著者/出典**：\n- **評価**：⭐⭐⭐⭐⭐\n\n---\n\n## 💡 一言まとめ\n\n> \n\n## ✍️ 要点と引用\n\n> [引用]\n> —— *出典*\n\n## 🧠 自分の理解と考察\n\n- \n\n## 🔗 関連知識とアクション\n\n- [ ] **実践**：\n",
    },
    {
      title: "Karta lektury",
      description: "Wyodrębnij kluczowe wnioski, cytaty, własne refleksje i powiązane zagadnienia.",
      contentMarkdown: "# 📖 Karta lektury\n\n- **Książka/artykuł**:\n- **Autor/źródło**:\n- **Ocena**: ⭐⭐⭐⭐⭐\n\n---\n\n## 💡 Najważniejszy wniosek\n\n> \n\n## ✍️ Najciekawsze fragmenty i cytaty\n\n> [Treść cytatu]\n> —— *Źródło*\n\n## 🧠 Własne refleksje\n\n- \n\n## 🔗 Działanie i praktyka\n\n- [ ] **Plan działania**:\n",
    },
    {
      title: "Čtenářská karta",
      description: "Zaznamenejte hlavní myšlenky, citáty, vlastní úvahy a související pojmy.",
      contentMarkdown: "# 📖 Čtenářská karta\n\n- **Kniha/článek**:\n- **Autor/zdroj**:\n- **Hodnocení**: ⭐⭐⭐⭐⭐\n\n---\n\n## 💡 Hlavní myšlenka\n\n> \n\n## ✍️ Zajímavé pasáže a citáty\n\n> [Text citátu]\n> —— *Původní zdroj*\n\n## 🧠 Vlastní úvahy\n\n- \n\n## 🔗 Akce a praxe\n\n- [ ] **Akční plán**:\n",
    },
  ),
  seed(
    { key: "okr", translationKey: "okr", tag: "okr" },
    {
      title: "目标与任务拆解",
      description: "明确 OKR 目标、关键结果、里程碑与具体执行清单。",
      contentMarkdown: "# 🎯 目标拆解\n\n- **周期**：\n- **负责人**：\n\n---\n\n## 📌 目标 (Objective)\n\n> \n\n## 📈 关键结果 (Key Results)\n\n- **KR 1**：期望指标 -> 当前进度\n- **KR 2**：期望指标 -> 当前进度\n\n## 🗓️ 里程碑节点 (Milestones)\n\n- [ ] **阶段一 (日期)**：完成标的\n- [ ] **阶段二 (日期)**：完成标的\n\n## 📋 执行任务清单\n\n- [ ] \n- [ ] \n",
    },
    {
      title: "Goal & Task Breakdown",
      description: "Define OKRs, Key Results, milestones, and task checklists.",
      contentMarkdown: "# 🎯 Goal Breakdown\n\n- **Period**:\n- **Owner**:\n\n---\n\n## 📌 Objective\n\n> \n\n## 📈 Key Results\n\n- **KR 1**: Target metric -> Current progress\n- **KR 2**: Target metric -> Current progress\n\n## 🗓️ Milestones\n\n- [ ] **Phase 1 (Date)**: Target\n- [ ] **Phase 2 (Date)**: Target\n\n## 📋 Execution Checklist\n\n- [ ] \n- [ ] \n",
    },
    {
      title: "目標とタスク分解",
      description: "OKR の目標、主要な結果、マイルストーン、実行チェックリストを定義します。",
      contentMarkdown: "# 🎯 目標の分解\n\n- **期間**：\n- **担当者**：\n\n---\n\n## 📌 目標 (Objective)\n\n> \n\n## 📈 主要な結果 (Key Results)\n\n- **KR 1**：目標指標 -> 現在の進捗\n- **KR 2**：目標指標 -> 現在の進捗\n\n## 🗓️ マイルストーン\n\n- [ ] **フェーズ 1（日付）**：達成目標\n- [ ] **フェーズ 2（日付）**：達成目標\n\n## 📋 実行チェックリスト\n\n- [ ] \n- [ ] \n",
    },
    {
      title: "Cele i podział zadań",
      description: "Określ cele OKR, kluczowe rezultaty, kamienie milowe i listy zadań.",
      contentMarkdown: "# 🎯 Podział celu\n\n- **Okres**:\n- **Osoba odpowiedzialna**:\n\n---\n\n## 📌 Cel (Objective)\n\n> \n\n## 📈 Kluczowe rezultaty (Key Results)\n\n- **KR 1**: Docelowy wskaźnik -> Obecny postęp\n- **KR 2**: Docelowy wskaźnik -> Obecny postęp\n\n## 🗓️ Kamienie milowe\n\n- [ ] **Etap 1 (data)**: Cel etapu\n- [ ] **Etap 2 (data)**: Cel etapu\n\n## 📋 Lista zadań do wykonania\n\n- [ ] \n- [ ] \n",
    },
    {
      title: "Cíle a rozpad úkolů",
      description: "Definujte OKR, klíčové výsledky, milníky a kontrolní seznamy úkolů.",
      contentMarkdown: "# 🎯 Rozpad cíle\n\n- **Období**:\n- **Odpovídá**:\n\n---\n\n## 📌 Cíl (Objective)\n\n> \n\n## 📈 Klíčové výsledky (Key Results)\n\n- **KR 1**: Cílová metrika -> Aktuální stav\n- **KR 2**: Cílová metrika -> Aktuální stav\n\n## 🗓️ Milníky\n\n- [ ] **Fáze 1 (datum)**: Cíl\n- [ ] **Fáze 2 (datum)**: Cíl\n\n## 📋 Seznam úkolů\n\n- [ ] \n- [ ] \n",
    },
  ),
];

export const normalizeMemoTemplateSeedLocale = (
  locale: string | null | undefined,
): MemoTemplateSeedLocale => resolveSupportedLocale(locale);

export const localizeMemoTemplateSeed = (
  templateSeed: MemoTemplateSeed,
  locale: string | null | undefined,
): MemoTemplateSeedTranslation => templateSeed.translations[normalizeMemoTemplateSeedLocale(locale)];

export const defaultMemoTemplateId = (workspaceId: string, seedKey: string) =>
  `${workspaceId}_template_${seedKey}`;

export const memoTemplateSeedTranslations = (locale: MemoTemplateSeedLocale) =>
  Object.fromEntries(DEFAULT_MEMO_TEMPLATE_SEEDS.map((item) => [
    item.translationKey,
    item.translations[locale],
  ])) as Record<MemoTemplateSeed["translationKey"], MemoTemplateSeedTranslation>;

type LocalizableMemoTemplate = {
  id: string;
  name: string;
  description: string | null;
  title: string | null;
  contentMarkdown: string;
  tags: readonly string[];
};

const findUntouchedSeedTranslation = (
  template: LocalizableMemoTemplate,
): MemoTemplateSeed | null => {
  const templateSeed = DEFAULT_MEMO_TEMPLATE_SEEDS.find((item) => template.id.endsWith(`_template_${item.key}`));
  if (!templateSeed) return null;
  const seededTags = ["template", templateSeed.tag];
  if (
    template.tags.length !== seededTags.length
    || template.tags.some((tag, index) => tag !== seededTags[index])
  ) return null;
  const untouched = Object.values(templateSeed.translations).some((translation) =>
    template.name === translation.title
    && template.title === translation.title
    && template.description === translation.description
    && template.contentMarkdown === translation.contentMarkdown);
  return untouched ? templateSeed : null;
};

/**
 * Shows a default template in the viewer's UI language while it still equals
 * one of its seeded translations, including its seeded tags. Templates the
 * user created or edited in any field are returned unchanged.
 */
export const localizeDefaultMemoTemplate = <Template extends LocalizableMemoTemplate>(
  template: Template,
  locale: string | null | undefined,
): Template => {
  const templateSeed = findUntouchedSeedTranslation(template);
  if (!templateSeed) return template;
  const localized = localizeMemoTemplateSeed(templateSeed, locale);
  return {
    ...template,
    name: localized.title,
    title: localized.title,
    description: localized.description,
    contentMarkdown: localized.contentMarkdown,
  };
};
