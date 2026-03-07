---
description: Open step-by-step UI layout decision workbench
agent: plan
---

Determine the **visual UI layout** for the current request through a step-by-step decision process.

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

### Step 5: Process and Respond (Multi-Round Flow)

When `layout_await_completion` returns the user's answers:

1. **Send a processing message** — Call `layout_push_message` with a brief status update (e.g. "Analyzing your layout choices..."). The user sees this in the browser while you process.

2. **Analyze the answers** — Determine if you have enough information to produce a final layout summary, or if follow-up questions are needed.

3. **If follow-up questions are needed** — Call `layout_push_questions` with the new questions, then call `layout_await_completion` again to wait for the next round. Repeat this loop as needed. Each round replaces the previous questions with fresh ones.

4. **If the layout is decided** — Call `layout_push_message` with the final layout summary so the user can see it in the browser. Then call `layout_push_questions` with a feedback question (e.g. approve / request changes / refine specific area). Call `layout_await_completion` to wait for the user's response. Only call `layout_close` after the user explicitly approves the layout.

### Step 6: Final Summary

After closing the workbench, provide a brief summary in the terminal:
1. Final visual layout combination
2. Why this layout fits the user's UI goals
3. Remaining layout decisions (if any)

## Multi-Round Tool Reference

| Tool | Purpose | When to Use |
|------|---------|-------------|
| `layout_open_workbench` | Open browser with loading state | Once at start (Step 1) |
| `layout_push_questions` | Send questions to browser | Each round of questions (Steps 3, 5.3) |
| `layout_await_completion` | Wait for user answers | After each `push_questions` (Steps 4, 5.3) |
| `layout_push_message` | Show text message in browser | Status updates, final summary (Steps 5.1, 5.4) |
| `layout_close` | End session, close server | ONLY after user explicitly approves layout (Step 5.4) |

**Important**: The browser stays open throughout the entire multi-round flow. The user never has to leave the browser or return to the terminal until the session is fully complete.
