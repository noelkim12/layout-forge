export type QuestionType =
  | "single-select"
  | "multi-select"
  | "text"
  | "slider"
  | "toggle"

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

/**
 * LLM constructs these at tool-call time; users can add more mid-session via UI.
 */
export interface QuestionDefinition {
  id: string
  type: QuestionType
  label: string
  description?: string

  options?: QuestionOption[]

  min?: number
  max?: number
  step?: number

  defaultValue?: string | number | boolean
  dependsOn?: DependsOn

  required?: boolean
  userAdded?: boolean
  allowCustom?: boolean
}

export type AnswerValue = string | string[] | number | boolean

export interface Answer {
  questionId: string
  value: AnswerValue
  answeredAt: string
}

export interface RefinementRequest {
  questionId: string
  questionLabel: string
  userIntent: string
  currentOptions?: QuestionOption[]
  requestedAt: string
}

export interface SessionMessage {
  id: string
  content: string
  pushedAt: string
}

export interface AsciiPreviewSection {
  number: number
  title: string
  summary: string
  status: "decided" | "pending"
}

export interface AsciiPreview {
  diagram: string
  legend: AsciiPreviewSection[]
  generatedAt: string
}

export interface RequirementItem {
  key: string
  label: string
  value: string | string[] | number | boolean
  sourceQuestionId: string
  capturedAt: string
  contextSource?: string
  provenanceNote?: string
}

export type ContextSourceType = "file" | "user-answer" | "session-brief" | "external-doc"

export interface ContextSourceRef {
  id: string
  type: ContextSourceType
  path?: string
  description: string
  addedAt: string
}

export interface RequirementSnapshot {
  id: string
  items: RequirementItem[]
  createdAt: string
}

export interface VisualPreviewNode {
  id: string
  label: string
  role: "nav" | "sidebar" | "main" | "inspector" | "bottom" | "toolbar"
  x: number
  y: number
  w: number
  h: number
  summary?: string
}

export interface VisualPreview {
  id: string
  title: string
  cols: number
  rows: number
  nodes: VisualPreviewNode[]
  outline: Array<{ id: string; title: string; summary: string }>
  raw?: {
    ascii?: string
    notes?: string[]
  }
  generatedAt: string
}

export interface PreviewReview {
  id: string
  previewId: string
  targetNodeId?: string
  type: "approve" | "revise-node" | "ask-followup" | "finish"
  message: string
  createdAt: string
}

export interface LayoutIntent {
  structure?: string
  navigation?: string
  mainContent?: string[]
  detailPlacement?: string
  bottomArea?: string
  density?: number
  constraints: {
    fixed: string[]
    flexible: string[]
    avoid: string[]
  }
}

export interface PromptPacket {
  summary: string
  approvedPreviewSummary: string
  constraints: string[]
  avoid: string[]
  outputFormat: string
}

export interface WorkbenchSession {
  id: string
  opencodeSessionId: string
  brief: string
  questions: QuestionDefinition[]
  currentIndex: number
  answers: Record<string, Answer>
  history: Answer[]
  createdAt: string
  updatedAt: string
  status: "active" | "processing" | "completed" | "abandoned" | "refinement_requested"
  refinementRequest?: RefinementRequest
  phase?: "collecting" | "previewing" | "reviewing" | "approved" | "prompt-ready" | "finished"
  requirementLedger?: RequirementItem[]
  requirementSnapshots?: RequirementSnapshot[]
  contextSources?: ContextSourceRef[]
  layoutIntent?: LayoutIntent
  visualPreview?: VisualPreview
  previewHistory?: VisualPreview[]
  previewReviews?: PreviewReview[]
  approvedPreviewId?: string
  promptSuggestionRequestedAt?: string
  promptPacket?: PromptPacket
  renderedPrompt?: string
  messages: SessionMessage[]
}
