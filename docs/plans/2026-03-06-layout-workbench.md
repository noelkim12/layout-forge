# Layout Workbench Plugin Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** OpenCode 플러그인으로 `/layout` 명령 시 브라우저 기반 레이아웃 의사결정 워크벤치를 열어, 8단계 질문 흐름 + ASCII 프리뷰 + 규칙 기반 추천을 통해 최종 레이아웃을 결정하고, 결과를 OpenCode 세션으로 돌려주는 플러그인을 만든다.

**Architecture:** `/layout` command → LLM이 `layout_open_workbench` tool 호출 → 플러그인이 ephemeral Bun.serve 서버 시작 → 브라우저 SPA 열기 → 사용자가 8단계 질문 응답 → Promise resolve → 결과를 tool output으로 반환. 브라우저는 sidecar 서버만 호출하며 OpenCode 서버에 직접 접근하지 않는다.

**Tech Stack:** TypeScript, Bun runtime, `@opencode-ai/plugin` (tool() + Zod schema), Bun.serve (HTTP), vanilla HTML/CSS/JS (SPA)

**Reference Spec:** `docs/ADW-001-layout-workbench.md`

---

## Known Risks & Mitigations

### Critical (구현 중 반드시 해결)

| # | Risk | Impact | Mitigation |
|---|------|--------|------------|
| 1 | `.opencode/plugins/*.{ts,js}` 자동 로드 — helper 파일이 플러그인으로 오인됨 | Plugin load failure | helper 모듈은 `plugins/lw/` 서브디렉토리에 배치. `opencode-companion` 플러그인도 `plugins/modules/` 패턴 사용 확인 |
| 2 | AbortSignal 미처리 → 좀비 서버 | Port leak, orphan process | `context.abort` → `server.stop()` + Promise rejection. `try/finally`로 모든 코드 경로에서 cleanup 보장 |
| 3 | `center-focus`/`two-column-right-drawer` 선택 시 left/right 질문이 의미 없음 | UX dead end | `applies()` 함수로 조건부 스킵 — shell.mode가 후속 노드 활성화 결정 |

### High (디버깅 어려운 문제 유발)

| # | Risk | Impact | Mitigation |
|---|------|--------|------------|
| 4 | WSL2에서 `xdg-open` 불안정 | Browser won't open | fallback 체인: `wslview` → `xdg-open` → `cmd.exe /c start` → URL 출력 (clipboard + terminal) |
| 5 | Plan 모드 파일 쓰기 모호성 — LLM이 쓰는지 tool이 쓰는지 | Silent write failure | **tool의 `execute()` 내부에서 `Bun.write()`로 직접 쓰기**. LLM에게 파일 쓰기 위임 금지 |
| 6 | 장시간 tool execution — LLM provider timeout 가능 | User loses all progress | 60분 max session + 45분 경고. `context.metadata({ title })` 로 TUI에 상태 표시 |
| 7 | 동시 세션 — /layout 중복 호출 | State corruption, port leak | 전역 singleton guard — `activeServer` 존재 시 기존 URL 반환 |

### Medium (구현 마찰)

| # | Risk | Impact | Mitigation |
|---|------|--------|------------|
| 8 | SPA 파일 경로 해석 — `process.cwd()` vs plugin dir | UI 404 | `import.meta.dir` (Bun) 기준 경로 해석, `process.cwd()` 금지 |
| 9 | AI 코멘터리 helper session 누적 | Token 낭비, rate limit | 세션당 최대 3회 + 워크벤치 종료 시 cleanup |
| 10 | Tool 반환 크기 초과 | Output truncated | `formatToolResult()` 2KB 이하. 전체 데이터는 파일에만 저장 |
| 11 | One-time token 보안 설계 | Token leakage | `crypto.randomUUID()` 서버 시작 시 생성, 모든 `/api/*` 요청에서 `X-Session-Token` 헤더 검증 |

---

## 구현 전 결정 필요 사항

아래 항목은 구현 전에 사용자와 합의가 필요하다.

### Must-Answer

1. **Shell mode → 노드 게이팅 방식**: `center-focus` 선택 시 left/right 질문을 (a) 완전 스킵, (b) 단일 "사이드바 요소" 질문으로 축소, (c) "N/A" 옵션과 함께 제시 중 어떤 방식? → **현재 계획: (a) 완전 스킵 (`applies()` 함수)**
2. **Blocking vs Async tool**: 현재 설계는 LLM turn을 워크벤치 전체 세션 동안 block. 10-30분 소요 가능. 이게 OK인지, 아니면 tool이 즉시 반환하고 callback 메커니즘 사용? → **현재 계획: Blocking (Plannotator 동일 패턴)**
3. **브라우저 탭 닫힘 시**: 사용자가 실수로 탭을 닫으면 (a) 서버 유지 + URL 재출력, (b) abandonment 처리 중 어느 쪽? → **현재 계획: (a) 서버 유지, idle timeout까지 대기**

---

## File Structure (최종)

```
.opencode/
  package.json                          # @opencode-ai/plugin dependency
  commands/
    layout.md                            # /layout command definition
    layout-resume.md                     # /layout-resume command
    layout-export.md                     # /layout-export command
  plugins/
    layout-workbench.ts                  # Plugin entry (auto-loaded)
    lw/                                  # Helper modules (NOT auto-loaded)
      types.ts                           # All TypeScript types
      graph.ts                           # 8-node question graph
      reducer.ts                         # State transitions + history
      store.ts                           # Session create/load/save
      ascii.ts                           # ASCII renderer (pure functions)
      score.ts                           # Rule-based scoring engine
      ai.ts                              # AI commentary via helper session
      server.ts                          # Ephemeral Bun.serve HTTP server
      browser.ts                         # Cross-platform browser opener
      format.ts                          # Tool result formatter
  plans/
    layout/                              # Generated layout plans (markdown)
  layout-workbench/
    sessions/                            # Session JSON files
    exports/                             # Exported artifacts
    ui/
      index.html                         # SPA (all-in-one HTML/CSS/JS)
```

---

## Phase 1: Foundation

### Task 1: Project Scaffold

**Files:**
- Create: `.opencode/package.json`
- Create: `tsconfig.json`
- Create: `.gitignore`
- Create: directory structure

**Step 1: Initialize git repository**

```bash
cd /home/noel/projects/personal/opencode-layout-workbench
git init
```

**Step 2: Create .opencode/package.json**

```json
{
  "name": "opencode-layout-workbench",
  "private": true,
  "dependencies": {
    "@opencode-ai/plugin": "latest"
  }
}
```

OpenCode는 시작 시 이 파일을 읽어 `bun install`로 dependency를 설치한다.

**Step 3: Create tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ESNext",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "outDir": "dist",
    "rootDir": ".",
    "types": ["bun-types"],
    "paths": {
      "@lw/*": ["./.opencode/plugins/lw/*"]
    }
  },
  "include": [".opencode/plugins/**/*.ts"],
  "exclude": ["node_modules", "dist"]
}
```

**Step 4: Create directory structure**

```bash
mkdir -p .opencode/commands
mkdir -p .opencode/plugins/lw
mkdir -p .opencode/plans/layout
mkdir -p .opencode/layout-workbench/sessions
mkdir -p .opencode/layout-workbench/exports
mkdir -p .opencode/layout-workbench/ui
```

**Step 5: Create .gitignore**

```
node_modules/
.opencode/layout-workbench/sessions/
dist/
*.js.map
```

**Step 6: Commit**

```bash
git add -A
git commit -m "chore: scaffold project structure for layout workbench plugin"
```

---

### Task 2: Plugin Entry & Command Definition (M1)

**Files:**
- Create: `.opencode/plugins/layout-workbench.ts`
- Create: `.opencode/commands/layout.md`

**Step 1: Create stub plugin entry**

```typescript
// .opencode/plugins/layout-workbench.ts
import type { Plugin } from "@opencode-ai/plugin"
import { tool } from "@opencode-ai/plugin"

export const LayoutWorkbenchPlugin: Plugin = async (ctx) => {
  await ctx.client.app.log({
    body: {
      service: "layout-workbench",
      level: "info",
      message: "Layout Workbench plugin initialized",
    },
  })

  return {
    tool: {
      layout_open_workbench: tool({
        description:
          "Open the layout decision workbench in a browser. The user will make step-by-step layout choices. Wait for the result before proceeding.",
        args: {
          brief: tool.schema
            .string()
            .describe("What the user wants to design — a short description of the UI goal"),
        },
        async execute(args, context) {
          // TODO: M2에서 서버+브라우저 구현
          return `[Layout Workbench] Stub response for: "${args.brief}". Workbench not yet implemented.`
        },
      }),
    },

    event: async ({ event }) => {
      if (event.type === "session.deleted") {
        // TODO: M5에서 세션 cleanup 구현
      }
    },
  }
}
```

**Step 2: Create /layout command definition**

```markdown
<!-- .opencode/commands/layout.md -->
---
description: 단계별 레이아웃 의사결정 워크벤치 열기
agent: plan
---

현재 요청에 맞는 UI 레이아웃을 단계적으로 결정해야 합니다.

사용자 목표:
$ARGUMENTS

반드시 `layout_open_workbench` 툴을 즉시 호출해서
외부 의사결정 워크벤치를 먼저 여세요.

툴이 반환되기 전에는 레이아웃을 임의로 확정하지 마세요.
툴이 반환되면 아래를 간단히 정리하세요:
1. 최종 조합
2. 왜 이 조합이 적절한지
3. 남은 결정 사항
```

**Step 3: Verify — OpenCode 시작 후 /layout 실행**

```bash
# OpenCode를 이 프로젝트 디렉토리에서 시작
opencode

