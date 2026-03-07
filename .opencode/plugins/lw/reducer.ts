import type {
  Answer,
  AnswerValue,
  LayoutIntent,
  PreviewReview,
  PromptPacket,
  QuestionDefinition,
  RequirementItem,
  RequirementSnapshot,
  SessionMessage,
  VisualPreview,
  WorkbenchSession,
} from "./types"
import { getApplicableQuestions } from "./graph"

export type Action =
  | { type: "ANSWER"; questionId: string; value: AnswerValue }
  | { type: "GO_BACK"; toIndex: number }
  | { type: "ADD_QUESTION"; question: QuestionDefinition; afterIndex?: number }
  | { type: "SET_QUESTIONS"; questions: QuestionDefinition[] }
  | { type: "TOGGLE_SELECT_MODE"; questionId: string }
  | { type: "COMPLETE" }
  | { type: "ABANDON" }
  | { type: "REFINE"; questionId: string; userIntent: string }
  | { type: "SUBMIT_ROUND" }
  | { type: "PUSH_MESSAGE"; content: string }
  | { type: "COMMIT_REQUIREMENTS" }
  | { type: "SET_PHASE"; phase: "collecting" | "previewing" | "reviewing" | "approved" | "finished" }
  | { type: "SET_LAYOUT_INTENT"; intent: LayoutIntent }
  | { type: "SET_VISUAL_PREVIEW"; preview: VisualPreview }
  | { type: "PUSH_PREVIEW_REVIEW"; review: PreviewReview }
  | { type: "APPROVE_PREVIEW"; previewId: string }
  | { type: "SET_PROMPT_PROPOSAL"; packet: PromptPacket; renderedPrompt: string }
