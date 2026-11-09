# Lemma

A local mathematics learning workspace: read one conceptual step, ask a question, and return along the right learning route. Each book has a persistent map and one Codex conversation.

## Run

Requirements: Node.js 22.13 or newer, npm, and an installed/authenticated Codex CLI (`codex login`). For live generation, the launching terminal must permit normal local networking and writes to your Codex runtime directory.

```sh
npm ci
npm run dev
```

Open **http://127.0.0.1:4317**. Add a book using its name and absolute material-directory path, then submit a learning prompt. A folder may contain PDFs, Markdown, notes, and a book-specific `AGENTS.md`. Material extraction capabilities depend on the local tools available to Codex; text/Markdown is the most reliable starting format.

To try the included original teaching fixture, use the absolute path to `examples/materials` as the material directory and ask: “Read convergence.md and explain Proposition 2 one conceptual step at a time.”

A deterministic demonstration needs no Codex login:

```sh
AI_PROVIDER=demo DATA_DIR=.data/demo npm run dev
```

Demo mode visibly labels itself and uses fixed convergence content. It does not answer arbitrary prompts.

For a production asset build:

```sh
npm run build
NODE_ENV=production npm start
```

The default development command uses Vite middleware and live reload. `npm start` serves a built `dist/` when present; otherwise it uses the same local development UI.

## Reading

- Use **Model** and **Reasoning** above the prompt to choose generation settings for the current book. Options come from the installed Codex model catalog, with only each model’s supported reasoning efforts offered. Choices persist across refresh/restart and Clear. They apply to the next generation; in-progress work and existing nodes keep their settings. **Codex default** restores the local configured model and effort without changing your global Codex configuration.
- A prompt starts a new tree. Initial generation prepares two conceptual steps, unless the task only needs one.
- Click any node to inspect it. The reader opens across the map area by default, with larger text and formulas. **Side by side** restores the map/reader layout: drag the divider to adjust their proportions (or focus it and use the arrow keys), and double-click it to reset. Both panels keep a minimum usable width. **Expand reader** opens the wide layout again, and **Back to map** closes the reader. Your layout and split ratio are remembered in this browser. Viewing and resizing do not move your formal reading position.
- **Continue** completes the current step and advances the saved reading route. The next step is prepared in the background.
- In the reading pane, switch between **Rendered** and **Markdown source**. Select a formula in the read-only source to copy its LaTeX, or use **Copy source** for the complete step. Switching views preserves your reading position and question draft.
- **Comment** saves a question and creates an explanation route. **Enter explanation** explicitly starts reading it; arriving results never replace the page you are viewing.
- Questions on old nodes return to the position saved when you asked. Nested questions return through the outer explanation.
- Use the tree buttons to explicitly resume a suspended tree, or the **Reading S…** button to return to the active step.
- Failed generation has a **Retry** action. Saved steps remain available.
- Revised unread content gets a new version. Old versions remain accessible from the revised step; a displayed old version stays visible with an update notice.
- **Clear map** removes the current book’s graph and progress, while preserving its material folder and Codex thread.

## Study progress, chapter notes, and references

The **Task** selector beside the prompt supports **Learn**, **Update progress**, and **Chapter notes**. Enter your instruction and submit. For chapter notes, supplying a stable **Chapter / topic** title updates that same section on later requests.

You can also submit explicit commands in the ordinary prompt:

```text
/progress 记录目前学习到哪里、尚未解决的问题以及下次从哪里继续。
/notes 整理第三章的重要定义、定理条件和证明思路，作为章节参考。
请更新学习进度
整理这一章的重要结论
```

Explicit update/save requests naming `STUDY_PROGRESS.md` or `STUDY_NOTES.md` are also recognized. Use the Task selector for instructions whose intent is ambiguous.

- **Progress** updates `STUDY_PROGRESS.md` in the book directory. Codex can look up existing progress and notes alongside actual reading state; prepared content must be distinguished from completed reading.
- **Chapter notes** save a managed chapter section in `STUDY_NOTES.md`. Existing CLI notes and other chapters remain in the file. Reuse the chapter title to replace that managed section.
- Saved content appears as a gold **Reference / Read only** node on the map; click it to open rendered/source views. It has no completion state or Continue action. Asking a question from a reference creates an explanation that returns to your saved reading position; with no active tree it creates a standalone question route.
- Each subsequent Codex generation receives current file paths and hashes; it can read the relevant document sections when needed. Unchanged document bodies are not replayed in every prompt. The Codex tool sandbox stays read-only; the application performs the narrowly scoped file writes after validating the result.
- Open saved references from their nodes on the map. CLI changes to the study files are picked up on subsequent generation.
- Clear removes canvas references and cancels outstanding document tasks, while preserving saved Markdown files. Existing references are snapshots: a displayed older version stays readable with an update notice.

File edits are checked against the version read at generation time. Conflicts fail visibly and can be retried against the latest file. Writes use a temporary file and atomic rename; before/after document bodies are retained in the application database's `document_writes` journal, including across Clear. The journal also recovers a completed file write if the application stopped before saving its canvas reference. This is separate from the temporary canvas data. Only regular files with the two specified names are supported; symlink targets are rejected and each document is limited to 512 KiB.

