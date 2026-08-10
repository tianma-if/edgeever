import Foundation

// MARK: - Server template

struct MemoTemplate: Codable, Equatable, Sendable, Identifiable {
    var id: String
    var name: String
    var description: String?
    var title: String?
    var contentMarkdown: String
    var tags: [String]
    var createdAt: String
    var updatedAt: String
}

struct TemplatesResponse: Codable, Sendable {
    var templates: [MemoTemplate]
}

// MARK: - Create seed (Android MobileCreateMemoSeed)

struct CreateMemoSeed: Equatable, Sendable {
    var title: String
    var contentMarkdown: String
    var tagsText: String

    var hasContent: Bool {
        !title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            || !contentMarkdown.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            || !tagsText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }
}

// MARK: - Selectable row (built-in + saved)

enum MemoTemplateSource: String, Equatable, Sendable {
    case builtin
    case saved
}

struct SelectableMemoTemplate: Identifiable, Equatable, Sendable {
    var id: String
    var name: String
    var description: String
    var title: String
    var contentMarkdown: String
    var tags: [String]
    var source: MemoTemplateSource

    var createSeed: CreateMemoSeed {
        CreateMemoSeed(
            title: title,
            contentMarkdown: contentMarkdown,
            tagsText: tags.joined(separator: ", ")
        )
    }
}

// MARK: - Built-in catalog (parity with apps/mobile + web i18n)

enum BuiltInMemoTemplates {
    private struct Item {
        var id: String
        var tag: String
        var titleZH: String
        var titleEN: String
        var descriptionZH: String
        var descriptionEN: String
        var contentMarkdownZH: String
        var contentMarkdownEN: String
    }