export function reduce(session: WorkbenchSession, action: Action): WorkbenchSession {
  const now = new Date().toISOString()

  switch (action.type) {
    case "ANSWER": {
      const questionExists = session.questions.some((q) => q.id === action.questionId)
      if (!questionExists) {
        throw new Error(`Unknown question: ${action.questionId}`)
      }

      const answer: Answer = {
        questionId: action.questionId,
        value: action.value,
        answeredAt: now,
      }

      const newAnswers = { ...session.answers, [action.questionId]: answer }
      const newHistory = [...session.history, answer]

      const applicable = getApplicableQuestions(session.questions, newAnswers)
      const currentApplicableIndex = applicable.findIndex((q) => q.id === action.questionId)
      const nextIndex = currentApplicableIndex + 1 < applicable.length
        ? currentApplicableIndex + 1
        : applicable.length

      return {
        ...session,
        answers: newAnswers,
        history: newHistory,
        currentIndex: nextIndex,
        updatedAt: now,
      }
    }

    case "GO_BACK": {
      if (action.toIndex < 0) {
        throw new Error(`Negative index: ${action.toIndex}`)
      }

      return {
        ...session,
        currentIndex: action.toIndex,
        updatedAt: now,
      }
    }

    case "ADD_QUESTION": {
      const question = { ...action.question, userAdded: true }
      const newQuestions = [...session.questions]

      if (action.afterIndex !== undefined) {
        newQuestions.splice(action.afterIndex + 1, 0, question)
      } else {
        newQuestions.push(question)
      }

      return {
        ...session,
        questions: newQuestions,
        updatedAt: now,
      }
    }

    case "TOGGLE_SELECT_MODE": {
      const toggleQuestion = session.questions.find((q) => q.id === action.questionId)
      if (!toggleQuestion) {
        throw new Error(`Unknown question: ${action.questionId}`)
      }

      if (toggleQuestion.type !== "single-select" && toggleQuestion.type !== "multi-select") {
        throw new Error(`Cannot toggle type for: ${toggleQuestion.type}`)
      }

      const newType = toggleQuestion.type === "single-select" ? "multi-select" : "single-select"
      const newQuestions = session.questions.map((q) => {
        if (q.id !== action.questionId) return q
        return { ...q, type: newType } as QuestionDefinition
      })

      // Convert existing answer if present
      const existingAnswer = session.answers[action.questionId]
      let newAnswers = session.answers
      if (existingAnswer) {
        let convertedValue: AnswerValue
        if (newType === "multi-select") {
          // single → multi: wrap string in array
          convertedValue = typeof existingAnswer.value === "string" ? [existingAnswer.value] : existingAnswer.value
        } else {
          // multi → single: take first element
          convertedValue = Array.isArray(existingAnswer.value) && existingAnswer.value.length > 0
            ? existingAnswer.value[0]
            : ""
        }
        newAnswers = {
          ...session.answers,
          [action.questionId]: { ...existingAnswer, value: convertedValue, answeredAt: now },
        }
      }

      return {
        ...session,
        questions: newQuestions,
        answers: newAnswers,
        updatedAt: now,
      }
    }

    case "SET_QUESTIONS": {
      return {
        ...session,
        status: "active",
        questions: action.questions,
        currentIndex: 0,
        answers: {},
        history: [],
        phase: "collecting",
        updatedAt: now,
      }
    }

    case "REFINE": {
      const refineQuestion = session.questions.find((q) => q.id === action.questionId)
      if (!refineQuestion) {
        throw new Error(`Unknown question: ${action.questionId}`)
      }

      return {
        ...session,
        status: "refinement_requested",
        refinementRequest: {
          questionId: action.questionId,
          questionLabel: refineQuestion.label,
          userIntent: action.userIntent,
          currentOptions: refineQuestion.options,
          requestedAt: now,
        },
        updatedAt: now,
      }
    }

    case "COMPLETE":
      return { ...session, status: "completed", updatedAt: now }

    case "ABANDON":
      return { ...session, status: "abandoned", updatedAt: now }

    case "SUBMIT_ROUND":
      return { ...session, status: "processing", updatedAt: now }

    case "PUSH_MESSAGE": {
      const message: SessionMessage = {
        id: `msg_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
        content: action.content,
        pushedAt: now,
      }
      return {
        ...session,
        messages: [...session.messages, message],
        updatedAt: now,
      }
    }
    case "COMMIT_REQUIREMENTS": {
      const snapshot = commitRequirements(session)
      const newLedger = [...(session.requirementLedger ?? []), ...snapshot.items]
      const newSnapshots = [...(session.requirementSnapshots ?? []), snapshot]
      return {
        ...session,
        requirementLedger: newLedger,
        requirementSnapshots: newSnapshots,
        updatedAt: now,
      }
    }

    case "SET_PHASE": {
      const from = session.phase
      const to = action.phase
      const validTransitions: Array<[string | undefined, string]> = [
        [undefined, "previewing"],
        ["collecting", "previewing"],
        ["previewing", "reviewing"],
        ["reviewing", "collecting"],
        ["reviewing", "approved"],
        ["reviewing", "finished"],
        ["approved", "finished"],
      ]
      const isValid = validTransitions.some(([f, t]) => f === from && t === to)
      if (!isValid) {
        throw new Error(`Invalid phase transition: ${from} → ${to}`)
      }
      return {
        ...session,
        phase: to,
        updatedAt: now,
      }
    }


    case "SET_LAYOUT_INTENT": {
      return { ...session, layoutIntent: action.intent, updatedAt: now }
    }

    case "SET_VISUAL_PREVIEW": {
      const newHistory = session.visualPreview
        ? [...(session.previewHistory ?? []), session.visualPreview]
        : (session.previewHistory ?? [])
      return { ...session, visualPreview: action.preview, previewHistory: newHistory, updatedAt: now }
    }

    case "PUSH_PREVIEW_REVIEW": {
      return { ...session, previewReviews: [...(session.previewReviews ?? []), action.review], updatedAt: now }
    }

    case "APPROVE_PREVIEW": {
      if (session.visualPreview?.id !== action.previewId) {
        throw new Error(`Preview ID mismatch: expected ${session.visualPreview?.id}, got ${action.previewId}`)
      }
      return { ...session, approvedPreviewId: action.previewId, phase: "approved", updatedAt: now }
    }

    case "SET_PROMPT_PROPOSAL": {
      return { ...session, promptPacket: action.packet, renderedPrompt: action.renderedPrompt, updatedAt: now }
    }

  }
}

export function commitRequirements(session: WorkbenchSession): RequirementSnapshot {
  const applicable = getApplicableQuestions(session.questions, session.answers)
  const items: RequirementItem[] = applicable
    .filter(q => session.answers[q.id] !== undefined)
    .map(q => ({
      key: q.id,
      label: q.label,
      value: session.answers[q.id]!.value,
      sourceQuestionId: q.id,
      capturedAt: session.answers[q.id]!.answeredAt,
    }))
  return {
    id: `snap_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
    items,
    createdAt: new Date().toISOString(),
  }
}
