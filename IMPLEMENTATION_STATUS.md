# Implementation status

## Delivery

The first usable version is implemented and verified. The earlier execution-sandbox blockers were removed when full access was enabled. Dependencies are installed, the lockfile is committed, the production frontend builds, and real Codex session creation, generation, interruption and resumption have passed.

## Implemented behavior

- Multiple local books, one persistent Codex conversation per book, and multiple learning trees per map. Per-book Model/Reasoning selectors use the installed Codex catalog, persist across refresh/restart/Clear, and apply to the next generation without interrupting active work or replacing a thread.
- Interactive graph, explicit tree resume, node reading, Markdown/LaTeX, question branches, generation feedback, retry, and Clear. The reading pane switches between rendered content and read-only Markdown source, with exact source copying for LaTeX questions. It opens over the full map area by default, with larger typography, a remembered split/expanded layout, and a Back to map action.
- Formal reading positions separate from displayed nodes; one successor buffered on the active route; explicit completion and duplicate-action protection.
- Single/multiple/nested explanations and return targets captured when the question is submitted, including targets not yet generated.
- Question priority, serialized per-book jobs, interruption, canvas epochs, stale-result rejection, and preservation of completed results.
- Validated structured AI output and immutable revisions of unread content. Old versions remain viewable; current or completed nodes cannot be silently replaced.
- Transactional SQLite persistence, restart recovery, and retryable interruption states.
- Read-only Codex material access, loopback HTTP, origin checks, and a separate, explicitly labeled deterministic demo mode.

## Verification completed (2026-11-09, Asia/Shanghai)

- **18 automated tests passed** (`npm test`). These cover the graph state machine, subprocess JSON-RPC transport, and real HTTP requests. HTTP testing launches, stops, and restarts the application and checks persisted reading state, book isolation, SSE, input/origin validation, and Clear during generation.
- **Full TypeScript check and production build passed** (`npm run build`).
- **Chrome browser verification passed** against the running application: book registration/switching, prompt generation, reading, Continue/prefetch, browsing without cursor movement, old-node questions, nested explanation returns, LaTeX rendering, refresh recovery, desktop/narrow layouts, and Clear. Source-view verification additionally checks exact Markdown/LaTeX preservation, clipboard copying, and unchanged reading position and question draft when toggling formats. No browser page exceptions were observed. Desktop and narrow screenshots were visually inspected. Expanded-reader checks confirmed the desktop reader grows from 440px to 1150px while preserving source text, question drafts and formal reading state; both wide and narrow overlays were visually inspected.
- **Real Codex integration passed** using installed CLI 0.167.0 and the user's configured model: local material reading, structured S1/S2 generation, background S3, an old-node explanation returning to the active reading position, Clear preserving the thread, and application/provider restart followed by `thread/resume` using the same thread ID.
- **Model-selection verification passed**: paginated catalog discovery, unsupported effort rejection, active-job isolation, restoration of configured defaults, and legacy-workspace migration. Chrome verified the selectors, capability-dependent effort choices, persistence and unchanged graph/thread. Real generation completed with `gpt-6.1-sol` and `gpt-6-astra` at `low` effort in the same conversation; App Server reported the requested settings. Evidence is saved in `.data/model-live-*/result.json`.
- **Actual `turn/interrupt` passed**: the App Server confirmed `interrupted`; Clear kept the conversation and the map remained empty.
- Generated proof steps from the original convergence fixture were reviewed for conceptual boundaries, notation and valid epsilon–N reasoning; Markdown/LaTeX strings were checked for proper encoding.

Verification artifacts are local and ignored by Git: `.data/screenshots/desktop.png`, `.data/screenshots/narrow.png`, and `.data/live-*/result.json` plus `interrupt-result.json`. Test workspaces are separate from the normal application database.

## Scope and practical limits

This is a local, single-user desktop product. There is no hosting, collaboration, or cross-device sync. PDF extraction depends on tools available to the installed Codex runtime; Markdown/plain text is the most reliable material format. Generation latency follows the user's configured model and reasoning settings; unfinished requests time out after five minutes with a retry action. Demo content is fixed and is not an arbitrary mathematics tutor.
