---
description: Open visual UI layout preview review workbench
agent: plan
---

Determine the **visual UI layout** for the current request through a structured preview review process.

User goal:
$ARGUMENTS

## Scope — STRICTLY UI/Visual Layout Only

This workbench is exclusively for **visual and structural UI decisions**. Every question you generate must be about something the user would **see on screen**.

**IN SCOPE** (generate questions about these):
- Page/screen structure (grid, flex, columns, sidebar, split pane, stacked, tabs)
- Component placement and arrangement (where things go visually)
- Navigation patterns (top nav, side nav, breadcrumbs, bottom tabs)
- Content area layout (cards, lists, tables, detail panels, previews)
- Spacing, sizing, and proportion between sections
- Responsive behavior and breakpoints
- Visual hierarchy and information density

**OUT OF SCOPE** (never generate questions about these):
- Framework or library choice (React, Svelte, Vue, etc.)
- Build tools or bundlers (esbuild, webpack, vite, etc.)
- State management libraries or patterns
- Communication protocols or APIs
- Testing strategy
- Data models or database schema
- Deployment or infrastructure
- Any technical implementation detail that is not directly visible in the UI

If the user's goal mentions technical aspects (e.g. "VSCode Extension"), focus ONLY on the visual layout aspects — where panels go, what content areas look like, how navigation works — not on the underlying technology.

## Workflow

### Step 1: Open the workbench immediately

Call `layout_open_workbench` with only the `brief` parameter (no `questions`). The `brief` must describe what **UI/screen** is being designed, not the project overall. This opens the browser with a loading indicator so the user sees immediate feedback.

### Step 2: Design the question outline

Plan 3-7 questions about **visual layout** decisions. Each question must pass this test:

> "Does this question affect what the user sees on screen?"
> If NO → do not include it.

Questions should gather enough information to generate a visual preview of the layout. Think about: overall structure, navigation placement, main content area, secondary panels, and information density.

Good question examples:
- "메인 화면의 레이아웃 구조를 선택하세요" (sidebar + content / three-column / stacked)
- "네비게이션 패턴을 선택하세요" (top bar / side drawer / bottom tabs)
- "콘텐츠 영역 표시 방식" (카드 그리드 / 리스트 / 테이블)
- "상세 정보 표시 위치" (오른쪽 패널 / 모달 / 인라인 확장)

Bad question examples (DO NOT generate):
- "프론트엔드 프레임워크를 선택하세요" ← technical, not visual
- "번들링 도구" ← build tooling
- "상태 관리 방식" ← implementation detail
- "테스트 전략" ← testing, not layout

For each question, decide:
- `id`: unique identifier
- `type`: one of `single-select`, `multi-select`, `text`, `slider`, `toggle`
- `label`: clear question text (in the user's language)
- `options`: array of choices with `id`, `label`, and optional `description` describing the visual result
- `dependsOn`: conditional visibility based on another answer (optional)
- `required`: whether the question must be answered (optional)

### Step 3: Push questions to the workbench

Call `layout_push_questions` with the complete `questions` array. The loading state in the browser will transition to show the questions.

### Step 4: Wait for the user

Call `layout_await_completion` to block until the user submits their answers for this round.

### Step 5: Generate Visual Preview

When `layout_await_completion` returns the user's answers:

1. **Send a processing message** — Call `layout_push_message` with a brief status update (e.g. "Analyzing your layout choices and generating a visual preview..."). The user sees this in the browser while you process.

2. **Analyze the answers** — Determine if you have enough information to generate a visual preview, or if follow-up questions are needed.

3. **If follow-up questions are needed** — Call `layout_push_questions` with the new questions, then call `layout_await_completion` again. Repeat as needed.

4. **If ready to generate a preview** — Build a `LayoutIntent` and `VisualPreview` from the answers:
   - `LayoutIntent`: structured layout decisions (structure, navigation, mainContent, detailPlacement, bottomArea, density, constraints)
   - `VisualPreview`: CSS Grid-based layout with nodes positioned by role (nav, sidebar, main, inspector, bottom, toolbar)
   - Each node has: `id`, `label`, `summary`, `role`, `x`, `y`, `w`, `h` (grid position and span)
   - Set `cols` and `rows` for the grid (e.g. `cols: 12, rows: 8`)

5. **Call `layout_push_preview`** with the `intent` and `preview` data. This commits requirements, sets the preview, and transitions to review mode.

6. **Call `layout_await_completion`** to wait for the user's review action. The user can:
   - **Approve Preview** — Accept the layout and proceed to prompt generation
   - **Revise Selected Area** — Request changes to a specific region (returns review with targetNodeId)
   - **Need More Questions** — Return to collecting mode for more requirements
   - **Finish Without Prompt** — End session without generating a prompt

7. **Handle review result**:
   - If user approved: proceed to Step 6
   - If user requested revisions: generate updated preview, call `layout_push_preview` again
   - If user needs more questions: call `layout_push_questions` with follow-up questions
   - If user finished without prompt: call `layout_close`

### Step 6: Prompt Suggestion

After the user approves the preview:

1. Build a `PromptPacket` from the session context:
   - `summary`: summary of all captured requirements
   - `approvedPreviewSummary`: title and outline of the approved preview
   - `constraints`: fixed layout constraints from the intent
   - `avoid`: things to avoid in the layout
   - `outputFormat`: "Structured component layout with sections matching the approved preview regions"

2. Call `layout_build_prompt` with the `packet` and `renderedPrompt` (a formatted string combining all 5 fields).

3. The user can also click "Suggest Prompt" in the browser to trigger this step.

4. Call `layout_close` to end the session.

After closing the workbench, provide a brief summary in the terminal:
1. Final visual layout combination
2. Why this layout fits the user's UI goals
3. The generated prompt (if available)

## Multi-Round Tool Reference

| Tool | Purpose | When to Use |
|------|---------|-------------|
| `layout_open_workbench` | Open browser with loading state | Once at start (Step 1) |
| `layout_push_questions` | Send questions to browser | Each round of questions (Steps 3, 5.3) |
| `layout_await_completion` | Wait for user answers or review action | After each push (Steps 4, 5.6) |
| `layout_push_message` | Show text message in browser | Status updates (Step 5.1) |
| `layout_push_preview` | Push visual preview for review | After generating preview (Step 5.5) |
| `layout_build_prompt` | Generate PromptPacket and rendered prompt | After preview approval (Step 6.2) |
| `layout_close` | End session, close server | ONLY after user approves or finishes (Steps 5.7, 6.4) |

**Important**: The browser stays open throughout the entire flow. The user never has to leave the browser or return to the terminal until the session is fully complete.
