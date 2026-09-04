# EdgeEver Paw mode: design and tradeoffs

[简体中文](personality-memory-agent.zh-CN.md)

Updated: 2026-09-03. This document describes the current product direction, implementation boundaries, and outstanding validation—not release notes or a development log. Git retains implementation history and verification records.

## 1. Product positioning

The Agent is a long-term assistant working with the user's knowledge, not just a chatbot familiar with notes or a general-purpose computer operator. Its value is connecting scattered records, understanding enduring interests, and helping organize notes.

The product must stay lightweight, fast, and reliable. Presence can be subtle; suggestions must be useful. Personality should emerge through continuing understanding, accurate memory, and measured actions—not anthropomorphic lines, simulated emotions, or frequent interruptions. Chat is a supporting entry point, not the primary experience.

The main flow is: normal note-taking → the Agent identifies an opportunity at an appropriate time → grounded information or an action proposal → execution after confirmation. Without a worthwhile result, remain quiet.

## 2. Interaction rules

- Entry: Settings → Paw mode, off by default. It can be enabled only after a default AI model is configured and enabled; the client links to model setup and the server enforces the same model-availability check. Paw mode can still be turned off while the model is unavailable. Enabling covers all notes in the current account, including child notebooks and future notes, without notebook selection. This does not mean reading or sending the entire library at once.
- Use a small bell and unread dot, without primary navigation, automatic popups, or system notifications. Currently available to signed-in personal accounts on non-demo instances with login enabled; no native Android/iOS entry yet.
- Informational notifications offer useful connections, explanations, and source links without requiring a task. Action notifications explain which notes will change, how, and with what consequences; confirmation invokes existing note capabilities.
- Suggestions do not enter the normal note list or automatically become “AI suggestion drafts.” Notes are created or modified only after confirmation of the corresponding write.
- Users may dismiss suggestions or disable the mode. Disabling invalidates unconfirmed discovery actions; already-started confirmed operations retain receipts. Disabling does not undo completed changes.

The settings page starts with a short benefit description, then makes the background behavior visible without adding configuration burden. A read-only status panel shows whether Paw mode is idle, checking, ready, or failed; the last check time; the conditions for another check; the data scope and confirmation boundary; and the latest generated discovery when one exists:

> When enabled, EdgeEver quietly helps tuck scattered fragments together, append new ideas to existing notes, and surface relevant past insights like a gentle cat paw.
>
> The longer you use it, the better Paw mode understands you.

## 3. Current capabilities and boundaries

| Path | Current capability | Boundary |
| --- | --- | --- |
| Proactive discovery: connections | Resurface related older notes and explain their connection to new records | Sources required; no notification without a suitable result |
| Proactive discovery: merge | Combine fragments of one idea while preserving text, attachments, and tags | Confirmation required; sources move to trash and their shares are revoked; no complete one-click undo promise |
| Proactive discovery: append | Add a new fragment to an existing note while preserving the source and original target content | Currently limited to plain-text notes without attachments; no automatic rewriting of rich documents |
| Optional conversation: note tools | 28 existing tools: 13 reads and 15 confirmed writes covering creation, import, editing, merging, moving, tags, trash, revision recovery, and notebook organization | Discovery does not propose all these operations; permanent deletion, public sharing, binary uploads, and system administration are not exposed |

“Conversation and personal memory” remains an optional settings entry. Conversation currently has independent note-access and memory controls, with note access off by default; these are not unified with the Paw-mode switch. This is the implementation state, not a requirement to select notebooks, and must not be presented as a single permission switch across the product.

“Note-operation capabilities” means reusing existing APIs and business services, not building another note system or granting unattended write authority to the model. Proactive tagging and other notification-based organization scenarios are not yet connected; the full tool catalog must not be advertised as proactive functionality.

## 4. Personality and memory

The long-term goal is for suggestions to reflect preferences, project context, shared decisions, and feedback. Personality and memory belong to EdgeEver's product data and behavior rules, not to a particular model; their value does not depend on adding a dedicated chat surface.

Implemented today:

- A product-controlled stable identity, conversation continuity, and explicit cross-conversation memory in the optional conversation workspace.
- Users manually add memories or save their own words through the UI, and can correct, forget, or suspend their use. The model cannot independently add or remove memories.
- Small-scale retrieval using segmentation, weighted keywords, and update recency, without a vector index. Memory edits/forgetting invalidate old context; user-confirmed information must remain distinct from model inference.
- Server-side storage isolated by workspace and user. Separate JSON export includes memories, chats, and organization records; import merges memories only, not chats or execution records.

Not yet connected: proactive discovery does not read personal memory. Current notifications must not be described as understanding long-term preferences. Automatic memory candidates, relationship modeling, and suggestion adaptation based on long-term feedback are also unimplemented.

The next priority is to test whether controlled memory improves relevance, not to expand personality settings. Connecting memory to discovery requires explicit user control, provenance, correction, and forgetting propagation; do not silently broaden memory use. Dismissing one notification should not directly become a lasting preference.

Deleting a note does not delete its text or snapshots in chats; forgetting a memory does not delete its source. This data is not yet included in note ZIP backups, desktop offline mirrors, or native mobile sync. Do not promise full cross-device recovery or deletion of exported files or provider-retained data.

## 5. How the implementation works

The architecture is “client trigger + server-side retrieval and model judgment + existing business operations after confirmation,” not an autonomous program permanently running inside Electron. The client handles interaction and sync checks; the instance server handles model calls, authorization, and persistence.

```text
Client activity/sync/visibility events → idle check → server rate/change checks
  → retrieve a few relevant notes → model returns a structured suggestion
      ├─ No useful result: finish without notification
      ├─ Knowledge connection: persist discovery → informational notification
      └─ Organization proposal: persist discovery and action → confirmation notification
          → user confirms action ID → revalidate → existing note service executes → save receipt, refresh notes
```

### How proactive discoveries are generated

1. Client events reset a one-shot idle timer rather than a polling loop. Before a check, verify visibility, connectivity, and pending sync changes. A conditional database update claims the server-side check; account rate limits and the workspace change cursor prevent duplicate model calls across devices.
2. Start from a recently updated note, find related records through existing search, and read bodies within the budget. The model sees only selected notes; it does not connect directly to the database or automatically know the entire library.
3. Create a `ToolLoopAgent` on demand, using `Output.object` and a shared schema to constrain output to no suggestion or one `insight / merge / append`. This path exposes no model-callable tools. The model judges connections and explains reasons; the server revalidates source IDs, data versions, and operation conditions.
4. The server constructs concrete merge/append tool arguments and persists notifications in `companion_discoveries` and action plans in `companion_actions`. Deduplicate by type and source combination. These are separate records, not ordinary notes; the client reads them to display the two notification types.

### How personality, memory, and conversation work

Optional conversation combines product-maintained identity instructions, the current message, eligible recent conversation, retrieved explicit memories, and tool results into model context. Memories come from the database and are selected by relevance when the user permits their use. This is not model training or reliance on the provider automatically remembering the user. Proactive discovery currently does not use this personal-memory retrieval path.

The conversation `ToolLoopAgent` can call exposed note tools within a step budget: read tools return query results immediately, while write tools only persist proposals awaiting confirmation. Tool definitions reuse the MCP catalog, but the built-in Agent calls the shared business executor directly, without an external MCP client round trip.

### Which database tables are involved

Seven Agent-specific tables live in the existing instance database; no separate database is introduced. Business records are scoped by workspace and user; `companion_action_checks` is for transaction-local validation and stores no user content.

| Table | Purpose |
| --- | --- |
| `companion_discovery_settings` | Stores the Agent switch, settings version, check time, workspace cursor, and active check claim. `last_input_hash` holds the last successfully analyzed input fingerprint to reduce repeat calls. The retained `notebook_ids_json` no longer selects the note-access scope. |
| `companion_discoveries` | Stores notification type, title, body, sources, deduplication fingerprint, and seen/dismissed status. `turn_id` links to the generation run; action notifications also link to a proposal through `action_id`. These are not notes. |
| `companion_turns` | Stores conversation or discovery generation runs: input, response, sources, model, permission snapshot, context version, status, and expiry. Token fields record usage when available, not complete billing statistics for every discovery request. `origin` distinguishes chat from discovery. |
| `companion_actions` | Stores exact proposed arguments and source snapshots, status, expiry, execution claims, and result receipts. Confirmation executes this persisted record without having the model regenerate arguments. |
| `companion_state` | Stores the account's `memory_revision` context version. Editing/forgetting memories or clearing history increments it to prevent generation or execution with stale context. It does not store personality content. |
| `companion_memories` | Stores explicitly added long-term memories, optional source runs, versions, and timestamps. Optional conversation retrieves them; proactive discovery currently does not. |
| `companion_action_checks` | Asserts valid permissions, context, and data versions within a database batch. A failed constraint rolls back the batch; successful check rows are deleted before commit. This is not an operation log or task queue. |

