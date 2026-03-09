---
description: Open step-by-step design decision forge (general-purpose)
agent: plan
model: google/gemini-3.1-pro-preview
---

Determine design decisions for the current request through a step-by-step process.

User goal:
$ARGUMENTS

## Workflow

### Step 1: Open the forge immediately

Call `layout_open_workbench` with only the `brief` parameter (no `questions`). This opens the browser with a loading indicator so the user sees immediate feedback.

### Step 2: Design the question outline

Think about what design decisions the user needs to make. Plan 3-8 questions covering any relevant aspects:
- Architecture and structure
- Technology choices (frameworks, libraries, tools)
- Communication patterns and protocols
- Build, test, and deployment strategy
- Data storage and state management
- Any context-specific decisions from the user's goal

For each question, decide:
- `id`: unique identifier
- `type`: one of `single-select`, `multi-select`, `text`, `slider`, `toggle`
- `label`: clear question text
- `options`: array of choices (for select types) with `id`, `label`, and optional `description`
- `dependsOn`: conditional visibility based on another question's answer (optional)
- `required`: whether the question must be answered (optional)

### Step 3: Push questions to the forge

Call `layout_push_questions` with the complete `questions` array. The loading state in the browser will transition to show the questions.

### Step 4: Wait for the user

Call `layout_await_completion` to block until the user finishes answering or abandons the session.

### Step 5: Summarize

When the tool returns, provide a brief summary:
1. Final combination of decisions
2. Why these choices fit the user's goal
3. Remaining decisions or open questions