# TUI에서 /layout 입력 → LLM이 layout_open_workbench tool 호출하는지 확인
# Stub response가 나오면 성공
```

Expected: LLM이 `layout_open_workbench` tool을 호출하고 stub response를 받아 정리해서 보여줌.

**Step 4: Commit**

```bash
git add -A
git commit -m "feat: add plugin entry with stub tool and /layout command"
```

---

## Phase 2: Decision Core (M3)

### Task 3: Types & Question Graph

**Files:**
- Create: `.opencode/plugins/lw/types.ts`
- Create: `.opencode/plugins/lw/graph.ts`
- Create: `tests/graph.test.ts`

**Step 1: Write types**

`types.ts`는 ADW-001 스펙의 타입을 그대로 구현. 핵심 타입:

```typescript
// .opencode/plugins/lw/types.ts

export type StageId = "shell" | "left" | "center" | "right" | "final"

export interface WorkbenchDraft {
  shell: {
    mode?: "three-column" | "two-column-right-drawer" | "center-focus"
    widths: { left: number; center: number; right: number }
  }
  left: {
    primary?: "tree" | "sections" | "tabs"
    secondary: Array<"filters" | "presets" | "history">
  }
  center: {
    primary?: "cards-first" | "preview-first" | "split"
    secondary: Array<"ascii-preview" | "diff-view" | "detail-form">
  }
  right: {
    primary?: "commentary" | "decision-log" | "inspector"
    secondary: Array<"recommendation" | "risks" | "a11y-notes">
  }
}

export interface DecisionEvent {
  nodeId: string
  selectedOptionIds: string[]
  at: string // ISO timestamp
}

export interface WorkbenchSession {
  id: string
  opencodeSessionId: string
  brief: string
  currentStage: StageId
  currentNodeId: string
  draft: WorkbenchDraft
  answers: Record<string, string[]>
  history: DecisionEvent[]
  createdAt: string
  updatedAt: string
  status: "active" | "completed" | "abandoned"
}

export type NodeType = "single-select" | "multi-select" | "review"

export interface QuestionOption {
  id: string
  label: string
  description: string
  tags?: string[] // for scoring
}

export interface QuestionNode {
  id: string
  stageId: StageId
  label: string
  question: string
  type: NodeType
  options: QuestionOption[]
  next: string | null // next node id, null = end
  applies: (draft: WorkbenchDraft) => boolean // conditional visibility
}

export interface GraphDefinition {
  nodes: QuestionNode[]
  entryNodeId: string
}
```

**Step 2: Write the question graph**

8개 고정 노드를 정의. 각 노드는 `QuestionNode` 인터페이스 구현:

```typescript
// .opencode/plugins/lw/graph.ts
import type { GraphDefinition, QuestionNode, WorkbenchDraft } from "./types"

const NODES: QuestionNode[] = [
  {
    id: "shell.mode",
    stageId: "shell",
    label: "Shell Mode",
    question: "전체 레이아웃 구조를 선택하세요",
    type: "single-select",
    options: [
      {
        id: "three-column",
        label: "Three Column",
        description: "좌/중/우 3단 균등. 탐색+작업+컨텍스트 동시 표시",
        tags: ["discoverability", "breadth"],
      },
      {
        id: "two-column-right-drawer",
        label: "Two Column + Right Drawer",
        description: "좌/중 2단 + 오른쪽 슬라이드 드로어. 포커스 중심",
        tags: ["focus", "progressive-disclosure"],
      },
      {
        id: "center-focus",
        label: "Center Focus",
        description: "중앙 집중형. 좌우는 최소화. 단일 작업 몰입",
        tags: ["simplicity", "depth"],
      },
    ],
    next: "left.primary",
    applies: () => true,
  },
  {
    id: "left.primary",
    stageId: "left",
    label: "Left Panel - Primary",
    question: "왼쪽 패널의 주 역할을 선택하세요",
    type: "single-select",
    options: [
      { id: "tree", label: "Tree Navigation", description: "계층형 트리 탐색", tags: ["navigation", "hierarchy"] },
      { id: "sections", label: "Section List", description: "평면 섹션 목록", tags: ["flat", "scannable"] },
      { id: "tabs", label: "Tab Groups", description: "탭 기반 전환", tags: ["compact", "switching"] },
    ],
    next: "left.secondary",
    applies: (draft) => draft.shell.mode !== "center-focus",
  },
  {
    id: "left.secondary",
    stageId: "left",
    label: "Left Panel - Secondary",
    question: "왼쪽 패널에 추가할 보조 모듈을 선택하세요 (복수 선택 가능)",
    type: "multi-select",
    options: [
      { id: "filters", label: "Filters", description: "필터링 컨트롤", tags: ["filtering"] },
      { id: "presets", label: "Presets", description: "사전 설정 목록", tags: ["efficiency"] },
      { id: "history", label: "History", description: "변경 이력", tags: ["traceability"] },
    ],
    next: "center.primary",
    applies: (draft) => draft.shell.mode !== "center-focus",
  },
  {
    id: "center.primary",
    stageId: "center",
    label: "Center Panel - Primary",
    question: "중앙 패널의 주 역할을 선택하세요",
    type: "single-select",
    options: [
      { id: "cards-first", label: "Decision Cards", description: "카드형 의사결정 UI", tags: ["decision", "scannable"] },
      { id: "preview-first", label: "Preview First", description: "프리뷰 중심 레이아웃", tags: ["visual", "preview"] },
      { id: "split", label: "Split View", description: "상하 또는 좌우 분할", tags: ["comparison", "multitask"] },
    ],
    next: "center.secondary",
    applies: () => true,
  },
  {
    id: "center.secondary",
    stageId: "center",
    label: "Center Panel - Secondary",
    question: "중앙 패널에 추가할 보조 모듈을 선택하세요 (복수 선택 가능)",
    type: "multi-select",
    options: [
      { id: "ascii-preview", label: "ASCII Preview", description: "실시간 ASCII box 프리뷰", tags: ["preview"] },
      { id: "diff-view", label: "Diff View", description: "현재안 vs 추천안 비교", tags: ["comparison"] },
      { id: "detail-form", label: "Detail Form", description: "상세 설정 폼", tags: ["configuration"] },
    ],
    next: "right.primary",
    applies: () => true,
  },
  {
    id: "right.primary",
    stageId: "right",
    label: "Right Panel - Primary",
    question: "오른쪽 패널의 주 역할을 선택하세요",
    type: "single-select",
    options: [
      { id: "commentary", label: "AI Commentary", description: "AI 분석 및 코멘터리", tags: ["ai", "insight"] },
      { id: "decision-log", label: "Decision Log", description: "결정 이력 타임라인", tags: ["traceability", "log"] },
      { id: "inspector", label: "Inspector", description: "선택 항목 상세 검사", tags: ["detail", "debug"] },
    ],
    next: "right.secondary",
    applies: (draft) => draft.shell.mode !== "center-focus",
  },
  {
    id: "right.secondary",
    stageId: "right",
    label: "Right Panel - Secondary",
    question: "오른쪽 패널에 추가할 보조 모듈을 선택하세요 (복수 선택 가능)",
    type: "multi-select",
    options: [
      { id: "recommendation", label: "Recommendations", description: "추천 사항 표시", tags: ["recommendation"] },
      { id: "risks", label: "Risks & Tradeoffs", description: "위험 요소 표시", tags: ["risk", "tradeoff"] },
      { id: "a11y-notes", label: "A11y Notes", description: "접근성 참고사항", tags: ["accessibility"] },
    ],
    next: "final.review",
    applies: (draft) => draft.shell.mode !== "center-focus",
  },
  {
    id: "final.review",
    stageId: "final",
    label: "Final Review",
    question: "최종 레이아웃을 검토하세요. 변경하고 싶은 단계가 있으면 돌아갈 수 있습니다.",
    type: "review",
    options: [
      { id: "confirm", label: "Confirm", description: "이 조합으로 확정", tags: [] },
      { id: "restart", label: "Restart", description: "처음부터 다시", tags: [] },
    ],
    next: null,
    applies: () => true,
  },
]

export const GRAPH: GraphDefinition = {
  nodes: NODES,
  entryNodeId: "shell.mode",
}

/** Get node by ID */
export function getNode(nodeId: string): QuestionNode | undefined {
  return NODES.find((n) => n.id === nodeId)
}

/** Get the next applicable node from current, given draft state */
export function getNextNode(currentNodeId: string, draft: WorkbenchDraft): QuestionNode | null {
  const current = getNode(currentNodeId)
  if (!current || !current.next) return null

  let nextId: string | null = current.next
  while (nextId) {
    const next = getNode(nextId)
    if (!next) return null
    if (next.applies(draft)) return next
    nextId = next.next
  }
  return null
}

/** Get all applicable nodes in order */
export function getApplicableNodes(draft: WorkbenchDraft): QuestionNode[] {
  const result: QuestionNode[] = []
  let nodeId: string | null = GRAPH.entryNodeId
  while (nodeId) {
    const node = getNode(nodeId)
    if (!node) break
    if (node.applies(draft)) result.push(node)
    nodeId = node.next
  }
  return result
}
```

**Step 3: Write failing tests**

```typescript
// tests/graph.test.ts
import { describe, expect, it } from "bun:test"
import { getNode, getNextNode, getApplicableNodes, GRAPH } from "../.opencode/plugins/lw/graph"
import type { WorkbenchDraft } from "../.opencode/plugins/lw/types"

const DEFAULT_DRAFT: WorkbenchDraft = {
  shell: { widths: { left: 25, center: 50, right: 25 } },
  left: { secondary: [] },
  center: { secondary: [] },
  right: { secondary: [] },
}