Additional verification: `npx tsx scripts/notes-browser-test.ts` against an isolated demo server on port 4320, and `npx tsx scripts/notes-live-test.ts` for actual Codex generation using temporary fixture materials. Neither script writes study documents in your registered book directory.

## Context and generation overhead

Codex keeps the conversation history. Ordinary turns send a compact reading-state update, assigned output slots, recent step identifiers, and (for questions) a bounded quotation of the source. They do not resend the whole tree or study files. A temporary read-only JSON lookup outside the book directory lets Codex retrieve exact older nodes, route/version information, or note sections when needed, including after conversation compaction. It is removed after the job or graceful shutdown. The full graph and progress remain authoritative in SQLite; cancellation and Clear validation are unchanged.

Normal continuation reuses the connected App Server and its known model catalog. Opening/reloading the model controls can refresh catalog metadata; expiry alone no longer adds a catalog query before generation. Resuming a thread requests metadata without returning the whole conversation to the application. Streaming text updates the status display only when its message changes.

Each new job records request size and adapter preparation/submission/first-event/total timing in its optional `metrics` field for local diagnosis. These do not measure total model input tokens or promise a fixed response time. Existing conversation history remains intact and Codex continues to manage its compaction.

`npx tsx scripts/context-benchmark.ts` compares a hypothetical next request against the old repeated context for the running workspace without generating content or changing reading state. `npx tsx scripts/context-live-test.ts` verifies actual continuation, exact historical lookup, progress writes and thread resumption in isolated temporary materials.

## Storage and configuration

SQLite workspace state lives in `.data/workspace.sqlite` by default, outside material folders. Browser refresh and application restart retain graph contents, questions, revisions, reading positions, and thread associations. Interrupted jobs recover as retryable failures. Stop the server before copying its SQLite database and associated WAL files for a backup.

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `4317` | Loopback HTTP port |
| `DATA_DIR` | `.data` | Application database directory |
| `CODEX_BIN` | `codex` | Codex executable path |
| `CODEX_MODEL` | Installed Codex default | Default model when the book uses **Codex default** |
| `AI_PROVIDER` | `codex` | Set `demo` for fixed sample content |
| `CHROME_PATH` | Installed Chrome channel | Executable used by browser verification |
| `TEST_URL` | `http://127.0.0.1:4317` | Browser test target |

The service binds to loopback and rejects foreign browser origins. Codex sessions use read-only material access and do not approve mutations. The application itself has no external hosting, analytics, or uploads. Live Codex generation uses your configured model provider and sends the context needed for that generation. Keep private materials subject to your provider/account policies.

## Verification

```sh
npm test                    # State machine + subprocess protocol fixtures
npm run build               # Whole-project TypeScript check and frontend build
npm run test:live            # Actual local Codex, isolated application database
npm run test:live:interrupt  # Interrupt a real turn in that test workspace
```

For browser verification, start a separate demo instance in one terminal, then run the browser test in another:

```sh
AI_PROVIDER=demo DATA_DIR=.data/browser-test npm run dev
npm run test:browser
```

The browser test requires Google Chrome (or `CHROME_PATH`) and writes screenshots under `.data/screenshots`. It registers a verification book and clears that book’s map at the end; use the isolated test data directory. The live test creates a real persistent test Codex thread, checks material reading, background generation, a question return, Clear, restart and thread resumption. The interruption test resumes that isolated test workspace and confirms an actual interrupted turn after Clear. It uses ordinary model usage and keeps evidence under `.data/live-*`.

Model-selection checks are available as `node --import tsx scripts/model-live-test.ts` (real model usage) and `node --import tsx scripts/model-browser-test.ts`. For the latter, start an isolated fixture server with `CODEX_BIN="$PWD/tests/fixtures/fake-codex.mjs" DATA_DIR=.data/model-browser PORT=4319 npm start`; it exercises model/effort switching without inference.

The state/HTTP suite, full build, Chrome browser workflow, model switching, and real Codex generation/resumption/interruption have all passed. See [IMPLEMENTATION_STATUS.md](IMPLEMENTATION_STATUS.md) for the verification record and practical limits.

## Project structure

- `src/server/engine.ts`: reading routes, jobs, cancellation, revisions and validation.
- `src/server/codex.ts`: Codex App Server JSON-RPC, streaming and interruption.
- `src/server/store.ts`: SQLite persistence and restart recovery.
- `src/server/index.ts`: loopback HTTP API and server-sent events.
- `src/shared/`: typed state and navigation resolution.
- `src/client/`: React graph canvas, reading UI and math rendering.
- `tests/`: deterministic lifecycle tests and a subprocess protocol fixture.
- `scripts/`: actual browser and Codex verification.
- `examples/materials/`: a small original mathematical teaching fixture.

[ARCHITECTURE.md](ARCHITECTURE.md) records state models and design defaults. [PROJECT_SPEC.md](PROJECT_SPEC.md) remains the functional specification.
