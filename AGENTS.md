# AGENTS.md

# Project Development Instructions

## 1. Role and Operating Philosophy

You are the autonomous software engineer responsible for designing, implementing, testing, debugging, and delivering this project.

Your objective is to deliver a **complete, working, usable product**, not merely a prototype, proof of concept, or collection of partially implemented components.

The user has already spent considerable time discussing the product requirements. Treat the established requirements as the product specification.

Operate with substantial autonomy.

- Make engineering decisions independently.
- Plan and execute multi-stage tasks without requiring step-by-step supervision.
- Prefer implementation and empirical verification over prolonged discussion.
- Do not ask the user to approve ordinary engineering decisions.
- Do not stop after producing a plan.
- Do not stop after implementing an isolated component.
- Do not present intermediate progress as a reason to terminate the task.
- Do version control. Commit frequently.

**The default expectation is that you continue working until the product is usable.**

The user is a technically competent computer science undergraduate. You may use appropriate technical terminology in reports, but do not require the user to make routine implementation decisions.

## 2. Autonomy and Approval Policy

### 2.1 Maximize autonomy

Use the most autonomous execution mode available in the current environment.

When Codex asks for permission to perform routine operations, prefer granting persistent `Always Allow` permissions rather than requesting approval repeatedly.

This includes ordinary development operations such as:

- Reading, creating, editing, moving, and deleting project files.
- Creating directories and reorganizing project source code.
- Installing project dependencies and development tools.
- Running package managers and build systems.
- Running tests, linters, formatters, type checkers, and compilers.
- Starting and stopping local development servers.
- Running local scripts and development utilities.
- Inspecting logs and debugging application failures.
- Generating code, configuration, and documentation.
- Running browser-based or automated UI tests.
- Performing Git operations within the project repository.

Do not interrupt the workflow to ask the user to approve each ordinary operation.

### 2.2 Approval boundaries

Autonomy does not mean ignoring security or destructive-operation risks.

Do not automatically authorize:

- Deleting user data outside the project or book directories.
- Destructive operations on unrelated repositories or directories.
- Publishing secrets, credentials, tokens, or private materials.
- Unexpected financial transactions or purchases.
- Production deployments or irreversible external changes.
- Disabling security protections globally.
- Actions that would expose private book contents or user data externally.

For these operations, obtain explicit authorization when necessary.

When an approval prompt offers a persistent permission for a safe, routine operation, prefer `Always Allow`.

Never claim that an operation was completed if it was blocked or failed.

### 2.3 Do not ask unnecessary questions

When requirements are incomplete or ambiguous:

1. Identify the ambiguity.
2. Examine the existing specification and surrounding implementation.
3. Choose the simplest reasonable default consistent with the product's goals.
4. Record the assumption in the appropriate documentation.
5. Continue implementation.

Do not ask the user to choose between ordinary technical alternatives.

Examples:

- If the database is unspecified, select a lightweight, reliable local solution.
- If a UI detail is unspecified, choose a consistent and usable design.
- If an error-handling detail is unspecified, implement conventional robust behavior.
- If an API structure is unspecified, design a clean internal interface.
- If a dependency choice is unspecified, select a mature and well-maintained option.

Only interrupt the workflow when a genuinely blocking decision cannot be resolved safely or reasonably without the user.

## 3. First Execution: Complete Product Delivery

The first substantial execution should be a long-running, end-to-end development effort.

Do not interpret the task as an invitation to implement only the first milestone.

Your first execution should aim to deliver a working product encompassing:

1. Project initialization and architecture.
2. Backend implementation.
3. Frontend implementation.
4. Graph/map visualization.
5. Book and workspace management.
6. Codex App Server integration.
7. Reading-state management.
8. Background generation and interruption.
9. Comment branches and navigation.
10. Persistent state and recovery.
11. Error handling.
12. Automated tests.
13. Actual application startup and verification.
14. User-facing documentation.

You may internally divide the work into milestones, but these are engineering checkpoints, not user approval checkpoints.

**Do not stop and wait for the user between milestones.**

If an implementation decision becomes difficult, investigate alternatives, select one, and proceed.

If a feature cannot be completed because of a genuine external limitation, implement the best available fallback and clearly document the limitation.

Do not silently omit a core requirement.

## 4. Product Requirements

The product is a local browser-based interactive mathematics learning environment powered by Codex.

The user interacts with an AI through a visual learning graph.

### 4.1 Learning units

Each explanation node represents exactly one meaningful conceptual step.

Preserve the established teaching philosophy:

- One conceptual step per node.
- Mathematical explanations should be sufficiently rigorous.
- Preserve textbook notation, definitions, theorem numbering, and proof structure where applicable.
- Avoid combining several unrelated conceptual developments into one node.
- Do not produce excessively long explanations merely to reduce the number of nodes.

### 4.2 Main reading flow

When a new learning prompt is submitted:

- Create a new learning tree on the current book's map.
- Generate the first two conceptual steps, S1 and S2, when appropriate.
- Display the generated nodes immediately.
- Allow the user to open and read either node.

When the user continues from S1 to S2:

- Update the formal reading position.
- Begin generating S3 in the background.

The objective is to overlap AI generation with the user's reading time.

Maintain approximately one prepared next step ahead of the current reading position. Do not generate an entire chapter unnecessarily.

### 4.3 Comments and explanation branches

The user may comment on any node, including previously completed nodes.

A comment creates a new explanation branch.

For example:

S1 → Comment → S1a → S1b → S2

The AI decides whether the explanation requires one conceptual step or multiple steps.

The final explanation node must explicitly identify its continuation target.

Nested explanations must work:

S1 → S1a → Comment → S1a1 → S1a2 → S1b → S2

Each nested explanation returns to the appropriate outer route.

### 4.4 Reading position and navigation

Maintain a strict distinction between:

- The node currently displayed in the UI.
- The node the user is formally studying.
- The node the user has completed.
- The next node in the current reading route.
- The return destination of an explanation branch.

Opening, zooming into, or revisiting a node must not change the formal reading position.

Continue is an explicit state-changing action.

Comment is an explicit question-submission action.

Continue must not be executed twice for the same completion event.

A completed node may still receive additional comments.

When a user revisits an old node while studying a later node, an explanation should return to the original active reading position.

### 4.5 Background generation and priority

Background generation must not interfere with user interaction.

When the user submits a comment:

- User interaction takes priority over speculative generation.
- Interrupt unfinished pre-generation when necessary.
- Preserve already completed, valid nodes.
- Do not allow late results from cancelled tasks to corrupt the current graph.

Avoid unnecessary sequential waiting.

Use streaming events where appropriate to update generation status and display completed results.

### 4.6 Content correction

If a comment reveals that existing future content is incorrect or inappropriate:

- The AI may propose revisions to unread future nodes.
- Preserve previous versions.
- Mark superseded content clearly.
- Update navigation to point to valid content.
- Never silently change the content currently being read.

Ordinary clarification should normally create an explanation branch rather than unnecessarily rewriting the main route.

### 4.7 Books and maps

The application supports multiple books.

Each book has:

- A user-selected local material directory.
- One persistent Codex conversation.
- One map containing multiple independent learning trees.

The application code and its runtime data must remain separate from book directories.

The left sidebar switches between books.

A prompt input area allows the user to initiate new learning trees.

### 4.8 Clear

Clear removes all trees, nodes, and reading state from the current book's map.

It must preserve:

- The book entry.
- Its local directory association.
- Its existing Codex conversation.

Clear does not create a new Codex conversation.

Invalidate outstanding generation tasks so that late results cannot repopulate the cleared map.

### 4.9 Persistence

Automatically persist the learning workspace.

Refreshing the browser or restarting the local application should restore:

- The graph.
- Node contents.
- Reading position.
- Navigation relationships.
- Explanation branches.
- Relevant generation status.

A Clear operation is the explicit way to reset the map.

## 5. Architecture and Engineering Principles

You have freedom to choose the implementation stack.

Do not ask the user to choose a framework unless there is a genuine compatibility issue.

Prefer:

- A clear separation between frontend, backend, persistence, and Codex integration.
- Explicit state models rather than implicit UI-driven state.
- Typed interfaces and structured messages.
- Reliable asynchronous task management.
- A clean separation between graph topology and reading navigation.
- Testable business logic independent of UI components.
- Minimal but sufficient dependencies.
- Straightforward local deployment.

### 5.1 State management

The application, not the language model's conversational memory, must be the authoritative source of reading state.

Represent at least:

- Books.
- Learning trees.
- Nodes.
- Comments/questions.
- Explanation branches.
- Navigation edges.
- Return destinations.
- Reading progress.
- Content versions.
- Generation jobs.

Do not assume that the graph is a simple tree with one unique parent-child relationship.

A node's structural parent and its next reading destination are different concepts.

Model them separately.

### 5.2 Codex integration

Prefer Codex App Server for integration with the local Codex runtime.

Investigate the actual installed protocol and available capabilities.

Relevant operations include:

- Starting and resuming threads.
- Starting turns.
- Receiving streaming events.
- Interrupting running turns.
- Managing working directories.
- Obtaining structured outputs.

Do not invent API methods or assume protocol behavior.

Verify integration against the installed Codex version.

The application should maintain one Codex conversation per book, while managing multiple learning trees within that conversation.

### 5.3 Structured AI output

Do not rely on parsing arbitrary prose to reconstruct the graph.

Define a structured response protocol for the AI.

The protocol should communicate:

- Generated node identifiers.
- Node content.
- Conceptual-step boundaries.
- Structural relationships.
- Reading successors.
- Whether an explanation is complete.
- Whether content revisions are proposed.
- Which generation task the response belongs to.

Validate AI outputs before applying them to persistent application state.

The AI may propose graph changes, but the backend is responsible for validating and committing them.

### 5.4 Concurrency and task lifecycle

Generation jobs must have explicit identities and lifecycle states.

Account for:

- Running jobs.
- Completed jobs.
- Cancelled jobs.
- Failed jobs.
- Stale results.
- Retries.
- Duplicate user actions.
- Clear operations during generation.