describe("graph", () => {
  it("should have exactly 8 nodes", () => {
    expect(GRAPH.nodes).toHaveLength(8)
  })

  it("should start with shell.mode", () => {
    expect(GRAPH.entryNodeId).toBe("shell.mode")
  })

  it("should find node by id", () => {
    const node = getNode("shell.mode")
    expect(node).toBeDefined()
    expect(node!.stageId).toBe("shell")
  })

  it("should return undefined for unknown node", () => {
    expect(getNode("nonexistent")).toBeUndefined()
  })

  it("should get next node in sequence", () => {
    const next = getNextNode("shell.mode", DEFAULT_DRAFT)
    expect(next).toBeDefined()
    expect(next!.id).toBe("left.primary")
  })

  it("should skip left/right panels for center-focus mode", () => {
    const centerDraft: WorkbenchDraft = {
      ...DEFAULT_DRAFT,
      shell: { mode: "center-focus", widths: { left: 0, center: 100, right: 0 } },
    }
    const applicable = getApplicableNodes(centerDraft)
    const ids = applicable.map((n) => n.id)

    expect(ids).toContain("shell.mode")
    expect(ids).toContain("center.primary")
    expect(ids).toContain("center.secondary")
    expect(ids).toContain("final.review")
    expect(ids).not.toContain("left.primary")
    expect(ids).not.toContain("right.primary")
  })

  it("should show all nodes for three-column mode", () => {
    const threeDraft: WorkbenchDraft = {
      ...DEFAULT_DRAFT,
      shell: { mode: "three-column", widths: { left: 25, center: 50, right: 25 } },
    }
    const applicable = getApplicableNodes(threeDraft)
    expect(applicable).toHaveLength(8)
  })

  it("final.review should have next=null", () => {
    const final = getNode("final.review")
    expect(final!.next).toBeNull()
  })
})
```

**Step 4: Run tests**

```bash
bun test tests/graph.test.ts
```

Expected: All tests pass.

**Step 5: Commit**

```bash
git add -A
git commit -m "feat: add types and 8-node question graph with conditional visibility"
```

---

### Task 4: State Reducer & Session Store

**Files:**
- Create: `.opencode/plugins/lw/reducer.ts`
- Create: `.opencode/plugins/lw/store.ts`
- Create: `tests/reducer.test.ts`
- Create: `tests/store.test.ts`

**Step 1: Write the reducer**

Reducer는 순수 함수. 현재 세션 + action → 새 세션 반환:

```typescript
// .opencode/plugins/lw/reducer.ts
import type { WorkbenchSession, DecisionEvent, WorkbenchDraft, StageId } from "./types"
import { getNode, getNextNode } from "./graph"

export type Action =
  | { type: "ANSWER"; nodeId: string; selectedOptionIds: string[] }
  | { type: "GO_BACK"; toNodeId: string }
  | { type: "COMPLETE" }
  | { type: "ABANDON" }

export function reduce(session: WorkbenchSession, action: Action): WorkbenchSession {
  const now = new Date().toISOString()

  switch (action.type) {
    case "ANSWER": {
      const node = getNode(action.nodeId)
      if (!node) throw new Error(`Unknown node: ${action.nodeId}`)

      const event: DecisionEvent = {
        nodeId: action.nodeId,
        selectedOptionIds: action.selectedOptionIds,
        at: now,
      }

      const newDraft = applyAnswer(session.draft, action.nodeId, action.selectedOptionIds)
      const nextNode = getNextNode(action.nodeId, newDraft)

      return {
        ...session,
        draft: newDraft,
        answers: { ...session.answers, [action.nodeId]: action.selectedOptionIds },
        history: [...session.history, event],
        currentNodeId: nextNode?.id ?? "final.review",
        currentStage: nextNode?.stageId ?? "final",
        updatedAt: now,
      }
    }

    case "GO_BACK": {
      const node = getNode(action.toNodeId)
      if (!node) throw new Error(`Unknown node: ${action.toNodeId}`)

      return {
        ...session,
        currentNodeId: action.toNodeId,
        currentStage: node.stageId,
        updatedAt: now,
      }
    }

    case "COMPLETE":
      return { ...session, status: "completed", updatedAt: now }

    case "ABANDON":
      return { ...session, status: "abandoned", updatedAt: now }
  }
}

function applyAnswer(
  draft: WorkbenchDraft,
  nodeId: string,
  selectedIds: string[],
): WorkbenchDraft {
  const newDraft = structuredClone(draft)

  switch (nodeId) {
    case "shell.mode":
      newDraft.shell.mode = selectedIds[0] as WorkbenchDraft["shell"]["mode"]
      // Adjust widths based on mode
      if (selectedIds[0] === "center-focus") {
        newDraft.shell.widths = { left: 0, center: 100, right: 0 }
      } else if (selectedIds[0] === "two-column-right-drawer") {
        newDraft.shell.widths = { left: 25, center: 55, right: 20 }
      } else {
        newDraft.shell.widths = { left: 20, center: 50, right: 30 }
      }
      break
    case "left.primary":
      newDraft.left.primary = selectedIds[0] as WorkbenchDraft["left"]["primary"]
      break
    case "left.secondary":
      newDraft.left.secondary = selectedIds as WorkbenchDraft["left"]["secondary"]
      break
    case "center.primary":
      newDraft.center.primary = selectedIds[0] as WorkbenchDraft["center"]["primary"]
      break
    case "center.secondary":
      newDraft.center.secondary = selectedIds as WorkbenchDraft["center"]["secondary"]
      break
    case "right.primary":
      newDraft.right.primary = selectedIds[0] as WorkbenchDraft["right"]["primary"]
      break
    case "right.secondary":
      newDraft.right.secondary = selectedIds as WorkbenchDraft["right"]["secondary"]
      break
  }

  return newDraft
}
```

**Step 2: Write failing tests for reducer**

```typescript
// tests/reducer.test.ts
import { describe, expect, it } from "bun:test"
import { reduce } from "../.opencode/plugins/lw/reducer"
import type { WorkbenchSession } from "../.opencode/plugins/lw/types"

function createTestSession(): WorkbenchSession {
  return {
    id: "test-session",
    opencodeSessionId: "ses_123",
    brief: "Test brief",
    currentStage: "shell",
    currentNodeId: "shell.mode",
    draft: {
      shell: { widths: { left: 25, center: 50, right: 25 } },
      left: { secondary: [] },
      center: { secondary: [] },
      right: { secondary: [] },
    },
    answers: {},
    history: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    status: "active",
  }
}

describe("reducer", () => {
  it("should advance to next node on ANSWER", () => {
    const session = createTestSession()
    const next = reduce(session, {
      type: "ANSWER",
      nodeId: "shell.mode",
      selectedOptionIds: ["three-column"],
    })

    expect(next.currentNodeId).toBe("left.primary")
    expect(next.currentStage).toBe("left")
    expect(next.draft.shell.mode).toBe("three-column")
    expect(next.history).toHaveLength(1)
    expect(next.answers["shell.mode"]).toEqual(["three-column"])
  })

  it("should skip left/right panels for center-focus", () => {
    const session = createTestSession()
    const next = reduce(session, {
      type: "ANSWER",
      nodeId: "shell.mode",
      selectedOptionIds: ["center-focus"],
    })

    expect(next.currentNodeId).toBe("center.primary")
    expect(next.draft.shell.widths.left).toBe(0)
  })

  it("should handle GO_BACK", () => {
    let session = createTestSession()
    session = reduce(session, {
      type: "ANSWER",
      nodeId: "shell.mode",
      selectedOptionIds: ["three-column"],
    })
    session = reduce(session, { type: "GO_BACK", toNodeId: "shell.mode" })

    expect(session.currentNodeId).toBe("shell.mode")
    expect(session.history).toHaveLength(1) // history preserved
  })

  it("should mark COMPLETE", () => {
    const session = createTestSession()
    const completed = reduce(session, { type: "COMPLETE" })
    expect(completed.status).toBe("completed")
  })

  it("should mark ABANDON", () => {
    const session = createTestSession()
    const abandoned = reduce(session, { type: "ABANDON" })
    expect(abandoned.status).toBe("abandoned")
  })

  it("should throw on unknown node", () => {
    const session = createTestSession()
    expect(() =>
      reduce(session, { type: "ANSWER", nodeId: "fake", selectedOptionIds: [] }),
    ).toThrow("Unknown node")
  })

  it("should accumulate multi-select answers", () => {
    let session = createTestSession()
    session = reduce(session, {
      type: "ANSWER",
      nodeId: "shell.mode",
      selectedOptionIds: ["three-column"],
    })
    session = reduce(session, {
      type: "ANSWER",
      nodeId: "left.primary",
      selectedOptionIds: ["tree"],
    })
    session = reduce(session, {
      type: "ANSWER",
      nodeId: "left.secondary",
      selectedOptionIds: ["filters", "history"],
    })

    expect(session.draft.left.secondary).toEqual(["filters", "history"])
    expect(session.history).toHaveLength(3)
  })
})
```

**Step 3: Run tests**

```bash
bun test tests/reducer.test.ts
```

Expected: All tests pass.

**Step 4: Write session store**

```typescript
// .opencode/plugins/lw/store.ts
import type { WorkbenchSession, WorkbenchDraft } from "./types"
import { GRAPH } from "./graph"
import { join } from "path"

const SESSIONS_DIR = ".opencode/layout-workbench/sessions"

