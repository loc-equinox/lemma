# Implementation status

## Delivery state

Implementation is present, but the Definition of Done is **not yet satisfied**. This execution environment denied dependency downloads, local listening sockets, writes to the installed Codex runtime, and `.git` creation. Its policy rejects execution-permission escalation. Normal development access has been requested; no permission grant has arrived.

## Implemented

- React/TypeScript desktop UI with book switching, graph pan/zoom, tree resume, reading pane, questions, progress, retry, Clear confirmation, Markdown and LaTeX.
- Express loopback API with input validation, origin/Host checks, SSE updates and SQLite persistence.
- Explicit per-tree reading cursors; route-slot return references; single and multi-step explanations; nested returns; revisiting completed nodes; duplicate-action protection.
- One successor buffered on the active route; serialized per-book jobs; question priority; cancellation tokens; canvas epochs and stale-result rejection.
- Structured AI slot allocation and output validation; immutable content revisions; preservation of displayed/completed versions.
- Codex App Server adapter for persistent thread creation/resumption, streaming, schema-constrained turns, interruption, timeout and disconnect recovery. Actual installed CLI 0.167.0 generated bindings were inspected.
- Deterministic demo provider, original sample material, installation documentation, and executable live/browser verification scripts.

## Executed checks

- **15 automated tests passed**, including an actual child-process JSON-RPC fixture. Coverage includes every deterministic acceptance scenario: initial steps, buffering, browsing purity, single/multiple/nested explanations, old-node questions, duplicate Continue, priority/cancellation races, unknown return destinations, revisions, multiple trees, Clear during generation, restart, retries, endings, malformed output, FIFO questions, and protocol streaming/interruption/resumption.
- Strict TypeScript checking passed for shared types, the state engine, storage, Codex adapter, demo provider, state tests and live/protocol scripts, using an existing local compiler.
- Frontend, HTTP entry point, and browser-test sources passed esbuild syntax transformation.
- A local existing Zod package's `zod/v4` export enabled offline tests. This temporary dependency directory is ignored; a normal `npm install` remains necessary to obtain the declared application dependencies.

## Verification blocked by the execution environment

- `npm install`: registry DNS failed with `ENOTFOUND`; offline install also failed because required packages are absent from cache. No lockfile could be resolved honestly.
- Full frontend typecheck and production build: awaiting dependencies.
- Actual HTTP startup/browser tests: a minimal Node server failed with `listen EPERM` on `127.0.0.1`.
- Actual Codex session generation/resumption: App Server exited because it could not initialize its SQLite runtime under `~/.codex`. Model-network access is also unavailable. Fixture protocol success does not verify a real model session.
- Git history: `git init` failed because this task’s filesystem policy makes `.git` read-only. No commits were created.

## Remaining acceptance work

With ordinary local development permissions: install dependencies; run `npm run build` and fix any discovered issues; launch demo mode; execute and visually inspect browser verification; execute live Codex verification and review actual generated mathematics; initialize and commit the source. The implementation is not represented as a verified working delivery until those checks succeed.

## Scope limits

Local, single-user desktop application. Textbook PDF extraction depends on local Codex tooling. No hosting, collaboration, or cross-device sync. The demo is deliberately deterministic and unsuitable for arbitrary mathematics questions.