    private static let items: [Item] = [
        Item(
            id: "quick-note",
            tag: "quick-note",
            titleZH: "灵感速记",
            titleEN: "Quick Spark",
            descriptionZH: "快速捕捉闪念、临时灵感、资料链接与即刻行动。",
            descriptionEN: "Capture fleeting thoughts, ideas, links, and immediate action items.",
            contentMarkdownZH: "## 💡 闪念记录\n\n- \n\n## 📌 背景与补充说明\n\n\n\n## 🚀 下一步动作\n\n- [ ] ",
            contentMarkdownEN: "## 💡 Fleeting Thoughts\n\n- \n\n## 📌 Context & Notes\n\n\n\n## 🚀 Next Actions\n\n- [ ] "
        ),
        Item(
            id: "meeting",
            tag: "meeting",
            titleZH: "会议纪要",
            titleEN: "Meeting Minutes",
            descriptionZH: "结构化记录议题背景、核心结论与带负责人的待办事项。",
            descriptionEN: "Structured log for agenda, key decisions, and action items with owners.",
            contentMarkdownZH: "# 📝 会议纪要\n\n- **时间**：\n- **主持人/记录人**：\n- **参会人**：\n\n---\n\n## 🎯 会议目标\n\n- \n\n## 💬 核心讨论与决策\n\n1. **[议题 1]**\n   - 讨论要点：\n   - ✅ **决议**：\n\n2. **[议题 2]**\n   - 讨论要点：\n   - ✅ **决议**：\n\n## 📋 待办事项 (Action Items)\n\n- [ ] **[负责人]** 任务描述 (截止日期：MM-DD)\n- [ ] **[负责人]** 任务描述 (截止日期：MM-DD)\n",
            contentMarkdownEN: "# 📝 Meeting Minutes\n\n- **Time**:\n- **Host/Recorder**:\n- **Attendees**:\n\n---\n\n## 🎯 Goal\n\n- \n\n## 💬 Discussion & Decisions\n\n1. **[Topic 1]**\n   - Points:\n   - ✅ **Decision**:\n\n2. **[Topic 2]**\n   - Points:\n   - ✅ **Decision**:\n\n## 📋 Action Items\n\n- [ ] **[Owner]** Task description (Due: MM-DD)\n- [ ] **[Owner]** Task description (Due: MM-DD)\n"
        ),
        Item(
            id: "weekly-review",
            tag: "weekly-review",
            titleZH: "周报与进展复盘",
            titleEN: "Weekly Review & Status",
            descriptionZH: "梳理本周核心产出、风险卡点与下周关键优先级。",
            descriptionEN: "Summarize weekly highlights, blockers, and next week's key priorities.",
            contentMarkdownZH: "# 🗓️ 工作周报\n\n## 🌟 本周核心进展 (Highlights)\n\n- [x] **[项目/功能]** 完成情况与成果说明\n- [x] **[项目/功能]** 完成情况与成果说明\n\n## 🚧 卡点与风险 (Blockers & Risks)\n\n- ⚠️ **阻塞项**：原因及所需支持\n\n## 🎯 下周优先级 (Next Week Priorities)\n\n- [ ] \n- [ ] \n- [ ] \n\n## 💡 总结与思考\n\n- \n",
            contentMarkdownEN: "# 🗓️ Weekly Status Report\n\n## 🌟 Highlights\n\n- [x] **[Project/Feature]** Accomplishment details\n- [x] **[Project/Feature]** Accomplishment details\n\n## 🚧 Blockers & Risks\n\n- ⚠️ **Blocker**: Reason and required support\n\n## 🎯 Next Week Priorities\n\n- [ ] \n- [ ] \n- [ ] \n\n## 💡 Reflection & Insights\n\n- \n"
        ),
        Item(
            id: "reading",
            tag: "reading",
            titleZH: "深度阅读卡片",
            titleEN: "Reading Note Card",
            descriptionZH: "提炼核心观点、精妙摘录、个人理解与关联知识卡片。",
            descriptionEN: "Extract key takeaways, quotes, reflections, and connected concepts.",
            contentMarkdownZH: "# 📖 深度阅读卡片\n\n- **书名/文章**：\n- **作者/来源**：\n- **推荐指数**：⭐⭐⭐⭐⭐\n\n---\n\n## 💡 一句话总结 (Key Takeaway)\n\n> \n\n## ✍️ 核心观点与金句摘录\n\n> [摘录内容]\n> —— *原书/原文*\n\n## 🧠 我的理解与延伸思考\n\n- \n\n## 🔗 关联知识与行动\n\n- [ ] **落地实践**：\n",
            contentMarkdownEN: "# 📖 Reading Note Card\n\n- **Book/Article**:\n- **Author/Source**:\n- **Rating**: ⭐⭐⭐⭐⭐\n\n---\n\n## 💡 Key Takeaway\n\n> \n\n## ✍️ Highlights & Quotes\n\n> [Quote content]\n> —— *Original Source*\n\n## 🧠 Personal Reflections\n\n- \n\n## 🔗 Action & Practice\n\n- [ ] **Action Plan**:\n"
        ),
        Item(
            id: "okr",
            tag: "okr",
            titleZH: "目标与任务拆解",
            titleEN: "Goal & Task Breakdown",
            descriptionZH: "明确 OKR 目标、关键结果、里程碑与具体执行清单。",
            descriptionEN: "Define OKRs, Key Results, milestones, and task checklists.",
            contentMarkdownZH: "# 🎯 目标拆解\n\n- **周期**：\n- **负责人**：\n\n---\n\n## 📌 目标 (Objective)\n\n> \n\n## 📈 关键结果 (Key Results)\n\n- **KR 1**：期望指标 -> 当前进度\n- **KR 2**：期望指标 -> 当前进度\n\n## 🗓️ 里程碑节点 (Milestones)\n\n- [ ] **阶段一 (日期)**：完成标的\n- [ ] **阶段二 (日期)**：完成标的\n\n## 📋 执行任务清单\n\n- [ ] \n- [ ] \n",
            contentMarkdownEN: "# 🎯 Goal Breakdown\n\n- **Period**:\n- **Owner**:\n\n---\n\n## 📌 Objective\n\n> \n\n## 📈 Key Results\n\n- **KR 1**: Target metric -> Current progress\n- **KR 2**: Target metric -> Current progress\n\n## 🗓️ Milestones\n\n- [ ] **Phase 1 (Date)**: Target\n- [ ] **Phase 2 (Date)**: Target\n\n## 📋 Execution Checklist\n\n- [ ] \n- [ ] \n"
        ),
        Item(
            id: "post-mortem",
            tag: "post-mortem",
            titleZH: "问题排查与复盘",
            titleEN: "Problem & Post-mortem",
            descriptionZH: "记录故障现象、根因分析 (5 Whys) 与防范机制。",
            descriptionEN: "Document incident symptoms, 5-Whys root cause, and preventive measures.",
            contentMarkdownZH: "# 🔍 问题排查与复盘 (Post-mortem)\n\n- **发生时间**：\n- **影响范围**：\n- **处理状态**：已解决 / 处理中\n\n---\n\n## 🚨 故障现象与影响\n\n\n\n## 🛠️ 排查过程与解决方案\n\n1. \n2. \n\n## 🔬 根因分析 (Root Cause / 5 Whys)\n\n- **根本原因**：\n\n## 🛡️ 预防措施 (Action Items)\n\n- [ ] **[短期规避]** \n- [ ] **[长期优化]** \n",
            contentMarkdownEN: "# 🔍 Post-mortem & Problem Investigation\n\n- **Occurred At**:\n- **Impact Scope**:\n- **Status**: Resolved / In-Progress\n\n---\n\n## 🚨 Symptoms & Impact\n\n\n\n## 🛠️ Investigation & Fix Steps\n\n1. \n2. \n\n## 🔬 Root Cause Analysis (5 Whys)\n\n- **Root Cause**:\n\n## 🛡️ Action Items & Prevention\n\n- [ ] **[Short-term]** \n- [ ] **[Long-term]** \n"
        ),
    ]

    static func all(isEnglish: Bool) -> [SelectableMemoTemplate] {
        items.map { item in
            SelectableMemoTemplate(
                id: item.id,
                name: isEnglish ? item.titleEN : item.titleZH,
                description: isEnglish ? item.descriptionEN : item.descriptionZH,
                title: isEnglish ? item.titleEN : item.titleZH,
                contentMarkdown: isEnglish ? item.contentMarkdownEN : item.contentMarkdownZH,
                tags: ["template", item.tag],
                source: .builtin
            )
        }
    }

    static func fromSaved(_ template: MemoTemplate) -> SelectableMemoTemplate {
        SelectableMemoTemplate(
            id: template.id,
            name: template.name,
            description: template.description ?? "",
            title: template.title ?? template.name,
            contentMarkdown: template.contentMarkdown,
            tags: template.tags,
            source: .saved
        )
    }
}