function generateId(): string {
  return `lw_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

export function createSession(opencodeSessionId: string, brief: string, baseDir: string): WorkbenchSession {
  const now = new Date().toISOString()
  return {
    id: generateId(),
    opencodeSessionId,
    brief,
    currentStage: "shell",
    currentNodeId: GRAPH.entryNodeId,
    draft: {
      shell: { widths: { left: 25, center: 50, right: 25 } },
      left: { secondary: [] },
      center: { secondary: [] },
      right: { secondary: [] },
    },
    answers: {},
    history: [],
    createdAt: now,
    updatedAt: now,
    status: "active",
  }
}

export async function saveSession(session: WorkbenchSession, baseDir: string): Promise<void> {
  const dir = join(baseDir, SESSIONS_DIR)
  await Bun.write(join(dir, `${session.id}.json`), JSON.stringify(session, null, 2))
}

export async function loadSession(sessionId: string, baseDir: string): Promise<WorkbenchSession | null> {
  const path = join(baseDir, SESSIONS_DIR, `${sessionId}.json`)
  const file = Bun.file(path)
  if (!(await file.exists())) return null
  return JSON.parse(await file.text()) as WorkbenchSession
}

export async function listSessions(baseDir: string): Promise<string[]> {
  const dir = join(baseDir, SESSIONS_DIR)
  const glob = new Bun.Glob("*.json")
  const files: string[] = []
  for await (const file of glob.scan({ cwd: dir })) {
    files.push(file.replace(".json", ""))
  }
  return files
}

export async function deleteSession(sessionId: string, baseDir: string): Promise<void> {
  const path = join(baseDir, SESSIONS_DIR, `${sessionId}.json`)
  const file = Bun.file(path)
  if (await file.exists()) {
    await Bun.write(path, "") // Bun doesn't have rm, write empty then unlink
    const { unlink } = await import("fs/promises")
    await unlink(path)
  }
}
```

**Step 5: Write store tests**

```typescript
// tests/store.test.ts
import { describe, expect, it, beforeEach, afterEach } from "bun:test"
import { createSession, saveSession, loadSession, listSessions, deleteSession } from "../.opencode/plugins/lw/store"
import { mkdtemp, rm } from "fs/promises"
import { join } from "path"
import { tmpdir } from "os"

describe("store", () => {
  let tempDir: string

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "lw-test-"))
    await Bun.write(join(tempDir, ".opencode/layout-workbench/sessions/.gitkeep"), "")
  })

  afterEach(async () => {
    await rm(tempDir, { recursive: true })
  })

  it("should create a session with generated id", () => {
    const session = createSession("ses_abc", "Test brief", tempDir)
    expect(session.id).toMatch(/^lw_/)
    expect(session.brief).toBe("Test brief")
    expect(session.status).toBe("active")
    expect(session.currentNodeId).toBe("shell.mode")
  })

  it("should save and load a session", async () => {
    const session = createSession("ses_abc", "Test brief", tempDir)
    await saveSession(session, tempDir)
    const loaded = await loadSession(session.id, tempDir)
    expect(loaded).toEqual(session)
  })

  it("should return null for missing session", async () => {
    const loaded = await loadSession("nonexistent", tempDir)
    expect(loaded).toBeNull()
  })

  it("should list sessions", async () => {
    const s1 = createSession("ses_1", "Brief 1", tempDir)
    const s2 = createSession("ses_2", "Brief 2", tempDir)
    await saveSession(s1, tempDir)
    await saveSession(s2, tempDir)
    const list = await listSessions(tempDir)
    expect(list).toHaveLength(2)
    expect(list).toContain(s1.id)
    expect(list).toContain(s2.id)
  })
})
```

**Step 6: Run tests**

```bash
bun test tests/store.test.ts
```

**Step 7: Commit**

```bash
git add -A
git commit -m "feat: add state reducer with history tracking and session store"
```

---

## Phase 3: ASCII Renderer (M4)

### Task 5: ASCII Renderer

**Files:**
- Create: `.opencode/plugins/lw/ascii.ts`
- Create: `tests/ascii.test.ts`

**Step 1: Write the ASCII renderer**

순수 함수. draft를 받아 ASCII box를 반환:

```typescript
// .opencode/plugins/lw/ascii.ts
import type { WorkbenchDraft } from "./types"

export interface RenderOptions {
  width: 80 | 100 | 120
  charset: "unicode" | "ascii"
}

const DEFAULTS: RenderOptions = { width: 100, charset: "unicode" }
const MIN_PANE_WIDTH = 12

interface BoxChars {
  tl: string; tr: string; bl: string; br: string
  h: string; v: string
  tj: string; bj: string; lj: string; rj: string
  cross: string
}

const UNICODE: BoxChars = {
  tl: "┌", tr: "┐", bl: "└", br: "┘",
  h: "─", v: "│",
  tj: "┬", bj: "┴", lj: "├", rj: "┤",
  cross: "┼",
}

const ASCII_CHARS: BoxChars = {
  tl: "+", tr: "+", bl: "+", br: "+",
  h: "-", v: "|",
  tj: "+", bj: "+", lj: "+", rj: "+",
  cross: "+",
}

function getChars(charset: "unicode" | "ascii"): BoxChars {
  return charset === "unicode" ? UNICODE : ASCII_CHARS
}

function truncate(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text
  return text.slice(0, maxLen - 1) + "…"
}

function padRight(text: string, width: number): string {
  return text + " ".repeat(Math.max(0, width - text.length))
}

function centerText(text: string, width: number): string {
  const pad = Math.max(0, width - text.length)
  const left = Math.floor(pad / 2)
  const right = pad - left
  return " ".repeat(left) + text + " ".repeat(right)
}

export function renderPreview(draft: WorkbenchDraft, opts: Partial<RenderOptions> = {}): string {
  const o = { ...DEFAULTS, ...opts }
  const c = getChars(o.charset)
  const W = o.width - 2 // inner width (minus borders)

  const mode = draft.shell.mode ?? "three-column"
  const title = ` Workbench `
  const lines: string[] = []

  // Title bar
  const titlePad = W - title.length
  const titleLeft = Math.floor(titlePad / 2)
  const titleRight = titlePad - titleLeft
  lines.push(c.tl + c.h.repeat(titleLeft) + title + c.h.repeat(titleRight) + c.tr)

  // Mode line
  lines.push(c.v + padRight(` Mode: ${mode}`, W) + c.v)

  // Calculate pane widths
  const { left: lPct, center: cPct, right: rPct } = draft.shell.widths
  const totalPct = lPct + cPct + rPct
  const lw = Math.max(lPct > 0 ? MIN_PANE_WIDTH : 0, Math.floor((lPct / totalPct) * W))
  const rw = Math.max(rPct > 0 ? MIN_PANE_WIDTH : 0, Math.floor((rPct / totalPct) * W))
  const cw = W - lw - rw - (lPct > 0 ? 1 : 0) - (rPct > 0 ? 1 : 0) // account for dividers

  // Separator with column dividers
  let sep = c.lj
  if (lw > 0) sep += c.h.repeat(lw) + c.cross
  sep += c.h.repeat(Math.max(0, cw))
  if (rw > 0) sep += c.cross + c.h.repeat(rw)
  lines.push(sep + c.rj)

  // Column headers
  const headers = buildPaneContent(draft, lw, cw, rw)
  for (const row of headers) {
    let line = c.v
    if (lw > 0) line += padRight(truncate(row.left, lw), lw) + c.v
    line += padRight(truncate(row.center, cw), Math.max(0, cw))
    if (rw > 0) line += c.v + padRight(truncate(row.right, rw), rw)
    lines.push(line + c.v)
  }

  // Bottom border
  let bottom = c.bl
  if (lw > 0) bottom += c.h.repeat(lw) + c.bj
  bottom += c.h.repeat(Math.max(0, cw))
  if (rw > 0) bottom += c.bj + c.h.repeat(rw)
  lines.push(bottom + c.br)

  return lines.join("\n")
}

interface PaneRow {
  left: string
  center: string
  right: string
}

function buildPaneContent(draft: WorkbenchDraft, lw: number, cw: number, rw: number): PaneRow[] {
  // Max 4 rows per pane (per spec rule 6)
  const leftItems = lw > 0
    ? [
        " " + (draft.left.primary ?? "Left"),
        ...draft.left.secondary.map((s) => " " + s),
      ].slice(0, 4)
    : []

  const centerItems = [
    " " + (draft.center.primary ?? "Center"),
    ...draft.center.secondary.map((s) => " " + s),
  ].slice(0, 4)

  const rightItems = rw > 0
    ? [
        " " + (draft.right.primary ?? "Right"),
        ...draft.right.secondary.map((s) => " " + s),
      ].slice(0, 4)
    : []

  const maxRows = Math.max(leftItems.length, centerItems.length, rightItems.length, 1)
  const rows: PaneRow[] = []
  for (let i = 0; i < maxRows; i++) {
    rows.push({
      left: leftItems[i] ?? "",
      center: centerItems[i] ?? "",
      right: rightItems[i] ?? "",
    })
  }
  return rows
}

/** Render a mini preview for a single option (used in option cards) */
export function renderOptionPreview(
  currentDraft: WorkbenchDraft,
  patch: Partial<WorkbenchDraft>,
  opts: Partial<RenderOptions> = {},
): string {
  const merged = structuredClone(currentDraft)
  Object.assign(merged, patch)
  return renderPreview(merged, { ...opts, width: 60 })
}

/** Render side-by-side diff of current vs candidate */
export function renderDiff(
  current: WorkbenchDraft,
  candidate: WorkbenchDraft,
  opts: Partial<RenderOptions> = {},
): string {
  const currentPreview = renderPreview(current, { ...opts, width: 60 })
  const candidatePreview = renderPreview(candidate, { ...opts, width: 60 })

  const currentLines = currentPreview.split("\n")
  const candidateLines = candidatePreview.split("\n")
  const maxLines = Math.max(currentLines.length, candidateLines.length)

  const lines: string[] = []
  lines.push("  Current" + " ".repeat(52) + "Candidate")
  lines.push("  " + "─".repeat(58) + "  " + "─".repeat(58))

  for (let i = 0; i < maxLines; i++) {
    const l = currentLines[i] ?? ""
    const r = candidateLines[i] ?? ""
    lines.push("  " + padRight(l, 58) + "  " + r)
  }

  return lines.join("\n")
}
```

**Step 2: Write tests**

```typescript
// tests/ascii.test.ts
import { describe, expect, it } from "bun:test"
import { renderPreview, renderDiff } from "../.opencode/plugins/lw/ascii"
import type { WorkbenchDraft } from "../.opencode/plugins/lw/types"

const THREE_COLUMN: WorkbenchDraft = {
  shell: { mode: "three-column", widths: { left: 20, center: 50, right: 30 } },
  left: { primary: "tree", secondary: ["filters", "presets"] },
  center: { primary: "cards-first", secondary: ["ascii-preview", "diff-view"] },
  right: { primary: "decision-log", secondary: ["recommendation", "risks"] },
}

const CENTER_FOCUS: WorkbenchDraft = {
  shell: { mode: "center-focus", widths: { left: 0, center: 100, right: 0 } },
  left: { secondary: [] },
  center: { primary: "preview-first", secondary: ["ascii-preview"] },
  right: { secondary: [] },
}

describe("ascii renderer", () => {
  it("should render three-column layout", () => {
    const result = renderPreview(THREE_COLUMN)
    expect(result).toContain("Workbench")
    expect(result).toContain("three-column")
    expect(result).toContain("tree")
    expect(result).toContain("cards-first")
    expect(result).toContain("decision-log")
  })

  it("should render center-focus without side panels", () => {
    const result = renderPreview(CENTER_FOCUS)
    expect(result).toContain("center-focus")
    expect(result).toContain("preview-first")
    expect(result).not.toContain("tree")
  })

  it("should respect width option", () => {
    const r80 = renderPreview(THREE_COLUMN, { width: 80 })
    const r120 = renderPreview(THREE_COLUMN, { width: 120 })
    const lines80 = r80.split("\n")
    const lines120 = r120.split("\n")
    expect(lines80[0].length).toBe(80)
    expect(lines120[0].length).toBe(120)
  })

  it("should use ascii charset", () => {
    const result = renderPreview(THREE_COLUMN, { charset: "ascii" })
    expect(result).toContain("+")
    expect(result).toContain("-")
    expect(result).not.toContain("┌")
  })

  it("should produce diff output with two columns", () => {
    const diff = renderDiff(THREE_COLUMN, CENTER_FOCUS)
    expect(diff).toContain("Current")
    expect(diff).toContain("Candidate")
  })

  it("should limit pane content to 4 lines max", () => {
    const manySecondary: WorkbenchDraft = {
      ...THREE_COLUMN,
      left: { primary: "tree", secondary: ["filters", "presets", "history"] },
    }
    const result = renderPreview(manySecondary)
    const lines = result.split("\n")
    // Content area should have at most 4 rows
    const contentLines = lines.filter((l) => l.includes("│") && !l.includes("─") && !l.includes("Mode"))
    expect(contentLines.length).toBeLessThanOrEqual(4)
  })
})
```

**Step 3: Run tests**

```bash
bun test tests/ascii.test.ts
```

**Step 4: Commit**

```bash
git add -A
git commit -m "feat: add ASCII renderer with unicode/ascii charsets and diff support"
```

---

## Phase 4: Sidecar Web UI (M2)

### Task 6: HTTP Server & Browser Opener

**Files:**
- Create: `.opencode/plugins/lw/server.ts`
- Create: `.opencode/plugins/lw/browser.ts`

**Step 1: Write cross-platform browser opener**

```typescript
// .opencode/plugins/lw/browser.ts
import { platform } from "os"
import { execSync } from "child_process"

function isWSL(): boolean {
  try {
    const release = execSync("uname -r", { encoding: "utf-8" })
    return release.toLowerCase().includes("microsoft") || release.toLowerCase().includes("wsl")
  } catch {
    return false
  }
}

export async function openBrowser(url: string): Promise<void> {
  const os = platform()

  try {
    if (os === "darwin") {
      Bun.spawn(["open", url])
    } else if (os === "win32") {
      Bun.spawn(["cmd.exe", "/c", "start", url])
    } else if (isWSL()) {
      // WSL: use Windows browser via cmd.exe
      Bun.spawn(["cmd.exe", "/c", "start", url.replace(/&/g, "^&")])
    } else {
      // Linux
      Bun.spawn(["xdg-open", url])
    }
  } catch (error) {
    // Non-fatal — log but don't throw
    console.error(`Failed to open browser: ${error}. Please open manually: ${url}`)
  }
}
```

**Step 2: Write ephemeral HTTP server**

```typescript
// .opencode/plugins/lw/server.ts
import type { Server } from "bun"
import type { WorkbenchSession } from "./types"
import type { Action } from "./reducer"
import { reduce } from "./reducer"
import { saveSession } from "./store"
import { getNode, getApplicableNodes } from "./graph"
import { renderPreview } from "./ascii"

export interface ServerConfig {
  session: WorkbenchSession
  baseDir: string
  uiHtml: string // pre-loaded HTML content
  onLog?: (msg: string) => void
}

export interface WorkbenchServer {
  url: string
  port: number
  token: string
  stop: () => void
  waitForCompletion: () => Promise<WorkbenchSession>
}

export async function startWorkbenchServer(
  config: ServerConfig,
  abortSignal?: AbortSignal,
): Promise<WorkbenchServer> {
  let currentSession = config.session
  const token = crypto.randomUUID()

  let resolveCompletion: (session: WorkbenchSession) => void
  let rejectCompletion: (error: Error) => void

  const completionPromise = new Promise<WorkbenchSession>((resolve, reject) => {
    resolveCompletion = resolve
    rejectCompletion = reject
  })

  // Idle timeout: auto-close after 30 min of inactivity
  let idleTimer: ReturnType<typeof setTimeout>
  const resetIdleTimer = () => {
    clearTimeout(idleTimer)
    idleTimer = setTimeout(() => {
      currentSession = reduce(currentSession, { type: "ABANDON" })
      saveSession(currentSession, config.baseDir)
      resolveCompletion(currentSession)
      server.stop()
    }, 30 * 60 * 1000)
  }

  const server: Server = Bun.serve({
    port: 0, // OS assigns random port
    hostname: "127.0.0.1",
    async fetch(req) {
      const url = new URL(req.url)

      // Token validation (except for root)
      if (url.pathname !== "/" && url.pathname !== "/health") {
        const reqToken = url.searchParams.get("token") ?? req.headers.get("x-session-token")
        if (reqToken !== token) {
          return new Response("Unauthorized", { status: 401 })
        }
      }

      resetIdleTimer()

      // CORS headers for local development
      const corsHeaders = {
        "Access-Control-Allow-Origin": `http://127.0.0.1:${server.port}`,
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, X-Session-Token",
      }

      if (req.method === "OPTIONS") {
        return new Response(null, { status: 204, headers: corsHeaders })
      }

      try {
        // --- API Routes ---
        if (url.pathname === "/api/session") {
          const nodes = getApplicableNodes(currentSession.draft)
          const currentNode = getNode(currentSession.currentNodeId)
          const preview = renderPreview(currentSession.draft)
          return Response.json({
            session: currentSession,
            currentNode,
            applicableNodes: nodes,
            preview,
          }, { headers: corsHeaders })
        }

        if (url.pathname === "/api/answer" && req.method === "POST") {
          const body = await req.json() as { nodeId: string; selectedOptionIds: string[] }
          const action: Action = {
            type: "ANSWER",
            nodeId: body.nodeId,
            selectedOptionIds: body.selectedOptionIds,
          }
          currentSession = reduce(currentSession, action)
          await saveSession(currentSession, config.baseDir)

          const nodes = getApplicableNodes(currentSession.draft)
          const currentNode = getNode(currentSession.currentNodeId)
          const preview = renderPreview(currentSession.draft)
          return Response.json({
            session: currentSession,
            currentNode,
            applicableNodes: nodes,
            preview,
          }, { headers: corsHeaders })
        }

        if (url.pathname === "/api/back" && req.method === "POST") {
          const body = await req.json() as { toNodeId: string }
          currentSession = reduce(currentSession, { type: "GO_BACK", toNodeId: body.toNodeId })
          await saveSession(currentSession, config.baseDir)
          const nodes = getApplicableNodes(currentSession.draft)
          const currentNode = getNode(currentSession.currentNodeId)
          const preview = renderPreview(currentSession.draft)
          return Response.json({
            session: currentSession,
            currentNode,
            applicableNodes: nodes,
            preview,
          }, { headers: corsHeaders })
        }

        if (url.pathname === "/api/complete" && req.method === "POST") {
          currentSession = reduce(currentSession, { type: "COMPLETE" })
          await saveSession(currentSession, config.baseDir)
          resolveCompletion(currentSession)
          // Server will be stopped after completion promise resolves
          return Response.json({ status: "completed", session: currentSession }, { headers: corsHeaders })
        }

        // --- UI Route ---
        if (url.pathname === "/") {
          // Inject token and session ID into HTML
          const html = config.uiHtml
            .replace("__SESSION_TOKEN__", token)
            .replace("__SESSION_ID__", currentSession.id)
          return new Response(html, {
            headers: { "Content-Type": "text/html; charset=utf-8", ...corsHeaders },
          })
        }

        return new Response("Not Found", { status: 404 })
      } catch (error) {
        config.onLog?.(`Server error: ${error}`)
        return Response.json({ error: String(error) }, { status: 500, headers: corsHeaders })
      }
    },
  })

  resetIdleTimer()

  // Handle abort signal (OpenCode cancellation)
  abortSignal?.addEventListener("abort", () => {
    clearTimeout(idleTimer)
    currentSession = reduce(currentSession, { type: "ABANDON" })
    saveSession(currentSession, config.baseDir)
    resolveCompletion(currentSession)
    server.stop()
  })

  const serverUrl = `http://127.0.0.1:${server.port}?token=${token}`

  return {
    url: serverUrl,
    port: server.port,
    token,
    stop: () => {
      clearTimeout(idleTimer)
      server.stop()
    },
    waitForCompletion: async () => {
      const result = await completionPromise
      server.stop()
      return result
    },
  }
}
```

**Step 3: Verify — Manual test**

```bash
# 별도 Bun 스크립트로 서버 단독 테스트
bun run -e "
import { startWorkbenchServer } from './.opencode/plugins/lw/server'
import { createSession } from './.opencode/plugins/lw/store'