Identity instructions and tool-exposure rules remain in code; there is no separate “personality table.” Schemas are defined by migrations [0040](../migrations/0040_companion_memory.sql), [0041](../migrations/0041_companion_actions.sql), [0042](../migrations/0042_companion_tool_execution.sql), [0043](../migrations/0043_companion_discovery.sql), and [0044](../migrations/0044_companion_discovery_input_hash.sql).

### Why confirmation can execute directly

Confirmation submits an action ID instead of asking the model to regenerate a task. The server reads the persisted arguments and source snapshots, rechecks account, status, expiry, and versions, then calls existing note services. Execution claims and write guards apply within database batches; outcomes become persistent receipts. The client uses those receipts to show success or uncertainty and refresh notes. Model judgment and actual writes are separate; the next section specifies conflict and partial-completion boundaries.

Implementation entry points: [client triggers](../apps/web/src/components/CompanionDiscoveryHub.tsx), [discovery service](../apps/api/src/companion-discovery.ts), [structured generation](../apps/api/src/companion-discovery-runtime.ts), [conversation and memory retrieval](../apps/api/src/companion-runtime.ts), [tool catalog](../apps/api/src/companion-tool-catalog.ts), [confirmed execution](../apps/api/src/companion-tool-actions.ts).

## 6. Technical and reliability tradeoffs

### Reuse existing capabilities

Keep AI SDK `ToolLoopAgent` and existing model configuration; EdgeEver manages identity, memory, permissions, proposals, and execution receipts. Do not currently introduce Mastra, ElizaOS, a second database, or a custom general-purpose agent/workflow framework.

Tool names and parameters come from the existing MCP catalog and use the same business executor. Add only Agent exposure policy, preview, and confirmation adaptation. Cloudflare and Docker share business logic. Agent UI and server-side AI runtimes load on demand; build tests inspect the entire startup dependency graph, including shared chunks.

There are no new runtime dependencies, always-on autonomous processes, or bundled local models. No new dependencies does not mean zero package growth, memory use, model fees, or maintenance. Measure actual deltas rather than promising results from early, non-reproducible framework comparisons.

### Projects considered and why they were not adopted

