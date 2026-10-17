import {
  normalizeMemoTemplateSeedLocale,
  type MemoTemplateSeedLocale,
  type MemoTemplateSeedTranslation,
} from "./memo-template-seeds";

/**
 * Optional templates a user can add to their own templates. Unlike the default
 * seeds they are never provisioned into a workspace, so the gallery can grow
 * without changing what new or existing workspaces contain.
 */
export type MemoTemplateGalleryItem = {
  key: string;
  tag: string;
  translations: Record<MemoTemplateSeedLocale, MemoTemplateSeedTranslation>;
};

export type MemoTemplateGalleryEntry = {
  key: string;
  name: string;
  description: string;
  title: string;
  contentMarkdown: string;
  tags: string[];
};

const item = (
  key: string,
  zhCN: MemoTemplateSeedTranslation,
  enUS: MemoTemplateSeedTranslation,
  ja: MemoTemplateSeedTranslation,
  pl: MemoTemplateSeedTranslation,
): MemoTemplateGalleryItem => ({
  key,
  tag: key,
  translations: { "zh-CN": zhCN, "en-US": enUS, ja, pl },
});

export const MEMO_TEMPLATE_GALLERY: readonly MemoTemplateGalleryItem[] = [
  item(
    "daily-journal",
    {
      title: "每日日志",
      description: "规划当天重点，记录发生的事情与当日反思。",
      contentMarkdown: "## 🎯 今日三件要事\n\n1. \n2. \n3. \n\n## 📅 今日记录\n\n- \n\n## 🙏 值得感恩\n\n- \n\n## 🌙 今日反思\n\n- 做得好的：\n- 可以改进的：\n- 明天要做的：\n",
    },
    {
      title: "Daily Journal",
      description: "Plan the day's priorities, log what happened, and reflect in the evening.",
      contentMarkdown: "## 🎯 Top 3 for Today\n\n1. \n2. \n3. \n\n## 📅 Log\n\n- \n\n## 🙏 Grateful For\n\n- \n\n## 🌙 Reflection\n\n- What went well:\n- What to improve:\n- Tomorrow:\n",
    },
    {
      title: "デイリージャーナル",
      description: "その日の優先事項を決め、出来事を記録し、一日を振り返ります。",
      contentMarkdown: "## 🎯 今日の3つの重点\n\n1. \n2. \n3. \n\n## 📅 今日の記録\n\n- \n\n## 🙏 感謝していること\n\n- \n\n## 🌙 振り返り\n\n- うまくいったこと：\n- 改善したいこと：\n- 明日やること：\n",
    },
    {
      title: "Dziennik dnia",
      description: "Zaplanuj priorytety dnia, zapisz, co się wydarzyło, i podsumuj dzień wieczorem.",
      contentMarkdown: "## 🎯 Trzy priorytety na dziś\n\n1. \n2. \n3. \n\n## 📅 Przebieg dnia\n\n- \n\n## 🙏 Wdzięczność\n\n- \n\n## 🌙 Refleksja\n\n- Co poszło dobrze:\n- Co poprawić:\n- Na jutro:\n",
    },
  ),
  item(
    "retrospective",
    {
      title: "复盘回顾",
      description: "回顾一个阶段：哪些做得好、哪些不足，以及具体改进行动。",
      contentMarkdown: "# 🔁 复盘回顾\n\n- **周期**：\n- **参与人**：\n\n## ✅ 做得好的\n\n- \n\n## ⚠️ 不足与问题\n\n- \n\n## 💡 可以尝试的改进\n\n- \n\n## 📋 改进行动\n\n- [ ] **[负责人]** 行动描述 (截止日期：MM-DD)\n",
    },
    {
      title: "Retrospective",
      description: "Look back on a period: what went well, what didn't, and concrete improvements.",
      contentMarkdown: "# 🔁 Retrospective\n\n- **Period**:\n- **Participants**:\n\n## ✅ What Went Well\n\n- \n\n## ⚠️ What Didn't Go Well\n\n- \n\n## 💡 Ideas to Try\n\n- \n\n## 📋 Action Items\n\n- [ ] **[Owner]** Action (Due: MM-DD)\n",
    },
    {
      title: "振り返り",
      description: "一定期間を振り返り、良かった点・課題・具体的な改善策をまとめます。",
      contentMarkdown: "# 🔁 振り返り\n\n- **期間**：\n- **参加者**：\n\n## ✅ 良かったこと\n\n- \n\n## ⚠️ 課題\n\n- \n\n## 💡 試してみたいこと\n\n- \n\n## 📋 改善アクション\n\n- [ ] **[担当者]** アクション (期限：MM-DD)\n",
    },
    {
      title: "Retrospektywa",
      description: "Podsumuj okres pracy: co poszło dobrze, co nie i jakie konkretne usprawnienia wprowadzić.",
      contentMarkdown: "# 🔁 Retrospektywa\n\n- **Okres**:\n- **Uczestnicy**:\n\n## ✅ Co poszło dobrze\n\n- \n\n## ⚠️ Co nie zadziałało\n\n- \n\n## 💡 Co warto wypróbować\n\n- \n\n## 📋 Działania\n\n- [ ] **[Osoba odpowiedzialna]** Działanie (Termin: DD.MM)\n",
    },
  ),
  item(
    "one-on-one",
    {
      title: "一对一沟通",
      description: "记录 1:1 沟通的议题、反馈、共识与后续跟进。",
      contentMarkdown: "# 🤝 一对一沟通\n\n- **时间**：\n- **参与人**：\n\n## 🗂️ 议题\n\n- \n\n## 💬 反馈\n\n- 给对方的：\n- 收到的：\n\n## ✅ 共识\n\n- \n\n## 📋 后续跟进\n\n- [ ] \n",
    },
    {
      title: "1:1 Meeting",
      description: "Track 1:1 topics, feedback both ways, agreements, and follow-ups.",
      contentMarkdown: "# 🤝 1:1 Meeting\n\n- **Date**:\n- **With**:\n\n## 🗂️ Topics\n\n- \n\n## 💬 Feedback\n\n- Given:\n- Received:\n\n## ✅ Agreements\n\n- \n\n## 📋 Follow-ups\n\n- [ ] \n",
    },
    {
      title: "1on1ミーティング",
      description: "1on1 の話題、相互フィードバック、合意事項、フォローアップを記録します。",
      contentMarkdown: "# 🤝 1on1ミーティング\n\n- **日時**：\n- **相手**：\n\n## 🗂️ 話題\n\n- \n\n## 💬 フィードバック\n\n- 伝えたこと：\n- 受け取ったこと：\n\n## ✅ 合意事項\n\n- \n\n## 📋 フォローアップ\n\n- [ ] \n",
    },
    {
      title: "Rozmowa 1:1",
      description: "Zapisuj tematy rozmowy 1:1, wzajemny feedback, ustalenia i dalsze kroki.",
      contentMarkdown: "# 🤝 Rozmowa 1:1\n\n- **Data**:\n- **Z kim**:\n\n## 🗂️ Tematy\n\n- \n\n## 💬 Feedback\n\n- Przekazany:\n- Otrzymany:\n\n## ✅ Ustalenia\n\n- \n\n## 📋 Dalsze kroki\n\n- [ ] \n",
    },
  ),
  item(
    "project-plan",
    {
      title: "项目计划",
      description: "明确项目目标、范围、里程碑、风险与相关人员。",
      contentMarkdown: "# 🗺️ 项目计划\n\n- **负责人**：\n- **开始 / 截止日期**：\n\n## 🎯 目标\n\n- \n\n## 📦 范围\n\n- 包含：\n- 不包含：\n\n## 🏁 里程碑\n\n- [ ] 里程碑 1 (MM-DD)\n- [ ] 里程碑 2 (MM-DD)\n\n## ⚠️ 风险与应对\n\n- \n\n## 👥 相关人员\n\n- \n",
    },
    {
      title: "Project Plan",
      description: "Define the project's goals, scope, milestones, risks, and stakeholders.",
      contentMarkdown: "# 🗺️ Project Plan\n\n- **Owner**:\n- **Start / Due**:\n\n## 🎯 Goals\n\n- \n\n## 📦 Scope\n\n- In scope:\n- Out of scope:\n\n## 🏁 Milestones\n\n- [ ] Milestone 1 (MM-DD)\n- [ ] Milestone 2 (MM-DD)\n\n## ⚠️ Risks & Mitigations\n\n- \n\n## 👥 Stakeholders\n\n- \n",
    },
    {
      title: "プロジェクト計画",
      description: "プロジェクトの目標、範囲、マイルストーン、リスク、関係者を整理します。",
      contentMarkdown: "# 🗺️ プロジェクト計画\n\n- **責任者**：\n- **開始 / 期限**：\n\n## 🎯 目標\n\n- \n\n## 📦 範囲\n\n- 対象：\n- 対象外：\n\n## 🏁 マイルストーン\n\n- [ ] マイルストーン 1 (MM-DD)\n- [ ] マイルストーン 2 (MM-DD)\n\n## ⚠️ リスクと対策\n\n- \n\n## 👥 関係者\n\n- \n",
    },
    {
      title: "Plan projektu",
      description: "Określ cele projektu, zakres, kamienie milowe, ryzyka i interesariuszy.",
      contentMarkdown: "# 🗺️ Plan projektu\n\n- **Właściciel**:\n- **Start / termin**:\n\n## 🎯 Cele\n\n- \n\n## 📦 Zakres\n\n- W zakresie:\n- Poza zakresem:\n\n## 🏁 Kamienie milowe\n\n- [ ] Kamień milowy 1 (DD.MM)\n- [ ] Kamień milowy 2 (DD.MM)\n\n## ⚠️ Ryzyka i sposoby ograniczenia\n\n- \n\n## 👥 Interesariusze\n\n- \n",
    },
  ),
  item(
    "cornell-notes",
    {
      title: "康奈尔笔记",
      description: "用线索问题、课堂笔记和总结三段式整理学习内容。",
      contentMarkdown: "# 🎓 康奈尔笔记\n\n- **主题**：\n- **来源**：\n\n## ❓ 线索与问题\n\n- \n\n## 📝 笔记\n\n- \n\n## 🧾 总结\n\n\n",
    },
    {
      title: "Cornell Notes",
      description: "Organize what you learn into cue questions, notes, and a summary.",
      contentMarkdown: "# 🎓 Cornell Notes\n\n- **Topic**:\n- **Source**:\n\n## ❓ Cues & Questions\n\n- \n\n## 📝 Notes\n\n- \n\n## 🧾 Summary\n\n\n",
    },
    {
      title: "コーネル式ノート",
      description: "学んだ内容をキーワード・ノート・まとめの3つに整理します。",
      contentMarkdown: "# 🎓 コーネル式ノート\n\n- **テーマ**：\n- **出典**：\n\n## ❓ キーワードと問い\n\n- \n\n## 📝 ノート\n\n- \n\n## 🧾 まとめ\n\n\n",
    },
    {
      title: "Notatka Cornella",
      description: "Porządkuj naukę w trzech częściach: pytania kluczowe, notatki i podsumowanie.",
      contentMarkdown: "# 🎓 Notatka Cornella\n\n- **Temat**:\n- **Źródło**:\n\n## ❓ Pytania kluczowe\n\n- \n\n## 📝 Notatki\n\n- \n\n## 🧾 Podsumowanie\n\n\n",
    },
  ),
  item(
    "bug-report",
    {
      title: "问题报告",
      description: "记录复现步骤、预期与实际结果、运行环境和附加信息。",
      contentMarkdown: "# 🐞 问题报告\n\n## 📄 概述\n\n\n\n## 🔁 复现步骤\n\n1. \n2. \n3. \n\n## ✅ 预期结果\n\n\n\n## ❌ 实际结果\n\n\n\n## 🖥️ 运行环境\n\n- 版本：\n- 系统 / 浏览器：\n\n## 📎 附加信息\n\n- \n",
    },
    {
      title: "Bug Report",
      description: "Capture reproduction steps, expected vs. actual results, environment, and extra context.",
      contentMarkdown: "# 🐞 Bug Report\n\n## 📄 Summary\n\n\n\n## 🔁 Steps to Reproduce\n\n1. \n2. \n3. \n\n## ✅ Expected Result\n\n\n\n## ❌ Actual Result\n\n\n\n## 🖥️ Environment\n\n- Version:\n- OS / Browser:\n\n## 📎 Additional Context\n\n- \n",
    },
    {
      title: "不具合報告",
      description: "再現手順、期待結果と実際の結果、環境、補足情報を記録します。",
      contentMarkdown: "# 🐞 不具合報告\n\n## 📄 概要\n\n\n\n## 🔁 再現手順\n\n1. \n2. \n3. \n\n## ✅ 期待される結果\n\n\n\n## ❌ 実際の結果\n\n\n\n## 🖥️ 環境\n\n- バージョン：\n- OS / ブラウザ：\n\n## 📎 補足情報\n\n- \n",
    },
    {
      title: "Raport błędu",
      description: "Zapisz kroki odtworzenia, oczekiwany i faktyczny wynik, środowisko oraz dodatkowy kontekst.",
      contentMarkdown: "# 🐞 Raport błędu\n\n## 📄 Opis\n\n\n\n## 🔁 Kroki odtworzenia\n\n1. \n2. \n3. \n\n## ✅ Oczekiwany wynik\n\n\n\n## ❌ Faktyczny wynik\n\n\n\n## 🖥️ Środowisko\n\n- Wersja:\n- System / przeglądarka:\n\n## 📎 Dodatkowy kontekst\n\n- \n",
    },
  ),
  item(
    "decision-record",
    {
      title: "决策记录",
      description: "记录决策背景、备选方案、最终决定及其影响。",
      contentMarkdown: "# ⚖️ 决策记录\n\n- **日期**：\n- **状态**：提议 / 已采纳 / 已废弃\n- **决策人**：\n\n## 🧭 背景\n\n\n\n## 🔀 备选方案\n\n1. **方案 A**：\n   - 优点：\n   - 缺点：\n2. **方案 B**：\n   - 优点：\n   - 缺点：\n\n## ✅ 决定\n\n\n\n## 📈 影响\n\n- \n",
    },
    {
      title: "Decision Record",
      description: "Document the context, options considered, the decision, and its consequences.",
      contentMarkdown: "# ⚖️ Decision Record\n\n- **Date**:\n- **Status**: Proposed / Accepted / Superseded\n- **Decided by**:\n\n## 🧭 Context\n\n\n\n## 🔀 Options Considered\n\n1. **Option A**:\n   - Pros:\n   - Cons:\n2. **Option B**:\n   - Pros:\n   - Cons:\n\n## ✅ Decision\n\n\n\n## 📈 Consequences\n\n- \n",
    },
    {
      title: "意思決定記録",
      description: "背景、検討した選択肢、決定内容とその影響を記録します。",
      contentMarkdown: "# ⚖️ 意思決定記録\n\n- **日付**：\n- **ステータス**：提案 / 採用 / 廃止\n- **決定者**：\n\n## 🧭 背景\n\n\n\n## 🔀 検討した選択肢\n\n1. **案 A**：\n   - 長所：\n   - 短所：\n2. **案 B**：\n   - 長所：\n   - 短所：\n\n## ✅ 決定\n\n\n\n## 📈 影響\n\n- \n",
    },
    {
      title: "Rejestr decyzji",
      description: "Opisz kontekst, rozważane opcje, podjętą decyzję i jej konsekwencje.",
      contentMarkdown: "# ⚖️ Rejestr decyzji\n\n- **Data**:\n- **Status**: Proponowana / Przyjęta / Zastąpiona\n- **Decyzja podjęta przez**:\n\n## 🧭 Kontekst\n\n\n\n## 🔀 Rozważane opcje\n\n1. **Opcja A**:\n   - Zalety:\n   - Wady:\n2. **Opcja B**:\n   - Zalety:\n   - Wady:\n\n## ✅ Decyzja\n\n\n\n## 📈 Konsekwencje\n\n- \n",
    },
  ),
  item(
    "travel-checklist",
    {
      title: "旅行清单",
      description: "整理行程、预订信息、行李清单和出发前待办。",
      contentMarkdown: "# ✈️ 旅行清单\n\n- **目的地**：\n- **日期**：\n\n## 🗓️ 行程\n\n- 第 1 天：\n- 第 2 天：\n\n## 🎫 预订信息\n\n- 交通：\n- 住宿：\n\n## 🧳 行李清单\n\n- [ ] 证件\n- [ ] 充电器\n- [ ] 衣物\n- [ ] 洗漱用品\n- [ ] 常用药品\n\n## ✅ 出发前待办\n\n- [ ] \n",
    },
    {
      title: "Travel Checklist",
      description: "Keep the itinerary, bookings, packing list, and pre-departure to-dos in one place.",
      contentMarkdown: "# ✈️ Travel Checklist\n\n- **Destination**:\n- **Dates**:\n\n## 🗓️ Itinerary\n\n- Day 1:\n- Day 2:\n\n## 🎫 Bookings\n\n- Transport:\n- Accommodation:\n\n## 🧳 Packing List\n\n- [ ] Documents\n- [ ] Chargers\n- [ ] Clothes\n- [ ] Toiletries\n- [ ] Medication\n\n## ✅ Before Leaving\n\n- [ ] \n",
    },
    {
      title: "旅行チェックリスト",
      description: "旅程、予約情報、持ち物リスト、出発前のやることをまとめます。",
      contentMarkdown: "# ✈️ 旅行チェックリスト\n\n- **行き先**：\n- **日程**：\n\n## 🗓️ 旅程\n\n- 1 日目：\n- 2 日目：\n\n## 🎫 予約情報\n\n- 交通：\n- 宿泊：\n\n## 🧳 持ち物リスト\n\n- [ ] 身分証明書\n- [ ] 充電器\n- [ ] 衣類\n- [ ] 洗面用具\n- [ ] 常備薬\n\n## ✅ 出発前のやること\n\n- [ ] \n",
    },
    {
      title: "Lista podróży",
      description: "Zbierz w jednym miejscu plan podróży, rezerwacje, listę pakowania i sprawy do załatwienia przed wyjazdem.",
      contentMarkdown: "# ✈️ Lista podróży\n\n- **Cel podróży**:\n- **Termin**:\n\n## 🗓️ Plan\n\n- Dzień 1:\n- Dzień 2:\n\n## 🎫 Rezerwacje\n\n- Transport:\n- Nocleg:\n\n## 🧳 Lista pakowania\n\n- [ ] Dokumenty\n- [ ] Ładowarki\n- [ ] Ubrania\n- [ ] Kosmetyki\n- [ ] Leki\n\n## ✅ Przed wyjazdem\n\n- [ ] \n",
    },
  ),
];

export const localizeMemoTemplateGalleryItem = (
  galleryItem: MemoTemplateGalleryItem,
  locale: string | null | undefined,
): MemoTemplateGalleryEntry => {
  const translation = galleryItem.translations[normalizeMemoTemplateSeedLocale(locale)];
  return {
    key: galleryItem.key,
    name: translation.title,
    description: translation.description,
    title: translation.title,
    contentMarkdown: translation.contentMarkdown,
    tags: ["template", galleryItem.tag],
  };
};

export const listMemoTemplateGallery = (locale: string | null | undefined): MemoTemplateGalleryEntry[] =>
  MEMO_TEMPLATE_GALLERY.map((galleryItem) => localizeMemoTemplateGalleryItem(galleryItem, locale));
