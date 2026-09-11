export type MemoTemplateSeedLocale = "zh-CN" | "en-US" | "ru-RU";

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
  ruRU: MemoTemplateSeedTranslation,
): MemoTemplateSeed => ({
  ...metadata,
  translations: { "zh-CN": zhCN, "en-US": enUS, "ru-RU": ruRU },
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
      title: "Быстрая заметка",
      description: "Быстро зафиксируй мелькнувшую мысль, идею, ссылку или немедленное действие.",
      contentMarkdown: "## 💡 Мысль на лету\n\n- \n\n## 📌 Контекст и пояснения\n\n\n\n## 🚀 Следующие шаги\n\n- [ ] ",
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
      title: "Протокол встречи",
      description: "Структурированная запись повестки, ключевых решений и задач с ответственными.",
      contentMarkdown: "# 📝 Протокол встречи\n\n- **Время**:\n- **Ведущий/секретарь**:\n- **Участники**:\n\n---\n\n## 🎯 Цель встречи\n\n- \n\n## 💬 Обсуждение и решения\n\n1. **[Вопрос 1]**\n   - Ключевые моменты:\n   - ✅ **Решение**:\n\n2. **[Вопрос 2]**\n   - Ключевые моменты:\n   - ✅ **Решение**:\n\n## 📋 Задачи (Action Items)\n\n- [ ] **[Ответственный]** Описание задачи (срок: MM-DD)\n- [ ] **[Ответственный]** Описание задачи (срок: MM-DD)\n",
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
      title: "Итоги недели",
      description: "Подведи итоги недели: главные результаты, риски и приоритеты на следующую.",
      contentMarkdown: "# 🗓️ Итоги недели\n\n## 🌟 Главные результаты (Highlights)\n\n- [x] **[Проект/функция]** Что сделано и с каким результатом\n- [x] **[Проект/функция]** Что сделано и с каким результатом\n\n## 🚧 Блокеры и риски\n\n- ⚠️ **Блокер**: причина и нужная поддержка\n\n## 🎯 Приоритеты на следующую неделю\n\n- [ ] \n- [ ] \n- [ ] \n\n## 💡 Выводы и размышления\n\n- \n",
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
      title: "Карточка прочитанного",
      description: "Выдели главные мысли, цитаты, личные выводы и связи с другими знаниями.",
      contentMarkdown: "# 📖 Карточка прочитанного\n\n- **Книга/статья**:\n- **Автор/источник**:\n- **Оценка**: ⭐⭐⭐⭐⭐\n\n---\n\n## 💡 Главная мысль (Key Takeaway)\n\n> \n\n## ✍️ Ключевые идеи и цитаты\n\n> [Цитата]\n> —— *Источник*\n\n## 🧠 Мои размышления\n\n- \n\n## 🔗 Связи и действия\n\n- [ ] **Что применить на практике**:\n",
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
      title: "Цели и задачи",
      description: "Определи цели OKR, ключевые результаты, вехи и конкретный список задач.",
      contentMarkdown: "# 🎯 Разбор цели\n\n- **Период**:\n- **Ответственный**:\n\n---\n\n## 📌 Цель (Objective)\n\n> \n\n## 📈 Ключевые результаты (Key Results)\n\n- **KR 1**: Целевой показатель → текущий прогресс\n- **KR 2**: Целевой показатель → текущий прогресс\n\n## 🗓️ Вехи (Milestones)\n\n- [ ] **Этап 1 (дата)**: результат этапа\n- [ ] **Этап 2 (дата)**: результат этапа\n\n## 📋 Список задач\n\n- [ ] \n- [ ] \n",
    },
  ),
];

export const normalizeMemoTemplateSeedLocale = (
  locale: string | null | undefined,
): MemoTemplateSeedLocale => {
  const normalized = locale?.toLowerCase() ?? "";

  if (normalized.startsWith("en")) {
    return "en-US";
  }

  if (normalized.startsWith("ru")) {
    return "ru-RU";
  }

  return "zh-CN";
};

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