const session = createSession('test', 'Test brief', '.')
const server = await startWorkbenchServer({
  session,
  baseDir: '.',
  uiHtml: '<h1>Test</h1><script>document.title=\"Token: __SESSION_TOKEN__\"</script>',
})
console.log('Server running at:', server.url)
// Should print URL with random port and token
"
```

**Step 4: Commit**

```bash
git add -A
git commit -m "feat: add ephemeral Bun HTTP server with token auth and cross-platform browser opener"
```

---

### Task 7: SPA UI Shell

**Files:**
- Create: `.opencode/layout-workbench/ui/index.html`

**Step 1: Create the all-in-one SPA**

HTML 파일 하나에 모든 CSS/JS 포함. 3컬럼 레이아웃:
- 좌측: 단계 네비게이터 (step sidebar)
- 중앙: 질문 카드 + ASCII 프리뷰
- 우측: 추천 + 결정 로그

핵심 구현 사항:
- `__SESSION_TOKEN__`과 `__SESSION_ID__` 자리표시자를 서버에서 주입
- 모든 API 호출에 `X-Session-Token` 헤더 포함
- 상태 변경 시 `/api/session` 재호출로 최신 상태 반영
- ASCII 프리뷰는 서버가 반환하는 `preview` 문자열을 `<pre>` 태그로 표시
- 반응형 필수 아님 — desktop-first로 구현

SPA는 약 400-600줄의 HTML/CSS/JS로 구현. 이 task에서는 완전한 SPA를 작성하지만, 디자인 디테일은 구현 시 조정 가능.

**구현해야 할 UI 컴포넌트:**

1. `StepSidebar` — 좌측 단계 목록. 현재 단계 하이라이트, 완료된 단계 체크마크, 클릭으로 GO_BACK
2. `QuestionCard` — 중앙 상단. 질문 텍스트 + 옵션 라디오/체크박스
3. `AsciiPreview` — 중앙 하단. 현재 draft의 ASCII box 렌더링 (`<pre>`)
4. `RecommendationPanel` — 우측 상단. 규칙 기반 점수 표시 (Task 11에서 구현, 일단 빈 패널)
5. `DecisionLog` — 우측 하단. history 배열의 타임라인 표시
6. `ActionBar` — 하단. "다음", "이전", "완료" 버튼

**API 통신 흐름:**
```
[Page Load] → GET /api/session → 렌더링
[선택 후 "다음"] → POST /api/answer → 렌더링
[단계 클릭] → POST /api/back → 렌더링
[최종 확인] → POST /api/complete → "완료" 화면
```

**Step 2: Verify — 브라우저에서 직접 열기**

```bash
# 서버 테스트 스크립트로 실제 UI 확인
bun run scripts/test-ui.ts
# 브라우저에서 URL 열어서 UI 동작 확인
```

**Step 3: Commit**

```bash
git add -A
git commit -m "feat: add SPA UI with step sidebar, question cards, ASCII preview, and decision log"
```

---

## Phase 5: Full Integration (M1+M2+M3 연결)

### Task 8: End-to-End Plugin Flow

**Files:**
- Modify: `.opencode/plugins/layout-workbench.ts`
- Create: `.opencode/plugins/lw/format.ts`

**Step 1: Write result formatter**

Tool이 OpenCode에 반환할 결과 문자열 포맷:

```typescript
// .opencode/plugins/lw/format.ts
import type { WorkbenchSession } from "./types"
import { renderPreview } from "./ascii"
import { getNode } from "./graph"

