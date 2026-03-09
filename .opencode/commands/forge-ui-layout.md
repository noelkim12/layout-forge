---
description: Open visual UI layout preview review forge
agent: plan
---

Determine the **visual UI layout** for the current request through a structured preview review process. The goal of this forge is to collect layout requirements, generate a visual preview, review it with the user, and produce a layout prompt based on the approved preview.

User goal:
$ARGUMENTS

## Scope — STRICTLY UI/Visual Layout Only

This forge is exclusively for **visual and structural UI decisions**. Every question you generate must be about something the user would **see on screen**.

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

### Step 1: Open the forge immediately

Call `layout_open_workbench` with only the `brief` parameter (no `questions`). The `brief` must describe what **UI/screen** is being designed, not the project overall. This opens the browser with a loading indicator so the user sees immediate feedback.

### Step 2: Analyze the user's goal

Before generating any questions, analyze `$ARGUMENTS` to understand:

1. **Product type** — What kind of UI is being designed? (e.g., web dashboard, mobile app, VSCode extension, desktop application, admin panel, landing page)
2. **Screen inventory** — What distinct screens or views does this product need? Identify the primary screen the user is asking about.
3. **Layout axes** — What are the key layout decisions for this specific product type? Each product type has different critical axes:
   - **Dashboard**: sidebar vs top-nav, widget grid vs list, filter placement, detail panel position
   - **Editor/IDE**: panel arrangement, toolbar position, split pane behavior, status bar
   - **Mobile app**: tab bar vs drawer, card vs list, bottom sheet vs modal, swipe navigation
   - **Admin panel**: data table layout, form placement, navigation depth, bulk action bar
   - **Content site**: article width, sidebar usage, header behavior, footer structure
4. **Conflict points** — Where might layout decisions conflict with each other? (e.g., two features competing for the same screen region)

This analysis is internal — do not show it to the user. Use it to generate targeted questions in the next step.

### Step 3: Design the foundation questions (Round 1)

Design 1-4 **foundation questions** based on the analysis from Step 2. Foundation questions establish the broad layout direction. They are answered in a single round and must be **mutually independent** — the validity of each question's options must not depend on how any other question in the same round is answered.

**Independence test:** For each question, ask: "If the user picks any option for every other question in this round, do this question's options still make sense?" If NO → move it to Round 2 (detail questions in Step 6.2). **If the independence test leaves only 1 question in Round 1, that is correct — push that single question immediately.** A Round 1 with 1 focused question followed by a targeted Round 2 is better than a Round 1 with 4 interdependent questions that become irrelevant based on the first answer.

**What belongs in Round 1 (foundation):**
- Overall page structure (sidebar+main, three-column, stacked, full-width, etc.)
- Navigation preference (top bar, side drawer, bottom tabs, breadcrumbs)
- Information density / visual feel (compact vs spacious)
- Primary content display mode (cards, lists, tables) — only if valid regardless of structure choice

**What belongs in Round 2 (detail — generated later in Step 6.3):**
- Region-specific content (what goes in the sidebar, what goes in the main area) — depends on structure choice
- Panel relationships and conflict resolution (how two features share one region) — depends on structure choice
- Secondary panel placement (detail/inspector position, bottom panel usage) — depends on structure choice
- Responsive breakpoint behavior — depends on structure choice

**Question design principles:**

- Each question must pass this test: "Does this question affect what the user sees on screen?" If NO → do not include it.
- Each option's `description` must describe the **visual result**, not the technical mechanism.
- Use `allowCustom: true` when the predefined options may not cover the user's specific case.
- Mark all foundation questions as `required: true`.
- Do not use `dependsOn` in Round 1 — foundation questions are independent by definition.

**Autonomous generation rule:** Do not reuse or paraphrase generic template questions. Every question and every option must be derived from the Step 2 analysis of the user's specific goal. The question labels, option labels, and option descriptions must reflect the product domain the user described. If the user is designing a chat application, the options should reference chat-specific regions (message list, input area, contact sidebar). If the user is designing an IDE extension, the options should reference IDE-specific regions (editor tab, side panel, bottom terminal area).

