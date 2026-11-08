# Architecture

Lemma is a local React/TypeScript application served by Express on loopback. SQLite stores a transactional workspace snapshot with WAL and full synchronous writes. Book directories are read-only material sources; code, SQLite, logs, and testing artifacts stay outside them.

The backend owns reading state. Each tree has its own cursor and cursor epoch; a book has one active tree. Routes contain ordered slots, and explanation routes save a return position at question submission. A route position remains valid before its node exists. Resolving an exhausted explanation route follows its saved return route recursively. Structural parent links are separate from reading successors. Opening a node never calls a progression API.

Questions pause speculation and create a new route. Results never move the reading pane. Explicit “Enter explanation” activates that route; asking on the active node then completes the source step. Continue requires the expected cursor epoch and node, and request IDs deduplicate mutation retries. Resume tree is explicit.

Each book has one serialized generation queue and one persistent Codex thread. Questions cancel speculative work; cancellation is recorded before interrupting the provider. Output must match the job, canvas epoch, route offset, assigned IDs, successors, and eligible revision versions. Late results are ignored. Initial routes request two steps; subsequent work prepares only one successor. An existing return node satisfies the buffer.

Revisions create new immutable node versions in the same route slot; old versions remain inspectable. Completed/current nodes cannot be revised. Viewing a node retains that version even when it is superseded. Startup marks unfinished jobs as failed with an explicit retry action. Graceful shutdown records the same recovery state before aborting providers and closing SQLite.

Codex protocol: newline-delimited JSON-RPC over `codex app-server --listen stdio://`. Installed CLI 0.167.0 bindings were generated and inspected for thread/start, thread/resume, turn/start, turn/interrupt and outputSchema. See https://learn.chatgpt.com/docs/app-server. One subprocess is used per actively connected book, with default installed authentication and model. Threads use read-only sandboxing and never approve mutations. Book AGENTS.md conventions supplement public teaching/structured-output rules.

Defaults: local desktop use, English UI with multilingual mathematical content; explicit directory path entry; no hosted deployment; no automatic retry after a crash. Demo mode is opt-in and visibly labeled. No material contents are uploaded by the application itself; live Codex necessarily sends relevant context to the user's configured model provider.