export function formatToolResult(session: WorkbenchSession): string {
  if (session.status === "abandoned") {
    return "사용자가 레이아웃 워크벤치를 중단했습니다."
  }

  const preview = renderPreview(session.draft, { width: 80, charset: "unicode" })

  const decisions = session.history.map((event) => {
    const node = getNode(event.nodeId)
    return `- **${node?.label ?? event.nodeId}**: ${event.selectedOptionIds.join(", ")}`
  }).join("\n")

  return `## 레이아웃 결정 완료

### 사용자 목표
${session.brief}

### 최종 레이아웃
\`\`\`
${preview}
\`\`\`

### 결정 이력
${decisions}

### 최종 조합
- **Shell**: ${session.draft.shell.mode} (${session.draft.shell.widths.left}/${session.draft.shell.widths.center}/${session.draft.shell.widths.right})
- **Left**: ${session.draft.left.primary ?? "없음"} + [${session.draft.left.secondary.join(", ")}]
- **Center**: ${session.draft.center.primary ?? "없음"} + [${session.draft.center.secondary.join(", ")}]
- **Right**: ${session.draft.right.primary ?? "없음"} + [${session.draft.right.secondary.join(", ")}]

### 세션 ID
${session.id}
`
}
```

**Step 2: Wire the full flow in plugin entry**

```typescript
// .opencode/plugins/layout-workbench.ts 를 완성:
import type { Plugin } from "@opencode-ai/plugin"
import { tool } from "@opencode-ai/plugin"
import { createSession, saveSession, loadSession } from "./lw/store"
import { startWorkbenchServer } from "./lw/server"
import { openBrowser } from "./lw/browser"
import { formatToolResult } from "./lw/format"
import { join } from "path"

// Active server tracking (prevent duplicate)
let activeServer: { stop: () => void; url: string } | null = null

export const LayoutWorkbenchPlugin: Plugin = async (ctx) => {
  await ctx.client.app.log({
    body: { service: "layout-workbench", level: "info", message: "Layout Workbench plugin initialized" },
  })

  // Load UI HTML at plugin init (once)
  const uiPath = join(ctx.directory, ".opencode/layout-workbench/ui/index.html")
  const uiFile = Bun.file(uiPath)
  const uiHtml = await uiFile.exists() ? await uiFile.text() : "<h1>UI not found</h1>"

  return {
    tool: {
      layout_open_workbench: tool({
        description:
          "Open the layout decision workbench in a browser and wait for the user's decisions. Returns the final layout choices.",
        args: {
          brief: tool.schema.string().describe("What the user wants to design"),
        },
        async execute(args, context) {
          // Prevent duplicate servers
          if (activeServer) {
            return `워크벤치가 이미 열려있습니다: ${activeServer.url}`
          }

          const session = createSession(context.sessionID, args.brief, ctx.directory)
          await saveSession(session, ctx.directory)

          await ctx.client.app.log({
            body: {
              service: "layout-workbench",
              level: "info",
              message: `Workbench session created: ${session.id}`,
            },
          })

          const server = await startWorkbenchServer(
            {
              session,
              baseDir: ctx.directory,
              uiHtml,
              onLog: (msg) => {
                ctx.client.app.log({
                  body: { service: "layout-workbench", level: "debug", message: msg },
                })
              },
            },
            context.abort,
          )

          activeServer = server

          await ctx.client.app.log({
            body: {
              service: "layout-workbench",
              level: "info",
              message: `Workbench server started at ${server.url}`,
            },
          })

          await openBrowser(server.url)

          // Block until user completes or abandons
          const result = await server.waitForCompletion()
          activeServer = null

          return formatToolResult(result)
        },
      }),
    },

    event: async ({ event }) => {
      if (event.type === "session.deleted") {
        // Cleanup: stop server if the OpenCode session is deleted
        if (activeServer) {
          activeServer.stop()
          activeServer = null
        }
      }
    },
  }
}
```

**Step 3: End-to-end verification**

```bash
# OpenCode를 프로젝트 디렉토리에서 시작
opencode

# /layout design a user analytics dashboard
# → LLM이 layout_open_workbench 호출
# → 브라우저가 열림
# → 8단계 질문 응답
# → 완료 시 결과가 OpenCode에 반환됨
# → LLM이 결과를 정리해서 보여줌
```

**Step 4: Commit**

```bash
git add -A
git commit -m "feat: wire complete plugin→server→browser→completion flow"
```

---

## Phase 6: Persistence & Export (M5)

### Task 9: Markdown Export

**Files:**
- Create: `.opencode/plugins/lw/export.ts`
- Create: `tests/export.test.ts`

**Step 1: Write markdown exporter**

```typescript
// .opencode/plugins/lw/export.ts
import type { WorkbenchSession } from "./types"
import { renderPreview } from "./ascii"
import { getNode } from "./graph"
import { join } from "path"

const PLANS_DIR = ".opencode/plans/layout"

export function generateMarkdownPlan(session: WorkbenchSession): string {
  const preview = renderPreview(session.draft, { width: 100, charset: "unicode" })

  const decisions = session.history.map((event) => {
    const node = getNode(event.nodeId)
    const selected = event.selectedOptionIds.join(", ")
    return `| ${node?.label ?? event.nodeId} | ${selected} | ${event.at} |`
  }).join("\n")

  // Find unanswered nodes
  const allNodeIds = ["shell.mode", "left.primary", "left.secondary",
    "center.primary", "center.secondary", "right.primary", "right.secondary"]
  const answered = Object.keys(session.answers)
  const pending = allNodeIds.filter((id) => !answered.includes(id))

  return `# Layout Plan: ${session.brief}

> Generated by Layout Workbench (${session.id})
> Date: ${new Date(session.updatedAt).toLocaleDateString("ko-KR")}

## 최종 레이아웃

\`\`\`
${preview}
\`\`\`

## 조합 요약

| 영역 | 설정 |
|------|------|
| Shell Mode | ${session.draft.shell.mode ?? "미정"} |
| Shell Widths | ${session.draft.shell.widths.left}/${session.draft.shell.widths.center}/${session.draft.shell.widths.right} |
| Left Primary | ${session.draft.left.primary ?? "없음"} |
| Left Secondary | ${session.draft.left.secondary.join(", ") || "없음"} |
| Center Primary | ${session.draft.center.primary ?? "없음"} |
| Center Secondary | ${session.draft.center.secondary.join(", ") || "없음"} |
| Right Primary | ${session.draft.right.primary ?? "없음"} |
| Right Secondary | ${session.draft.right.secondary.join(", ") || "없음"} |

## 단계별 결정 이력

| 단계 | 선택 | 시점 |
|------|------|------|
${decisions}

${pending.length > 0 ? `## 미정 항목\n${pending.map((p) => `- ${p}`).join("\n")}` : ""}

## 메타데이터

- Session ID: \`${session.id}\`
- OpenCode Session: \`${session.opencodeSessionId}\`
- Status: ${session.status}
- Created: ${session.createdAt}
- Updated: ${session.updatedAt}
`
}

