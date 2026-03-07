import type {
  Answer,
  AnswerValue,
  QuestionDefinition,
  SessionMessage,
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
  }
}
