import { writeFile } from "fs/promises"
import { getApplicableQuestions } from "./graph"
import type { AnswerValue, QuestionDefinition, WorkbenchSession } from "./types"
import { buildAsciiPreview } from "./ascii"

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

export function generateMarkdownPlan(session: WorkbenchSession): string {
  const preview = buildAsciiPreview(session)
  const applicableQuestions = getApplicableQuestions(session.questions, session.answers)
  const answeredQuestions = applicableQuestions.filter((question) => session.answers[question.id] !== undefined)
  const unansweredQuestions = applicableQuestions.filter((question) => session.answers[question.id] === undefined)

  const lines: string[] = [
    `# Layout Plan: ${session.brief}`,
    "",
    "## Decisions",
    "",
    "| Question | Answer | Time |",
    "|----------|--------|------|",
  ]

  if (answeredQuestions.length === 0) {
    lines.push("| (none) | - | - |")
  } else {
    for (const question of answeredQuestions) {
      const answer = session.answers[question.id]
      const value = stringifyAnswerValue(question, answer.value)
      lines.push(`| ${question.label} | ${value} | ${answer.answeredAt} |`)
    }
  }

  if (unansweredQuestions.length > 0) {
    lines.push("", "## Pending Questions", "")
    for (const question of unansweredQuestions) {
      lines.push(`- ${question.label}`)
    }
  }

  lines.push(
    "",
    "## Numbered ASCII Layout",
    "",
    "```text",
    preview.diagram,
    "```",
    "",
    "## Numbered Legend",
    "",
  )

  for (const item of preview.legend) {
    lines.push(`- [${item.number}] ${item.title}: ${item.summary} (${item.status})`)
  }

  lines.push(
    "",
    "## Session Metadata",
    "",
    `- Session ID: ${session.id}`,
    `- OpenCode Session: ${session.opencodeSessionId}`,
    `- Status: ${session.status}`,
    `- Created: ${session.createdAt}`,
    `- Updated: ${session.updatedAt}`,
  )

  return lines.join("\n")
}

export async function exportMarkdownPlan(session: WorkbenchSession, baseDir: string): Promise<string> {
  const markdown = generateMarkdownPlan(session)

  const now = new Date()
  const year = now.getFullYear()
  const month = String(now.getMonth() + 1).padStart(2, "0")
  const day = String(now.getDate()).padStart(2, "0")
  const hours = String(now.getHours()).padStart(2, "0")
  const minutes = String(now.getMinutes()).padStart(2, "0")
  const seconds = String(now.getSeconds()).padStart(2, "0")

  const timestamp = `${year}${month}${day}-${hours}${minutes}${seconds}`
  const filePath = `${baseDir}/.opencode/plans/layout/${timestamp}-layout-plan.md`

  await writeFile(filePath, markdown, "utf8")

  return filePath
}