export async function exportMarkdownPlan(session: WorkbenchSession, baseDir: string): Promise<string> {
  const markdown = generateMarkdownPlan(session)
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19)
  const filename = `${timestamp}-layout-plan.md`
  const path = join(baseDir, PLANS_DIR, filename)
  await Bun.write(path, markdown)
  return path
}
```

**Step 2: Write tests**

```typescript
// tests/export.test.ts
import { describe, expect, it } from "bun:test"
import { generateMarkdownPlan } from "../.opencode/plugins/lw/export"
import type { WorkbenchSession } from "../.opencode/plugins/lw/types"

const COMPLETED_SESSION: WorkbenchSession = {
  id: "lw_test123",
  opencodeSessionId: "ses_abc",
  brief: "Design a user analytics dashboard",
  currentStage: "final",
  currentNodeId: "final.review",
  draft: {
    shell: { mode: "three-column", widths: { left: 20, center: 50, right: 30 } },
    left: { primary: "tree", secondary: ["filters", "history"] },
    center: { primary: "cards-first", secondary: ["ascii-preview"] },
    right: { primary: "decision-log", secondary: ["recommendation"] },
  },
  answers: {
    "shell.mode": ["three-column"],
    "left.primary": ["tree"],
    "left.secondary": ["filters", "history"],
    "center.primary": ["cards-first"],
    "center.secondary": ["ascii-preview"],
    "right.primary": ["decision-log"],
    "right.secondary": ["recommendation"],
  },
  history: [
    { nodeId: "shell.mode", selectedOptionIds: ["three-column"], at: "2026-03-06T10:00:00Z" },
    { nodeId: "left.primary", selectedOptionIds: ["tree"], at: "2026-03-06T10:01:00Z" },
  ],
  createdAt: "2026-03-06T10:00:00Z",
  updatedAt: "2026-03-06T10:05:00Z",
  status: "completed",
}

describe("export", () => {
  it("should generate valid markdown", () => {
    const md = generateMarkdownPlan(COMPLETED_SESSION)
    expect(md).toContain("# Layout Plan:")
    expect(md).toContain("three-column")
    expect(md).toContain("tree")
    expect(md).toContain("cards-first")
    expect(md).toContain("decision-log")
    expect(md).toContain("lw_test123")
  })

  it("should include decision history table", () => {
    const md = generateMarkdownPlan(COMPLETED_SESSION)
    expect(md).toContain("| Shell Mode |")
    expect(md).toContain("단계별 결정 이력")
  })

  it("should show pending items when incomplete", () => {
    const partial = { ...COMPLETED_SESSION, answers: { "shell.mode": ["three-column"] } }
    const md = generateMarkdownPlan(partial)
    expect(md).toContain("미정 항목")
    expect(md).toContain("left.primary")
  })
})
```

**Step 3: Run tests**

```bash
bun test tests/export.test.ts
```

**Step 4: Commit**

```bash
git add -A
git commit -m "feat: add markdown plan exporter with decision history and pending items"
```

---

### Task 10: Resume & Export Commands

**Files:**
- Create: `.opencode/commands/layout-resume.md`
- Create: `.opencode/commands/layout-export.md`
- Modify: `.opencode/plugins/layout-workbench.ts` — 추가 tools

**Step 1: Create /layout-resume command**

```markdown
<!-- .opencode/commands/layout-resume.md -->
---
description: 중단된 레이아웃 워크벤치 세션 이어서 하기
agent: plan
---

중단된 레이아웃 의사결정 세션을 이어서 진행합니다.

세션 ID: $ARGUMENTS

`layout_resume_workbench` 툴을 호출해서 해당 세션을 다시 열어주세요.
세션이 없으면 사용 가능한 세션 목록을 보여주세요.
```

**Step 2: Create /layout-export command**

```markdown
<!-- .opencode/commands/layout-export.md -->
---
description: 완료된 레이아웃 워크벤치 세션을 마크다운 계획으로 내보내기
agent: plan
---

완료된 레이아웃 세션을 마크다운 계획 문서로 내보냅니다.

세션 ID: $ARGUMENTS

`layout_export_plan` 툴을 호출해서 해당 세션의 결과를 .opencode/plans/layout/에 내보내주세요.
```

**Step 3: Add resume and export tools to plugin entry**

`layout-workbench.ts`에 두 개의 추가 tool 등록:
- `layout_resume_workbench`: 기존 session을 로드해서 서버 다시 시작
- `layout_export_plan`: 완료된 session을 markdown으로 내보내기

**Step 4: Verify**

```bash
opencode
# /layout-export <session-id>
# → .opencode/plans/layout/ 에 markdown 파일 생성 확인
```

**Step 5: Commit**

```bash
git add -A
git commit -m "feat: add /layout-resume and /layout-export commands with corresponding tools"
```

---

## Phase 7: Recommendations (M6)

### Task 11: Rule-Based Scoring Engine

**Files:**
- Create: `.opencode/plugins/lw/score.ts`
- Create: `tests/score.test.ts`
- Modify: `.opencode/plugins/lw/server.ts` — `/api/recommend` 엔드포인트 추가

**Step 1: Write scoring rules**

ADW-001 스펙의 규칙을 구현:

```typescript
// .opencode/plugins/lw/score.ts
import type { WorkbenchDraft, QuestionOption } from "./types"

export interface ScoreResult {
  optionId: string
  score: number
  reasons: string[]
}

export interface ScoreDimension {
  name: string
  weight: number
  evaluate: (draft: WorkbenchDraft, optionId: string, tags: string[]) => number
}

const DIMENSIONS: ScoreDimension[] = [
  {
    name: "discoverability",
    weight: 1.0,
    evaluate: (draft, _, tags) => {
      let score = 0
      if (draft.shell.mode === "three-column") score += 2
      if (tags.includes("discoverability") || tags.includes("breadth")) score += 1
      return score
    },
  },
  {
    name: "traceability",
    weight: 1.2,
    evaluate: (draft, _, tags) => {
      let score = 0
      if (draft.right?.primary === "decision-log") score += 2
      if (tags.includes("traceability") || tags.includes("log")) score += 1
      if (tags.includes("history")) score += 1
      return score
    },
  },
  {
    name: "preview-immediacy",
    weight: 0.8,
    evaluate: (draft, _, tags) => {
      let score = 0
      if (draft.center?.secondary?.includes("ascii-preview")) score += 2
      if (draft.center?.primary === "split") score += 1
      if (tags.includes("preview") || tags.includes("visual")) score += 1
      return score
    },
  },
  {
    name: "complexity-penalty",
    weight: -0.5,
    evaluate: (draft) => {
      const totalSecondary =
        (draft.left?.secondary?.length ?? 0) +
        (draft.center?.secondary?.length ?? 0) +
        (draft.right?.secondary?.length ?? 0)
      return totalSecondary > 4 ? totalSecondary - 4 : 0
    },
  },
]

export function scoreOptions(
  draft: WorkbenchDraft,
  options: QuestionOption[],
): ScoreResult[] {
  return options.map((option) => {
    let totalScore = 0
    const reasons: string[] = []

    for (const dim of DIMENSIONS) {
      const raw = dim.evaluate(draft, option.id, option.tags ?? [])
      const weighted = raw * dim.weight
      if (weighted !== 0) {
        totalScore += weighted
        const sign = weighted > 0 ? "+" : ""
        reasons.push(`${dim.name}: ${sign}${weighted.toFixed(1)}`)
      }
    }

    return {
      optionId: option.id,
      score: Math.round(totalScore * 10) / 10,
      reasons,
    }
  }).sort((a, b) => b.score - a.score)
}
```

**Step 2: Write tests**

```typescript
// tests/score.test.ts
import { describe, expect, it } from "bun:test"
import { scoreOptions } from "../.opencode/plugins/lw/score"
import type { WorkbenchDraft, QuestionOption } from "../.opencode/plugins/lw/types"

describe("scoring", () => {
  it("should score options and return sorted results", () => {
    const draft: WorkbenchDraft = {
      shell: { mode: "three-column", widths: { left: 20, center: 50, right: 30 } },
      left: { secondary: [] },
      center: { secondary: [] },
      right: { secondary: [] },
    }

    const options: QuestionOption[] = [
      { id: "tree", label: "Tree", description: "", tags: ["navigation", "hierarchy"] },
      { id: "sections", label: "Sections", description: "", tags: ["flat", "scannable"] },
    ]

    const results = scoreOptions(draft, options)
    expect(results).toHaveLength(2)
    expect(results[0].score).toBeGreaterThanOrEqual(results[1].score)
    expect(results[0].reasons.length).toBeGreaterThan(0)
  })

  it("should penalize excessive secondary modules", () => {
    const draft: WorkbenchDraft = {
      shell: { mode: "three-column", widths: { left: 20, center: 50, right: 30 } },
      left: { primary: "tree", secondary: ["filters", "presets", "history"] },
      center: { primary: "split", secondary: ["ascii-preview", "diff-view"] },
      right: { secondary: [] },
    }

    const options: QuestionOption[] = [
      { id: "recommendation", label: "Reco", description: "", tags: ["recommendation"] },
    ]

    const results = scoreOptions(draft, options)
    // Should have negative complexity penalty in reasons
    const hasComplexity = results[0].reasons.some((r) => r.includes("complexity"))
    expect(hasComplexity).toBe(true)
  })
})
```

**Step 3: Wire `/api/recommend` endpoint into server**

`server.ts`에 추가:
```typescript
if (url.pathname === "/api/recommend" && req.method === "POST") {
  const node = getNode(currentSession.currentNodeId)
  if (!node) return Response.json({ scores: [] })
  const scores = scoreOptions(currentSession.draft, node.options)
  return Response.json({ scores }, { headers: corsHeaders })
}
```

**Step 4: Wire scoring into SPA UI**

옵션 카드 옆에 점수 배지 표시. API 호출: 각 노드 진입 시 `/api/recommend` 호출.

**Step 5: Run tests and verify**

```bash
bun test tests/score.test.ts
```

**Step 6: Commit**

```bash
git add -A
git commit -m "feat: add rule-based scoring engine with 4 dimensions and complexity penalty"
```

---

### Task 12: AI Commentary (Optional, Debounced)

**Files:**
- Create: `.opencode/plugins/lw/ai.ts`
- Modify: `.opencode/plugins/lw/server.ts` — `/api/ai-comment` 엔드포인트

**Step 1: Write AI commentary module**

OpenCode SDK의 `client.session.create()` + `client.session.message()`를 사용하여 별도 helper session에서 AI 코멘터리를 받아온다.

```typescript
// .opencode/plugins/lw/ai.ts
import type { WorkbenchSession } from "./types"
import { renderPreview } from "./ascii"
import { getNode } from "./graph"