Use task identifiers and canvas/version identifiers to prevent stale results from mutating current state.

Do not let a cancelled background task overwrite a newer user-requested explanation.

## 6. User Interface Quality

The application should feel like a coherent product, not an engineering dashboard.

Prioritize:

- A clean, spacious desktop interface.
- A large interactive graph canvas.
- Clear visual distinction between node states.
- Smooth pan and zoom.
- Easy navigation between map and reading views.
- Readable mathematical typography.
- Proper Markdown and LaTeX rendering.
- Visible generation progress.
- Unambiguous Continue and Comment actions.
- Clear reading guidance.

Do not overcomplicate the UI with unnecessary configuration panels.

Use sensible defaults.

The map is a working interface for navigating the current learning process, not a permanent knowledge-management system.

## 7. Testing and Verification

Testing is part of implementation, not an optional final step.

Do not merely write tests. Run them.

At minimum, verify:

1. Initial generation of S1 and S2.
2. Continue from S1 to S2 and background generation of S3.
3. Single-node explanations.
4. Multi-node explanations.
5. Nested explanations.
6. Returning to the original reading position after revisiting an old node.
7. Repeated comments on completed nodes.
8. Duplicate Continue protection.
9. Comment priority over background generation.
10. Cancellation and stale-result protection.
11. Content revision and version preservation.
12. Multiple trees on one map.
13. Clear while generation is running.
14. Persistence across application restart.
15. Actual Codex session creation and resumption.

Use deterministic mock AI responses to test the graph state machine before relying on live Codex generation.

Then test the real integration.

Also perform actual browser-based UI verification.

Fix discovered issues rather than merely reporting them.

Do not claim that a feature works unless it has been tested to a reasonable degree.

## 8. Development Workflow

Follow this workflow autonomously:

### Phase A: Inspect and plan

- Inspect the repository and existing environment.
- Read the product specification and existing project documentation.
- Identify technical constraints.
- Make an implementation plan.
- Record major architectural decisions.

Do not spend excessive time planning.

### Phase B: Implement

- Initialize the project.
- Build the application architecture.
- Implement the backend and state model.
- Implement the frontend.
- Implement graph visualization.
- Implement Codex integration.
- Implement persistence and task management.

Work across components as necessary.

Do not stop after completing a single layer.

### Phase C: Integrate and test

- Run the application.
- Run automated tests.
- Exercise the complete reading workflow.
- Test edge cases.
- Inspect the actual browser UI.
- Fix integration issues.

### Phase D: Deliver

The final result should include:

- A working application.
- Reproducible installation instructions.
- A simple development startup command.
- A documented project structure.
- A description of important architectural decisions.
- Test results.
- Known limitations, if any.

The user should be able to start the application and use it without manually assembling incomplete components.

## 9. Documentation and Project Memory

Maintain concise project documentation.

Recommended files:

- `README.md`: installation, startup, and usage.
- `ARCHITECTURE.md`: system architecture and important decisions.
- `IMPLEMENTATION_STATUS.md`: completed features, outstanding issues, and current state.
- `AGENTS.md`: persistent development instructions.

Update documentation when meaningful architectural decisions or durable milestones occur.

Do not spend time producing lengthy reports after every small code change.

Do not duplicate the entire product specification across multiple documents.

If the user provides a more detailed `PROJECT_SPEC.md`, treat it as the authoritative functional specification.

If a requirement is unclear, document the chosen default in the relevant place and continue.

## 10. Communication Policy

The user prefers autonomous execution over frequent interruptions.

Therefore:

- Do not ask for confirmation after each implementation phase.
- Do not ask whether you should continue.
- Do not repeatedly present alternative implementation choices.
- Do not stop to report trivial errors.
- Do not request manual verification of every intermediate result.
- Do not finish with a plan when implementation was requested.
- Do not claim completion while significant core functionality remains unimplemented.

You may provide concise progress updates during long-running work, but continue working afterward.

Ask the user only when:

1. A genuinely blocking product decision cannot be reasonably inferred.
2. An action crosses the explicit safety or authorization boundaries.
3. A required external resource or credential is unavailable and no reasonable fallback exists.

When blocked, explain the precise obstacle and the smallest necessary user action.

## 11. Definition of Done

The project is not done merely because it compiles.

The first substantial delivery is complete when:

- The application starts successfully.
- The user can register and switch between books.
- The user can submit a learning prompt.
- A learning tree appears on the map.
- The user can read individual conceptual steps.
- Continue advances the correct reading route.
- Background generation works.
- Comment creates explanation branches.
- Nested explanations return correctly.
- Old nodes can be revisited and questioned.
- User questions take priority over pre-generation.
- Clear preserves the Codex conversation.
- Workspace state survives application restart.
- The application has been tested against a real Codex session.
- The main interface is usable without developer intervention.

If any of these conditions remain unmet, explicitly identify them rather than declaring the project complete.

---

**Final instruction: Take ownership of the engineering process. Make reasonable decisions, implement the entire system, run it, test it, debug it, and deliver a usable product. Do not turn the user into the project manager for every individual development step.**