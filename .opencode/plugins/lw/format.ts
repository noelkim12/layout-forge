import { getApplicableQuestions } from "./graph"
import type { AnswerValue, QuestionDefinition, WorkbenchSession } from "./types"

const MAX_TOOL_RESULT_LENGTH = 2048

function stringifyAnswerValue(question: QuestionDefinition, value: AnswerValue): string {
  if (Array.isArray(value)) {
    if (!question.options || question.options.length === 0) {
      return value.join(", ")
    }

    return value
      .map((selectedId) => question.options?.find((option) => option.id === selectedId)?.label ?? selectedId)
      .join(", ")
  }

  if (typeof value === "string" && question.options && question.options.length > 0) {
    return question.options.find((option) => option.id === value)?.label ?? value
  }

  if (typeof value === "boolean") {
    return value ? "Yes" : "No"
  }

  return String(value)
}

function clampLength(input: string): string {
  if (input.length <= MAX_TOOL_RESULT_LENGTH) {
    return input
  }

  return `${input.slice(0, MAX_TOOL_RESULT_LENGTH - 3)}...`
}

export function formatToolResult(session: WorkbenchSession): string {
  if (session.status === "abandoned") {
    return "사용자가 워크벤치를 중단했습니다."
  }

  const applicableQuestions = getApplicableQuestions(session.questions, session.answers)
  const answeredLines = applicableQuestions
    .filter((question) => session.answers[question.id] !== undefined)
    .map((question) => {
      const answer = session.answers[question.id]
      const value = stringifyAnswerValue(question, answer.value)
      return `- ${question.label}: ${value}`
    })

  const unansweredLines = applicableQuestions
    .filter((question) => session.answers[question.id] === undefined)
    .map((question) => `- ${question.label}`)

  const lines = [
    `## Brief`,
    session.brief,
    "",
    "## Answers",
    ...(answeredLines.length > 0 ? answeredLines : ["- (none)"]),
  ]

  if (unansweredLines.length > 0) {
    lines.push("", "## Unanswered Questions", ...unansweredLines)
  }

  lines.push("", `Session ID: ${session.id}`)

  return clampLength(lines.join("\n"))
}