export interface AiCommentary {
  why: string
  tradeoffs: string[]
  risks: string[]
  bestFor: string
}

export async function getAiCommentary(
  session: WorkbenchSession,
  client: any, // OpencodeClient
): Promise<AiCommentary | null> {
  try {
    const currentNode = getNode(session.currentNodeId)
    if (!currentNode) return null

    const preview = renderPreview(session.draft, { width: 80 })
    const selectedIds = session.answers[session.currentNodeId] ?? []

    // Create helper session (isolated from main session)
    const helperSession = await client.session.create({
      body: { title: `[LW] AI Commentary for ${currentNode.label}` },
    })

    const prompt = `You are a UX layout advisor. The user is designing a UI layout.

Current layout state:
\`\`\`
${preview}
\`\`\`

Current question: ${currentNode.question}
Selected options: ${selectedIds.join(", ") || "none yet"}
Available options: ${currentNode.options.map((o) => `${o.id}: ${o.description}`).join("; ")}

Respond in JSON only:
{
  "why": "1-2 sentence explanation of why the current selection is good/bad",
  "tradeoffs": ["tradeoff 1", "tradeoff 2"],
  "risks": ["risk 1"],
  "bestFor": "one sentence describing the ideal use case for this combination"
}`

    const response = await client.session.message({
      path: { id: helperSession.data.id },
      body: {
        parts: [{ type: "text", text: prompt }],
      },
    })

    // Parse JSON from response
    const text = response.data?.parts?.[0]?.text ?? ""
    const jsonMatch = text.match(/\{[\s\S]*\}/)
    if (!jsonMatch) return null

    return JSON.parse(jsonMatch[0]) as AiCommentary
  } catch (error) {
    return null // Non-fatal — AI commentary is optional
  }
}
```

**Step 2: Wire `/api/ai-comment` endpoint**

UI에서 "AI 설명 보기" 버튼 클릭 시 호출. Debounce 또는 명시적 버튼 클릭으로만 트리거.

**Step 3: Verify**

```bash
# OpenCode에서 /layout 실행 후 AI 코멘터리 버튼 클릭
# helper session이 생성되고 JSON 응답이 오른쪽 패널에 표시되는지 확인
```

**Step 4: Commit**

```bash
git add -A
git commit -m "feat: add AI commentary via helper session with JSON-only response"
```

---

## Phase 8: Packaging & Polish (M7)

### Task 13: npm Package Migration

**Files:**
- Create: `package.json` (project root)
- Create: `src/` (mirror of `.opencode/plugins/`)
- Create: `README.md`

**Step 1: Restructure for npm publishing**

```
opencode-layout-workbench/
  package.json            # npm package config
  tsconfig.json
  src/
    index.ts              # Plugin entry (re-export)
    lw/
      types.ts
      graph.ts
      reducer.ts
      store.ts
      ascii.ts
      score.ts
      ai.ts
      server.ts
      browser.ts
      format.ts
      export.ts
    ui/
      index.html
  tests/
    ...
  .opencode/
    commands/
      layout.md           # Still needed — command files can't be in npm package
    plugins/
      layout-workbench.ts # Dev entry → imports from src/
```

**Step 2: Configure package.json**

```json
{
  "name": "opencode-layout-workbench",
  "version": "0.1.0",
  "description": "OpenCode plugin for step-by-step UI layout decision workbench",
  "main": "src/index.ts",
  "type": "module",
  "scripts": {
    "test": "bun test",
    "typecheck": "tsc --noEmit",
    "build": "bun build src/index.ts --outdir dist --target bun"
  },
  "peerDependencies": {
    "@opencode-ai/plugin": ">=0.1.0"
  },
  "devDependencies": {
    "@opencode-ai/plugin": "latest",
    "bun-types": "latest",
    "typescript": "^5.0.0"
  },
  "keywords": ["opencode", "plugin", "layout", "ui", "decision"],
  "license": "MIT"
}
```

**Step 3: Write installation docs**

설치 문서에 반드시 포함:
1. `opencode.json`에 plugin 추가: `{ "plugin": ["opencode-layout-workbench"] }`
2. `.opencode/commands/layout.md` 파일을 수동으로 복사 (또는 설치 스크립트 제공)

**Step 4: Verify**

```bash
bun test
bun run typecheck
bun run build
```

**Step 5: Commit**

```bash
git add -A
git commit -m "feat: restructure for npm package publishing"
```

---

## Verification Checklist

### 기능 검증
- [ ] `/layout` 명령 → LLM이 `layout_open_workbench` tool 호출
- [ ] 브라우저가 자동으로 열림 (WSL 포함)
- [ ] 8단계 질문 순차 진행
- [ ] center-focus 선택 시 left/right 패널 스킵
- [ ] ASCII 프리뷰가 각 단계마다 업데이트
- [ ] GO_BACK으로 이전 단계 재방문 가능
- [ ] 완료 시 결과가 OpenCode 세션에 반환
- [ ] 세션 JSON이 `.opencode/layout-workbench/sessions/`에 저장
- [ ] `/layout-export`로 markdown 계획 생성
- [ ] `/layout-resume`로 중단된 세션 재개
- [ ] 규칙 기반 점수가 옵션 옆에 표시
- [ ] AI 코멘터리가 버튼 클릭 시 표시

### 보안 검증
- [ ] 서버가 127.0.0.1에만 바인딩
- [ ] 랜덤 포트 사용
- [ ] 세션별 one-time token 검증
- [ ] 30분 idle timeout 후 자동 종료
- [ ] OpenCode session ID가 브라우저에 최소 노출

### 안정성 검증
- [ ] abort signal 수신 시 서버 정상 종료
- [ ] 중복 `/layout` 실행 시 기존 URL 반환
- [ ] session.deleted 이벤트 시 서버 정리
- [ ] 모든 unit test 통과 (`bun test`)
- [ ] TypeScript type check 통과 (`tsc --noEmit`)

---

## 구현 순서 요약

```
Phase 1 → Task 1 (Scaffold) → Task 2 (Plugin Entry)
Phase 2 → Task 3 (Types+Graph) → Task 4 (Reducer+Store)
Phase 3 → Task 5 (ASCII Renderer)
Phase 4 → Task 6 (Server+Browser) → Task 7 (SPA UI)
Phase 5 → Task 8 (E2E Integration)
Phase 6 → Task 9 (Export) → Task 10 (Resume/Export Commands)
Phase 7 → Task 11 (Scoring) → Task 12 (AI Commentary)
Phase 8 → Task 13 (npm Packaging)
```

예상 소요: Task당 30-60분, 총 약 2-3일 (집중 작업 기준)

---

## Implementation Directives (Metis Review)

### MUST

- `.opencode/plugins/` 루트에는 `layout-workbench.ts` 단 하나만 배치. 다른 모든 `.ts` 파일은 `plugins/lw/` 하위에
- `context.abort` → `server.stop()` + Promise rejection을 모든 코드 경로에서 보장. `try/finally`로 감싸기
- `shell.mode`가 후속 노드 활성화를 결정 — `applies()` 함수를 graph.ts의 각 노드에 구현
- tool `execute()`가 session JSON과 markdown plan을 `Bun.write()`로 직접 저장. LLM에게 파일 쓰기 위임 금지
- singleton guard — OpenCode 세션당 하나의 active workbench. 이미 실행 중이면 기존 URL 반환
- 브라우저 열기 fallback 체인: `wslview` → `xdg-open` → `cmd.exe /c start` → `client.app.log()`로 URL 출력
- UI 에셋 경로는 `import.meta.dir` (Bun) 기준 해석. `process.cwd()` 금지
- `formatToolResult()` 반환값 2KB 이하. 전체 데이터는 저장된 파일에만
- `context.metadata({ title })` 로 blocking 중 TUI에 서버 URL과 세션 상태 표시
- ASCII renderer snapshot test — 각 shell mode의 `renderPreview()` 출력이 deterministic

### MUST NOT

- `.opencode/plugins/` 루트에 entry 파일 외 `.ts`/`.js` 파일 배치
- `xdg-open`이 WSL2에서 작동한다고 가정 — 항상 fallback 보유
- `waitForCompletion()`을 timeout 없이 hang. 최대 60분 + 45분 경고
- AI commentary helper session을 cleanup 전략과 세션당 예산(max 3회) 없이 생성
- `console.log()` 사용 — 반드시 `client.app.log()` 사용

### Reference Architecture

- `opencode-companion` 플러그인 패턴 참조: `plugins/modules/` 서브디렉토리 구조, `createRuntimeTools()` 팩토리
- `plannotator` 플러그인 패턴 참조: ephemeral `Bun.serve`, Promise-based decision loop, `resolveDecision()` 패턴

