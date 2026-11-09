# Architecture

Lemma is a local React/TypeScript application served by Express on loopback. SQLite stores a transactional workspace snapshot with WAL and full synchronous writes. Textbook materials remain read-only. The backend can explicitly update the two study-context Markdown files inside a book directory; code, SQLite, logs, and testing artifacts stay outside book directories.

The backend owns reading state. Each tree has its own cursor and cursor epoch; a book has one active tree. Routes contain ordered slots, and explanation routes save a return position at question submission. A route position remains valid before its node exists. Resolving an exhausted explanation route follows its saved return route recursively. Structural parent links are separate from reading successors. Opening a node never calls a progression API.

Questions pause speculation and create a new route. Results never move the reading pane. Explicit “Enter explanation” activates that route; asking on the active node then completes the source step. Continue requires the expected cursor epoch and node, and request IDs deduplicate mutation retries. Resume tree is explicit.

Each book has one serialized generation queue and one persistent Codex thread. Questions cancel speculative work; cancellation is recorded before interrupting the provider. Output must match the job, canvas epoch, route offset, assigned IDs, successors, and eligible revision versions. Late results are ignored. Initial routes request two steps; subsequent work prepares only one successor. An existing return node satisfies the buffer.

Revisions create new immutable node versions in the same route slot; old versions remain inspectable. Completed/current nodes cannot be revised. Viewing a node retains that version even when it is superseded. Startup marks unfinished jobs as failed with an explicit retry action. Graceful shutdown records the same recovery state before aborting providers and closing SQLite.

Codex protocol: newline-delimited JSON-RPC over `codex app-server --listen stdio://`. Installed CLI 0.167.0 bindings were generated and inspected for thread/start, thread/resume, turn/start, turn/interrupt and outputSchema. See https://learn.chatgpt.com/docs/app-server. One subprocess is used per actively connected book, with default installed authentication and model. Threads use read-only sandboxing and never approve mutations. Book AGENTS.md conventions supplement public teaching/structured-output rules.

Defaults: local desktop use, English UI with multilingual mathematical content; explicit directory path entry; no hosted deployment; no automatic retry after a crash. Demo mode is opt-in and visibly labeled. No material contents are uploaded by the application itself; live Codex necessarily sends relevant context to the user's configured model provider.


Model and reasoning choices are book-level preferences, persisted independently of canvas state. `model/list` is paginated and cached for one minute; `config/read` resolves local defaults for the material directory. Only the model/effort metadata is exposed to the UI. Each running job captures its settings before generation. The adapter sends explicit `model` and `effort` on every `turn/start`, so restoring defaults cannot accidentally retain a previous turn’s overrides. Settings changes neither interrupt active work nor replace a thread. Legacy workspaces acquire null preferences, retaining their configured Codex defaults.


## Durable study context and reference nodes

Document jobs (`notes`, `progress`) share the per-book serialized generation queue and persistent Codex conversation, interrupting speculative work. They do not create a learning route or move its cursor. Each generation snapshots both study files; document output has a separate schema and is validated against its job and fixed filename. The backend checks the file hash before saving, preserves existing note sections, and records before/after bodies in a SQLite write-ahead journal before atomically replacing the file. Startup can recover the reference and completed job after a file/state commit interruption. Backups survive canvas Clear.

References are a separate entity from `Step`; they have no completed flag, route index, or reading successor. Their source content, chapter key, revision and supersession links are persisted. A new reference version leaves an already displayed old version intact. Questions may target reference IDs and capture the same return cursor as old-step questions. With no active tree, the application creates a question route with a null return destination.

The GUI supports explicit task selection and bounded command recognition (`/notes`, `/progress`, explicit file update requests, and common Chinese summary/progress commands). Ambiguous prose remains a learning prompt; the task selector gives a deterministic way to request document changes. Reference content is read-only in the GUI; document updates are explicit new tasks. Clear never implicitly reimports saved files.
