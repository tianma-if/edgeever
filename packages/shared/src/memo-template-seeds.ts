import { resolveSupportedLocale } from "./i18n/locales";

export type MemoTemplateSeedLocale = "zh-CN" | "zh-TW" | "en-US" | "ja" | "pl" | "ru" | "es" | "de" | "fr";

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
  zhTW: MemoTemplateSeedTranslation,
  enUS: MemoTemplateSeedTranslation,
  ja: MemoTemplateSeedTranslation,
  pl: MemoTemplateSeedTranslation,
  ru: MemoTemplateSeedTranslation,
  es: MemoTemplateSeedTranslation,
  de: MemoTemplateSeedTranslation,
  fr: MemoTemplateSeedTranslation,
): MemoTemplateSeed => ({
  ...metadata,
  translations: { "zh-CN": zhCN, "zh-TW": zhTW, "en-US": enUS, ja, pl, ru, es, de, fr },
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
      title: "靈感速記",
      description: "快速捕捉閃念、臨時靈感、資料連結與即刻行動。",
      contentMarkdown: "## 💡 閃念記錄\n\n- \n\n## 📌 背景與補充說明\n\n\n\n## 🚀 下一步動作\n\n- [ ] ",
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
      title: "Быстрая заметка",
      description: "Записывайте мимолётные мысли, идеи, ссылки и ближайшие действия.",
      contentMarkdown: "## 💡 Мимолётные мысли\n\n- \n\n## 📌 Контекст и заметки\n\n\n\n## 🚀 Дальше\n\n- [ ] ",
    },
    {
      title: "Nota rápida",
      description: "Capture pensamientos fugaces, ideas, enlaces y acciones inmediatas.",
      contentMarkdown: "## 💡 Pensamientos fugaces\n\n- \n\n## 📌 Contexto y notas\n\n\n\n## 🚀 Próximas acciones\n\n- [ ] ",
    },
    {
      title: "Kurznotiz",
      description: "Halten Sie flüchtige Gedanken, Ideen, Links und sofortige Aufgaben fest.",
      contentMarkdown: "## 💡 Flüchtige Gedanken\n\n- \n\n## 📌 Kontext & Notizen\n\n\n\n## 🚀 Nächste Aktionen\n\n- [ ] ",
    },
    {
      title: "Note rapide",
      description: "Capturez des pensées éphémères, des idées, des liens et des actions immédiates.",
      contentMarkdown: "## 💡 Pensées éphémères\n\n- \n\n## 📌 Contexte et remarques\n\n\n\n## 🚀 Prochaines actions\n\n- [ ] ",
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
      title: "會議記錄",
      description: "結構化記錄議題背景、核心結論與帶負責人的待辦事項。",
      contentMarkdown: "# 📝 會議記錄\n\n- **時間**：\n- **主持人/記錄人**：\n- **出席者**：\n\n---\n\n## 🎯 會議目標\n\n- \n\n## 💬 核心討論與決策\n\n1. **[議題 1]**\n   - 討論要點：\n   - ✅ **決議**：\n\n2. **[議題 2]**\n   - 討論要點：\n   - ✅ **決議**：\n\n## 📋 待辦事項 (Action Items)\n\n- [ ] **[負責人]** 任務描述 (截止日期：MM-DD)\n- [ ] **[負責人]** 任務描述 (截止日期：MM-DD)\n",
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
      title: "Протокол встречи",
      description: "Структурированная запись повестки, решений и задач с ответственными.",
      contentMarkdown: "# 📝 Протокол встречи\n\n- **Время**:\n- **Ведущий/запись**:\n- **Участники**:\n\n---\n\n## 🎯 Цель\n\n- \n\n## 💬 Обсуждение и решения\n\n1. **[Тема 1]**\n   - Главное:\n   - ✅ **Решение**:\n\n2. **[Тема 2]**\n   - Главное:\n   - ✅ **Решение**:\n\n## 📋 Задачи\n\n- [ ] **[Ответственный]** Описание задачи (срок: ММ-ДД)\n- [ ] **[Ответственный]** Описание задачи (срок: ММ-ДД)\n",
    },
    {
      title: "Acta de reunión",
      description: "Registro estructurado del orden del día, decisiones clave y tareas pendientes con responsables.",
      contentMarkdown: "# 📝 Acta de reunión\n\n- **Hora**:\n- **Organizador/Secretario**:\n- **Asistentes**:\n\n---\n\n## 🎯 Objetivo\n\n- \n\n## 💬 Discusión y decisiones\n\n1. **[Tema 1]**\n   - Puntos clave:\n   - ✅ **Decisión**:\n\n2. **[Tema 2]**\n   - Puntos clave:\n   - ✅ **Decisión**:\n\n## 📋 Tareas pendientes\n\n- [ ] **[Responsable]** Descripción de la tarea (Fecha límite: MM-DD)\n- [ ] **[Responsable]** Descripción de la tarea (Fecha límite: MM-DD)\n",
    },
    {
      title: "Besprechungsprotokoll",
      description: "Strukturierte Erfassung von Tagesordnung, wichtigen Beschlüssen und Aufgaben mit Verantwortlichen.",
      contentMarkdown: "# 📝 Besprechungsprotokoll\n\n- **Uhrzeit**:\n- **Leitung/Protokoll**:\n- **Teilnehmer**:\n\n---\n\n## 🎯 Ziel\n\n- \n\n## 💬 Diskussion & Entscheidungen\n\n1. **[Thema 1]**\n   - Wichtige Punkte:\n   - ✅ **Entscheidung**:\n\n2. **[Thema 2]**\n   - Wichtige Punkte:\n   - ✅ **Entscheidung**:\n\n## 📋 Aufgaben\n\n- [ ] **[Verantwortlich]** Aufgabenbeschreibung (Fällig: MM-DD)\n- [ ] **[Verantwortlich]** Aufgabenbeschreibung (Fällig: MM-DD)\n",
    },
    {
      title: "Compte-rendu de réunion",
      description: "Compte-rendu structuré de l'ordre du jour, des décisions clés et des tâches à accomplir.",
      contentMarkdown: "# 📝 Compte-rendu de réunion\n\n- **Horaire** :\n- **Animateur/Secrétaire** :\n- **Participants** :\n\n---\n\n## 🎯 Objectif\n\n- \n\n## 💬 Échanges et décisions\n\n1. **[Sujet 1]**\n   - Points clés :\n   - ✅ **Décision** :\n\n2. **[Sujet 2]**\n   - Points clés :\n   - ✅ **Décision** :\n\n## 📋 Actions à mener\n\n- [ ] **[Responsable]** Description de la tâche (Échéance : MM-JJ)\n- [ ] **[Responsable]** Description de la tâche (Échéance : MM-JJ)\n",
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
      title: "週報與進展覆盤",
      description: "梳理本週核心產出、風險障礙與下週關鍵優先事項。",
      contentMarkdown: "# 🗓️ 工作週報\n\n## 🌟 本週核心進展 (Highlights)\n\n- [x] **[專案/功能]** 完成情況與成果說明\n- [x] **[專案/功能]** 完成情況與成果說明\n\n## 🚧 障礙與風險 (Blockers & Risks)\n\n- ⚠️ **阻塞項**：原因及所需支援\n\n## 🎯 下週優先事項 (Next Week Priorities)\n\n- [ ] \n- [ ] \n- [ ] \n\n## 💡 總結與思考\n\n- \n",
    },
    {
      title: "Weekly Review & Status",
      description: "Summarize weekly highlights, blockers, and next week\x27s key priorities.",
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
      title: "Итоги недели",
      description: "Главное за неделю, препятствия и приоритеты на следующую.",
      contentMarkdown: "# 🗓️ Отчёт за неделю\n\n## 🌟 Главное\n\n- [x] **[Проект/функция]** Что сделано\n- [x] **[Проект/функция]** Что сделано\n\n## 🚧 Препятствия и риски\n\n- ⚠️ **Препятствие**: причина и какая помощь нужна\n\n## 🎯 Приоритеты на следующую неделю\n\n- [ ] \n- [ ] \n- [ ] \n\n## 💡 Выводы\n\n- \n",
    },
    {
      title: "Revisión semanal y progreso",
      description: "Resuma los logros semanales, obstáculos y prioridades clave para la próxima semana.",
      contentMarkdown: "# 🗓️ Informe de estado semanal\n\n## 🌟 Logros destacados\n\n- [x] **[Proyecto/Función]** Detalles del logro\n- [x] **[Proyecto/Función]** Detalles del logro\n\n## 🚧 Obstáculos y riesgos\n\n- ⚠️ **Bloqueo**: Causa y apoyo necesario\n\n## 🎯 Prioridades para la próxima semana\n\n- [ ] \n- [ ] \n- [ ] \n\n## 💡 Reflexiones e ideas\n\n- \n",
    },
    {
      title: "Wochenrückblick & Status",
      description: "Fassen Sie wöchentliche Meilensteine, Hindernisse und Prioritäten für die nächste Woche zusammen.",
      contentMarkdown: "# 🗓️ Wöchentlicher Statusbericht\n\n## 🌟 Highlights\n\n- [x] **[Projekt/Feature]** Einzelheiten zum Fortschritt\n- [x] **[Projekt/Feature]** Einzelheiten zum Fortschritt\n\n## 🚧 Hindernisse & Risiken\n\n- ⚠️ **Blocker**: Ursache und benötigte Unterstützung\n\n## 🎯 Prioritäten für nächste Woche\n\n- [ ] \n- [ ] \n- [ ] \n\n## 💡 Reflexion & Erkenntnisse\n\n- \n",
    },
    {
      title: "Revue hebdomadaire et bilan",
      description: "Faites le point sur les réussites de la semaine, les blocages et les priorités clés pour la semaine suivante.",
      contentMarkdown: "# 🗓️ Rapport d'activité hebdomadaire\n\n## 🌟 Points marquants\n\n- [x] **[Projet/Fonctionnalité]** Détails des réalisations\n- [x] **[Projet/Fonctionnalité]** Détails des réalisations\n\n## 🚧 Blocages et risques\n\n- ⚠️ **Blocage** : Cause et assistance requise\n\n## 🎯 Priorités de la semaine prochaine\n\n- [ ] \n- [ ] \n- [ ] \n\n## 💡 Bilan et réflexions\n\n- \n",
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
      title: "深度閱讀卡片",
      description: "提煉核心觀點、精妙摘錄、個人理解與關聯知識卡片。",
      contentMarkdown: "# 📖 深度閱讀卡片\n\n- **書名/文章**：\n- **作者/來源**：\n- **推薦指數**：⭐⭐⭐⭐⭐\n\n---\n\n## 💡 一句話總結 (Key Takeaway)\n\n> \n\n## ✍️ 核心觀點與金句摘錄\n\n> [摘錄內容]\n> —— *原書/原文*\n\n## 🧠 我的理解與延伸思考\n\n- \n\n## 🔗 關聯知識與行動\n\n- [ ] **落地實踐**：\n",
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
      title: "Карточка чтения",
      description: "Главные выводы, цитаты, собственные мысли и связанные идеи.",
      contentMarkdown: "# 📖 Карточка чтения\n\n- **Книга/статья**:\n- **Автор/источник**:\n- **Оценка**: ⭐⭐⭐⭐⭐\n\n---\n\n## 💡 Главный вывод\n\n> \n\n## ✍️ Цитаты\n\n> [Текст цитаты]\n> —— *Источник*\n\n## 🧠 Свои мысли\n\n- \n\n## 🔗 Что сделать\n\n- [ ] **План**:\n",
    },
    {
      title: "Ficha de lectura profunda",
      description: "Extraiga conclusiones clave, citas, reflexiones personales y conceptos relacionados.",
      contentMarkdown: "# 📖 Ficha de lectura\n\n- **Libro/Artículo**:\n- **Autor/Fuente**:\n- **Calificación**: ⭐⭐⭐⭐⭐\n\n---\n\n## 💡 Conclusión clave\n\n> \n\n## ✍️ Citas destacadas\n\n> [Cita]\n> —— *Fuente original*\n\n## 🧠 Reflexiones personales\n\n- \n\n## 🔗 Acción y práctica\n\n- [ ] **Plan de acción**:\n",
    },
    {
      title: "Lese-Notizkarte",
      description: "Halten Sie Kernaussagen, Zitate, eigene Gedanken und verknüpfte Ideen fest.",
      contentMarkdown: "# 📖 Lese-Notizkarte\n\n- **Buch/Artikel**:\n- **Autor/Quelle**:\n- **Bewertung**: ⭐⭐⭐⭐⭐\n\n---\n\n## 💡 Kernaussage\n\n> \n\n## ✍️ Zitate & Höhepunkte\n\n> [Zitat]\n> —— *Originalquelle*\n\n## 🧠 Eigene Gedanken\n\n- \n\n## 🔗 Praxis & Umsetzung\n\n- [ ] **Aktionsplan**:\n",
    },
    {
      title: "Fiche de lecture approfondie",
      description: "Extrayez les idées clés, citations, réflexions personnelles et concepts associés.",
      contentMarkdown: "# 📖 Fiche de lecture\n\n- **Livre/Article** :\n- **Auteur/Source** :\n- **Évaluation** : ⭐⭐⭐⭐⭐\n\n---\n\n## 💡 Enseignement clé\n\n> \n\n## ✍️ Extraits et citations clés\n\n> [Extrait de citation]\n> —— *Source originale*\n\n## 🧠 Réflexions personnelles\n\n- \n\n## 🔗 Actions et mise en pratique\n\n- [ ] **Plan d'action** :\n",
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
      title: "目標與任務拆解",
      description: "明確 OKR 目標、關鍵結果、里程碑與具體執行清單。",
      contentMarkdown: "# 🎯 目標拆解\n\n- **週期**：\n- **負責人**：\n\n---\n\n## 📌 目標 (Objective)\n\n> \n\n## 📈 關鍵結果 (Key Results)\n\n- **KR 1**：期望指標 -> 目前進度\n- **KR 2**：期望指標 -> 目前進度\n\n## 🗓️ 里程碑節點 (Milestones)\n\n- [ ] **階段一 (日期)**：完成標的\n- [ ] **階段二 (日期)**：完成標的\n\n## 📋 執行任務清單\n\n- [ ] \n- [ ] \n",
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
      title: "Цели и разбиение задач",
      description: "Цели OKR, ключевые результаты, вехи и список дел.",
      contentMarkdown: "# 🎯 Разбор цели\n\n- **Период**:\n- **Ответственный**:\n\n---\n\n## 📌 Цель (Objective)\n\n> \n\n## 📈 Ключевые результаты (Key Results)\n\n- **KR 1**: целевой показатель -> текущий прогресс\n- **KR 2**: целевой показатель -> текущий прогресс\n\n## 🗓️ Вехи\n\n- [ ] **Этап 1 (дата)**: результат этапа\n- [ ] **Этап 2 (дата)**: результат этапа\n\n## 📋 Список дел\n\n- [ ] \n- [ ] \n",
    },
    {
      title: "Desglose de objetivos y tareas",
      description: "Defina objetivos OKR, resultados clave, hitos y listas de tareas.",
      contentMarkdown: "# 🎯 Desglose de objetivos\n\n- **Período**:\n- **Responsable**:\n\n---\n\n## 📌 Objetivo (Objective)\n\n> \n\n## 📈 Resultados clave (Key Results)\n\n- **KR 1**: Métrica objetivo -> Progreso actual\n- **KR 2**: Métrica objetivo -> Progreso actual\n\n## 🗓️ Hitos (Milestones)\n\n- [ ] **Fase 1 (Fecha)**: Meta\n- [ ] **Fase 2 (Fecha)**: Meta\n\n## 📋 Lista de tareas\n\n- [ ] \n- [ ] \n",
    },
    {
      title: "Ziele- & Aufgabenaufschlüsselung",
      description: "Definieren Sie OKR-Ziele, Schlüsselergebnisse, Meilensteine und Aufgabenlisten.",
      contentMarkdown: "# 🎯 Zielaufteilung\n\n- **Zeitraum**:\n- **Verantwortlich**:\n\n---\n\n## 📌 Ziel (Objective)\n\n> \n\n## 📈 Schlüsselergebnisse (Key Results)\n\n- **KR 1**: Zielwert -> Aktueller Fortschritt\n- **KR 2**: Zielwert -> Aktueller Fortschritt\n\n## 🗓️ Meilensteine\n\n- [ ] **Phase 1 (Datum)**: Ziel\n- [ ] **Phase 2 (Datum)**: Ziel\n\n## 📋 Aufgabenliste\n\n- [ ] \n- [ ] \n",
    },
    {
      title: "Décomposition des objectifs et tâches",
      description: "Définissez les objectifs OKR, résultats clés, jalons et listes de contrôle.",
      contentMarkdown: "# 🎯 Décomposition des objectifs\n\n- **Période** :\n- **Responsable** :\n\n---\n\n## 📌 Objectif (Objective)\n\n> \n\n## 📈 Résultats clés (Key Results)\n\n- **KR 1** : Indicateur cible -> Progression actuelle\n- **KR 2** : Indicateur cible -> Progression actuelle\n\n## 🗓️ Jalons (Milestones)\n\n- [ ] **Étape 1 (Date)** : Objectif de l'étape\n- [ ] **Étape 2 (Date)** : Objectif de l'étape\n\n## 📋 Liste des tâches\n\n- [ ] \n- [ ] \n",
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
 * Shows a default template in the viewer\x27s UI language while it still equals
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
