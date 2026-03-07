# ASCII Layout Readability Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make ASCII layout previews consistently readable across desktop/mobile and multilingual (ASCII + CJK) content by improving rendering, generation constraints, and fallback UX.

**Architecture:** Keep the current text-first architecture (`buildAsciiPreview` + message rendering in `<pre>`) but add an explicit render pipeline: normalize content -> compute display-cell width -> choose render mode (Unicode box or pure ASCII) -> render with viewport-aware sizing and fallback controls. Add constraints in formatting/generation so produced diagrams are structurally predictable and testable. Treat browser typography tuning and content-shaping as complementary layers, not substitutes.

**Tech Stack:** TypeScript, Bun, vanilla HTML/CSS/JS, Unicode East Asian Width rules (UAX #11), `string-width` (or equivalent width calculator), optional Mermaid/SVG for non-ASCII fallback rendering.

---

## Baseline Findings (Current Code)

- `.opencode/layout-workbench/ui/index.html` renders AI messages using inline `<pre style="white-space: pre; overflow-x: auto; font-family: var(--font-mono); font-size: 14px; line-height: 1.45;">` inside `renderMessages()`.
- `.preview-diagram` CSS exists but is currently not used by the active message path.
- `.opencode/plugins/lw/ascii.ts` generates fixed-width Unicode box diagrams using hard-coded char widths (`truncate` + `padEnd`) that assume `string.length` ~= display width.
- `.opencode/plugins/lw/format.ts` and `.opencode/plugins/lw/export.ts` emit `## Numbered ASCII Layout` blocks but do not enforce strict structural constraints for multilingual width safety.
- There is no render-mode negotiation (Unicode vs ASCII), no width diagnostics metadata, and no mobile-specific diagram strategy beyond horizontal scrolling.

---

## Recommendation Summary

1. **Adopt dual render mode (recommended):** keep Unicode box-drawing as default, auto-fallback to pure ASCII (`+-|`) when width confidence is low (CJK/ambiguous glyphs/font mismatch), and expose a manual UI toggle.
2. **Add display-cell width logic in generation:** stop relying on `string.length`; use cell-width calculation (East Asian aware) for truncation/padding.
3. **Add strict diagram generation constraints:** fixed charset, fixed max line length, reserved labels, normalized spaces, no tabs, no emoji.
4. **Improve `<pre>` rendering semantics and typography controls:** dedicated class-based styling (not inline), tuned line-height/letter-spacing, tab-size, optional language-sensitive settings.
5. **Add mobile/narrow viewport fallback UX:** preserve canonical diagram (no wrapping), but provide zoom/fit modes, mini-map, and optional section-wise stacked textual summary.
6. **Optional phase:** support alternate renderer (Mermaid/SVG) for readability-critical contexts while preserving ASCII as source of truth.

---

## External References Used

- MDN `<pre>` and accessibility guidance: preserve preformatted text and provide semantic alternatives for ASCII-art-like output.
- MDN `white-space`, `line-height`, `letter-spacing`, `font-family`: confirms effects on wrapping, glyph spacing, and fallback behavior.
- Unicode UAX #11 (East Asian Width): ambiguous/wide/narrow handling and recommendation to treat ambiguous as narrow by default when context is unclear.
- `string-width` package docs: practical JS API for visual cell width (`古` -> 2) with ambiguous-width policy.
- Mermaid docs: viable text-to-diagram SVG alternative where ASCII legibility fails.

---

### Task 1: Introduce Readability Acceptance Tests (Quick Win, High Impact)

**Files:**
- Create: `tests/lw/ascii-readability.test.ts`
- Create: `tests/lw/ascii-cjk-width.test.ts`
- Modify: `package.json` (if test script update is needed)

**Step 1: Write failing tests for baseline regressions**

```ts
it("keeps box corners aligned for ASCII-only labels", () => {
  const out = buildAsciiPreview(sessionWithAscii)
  expect(allLinesSameVisualWidth(out.diagram)).toBe(true)
})

it("keeps rows aligned for mixed CJK labels", () => {
  const out = buildAsciiPreview(sessionWithCjk)
  expect(allLinesSameVisualWidth(out.diagram)).toBe(true)
})

it("provides ASCII fallback diagram when width confidence is low", () => {
  const out = buildAsciiPreview(sessionWithAmbiguousWidth, { mode: "auto" })
  expect(out.charset).toBe("ascii")
})
```

**Step 2: Run tests to verify failure**

Run: `bun test tests/lw/ascii-readability.test.ts tests/lw/ascii-cjk-width.test.ts`

Expected: FAIL due to current `string.length`-based width and no render mode support.

**Step 3: Commit**

```bash
git add tests/lw/ascii-readability.test.ts tests/lw/ascii-cjk-width.test.ts package.json
git commit -m "test: add ASCII readability and CJK width regression coverage"
```

---

### Task 2: Add Width-Aware Diagram Core (Deep Fix, Highest Impact)

**Files:**
- Modify: `.opencode/plugins/lw/ascii.ts`
- Modify: `.opencode/plugins/lw/types.ts`
- Create: `.opencode/plugins/lw/text-width.ts`
- Test: `tests/lw/ascii-cjk-width.test.ts`

**Step 1: Add failing test for display-cell utilities**

```ts
it("counts CJK as double width", () => {
  expect(cellWidth("A古B")).toBe(4)
})
```

**Step 2: Implement width utility with explicit policy**

```ts
export function cellWidth(input: string): number {
  // use string-width (ambiguousIsNarrow: true) or equivalent implementation
}

export function padCellByWidth(input: string, targetCells: number): string {
  // truncate by visual cells, then space-pad to target
}
```

**Step 3: Refactor `ascii.ts` to use cell-width functions**

```ts
const row = (a: string, b: string, c: string) =>
  `│${padCellByWidth(a, leftWidth)}│${padCellByWidth(b, centerWidth)}│${padCellByWidth(c, rightWidth)}│`
```

**Step 4: Extend preview metadata**

```ts
interface AsciiPreview {
  diagram: string
  legend: AsciiPreviewSection[]
  generatedAt: string
  charset: "unicode" | "ascii"
  widthConfidence: "high" | "medium" | "low"
}
```

**Step 5: Re-run tests**

Run: `bun test tests/lw/ascii-cjk-width.test.ts`

Expected: PASS; row widths visually aligned in mixed-language strings.

**Step 6: Commit**

```bash
git add .opencode/plugins/lw/ascii.ts .opencode/plugins/lw/types.ts .opencode/plugins/lw/text-width.ts tests/lw/ascii-cjk-width.test.ts
git commit -m "feat: make ASCII preview width-aware for CJK and ambiguous glyphs"
```

---

### Task 3: Implement Dual Render Mode (Unicode + Pure ASCII) with Auto Selection

**Files:**
- Modify: `.opencode/plugins/lw/ascii.ts`
- Modify: `.opencode/plugins/lw/format.ts`
- Modify: `.opencode/plugins/lw/export.ts`
- Test: `tests/lw/ascii-readability.test.ts`

**Step 1: Add failing tests for mode selection**

```ts
it("renders unicode in high-confidence contexts", () => {
  expect(buildAsciiPreview(sessionAsciiOnly, { mode: "auto" }).charset).toBe("unicode")
})

it("falls back to pure ascii in low-confidence contexts", () => {
  expect(buildAsciiPreview(sessionMixedCjk, { mode: "auto" }).charset).toBe("ascii")
})
```

**Step 2: Implement render mode policy**

```ts
type RenderMode = "auto" | "unicode" | "ascii"
// auto: choose ascii when confidence low (ambiguous-heavy, unsupported glyph diagnostics, or narrow viewport hints)
```

**Step 3: Ensure formatter/export annotate charset and compatibility note**

```md
## Numbered ASCII Layout (charset: ascii)
```

**Step 4: Re-run tests**

Run: `bun test tests/lw/ascii-readability.test.ts`

Expected: PASS.

**Step 5: Commit**

```bash
git add .opencode/plugins/lw/ascii.ts .opencode/plugins/lw/format.ts .opencode/plugins/lw/export.ts tests/lw/ascii-readability.test.ts
git commit -m "feat: add unicode/ascii dual render mode with auto fallback"
```

---

### Task 4: Replace Inline `<pre>` Styling with Dedicated Readability Classes (Quick Win)

**Files:**
- Modify: `.opencode/layout-workbench/ui/index.html`

**Step 1: Add failing UI snapshot/DOM test (if available)**

```ts
expect(pre.classList.contains("message-diagram")).toBe(true)
```

**Step 2: Move message `<pre>` inline styles into class-based CSS**

```css
.message-diagram {
  white-space: pre;
  overflow: auto;
  tab-size: 2;
  font-family: var(--font-mono);
  font-size: 13px;
  line-height: 1.3;
  letter-spacing: 0;
  font-kerning: none;
  text-rendering: optimizeSpeed;
}
```

**Step 3: Add render metadata badges in message card**

```html
<span class="diagram-meta">unicode | 95 cols | confidence: high</span>
```

**Step 4: Manual verification**

Run app and verify:
- No wrapping inside diagram block
- Stable vertical alignment at 100%, 125%, 150% zoom
- No clipping of top/bottom box lines

**Step 5: Commit**

```bash
git add .opencode/layout-workbench/ui/index.html
git commit -m "feat: harden preformatted diagram typography and metadata display"
```

---

### Task 5: Mobile/Narrow Viewport Preservation Strategy (Quick Win + UX)

**Files:**
- Modify: `.opencode/layout-workbench/ui/index.html`
- Optional create: `.opencode/layout-workbench/ui/diagram-view.ts` (if splitting script)

**Step 1: Add failing viewport behavior test (manual or Playwright)**

```ts
// at 375px viewport, diagram container remains horizontally scrollable, not wrapped
```

**Step 2: Implement narrow-screen controls**

```txt
Mode: [Fit Width] [1:1] [Summary]
```

- `1:1`: exact preformatted with horizontal scroll.
- `Fit Width`: scale transform for quick overview (non-authoritative preview).
- `Summary`: section-wise textual list when diagram is unreadable on mobile.

**Step 3: Add sticky mini-map indicator for scroll position (optional)**

**Step 4: Validate mobile behavior**

Check 360px/390px/430px widths in browser responsive mode.

**Step 5: Commit**

```bash
git add .opencode/layout-workbench/ui/index.html .opencode/layout-workbench/ui/diagram-view.ts
git commit -m "feat: add narrow-viewport diagram preservation and fallback views"
```

---

### Task 6: Add Prompt/Generation Constraints for Diagram Consistency (Deep, Medium Risk)

**Files:**
- Modify: `.opencode/plugins/lw/format.ts`
- Modify: `.opencode/plugins/lw/ascii.ts`
- Optional create: `.opencode/plugins/lw/diagram-constraints.ts`

**Step 1: Add failing tests for normalization rules**

```ts
it("rejects tabs and normalizes to spaces", () => { ... })
it("caps diagram width to configured max columns", () => { ... })
it("removes unsupported symbols outside configured charset", () => { ... })
```

**Step 2: Add hard constraints included in formatted tool output**

```md
Diagram constraints:
- Charset: unicode-box or pure-ascii only
- Max width: 95 columns
- No tabs; spaces only
- Labels max: 22 visual cells per panel
- No emoji/symbols outside profile
```

**Step 3: Enforce constraints in generation pipeline**

**Step 4: Re-run tests**

Run: `bun test tests/lw/ascii-readability.test.ts`

Expected: PASS.

**Step 5: Commit**

```bash
git add .opencode/plugins/lw/format.ts .opencode/plugins/lw/ascii.ts .opencode/plugins/lw/diagram-constraints.ts tests/lw/ascii-readability.test.ts
git commit -m "feat: enforce diagram generation constraints for deterministic readability"
```

---

### Task 7: Add Fallback UX for Unreliable Glyph Support (Deep, Medium Impact)

**Files:**
- Modify: `.opencode/layout-workbench/ui/index.html`
- Modify: `.opencode/plugins/lw/server.ts`
- Modify: `.opencode/plugins/lw/types.ts`

**Step 1: Add detection + metadata flow**

- Include `charset` and `widthConfidence` in `/api/session` payload.
- UI shows warning when confidence is low: "Diagram switched to ASCII compatibility mode."

**Step 2: Add manual toggle in UI**

```txt
[Unicode] [ASCII Compatible]
```

**Step 3: Persist preferred mode per session**

**Step 4: Manual validation**

Ensure toggle updates current and future pushed messages in same session.

**Step 5: Commit**

```bash
git add .opencode/layout-workbench/ui/index.html .opencode/plugins/lw/server.ts .opencode/plugins/lw/types.ts
git commit -m "feat: expose render confidence and user-selectable diagram mode"
```

---

### Task 8: Evaluate and Gate Alternative Diagram Renderer (Optional Track)

**Files:**
- Create: `.opencode/plugins/lw/alt-renderer.ts`
- Modify: `.opencode/plugins/lw/format.ts`
- Modify: `.opencode/layout-workbench/ui/index.html`
- Docs: `docs/ADW-001-layout-workbench.md`

**Step 1: Prototype Mermaid flow for same semantic sections**

```txt
ASCII source-of-truth -> Mermaid syntax -> SVG preview (optional)
```

**Step 2: Add feature flag**

`LW_ENABLE_ALT_RENDERER=true`

**Step 3: Fallback order**

`Unicode ASCII` -> `Pure ASCII` -> `Mermaid SVG`

**Step 4: Validate security/perf constraints**

**Step 5: Commit (optional branch)**

```bash
git add .opencode/plugins/lw/alt-renderer.ts .opencode/plugins/lw/format.ts .opencode/layout-workbench/ui/index.html docs/ADW-001-layout-workbench.md
git commit -m "feat: add optional mermaid-based fallback renderer for low-legibility cases"
```

---

## Priority and Scope Matrix

| Priority | Item | Impact | Effort | Scope |
|---|---|---:|---:|---|
| P0 | Width-aware cell computation + tests (Tasks 1-2) | Very High | Medium | Core generation correctness |
| P0 | Dual render mode auto fallback (Task 3) | Very High | Medium | Reliability across fonts/locales |
| P1 | `<pre>` typography refactor (Task 4) | High | Low | Fast UI readability gains |
| P1 | Mobile preservation modes (Task 5) | High | Medium | Small-screen usability |
| P1 | Prompt/generation constraints (Task 6) | High | Medium | Output consistency |
| P2 | Render confidence UX + manual toggle (Task 7) | Medium | Medium | User trust/control |
| P3 | Mermaid/SVG optional renderer (Task 8) | Medium | High | Strategic fallback |

---

## Risk / Impact Analysis

| Risk | Where | Impact | Mitigation |
|---|---|---|---|
| Width library mismatch with browser fonts | `ascii.ts`, UI | Misaligned boxes persist | Keep dual mode + confidence scoring + manual override |
| Over-constraining labels harms expressiveness | `format.ts` | Loss of useful context | Truncate with hover/full-text legend, not hard deletion |
| Mobile fit mode misleads users | UI | Decision errors | Label fit mode as "preview", keep 1:1 authoritative mode |
| Unicode fallback churn in mixed locales | generation/UI | Flaky experience | Session-persisted mode and deterministic fallback policy |
| Added complexity in rendering flow | plugin + UI | Maintenance cost | Keep source-of-truth in one module and add tests per stage |

---

## Validation Checklist (Definition of Done)

### Functional

- [ ] ASCII-only, mixed CJK, and mixed punctuation diagrams retain aligned borders in generated output.
- [ ] Auto mode chooses Unicode in high-confidence cases and ASCII in low-confidence cases.
- [ ] User can manually override mode in UI and setting persists for session.
- [ ] Mobile (<= 430px) supports 1:1 scroll mode without wrapping corruption.

### Visual/UX

- [ ] `<pre>` rendering uses class-based styling (no inline ad-hoc overrides).
- [ ] Diagram metadata (charset, confidence, column width) is visible to user.
- [ ] Summary fallback remains understandable when diagrams are too wide.

### Technical

- [ ] `bun test tests/lw/ascii-readability.test.ts tests/lw/ascii-cjk-width.test.ts` passes.
- [ ] Any existing plugin tests still pass.
- [ ] LSP diagnostics clean for touched files.

### Cross-Environment Smoke Checks

- [ ] Chromium latest desktop
- [ ] Safari/WebKit (if available)
- [ ] Firefox latest
- [ ] Browser zoom 100/125/150%

---

## Final Recommendation on Charset Strategy

- **Do not fully abandon Unicode box-drawing.** It is more legible when supported.
- **Do not rely on Unicode only.** Mixed-language width and font fallback are too fragile.
- **Implement dual mode now:** default Unicode + automatic pure ASCII fallback + manual override.
- **Keep optional SVG renderer as P3:** use only for edge cases or when product direction shifts from terminal-like output.
