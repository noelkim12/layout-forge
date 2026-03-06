# Amendment 1: Dynamic Question Graph

> **Date**: 2026-03-06
> **Feedback**: 고정 8개 노드 그래프가 너무 rigid함. LLM 응답 기반으로 유연하게 구성되어야 하고, 사용자가 중간에 질문을 추가할 수 있어야 함.

## Design Decisions

1. **LLM이 tool args로 전체 질문 스키마 전달** (Option A)
2. **사용자가 Browser UI에서 직접 질문 추가** (blocking tool이므로 LLM 개입 불가)

## 아키텍처 변경 요약

| 항목 | Before (고정 그래프) | After (동적 그래프) |
|------|---------------------|---------------------|
| Question 정의 | 8개 하드코딩된 `QuestionNode` | LLM이 tool args로 `QuestionDefinition[]` 전달 |
| 그래프 구조 | 복잡한 DAG + `applies()` 함수 | 플랫 리스트 + `dependsOn` 조건부 표시 |
| 타입 시스템 | layout 전용 (`WorkbenchDraft`, `StageId`) | 제네릭 질문 타입 (single-select, multi-select, text, slider, toggle) |
| 질문 수 | 8개 고정 | LLM이 결정 + 사용자가 UI에서 중간 추가 가능 |
| Tool args | `{ brief: string }` | `{ brief: string, questions: QuestionDefinition[] }` |
| Session 상태 | `draft: WorkbenchDraft` (layout 전용) | `answers: Record<string, Answer>` (제네릭) |
| Reducer | layout 필드별 하드코딩 switch | 제네릭 answer 저장 + ADD_QUESTION 액션 |
| ASCII Preview | 필수 (layout 고정 구조) | optional stretch goal (layout 프리셋 사용 시만) |
| Score Engine | layout 전용 dimensions | tag 기반 제네릭 (optional) |

## 핵심 타입 (Revised)

```typescript
export type QuestionType = "single-select" | "multi-select" | "text" | "slider" | "toggle"

export interface QuestionOption {
  id: string
  label: string
  description?: string
  tags?: string[]
}

export interface DependsOn {
  questionId: string
  operator: "eq" | "neq" | "includes" | "excludes"
  value: string | string[]
}

export interface QuestionDefinition {
  id: string
  type: QuestionType
  label: string
  description?: string
  options?: QuestionOption[]     // for select types
  min?: number                   // for slider
  max?: number                   // for slider
  step?: number                  // for slider
  defaultValue?: string | number | boolean
  dependsOn?: DependsOn          // conditional visibility
  required?: boolean             // default true
  userAdded?: boolean            // true if added by user mid-session
}

export type AnswerValue = string | string[] | number | boolean

export interface Answer {
  questionId: string
  value: AnswerValue
  answeredAt: string
}

export interface WorkbenchSession {
  id: string
  opencodeSessionId: string
  brief: string
  questions: QuestionDefinition[]   // embedded, not global reference
  currentIndex: number              // index in questions array
  answers: Record<string, Answer>
  history: Answer[]                 // ordered answer trail
  createdAt: string
  updatedAt: string
  status: "active" | "completed" | "abandoned"
}
```

## 변경되는 서버 엔드포인트

| Endpoint | Before | After |
|----------|--------|-------|
| GET /api/session | hardcoded graph 참조 | session 내 embedded questions 반환 |
| POST /api/answer | graph.getNextNode() | currentIndex 기반 다음 applicable question |
| POST /api/add-question | (없음) | 사용자가 UI에서 질문 추가 |
| POST /api/back | GO_BACK to nodeId | GO_BACK to index |

## 변경되는 Tool Args (Zod)

```typescript
args: {
  brief: z.string().describe("What the user wants to design"),
  questions: z.array(z.object({
    id: z.string(),
    type: z.enum(["single-select", "multi-select", "text", "slider", "toggle"]),
    label: z.string(),
    description: z.string().optional(),
    options: z.array(z.object({
      id: z.string(),
      label: z.string(),
      description: z.string().optional(),
      tags: z.array(z.string()).optional(),
    })).optional(),
    min: z.number().optional(),
    max: z.number().optional(),
    step: z.number().optional(),
    defaultValue: z.union([z.string(), z.number(), z.boolean()]).optional(),
    dependsOn: z.object({
      questionId: z.string(),
      operator: z.enum(["eq", "neq", "includes", "excludes"]),
      value: z.union([z.string(), z.array(z.string())]),
    }).optional(),
    required: z.boolean().optional(),
  })).describe("Questions for the user to answer, in order"),
}
```

## 영향 받지 않는 부분

- Plugin 전체 구조 (entry + lw/ subdirectory)
- Browser opener (cross-platform)
- Server lifecycle (ephemeral Bun.serve, token auth, idle timeout)
- Command definitions (.opencode/commands/)
- Singleton guard, abort signal handling
- Session file I/O (save/load JSON)