- [ElizaOS](https://github.com/elizaos/eliza): considered as a reference for personality, memory, and plugin-based agents. EdgeEver already has note storage, plugins, and permissions; adopting another agent runtime would require reconciling its memory, state, and plugin contracts. Current lightweight discovery and confirmed organization do not yet justify that adaptation cost. Retain design ideas without adopting the runtime.
- [Mastra](https://github.com/mastra-ai/mastra): evaluated for its TypeScript agents, memory, workflows, and human approval capabilities. Model integration, the tool loop, and note execution already have reusable foundations, while current flows do not require full workflow orchestration. A framework would still require EdgeEver-specific permissions, version checks, and memory governance; the benefits do not yet justify additional dependencies and integration maintenance.

This is a provisional decision based on current scope and architecture, not a claim that either framework cannot be embedded in Electron or necessarily consumes excessive resources. Reevaluate if requirements outgrow the maintainable scope of the existing approach, using package-size, memory, and startup measurements from an actual integration.

### Bounded cost

- Proactive checks run only while the app is open, visible, online, free of pending sync changes, and inactive for three minutes. A cross-device limit allows at most one attempt per account per 24 hours; unchanged notes are skipped. After one completed check, the client makes no further request in that session until another note or sync change occurs. This is not an always-running background service.
- Each check selects a small set from recent records and keyword searches: at most six note bodies totaling 12,000 characters. One structured generation, at most 1,200 output tokens, cancellation after 60 seconds, and no automatic model retries.
- Full conversations have separate tool-call, context, concurrency, and timeout budgets. Library-wide authorization does not mean putting the entire library into a prompt.
- Selected content is sent to the user's configured default model provider. A check can incur charges without producing a visible suggestion. Keyword retrieval may miss semantic connections, and low-frequency checks do not guarantee timely discovery of every opportunity.

### Token controls

- Proactive discovery stores a fingerprint of the last successfully analyzed input. Even when unrelated workspace changes trigger another eligible check, identical candidate notes, instructions, language, settings, context, and model-configuration versions skip the model call. Successful no-suggestion results count too. Failures are not cached; clearing history removes the fingerprint. Old results are not replayed and invalidated actions are not revived.
- Note IDs sent to the model become short, invocation-local aliases, strictly mapped back to real IDs by the server. Bodies remain complete; organization sources are not truncated to save tokens.
- Conversations retrieve at most eight relevant memories, reducing the total memory-body budget from 8,000 to 4,000 characters. Without keyword matches, retain at most two recent memories. Stored memories are not deleted, but relevant older preferences may be missed; validate this tradeoff against real scenarios.
- Repeated reads of a completely read note within one run return a reference hint, reusing the body already in that run's context. Authorization and data-version checks still apply; there is no cross-run cache. Confirmed operations continue to use persisted arguments without another model call.

These controls reuse the existing AI SDK without changing the default model, trigger frequency, or confirmation permissions. Character budgets are not token measurements; actual cost depends on model, language, and content, so no fixed savings percentage is promised. Upgrades require [database migration 0044](../migrations/0044_companion_discovery_input_hash.sql), which adds only a nullable fingerprint field without changing note content.

### Confirmation and recovery

1. The model proposes; the server validates sources and arguments. For proactive merges/appends, the server constructs the arguments. Persist the exact operation, reason, and data versions; a proposal does not modify notes.
2. Confirmation binds to that operation, without another model decision at execution. Check account, expiry, source versions, and sync state; expired proposals or changed data require regeneration.
3. Reuse transactions, execution claims, and persistent receipts to prevent duplicate confirmation and concurrent overwrites. Recover or query outcomes after disconnection; generated text is not a success receipt, and uncertain writes must not be blindly replayed.
4. Multi-batch operations may partially complete; cancellation does not roll back completed effects. The current workspace-cursor policy is conservative, so unrelated note changes may also invalidate other proposals.

Notes, memories, attachments, and tool results are untrusted data. They cannot change identity, grant permissions, or forge confirmation. Do not expose shell/computer control, automatic external messaging, or publication, or relax authorization because the Agent “knows the user.”

## 7. Outstanding validation and priorities

- Build a real-note evaluation set: whether fragments belong to one idea, whether merging/appending is worthwhile, and whether connections are useful. Measure false positives, interruptions, acceptance, and harmful organization—not notification count or chat duration.
- Validate structured outputs, tool calling, cancellation, source accuracy, and prompt-injection defenses with real models. Model failures must not disrupt ordinary note operations.
- Measure installer size, cold start, CPU, RSS/heap, and model costs with the Agent disabled, idle, on first use, during sustained use, and after cancellation. Separate client and server measurements; use the [desktop performance baseline](desktop-performance-baseline.md).
- Once current scenarios are reliable, evaluate memory-informed suggestions, proactive tagging, and consistent permissions across conversation and Paw mode. These document goals are not completed features.
- Complete backup/recovery, deletion propagation, and cross-device experience. Automation, reminders, multiple agents, and heavier retrieval infrastructure are not in the current default scope; reconsider only when actual needs and measurements justify them.

Implementation changes must pass relevant tests, the full non-E2E suite, `bun run typecheck`, `bun run typecheck:mobile`, and `bun run build:web`. Passing tests does not establish suggestion quality or acceptable resource usage.

Zero new dependencies is a current strategy, not a permanent prohibition. New dependencies must justify user value, resource deltas, maintenance costs, and an exit path; never reinvent a general framework merely to preserve a “zero dependencies” claim.
