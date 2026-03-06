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
  questions: QuestionDefinition[]
  currentIndex: number
  answers: Record<string, Answer>
  history: Answer[]
  createdAt: string
  updatedAt: string
  status: "active" | "completed" | "abandoned"
}
