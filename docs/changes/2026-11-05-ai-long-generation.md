# Long generation in parts and continuations, sidebar body commands (#652 PR B)

[简体中文](2026-11-05-ai-long-generation.zh-CN.md)

Related Issue: #652

## Problem and outcome

After PR A (#791), models with known limits are no longer cut at 4096. Gateways without published limits, models with small limits, and notes larger than the context window still could not finish in one request: an incomplete result was flagged and could not replace the original, but the task itself was not done. In the Web and desktop sidebar, `/translate`, `/improve` and selection Translate were Agent turns, outside the automatic budget and truncation protection. This PR implements PR B as agreed in #652:

- Source-sized tasks (translate, proofread, polish, simplify, change tone) that one request cannot finish run in parts split along the Markdown structure.
- Tasks that depend on the whole note (continue writing, make longer, custom instructions) continue automatically after being cut off.
- In the Web and desktop sidebar, `/translate`, `/improve` and the selection menu's Translate use the note-generation flow. The result appears as one turn of the sidebar conversation, like an Agent reply, with copy, insert and replace, and the latest unapplied draft is restored on this device after a reload.
- The Android and iOS AI assistants and the Android editor selection panel run parts and continuations the same way, and show progress and the parts that could not finish.

## Allowed changes and acceptance

1. **Part planning (server prepare, shared pure functions)**:
   - The rules live in `packages/shared/src/ai-generation-segments.ts`. Using the `marked` lexer, a note is split only between top-level blocks. A heading stays with what follows it, and blank lines stay with the block before them. Code blocks, tables, HTML blocks and math are never cut. A block that alone is too long is split between list items, then between sentences. Joining the parts gives the source back character for character. A note with CRLF or mixed line endings is split as LF text and cut at the same places in the original, keeping its line endings.
   - Front matter and code-only parts are kept as is without a request.
   - A note is split when the estimated output passes 80% of the available output limit, when the input does not fit, or, without known limits, when the source is long (about 2,000 source tokens per part). A manual budget is used as the limit.
   - New clients send `segmentation` to prepare. When parts are needed, prepare returns `segments` instead of answering 413 for a long input. Each part is prepared with `segment`: its position, heading path, and the end of the previous part's source and result. The server tells the model that this is part i of n and to process only this part, and adds the context.
   - Unlike the original design in #652, the server plans the parts and returns them to every client (the reason is noted in #652). The server only splits text and never calls a model.
2. **Client orchestration (`packages/client` for Web, desktop and Android; iOS implements the same rules in Swift)**:
   - Each part is prepared and streamed directly from the model, in order. A `progress` event starts each part and `text-reset` fixes up the whole draft when a part ends.
   - A part that is cut off or does not fit is split again by the server through `segmentation.depth`, at most two levels. A part that still cannot finish keeps its source text and is listed in the finish event's `incompleteParts`. Any incomplete part blocks replace.
   - Other tasks that are cut off continue with the end of the text so far (up to 20,000 characters), at most three rounds, dropping text the model repeated at the seam. Only a continuation that adds text ends the cut-off state; an empty one, or one that only repeats what was there, leaves the draft incomplete and stops continuing. When the window has no room for a continuation, the run stops and the draft is incomplete.
   - Continuations run only when prepare says `longGeneration: true`. An older server ignores the continuation fields and would start over, so a new client on an older server does not continue and behaves as in PR A.
   - An error, a dropped connection or a stop in any part ends the run. The text so far stays as an incomplete draft, and requests that already returned are never repeated.
3. **Sidebar body commands (Web / desktop)**:
   - When the default model is available, `/translate [language]`, `/improve`, the skill buttons and the selection menu's Translate use note generation. Other words after a command become the user's instruction. `/summarize`, Explain and chat stay with the Agent, which can still edit notes.
   - The result is placed in the conversation by time: the command (or the quoted selection for selection Translate) is the user's message and the draft is the reply. Under it are progress, incomplete notices and the actions: copy, insert (after the selection or at the end of the note), replace (the note or the selection), regenerate and discard. A translation without a named language (`/translate`, the Translate button and selection Translate) first asks for the target language with the same question form the Agent uses: three likely languages (leaving out the source's language, the UI language's default first) or another one typed in, and starts only after Continue; `/translate en` translates directly. There is no language switch once the result is there. The draft is not written to the Agent's conversation history.
   - Replace is only offered for a finished, complete draft. Replacing the note after it changed since generation asks for confirmation. When the selected text or the document changed (Markdown source mode also compares the whole source, so identical text moved to the old offsets is not replaced), it offers to replace the text selected now, or asks the user to select the text again.
4. **Draft recovery (Web / desktop)**: each note keeps only its latest generated, unapplied draft on this device, isolated by instance and account (the account determines the workspace). It is cleared when applied or discarded; signing out cancels drafts being generated and removes the account's drafts on this instance. A request still generating ends with the page and does not resume after a reload. Drafts live in their own IndexedDB database `edgeever-ai-drafts`; the main local database `edgeever-local` keeps its schema version.
5. **Mobile UI**: the Android AI assistant, the editor selection panel and the iOS AI assistant show "Working on part i of n". When parts could not finish, they say which parts kept the original text and disable replace. Strings cover five languages.

## Unchanged boundaries, risks and recovery

- Across versions:
  - A new client on an older server gets no parts and does not continue. It runs PR A's single request, and truncation protection still applies.
  - An older client on a new server sends none of the new fields and behaves as in PR A.
  - There is no database migration.
- Worst cases:
  - Terms and style may vary between translated parts. Each part carries its heading path and the end of the previous part's source and result to reduce this.
  - Parts and continuations add requests, cost and time. The UI shows progress, and the user can stop at any time.
  - A part that never finishes keeps its original text. The UI says so and blocks replace.
  - A model may not resume exactly at the cut. The client only drops repeated text at the start, and cannot correct reworded text.
- Rollback: revert the code. The draft database is separate; older versions neither read it nor are affected by it.

## Implementation and acceptance

- Automated:
  - shared: the splitting rules (exact round trip; headings stay with their content; code, tables and math are never cut; front matter and code-only parts pass through; long lists and paragraphs are split; short code blocks stay with the text before them; parts prefer to start at a heading), when to split, joining continuations without repeats, too-short results, and draft completion with incomplete parts.
  - API: `segments` when parts are needed; no parts for short notes or open-ended tasks; older clients unaffected; parts instead of 413 without limits or window; one part's position and context; re-splitting a cut-off part; continuations counted against the window; invalid field combinations.
  - client: parts in order with context; no request for code-only parts; a cut-off part split again, and its source kept with replace blocked when it still fails; too-short results handled as incomplete; errors and stops end the run; up to three continuations without repeats; no continuation on an older server; parts end to end through prepare.
  - iOS unit tests: the same cases as the client.
  - Web: command parsing, source-change detection, and source assertions for the sidebar wiring and replace conditions.
  - Playwright (real browser, local dev, model provider mocked in the browser):
    - `/translate en` translates a 24-section note in several parts, the draft is restored after a reload, and it replaces the note;
    - a part that is always cut off keeps its source, reports part 2 as incomplete and blocks replace;
    - selection Translate replaces only the selection and leaves the rest of the note unchanged.
  - `bun run typecheck`, `bun run typecheck:mobile`, `bun run build:web` and `bun run lint` pass.
- Real providers (the preview instance runs this branch; the branch client calls models directly; the same long note as PR A: 40 Chinese Markdown sections with 41 headings, 8 code blocks, 40 links and a table):
  - An OpenAI-compatible gateway without published limits: the gateway ignores the client's `max_tokens` and cuts Claude Haiku 4.5 at about 8,192 tokens. In PR A, a full polish with this model was cut at 8,195 tokens. With this PR, translation and full polish each finished in 13 parts with a normal finish and no incomplete parts. All 40 sections, 41 headings, 16 code fences, 40 links and 5 table rows were kept, with no manual budget.
  - The first acceptance run found two problems, both fixed and retested:
    - when a part opened with a code block, the model treated it as context from the previous part and left it out;
    - a part that started mid-section came back as a fragment, losing four sections, while the model reported a normal finish.
    - Fixes: short code blocks stay with the text before them; parts prefer to start at a heading; the part instruction asks for every block; a result far shorter than its part counts as incomplete.
  - Known limits (DeepSeek official, output limit 393,216): the 40-section translation stays a single request (`max_tokens=45166`) with the structure intact.
  - Continuation: on DeepSeek official with a temporary manual budget of 4,096, making a 12-section note longer was cut at the limit, continued once, and finished normally. All 12 sections, links and code blocks were kept, with no repeat at the seam. The gateway above ignores `max_tokens`, so it cannot produce a cut for this test.
- Android device (preview APK, against the preview instance running this branch):
  - On the gateway without limits, Claude Haiku 4.5 on the 40-section note: the AI assistant showed part progress and finished completely, with replace available.
  - Continuation on DeepSeek official with the custom instruction "make every section three times longer":
    - with a manual budget of 4,096, three continuations were not enough, so the result was reported as reaching the output limit and replace was disabled;
    - with 8,192, the cut-off result continued automatically, finished normally, and could replace the note.
- iOS: build and unit tests pass on the fork's Actions, including the six part and continuation cases. The new simulator UI case "a cut-off result is continued and can replace" passed in one run; in another run it and "a complete result can replace" timed out while the app was launching and signing in, before the AI assistant opened. The other six cases passed in both runs.
- Regression tests for the review fixes:
  - CRLF splits into as many parts as LF and joins back exactly, as do mixed line endings and CRLF front matter;
  - after a first cut, a continuation that is empty, whitespace only or only repeats the text keeps the draft cut off and blocks replace (client and iOS);
  - Playwright: in Markdown source mode, deleting the selected line so identical text moves to the old offsets makes "Replace selection" ask again and leaves the note unchanged (the case fails without the fix);
  - signing out cancels every draft being generated in the window, a cancelled run is not saved, and the account's drafts on this instance are removed.
- Not verified: iOS device; the desktop app reuses the Web pages and was not packaged and tested separately.
