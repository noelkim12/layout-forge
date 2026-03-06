import type {
  Answer,
  AnswerValue,
  QuestionDefinition,
  WorkbenchSession,
} from "./types"
import { getApplicableQuestions } from "./graph"

export type Action =
  | { type: "ANSWER"; questionId: string; value: AnswerValue }
  | { type: "GO_BACK"; toIndex: number }
  | { type: "ADD_QUESTION"; question: QuestionDefinition; afterIndex?: number }
  | { type: "COMPLETE" }
  | { type: "ABANDON" }

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
        : session.currentIndex

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

    case "COMPLETE":
      return { ...session, status: "completed", updatedAt: now }

    case "ABANDON":
      return { ...session, status: "abandoned", updatedAt: now }
  }
}