**Bad question examples (DO NOT generate):**
- "프론트엔드 프레임워크를 선택하세요" ← technical, not visual
- "번들링 도구" ← build tooling
- "상태 관리 방식" ← implementation detail
- "테스트 전략" ← testing, not layout

**Question field reference:**

- `id`: unique identifier
- `type`: one of `single-select`, `multi-select`, `text`, `slider`, `toggle`
- `label`: clear question text (in the user's language)
- `description`: additional context for the question (optional)
- `options`: array of choices with `id`, `label`, and optional `description` describing the visual result
- `dependsOn`: conditional visibility based on another answer (optional — use in Round 2 only)
- `required`: whether the question must be answered (optional)
- `allowCustom`: allow the user to type a custom answer beyond the provided options (optional)

### Step 4: Push questions to the forge

Call `layout_push_questions` with the complete `questions` array. The loading state in the browser will transition to show the questions.

### Step 5: Wait for the user

Call `layout_await_completion` to block until the user submits their answers for this round.

### Step 6: Process answers and decide next action

When `layout_await_completion` returns the user's answers:

1. **Send a processing message** — Call `layout_push_message` with a brief status update (e.g. "Analyzing your layout choices and generating a visual preview..."). The user sees this in the browser while you process.

2. **Design detail questions (Round 2)** — After Round 1, the overall direction is established but region-specific details are unresolved. This is expected. Generate 2-5 detail questions that are derived from the Round 1 answers:
   - Reference the user's Round 1 choices explicitly (e.g., "You chose a sidebar + main structure. What content should the sidebar contain?").
   - Address region-specific content, panel relationships, and conflict points identified in the Step 2 analysis.
   - Use `dependsOn` when some detail questions are only relevant for certain Round 1 answers.
   - Call `layout_push_questions` with the detail questions, then call `layout_await_completion` again.

3. **Evaluate preview readiness** — After Round 2 (or Round 1 if the user's goal is simple enough), check these four conditions:
   - The overall screen structure is decided (which regions exist and their arrangement)
   - The primary content area layout is decided (how the main content is organized)
   - Major region assignments are decided (what goes where)
   - No two features compete for the same screen region without a resolution

   If all four conditions are met → proceed to generate a preview (step 6.5).
   If any condition is unmet → generate one more follow-up round (max 1 additional round after Round 2). If still incomplete, proceed with reasonable defaults and note the assumptions.

4. **Generate the visual preview** — Build a `LayoutIntent` and `VisualPreview` from the answers:

   - `LayoutIntent`: structured layout decisions (structure, navigation, mainContent, detailPlacement, bottomArea, density, constraints)
     - `constraints.fixed`: layout properties that the user explicitly chose and must not change
     - `constraints.flexible`: layout properties that can be adjusted during implementation
     - `constraints.avoid`: patterns the user rejected or that conflict with their choices
   - `VisualPreview`: CSS Grid-based layout with nodes positioned by role (nav, sidebar, main, inspector, bottom, toolbar)
     - Each node has: `id`, `label`, `summary`, `role`, `x`, `y`, `w`, `h` (grid position and span)
     - Set `cols` and `rows` for the grid (e.g. `cols: 12, rows: 8`)
     - Map each user-chosen region to a node. The `role` field determines visual styling:
       - `nav`: navigation bars (top or side)
       - `sidebar`: collapsible side panels
       - `main`: primary content area
       - `inspector`: detail/property panels
       - `bottom`: status bars, terminals, log panels
       - `toolbar`: action bars, toolbars
     - The `outline` array must contain one entry per node, with a `title` and `summary` explaining what that region contains

   **Example — sidebar + main layout:**
   ```json
   {
     "id": "preview_1",
     "title": "Sidebar Layout",
     "cols": 12,
     "rows": 8,
     "nodes": [
       { "id": "nav", "label": "Top Navigation", "role": "nav", "x": 1, "y": 1, "w": 12, "h": 1, "summary": "App logo, global search, user menu" },
       { "id": "sidebar", "label": "Sidebar", "role": "sidebar", "x": 1, "y": 2, "w": 3, "h": 7, "summary": "Navigation links and filters" },
       { "id": "main", "label": "Main Content", "role": "main", "x": 4, "y": 2, "w": 9, "h": 7, "summary": "Primary content area" }
     ],
     "outline": [
       { "id": "nav", "title": "Top Navigation", "summary": "Fixed top bar with app logo, global search, and user menu" },
       { "id": "sidebar", "title": "Sidebar", "summary": "Left sidebar with navigation links and content filters" },
       { "id": "main", "title": "Main Content", "summary": "Primary content area occupying the remaining space" }
     ],
     "generatedAt": "2026-01-01T00:00:00.000Z"
   }
   ```
   This is a structural reference for the data format. The actual node labels, summaries, roles, and grid positions must be derived from the user's answers — not copied from this example.

5. **Call `layout_push_preview`** with the `intent` and `preview` data. This commits requirements, sets the preview, and transitions to review mode.

6. **Call `layout_await_completion`** to wait for the user's review action. The user can:
   - **Approve Preview** — Accept the layout and proceed to prompt generation
   - **Revise Selected Area** — Request changes to a specific region (returns review with targetNodeId)
   - **Need More Questions** — Return to collecting mode for more requirements
   - **Finish Without Prompt** — End session without generating a prompt

7. **Handle review result**:
   - If user approved: proceed to Step 7
   - If user requested revisions: generate updated preview, call `layout_push_preview` again
   - If user needs more questions: call `layout_push_questions` with follow-up questions
   - If user finished without prompt: call `layout_close`

### Step 7: Prompt Suggestion

After the user approves the preview:

1. If the user clicked **Suggest Prompt** in the browser, treat it as a request to generate a high-quality prompt via LLM (not via local string templates).

2. Build a `PromptPacket` from the session context:
   - `summary`: summary of all captured requirements
   - `approvedPreviewSummary`: title and outline of the approved preview
   - `constraints`: fixed layout constraints from the intent
   - `avoid`: things to avoid in the layout
   - `outputFormat`: "Structured component layout with sections matching the approved preview regions"

3. Generate `renderedPrompt` — a self-contained prompt that produces working UI code when pasted into any code-generating LLM (Claude, GPT, Gemini, etc.) without additional clarification. **Copy-Paste Readiness Standard**: the generated prompt alone contains every detail needed to build the UI. A developer who reads only the generated prompt — without access to the forge session — can implement the full layout.

   The rendered prompt contains these mandatory sections in this exact order:

   **Section 1 — Product Goal and User Context**
   State what is being built, who uses it, and the primary workflow.
   Required items:
   - Product name or description (e.g., "Server monitoring dashboard")
   - Target user role (e.g., "DevOps engineer")
   - Core use case in one sentence (e.g., "The user monitors real-time server metrics and drills into individual server details")

   **Section 2 — Technology and Environment**
   Specify the implementation target. Derive from the user's project context (file extensions, package.json, framework files in the workspace) or stated preference.
   Required items:
   - Framework and language (e.g., "React 18 + TypeScript", "HTML5 + Tailwind CSS v3", "Vue 3 + Composition API")
   - Styling approach (e.g., "Tailwind utility classes", "CSS Modules", "styled-components")
   - Default when not determinable from context: "HTML + CSS (framework-agnostic, portable to any framework)"

   **Section 3 — Layout Blueprint (CSS Grid Specification)**
   Translate the approved `VisualPreview` into implementable CSS Grid code.
   Required items:
   - Grid definition expressed as `grid-template-areas` derived from the preview nodes. Example format:
     ```css
     display: grid;
     grid-template-columns: 240px 1fr;
     grid-template-rows: 56px 1fr;
     grid-template-areas:
       "nav  nav"
       "side main";
     ```
   - Area-to-role mapping table:
     | Area Name | Role | Dimensions | Min/Max Constraints |
     |-----------|------|------------|---------------------|
     | nav | Top navigation | full width × 56px | min-height: 56px |
     | side | Sidebar | 240px × remaining | min: 200px, max: 320px |
     | main | Main content | remaining × remaining | min-width: 480px |
   - Visual hierarchy order: which region draws the user's eye first → second → third

   **Section 4 — Region-by-Region UI Specification**
   For **each** region in the approved preview, include a specification block with all 7 sub-items:
   1. **Role**: nav | sidebar | main | inspector | bottom | toolbar
   2. **Contains**: every UI element with position and approximate size
      Example: "Logo (left, 32×32px), Search input (center, width: 320px), Avatar dropdown (right, 40×40px)"
   3. **Internal layout**: CSS layout properties
      Example: "flex row, justify-content: space-between, align-items: center, gap: 16px, padding: 0 16px"
   4. **Visual style**: background, border, shadow as CSS values
      Example: "background: #FFFFFF, border-bottom: 1px solid #E5E7EB, box-shadow: 0 1px 3px rgba(0,0,0,0.1)"
   5. **Content behavior**: how content changes on interaction
      Example: "Active nav item: left 4px border #3B82F6, background #EFF6FF"
   6. **Empty state**: display when no data exists
      Example: "Centered illustration (200×160px) + 'No items yet' text (16px, #6B7280)"
   7. **Loading state**: display during data fetch
      Example: "3 skeleton rectangles (height: 48px, border-radius: 8px) with pulse animation"

   Prohibited in "Contains": "various controls", "relevant information", "appropriate content", "etc.". Every element is named with position and size.

   **Section 5 — Interaction and State Behavior**
   Define every user interaction that changes the layout or visible content:
   - **Click targets**: element → visual result (e.g., "Clicking a sidebar nav item highlights it with bg #EFF6FF and loads content in the main area")
   - **Hover states**: elements and CSS values (e.g., "Nav items: background changes to #F3F4F6 on hover, transition: 150ms")
   - **Expand/collapse**: trigger element, dimensions in both states, animation (e.g., "Sidebar collapses to 64px icon-only mode on hamburger click, transition: width 200ms ease")
   - **Selection states**: visual distinction between selected and unselected items
   - **Modal/overlay triggers**: actions that open modals, overlay coverage area
   Default when no interaction was discussed: "All regions are static. Sidebar navigation items highlight on click."

   **Section 6 — Responsive Behavior**
   Layout changes at each breakpoint with specific pixel thresholds:
   | Breakpoint | Width Range | Layout Changes |
   |------------|-------------|----------------|
   | Desktop | ≥1024px | Default layout as specified above |
   | Tablet | 768–1023px | [specific changes, e.g., "Sidebar hidden, hamburger menu in nav, main area full width"] |
   | Mobile | <768px | [specific changes, e.g., "Single column. Bottom tab bar (56px) replaces sidebar navigation"] |
   For each breakpoint, state which regions are: visible, hidden, reorganized, or resized.
   Default when not discussed: "Fixed layout, horizontal scroll below 1024px."

   **Section 7 — Design Tokens**
   Foundational visual values. Derive from user answers when available, otherwise apply defaults.
   Required token categories:
   - **Spacing**: base unit and scale (e.g., "4px base: 4, 8, 12, 16, 24, 32, 48, 64")
   - **Border radius**: per component type (e.g., "buttons: 6px, cards: 8px, modals: 12px, avatars: 9999px")
   - **Colors** (minimum 6 values): primary, background, surface, border, text-primary, text-secondary (hex values)
   - **Typography**: font-family, heading sizes (h1–h3 in px), body size, line-height
   - **Shadows**: per elevation level (e.g., "cards: 0 1px 3px rgba(0,0,0,0.1), modals: 0 4px 12px rgba(0,0,0,0.15)")
   Default when not discussed: "No design tokens specified. Defaults:" followed by a neutral light-theme palette.

   **Section 8 — Constraints and Avoidances**
   Three lists derived directly from `LayoutIntent.constraints`:
   - **Fixed** (must not change during implementation): [constraints.fixed]
   - **Flexible** (adjustable by the implementer): [constraints.flexible]
   - **Avoid** (must not appear in the implementation): [constraints.avoid]

   **Section 9 — Deliverable Specification**
   Define the expected output from the implementing LLM:
   - **File structure**: list expected output files (e.g., "index.html + styles.css" or "Layout.tsx, Sidebar.tsx, MainContent.tsx, NavBar.tsx")
   - **Component boundaries**: which regions are separate components and what props they accept
   - **Data placeholders**: realistic sample data (e.g., "John Doe", "2026-03-08", "$1,234.56") — not "Lorem ipsum"
   - **Icon references**: icon library (e.g., "Lucide React icons") or "inline SVG placeholder squares with text labels"

   **Section 10 — Acceptance Criteria**
   Binary pass/fail checklist. 8–15 criteria, each verifiable by visual inspection or DOM measurement. Reference specific regions, elements, or measurements from Sections 3–7. Example items:
   - [ ] All [N] regions visible at ≥1024px viewport width
   - [ ] [Region A] occupies grid area "[area-name]" with min-width [X]px
   - [ ] [Region B] contains [specific element] at [position]
   - [ ] Clicking [element] causes [specific visible result]
   - [ ] At viewport width <768px, [specific responsive change] occurs
   - [ ] No horizontal scrollbar at ≥1024px viewport width
   - [ ] Body text ≥14px, contrast ratio ≥4.5:1 against background

   **Quality gates (verify before submitting the rendered prompt):**
   - Every region in the approved preview has a corresponding Section 4 block.
   - Every Section 4 block contains all 7 sub-items (Role, Contains, Internal layout, Visual style, Content behavior, Empty state, Loading state).
   - No abstract adjectives remain: "nice", "clean", "modern", "intuitive", "appropriate", "beautiful", "seamless" are replaced with CSS properties or specific descriptions.
   - All dimensions are in px, %, fr, or grid units — not words like "large", "narrow", "generous".
   - Acceptance criteria reference at least one item from each of Sections 3–7.

4. Call `layout_build_prompt` with the `packet` and `renderedPrompt`.

5. The user can click "Suggest Prompt (LLM)" in the browser to trigger this step. When this happens, prioritize prompt generation immediately.

6. Call `layout_close` to end the session.

After closing the forge, provide a brief summary in the terminal:
1. Final visual layout combination
2. Why this layout fits the user's UI goals
3. The generated prompt (if available)

## Multi-Round Tool Reference

| Tool | Purpose | When to Use |
|------|---------|-------------|
| `layout_open_workbench` | Open browser with loading state | Once at start (Step 1) |
| `layout_push_questions` | Send questions to browser | Round 1 (Step 4), Round 2 detail (Step 6.2), follow-up (Step 6.3) |
| `layout_await_completion` | Wait for user answers or review action | After each push (Steps 5, 6.2, 6.6) |
| `layout_push_message` | Show text message in browser | Status updates (Step 6.1) |
| `layout_push_preview` | Push visual preview for review | After generating preview (Step 6.5) |
| `layout_build_prompt` | Generate PromptPacket and rendered prompt | After preview approval (Step 7.2) |
| `layout_close` | End session, close server | ONLY after user approves or finishes (Steps 6.7, 7.4) |

**Important**: The browser stays open throughout the entire flow. The user never has to leave the browser or return to the terminal until the session is fully complete.
