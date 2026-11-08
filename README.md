# Lemma

A local mathematics learning workspace: read one conceptual step, ask a question, and return along the right learning route. Each book has a persistent map and one Codex conversation.

## Run

Requirements: Node.js 22.13 or newer, npm, and an installed/authenticated Codex CLI (`codex login`). For live generation, the launching terminal must permit normal local networking and writes to your Codex runtime directory.

```sh
npm install
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

- A prompt starts a new tree. Initial generation prepares two conceptual steps, unless the task only needs one.
- Click any node to inspect it. Viewing does not move your formal reading position.
- **Continue** completes the current step and advances the saved reading route. The next step is prepared in the background.
- **Comment** saves a question and creates an explanation route. **Enter explanation** explicitly starts reading it; arriving results never replace the page you are viewing.
- Questions on old nodes return to the position saved when you asked. Nested questions return through the outer explanation.
- Use the tree buttons to explicitly resume a suspended tree, or the **Reading S…** button to return to the active step.
- Failed generation has a **Retry** action. Saved steps remain available.
- Revised unread content gets a new version. Old versions remain accessible from the revised step; a displayed old version stays visible with an update notice.
- **Clear map** removes the current book’s graph and progress, while preserving its material folder and Codex thread.

## Storage and configuration

SQLite workspace state lives in `.data/workspace.sqlite` by default, outside material folders. Browser refresh and application restart retain graph contents, questions, revisions, reading positions, and thread associations. Interrupted jobs recover as retryable failures. Stop the server before copying its SQLite database and associated WAL files for a backup.

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `4317` | Loopback HTTP port |
| `DATA_DIR` | `.data` | Application database directory |
| `CODEX_BIN` | `codex` | Codex executable path |
| `CODEX_MODEL` | Installed Codex default | Optional explicit model override |
| `AI_PROVIDER` | `codex` | Set `demo` for fixed sample content |
| `CHROME_PATH` | Installed Chrome channel | Executable used by browser verification |
| `TEST_URL` | `http://127.0.0.1:4317` | Browser test target |

The service binds to loopback and rejects foreign browser origins. Codex sessions use read-only material access and do not approve mutations. The application itself has no external hosting, analytics, or uploads. Live Codex generation uses your configured model provider and sends the context needed for that generation. Keep private materials subject to your provider/account policies.

## Verification

```sh
npm test                    # State machine + subprocess protocol fixtures
npm run build               # Whole-project TypeScript check and frontend build
npm run test:live            # Actual local Codex, isolated application database
```

For browser verification, start a separate demo instance in one terminal, then run the browser test in another:

```sh
AI_PROVIDER=demo DATA_DIR=.data/browser-test npm run dev
npm run test:browser
```

The browser test requires Google Chrome (or `CHROME_PATH`) and writes screenshots under `.data/screenshots`. It registers a verification book and clears that book’s map at the end; use the isolated test data directory. The live test creates a real persistent test Codex thread, checks material reading, background generation, a question return, Clear, restart and thread resumption. It uses ordinary model usage and keeps evidence under `.data/live-*`.

See [IMPLEMENTATION_STATUS.md](IMPLEMENTATION_STATUS.md) for tests actually executed and current environment blockers. Browser and live-model verification must not be inferred from fixture tests.

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
