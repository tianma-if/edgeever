# EdgeEver Paw mode: design and tradeoffs

[简体中文](personality-memory-agent.zh-CN.md)

Updated: 2026-09-05. This describes implementation and validation limits, not release notes.

## 1. Product purpose

Paw connects knowledge and proposes organization during everyday note work. Long-term memory must change future suggestions, not merely accumulate chat logs. Explicit preferences and evidence-backed filing/tagging habits now form this loop; understanding every user intention is not promised.

Suggestions stay separate from notes. Without a useful result Paw stays quiet. Merge, append, filing and tagging require confirmation. Existing business services execute saved arguments; the model cannot rewrite them during confirmation or write unattended.

## 2. Controls and interface

- Settings → Paw mode. Initial activation requires an available default AI model. Disabling Paw, pausing learning and stopping memory use do not require a working provider.
- “Learn from my choices” processes future operations only. Re-enabling skips operations performed while paused; disabling Paw also stops learning processing.
- “Use saved memories” controls both chat and discovery. Chat retains per-request note access, off by default. Pausing learning keeps memories; disabling recall does not delete them.
- Existing accounts do not silently opt into learning or discovery memory. Enable these controls explicitly. The chat memory checkbox updates the same global setting.
- “Conversation and personal memory” shows explicit information, candidate/active/conflicting inferences and evidence. Memories can be corrected or forgotten.
- Organization cards offer “Stop suggesting this kind of organization,” recording an explicit preference for the source notebook. Ordinary dismissal is not a lasting preference.
- Web and desktop provide the UI. Native Android/iOS have no Paw entry yet. Only reliably attributed operations reaching the shared server business services can contribute; native end-to-end behavior is unverified.

## 3. Current capabilities

| Path | Capability and boundary |
| --- | --- |
| Connection | Explains a concrete relationship between at least two notes |
| Merge | Fragments of one concrete idea only; preserves text, attachments and tags, trashes sources and revokes shares; no complete one-click undo |
| Append | Adds a plain-text fragment to a target and preserves both originals; excludes complex documents and source attachments |
| Filing | Proposes an existing notebook; confirmation uses the existing move tool |
| Tagging | Uses tags present in candidate notes and preserves the target's existing tags |
| Optional chat | Retains the existing 28 note tools and confirmation flow; explicit and active inferred memories can enter context |

## 4. Learning and durable memory

Reuse the existing AI SDK, database and business services. No new agent framework, vector database or permanently running background process.

The first implementation uses deterministic evidence rules rather than model self-rated confidence:

1. Existing `memo.move`, `memo.update`, `tag.add/remove` audit records include before/after notebooks and tags. Note saving does not call a model or maintain memories.
2. Idle checks asynchronously consume committed audits, scoped to workspace/user and attributable user operations. Imports lack learning snapshots; tool execution is marked as agent activity and does not count as independent user behavior.
3. Learn two scoped patterns: notes with a particular tag are usually filed in a notebook; notes in a notebook are frequently given a particular tag.
4. Require three distinct notes, three independent time windows and at least two days of consistent choices. A bulk burst within ten minutes counts at most once. Event IDs deduplicate; evidence and processing cursor commit together.
5. Reevaluate when sources are deleted, filing changes, competing targets appear, or evidence exceeds 90 days. Conflicting inferences are excluded from recall. These thresholds are initial product rules, not proven accuracy guarantees.
6. Corrections become explicit user statements and cannot be overwritten by learning. Forgetting removes evidence and keeps a content-free rule exclusion key, preventing the same rule from returning from old or future observations.

Up to 50 memories, including at most 30 automatic inferences, reserving room for explicit preferences. Each pass consumes at most 50 audit events with a small number of rules per event and reviews at most 2,000 recent evidence records. Busy accounts may process later; learning every action is not guaranteed.

Automatic extraction from free-form chat, abstract project/relationship modeling, weighted learning from accepted suggestions, and precise undo attribution remain unimplemented. Explicit chat preferences can be saved with “Remember this message.” Paw's own operations do not positively reinforce its habits.

## 5. How memory changes suggestions

Discovery searches multiple keywords and recent records, selecting at most six complete note bodies within 12,000 characters. The most recently updated note remains the anchor; rotating through multiple anchors is not implemented.

Chat and discovery share memory selection: valid status, scope, keywords and recency, with explicit preferences before inferences. Up to eight records within 4,000 characters; a small fallback is used without keyword matches. No full-library prompt or model training.

The model receives selected notes, related memories and existing notebooks. Notes and memories are untrusted data, not permission changes or confirmations. Structured results cite note and memory identifiers; the server validates them and persists exact proposals. Cards can show memories used. Explicit “stop suggesting” rules are also filtered server-side.

Input fingerprints include memory and notebook context. A memory version change can trigger analysis without a note change and invalidates old context/pending actions. Execution still rechecks access, versions, sources and synchronization. Completed operations retain their receipts.

## 6. Storage, deletion and backup

New migration [0045](../migrations/0045_companion_learning.sql), without editing old migrations:

- Extend `companion_memories` with kind, scope, rule key and state; preserve legacy explicit records and versions.
- Add `companion_memory_evidence` and `companion_memory_exclusions` for evidence references and excluded rule identifiers.
- Extend discovery settings with learning/recall controls, learning cursor and last analyzed memory version.
- Expand the discovery kind constraint, preserve old discoveries and add used-memory IDs.

Records are isolated by workspace and user. Cloudflare/D1 and Docker/Bun SQLite share business services and SQL.

Separate JSON export uses version 2, preserving memory kinds and learning controls. Version 1 import remains supported. Version 2 merges memories and restores controls; imported inferences have no trusted evidence and remain candidates until explicitly confirmed. Notebook scopes, exclusions and evidence are not reconstructed across instances. Chat and execution history are not imported.

These records remain outside note ZIP backups, desktop offline mirrors and native mobile synchronization. Deleting a note retracts its learning evidence, not existing chat snapshots. Forgetting cannot delete exported files or provider-retained data.

## 7. Runtime and costs

Checks require a visible, online app without pending synchronization, after three idle minutes. Ordinary note changes are checked at most daily; memory changes can trigger earlier checks, at most hourly. Rate limits and concurrency claims are account-wide. The client does not poll continuously or retry without new events. Rule learning makes no model calls.

Each discovery makes at most one structured generation, with 1,200 output tokens, a 60-second timeout and no automatic paid retry. Selected notes and memories go to the default model provider; a check producing no notification can still cost money. Character budgets are not token counts; no fixed cost or savings claim.

## 8. Validation and rollback

Coverage includes bulk/repeated operations, pause/re-enable, isolation, conflicts, corrections, forgetting, candidate imports, memory-triggered discovery, filing/tagging confirmation and reopening/upgrading an old SQLite database. An isolated local D1 database also receives old migrations/data, then migration 0045, followed by data-preservation and foreign-key checks.

Run the full non-E2E suite, `bun run typecheck`, `bun run typecheck:mobile`, and `bun run build:web`. Browser verification uses Codex's built-in Browser.

Unverified: production D1 upgrade, long-term real-user suggestion quality, actual model cost and native mobile cross-version behavior. Do not claim no impact on existing users or automatic updates.

Pause learning to stop new evidence processing; disable memory use to return discovery to note context. Retain additive database fields instead of destructive reverse migrations. Disable Paw before downgrading code so old clients do not handle new discovery kinds. Confirmed note operations are not automatically undone by disabling or rolling back Paw.
