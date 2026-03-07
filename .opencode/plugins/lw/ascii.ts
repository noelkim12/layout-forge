import { getApplicableQuestions } from "./graph"
import type {
  Answer,
  AnswerValue,
  AsciiPreview,
  AsciiPreviewSection,
  QuestionDefinition,
  WorkbenchSession,
} from "./types"

type SectionKey = "top" | "left" | "center" | "right" | "bottom"

interface SectionSpec {
  key: SectionKey
  number: number
  title: string
  keywords: string[]
}

const SECTION_SPECS: SectionSpec[] = [
  {
    key: "top",
    number: 1,
    title: "Top Navigation",
    keywords: ["top", "header", "toolbar", "global", "nav", "navigation", "상단", "헤더", "탑"],
  },
  {
    key: "left",
    number: 2,
    title: "Left Panel",
    keywords: ["left", "sidebar", "tree", "filters", "menu", "drawer", "사이드", "좌측", "왼", "탐색"],
  },
  {
    key: "center",
    number: 3,
    title: "Main Workspace",
    keywords: [
      "center",
      "main",
      "content",
      "canvas",
      "preview",
      "cards",
      "table",
      "editor",
      "메인",
      "중앙",
      "콘텐츠",
      "작업",
      "프리뷰",
    ],
  },
  {
    key: "right",
    number: 4,
    title: "Right Panel",
    keywords: ["right", "detail", "inspector", "notes", "comment", "log", "properties", "우측", "오른", "상세"],
  },
  {
    key: "bottom",
    number: 5,
    title: "Footer and Secondary",
    keywords: ["bottom", "footer", "actions", "status", "responsive", "mobile", "breakpoint", "하단", "푸터", "반응형"],
  },
]

const DEFAULT_SECTION_BY_INDEX: SectionKey[] = ["top", "left", "center", "right", "bottom"]

function truncate(value: string, max: number): string {
  if (value.length <= max) {
    return value
  }

  if (max <= 3) {
    return value.slice(0, max)
  }

  return `${value.slice(0, max - 3)}...`
}

function padCell(value: string, width: number): string {
  const trimmed = truncate(value, width)
  return trimmed.padEnd(width, " ")
}

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
    return value ? "On" : "Off"
  }

  return String(value)
}

function findSectionKey(question: QuestionDefinition, fallbackIndex: number): SectionKey {
  const source = `${question.id} ${question.label} ${question.description ?? ""}`.toLowerCase()

  for (const spec of SECTION_SPECS) {
    if (spec.keywords.some((keyword) => source.includes(keyword))) {
      return spec.key
    }
  }

  return DEFAULT_SECTION_BY_INDEX[fallbackIndex % DEFAULT_SECTION_BY_INDEX.length] ?? "center"
}

function formatDecision(question: QuestionDefinition, answer: Answer): string {
  const value = stringifyAnswerValue(question, answer.value)
  return `${question.label}: ${value}`
}

function toSectionMap(session: WorkbenchSession): Map<SectionKey, string[]> {
  const sectionMap = new Map<SectionKey, string[]>()
  const applicableQuestions = getApplicableQuestions(session.questions, session.answers)

  for (let index = 0; index < applicableQuestions.length; index += 1) {
    const question = applicableQuestions[index]
    const answer = session.answers[question.id]
    if (!answer) {
      continue
    }

    const sectionKey = findSectionKey(question, index)
    const current = sectionMap.get(sectionKey) ?? []
    current.push(formatDecision(question, answer))
    sectionMap.set(sectionKey, current)
  }

  return sectionMap
}

function summarizeSection(decisions: string[] | undefined): { summary: string; status: "decided" | "pending" } {
  if (!decisions || decisions.length === 0) {
    return { summary: "Pending decision", status: "pending" }
  }

  if (decisions.length === 1) {
    return { summary: decisions[0], status: "decided" }
  }

  return {
    summary: `${decisions[0]} (+${decisions.length - 1} more)`,
    status: "decided",
  }
}

export function buildAsciiPreview(session: WorkbenchSession): AsciiPreview {
  const bySection = toSectionMap(session)
  const legend: AsciiPreviewSection[] = SECTION_SPECS.map((spec) => {
    const decisions = bySection.get(spec.key)
    const { summary, status } = summarizeSection(decisions)

    return {
      number: spec.number,
      title: spec.title,
      summary,
      status,
    }
  })

  const top = legend[0]
  const left = legend[1]
  const center = legend[2]
  const right = legend[3]
  const bottom = legend[4]

  const totalWidth = 95
  const leftWidth = 24
  const centerWidth = 45
  const rightWidth = 24

  const row = (a: string, b: string, c: string) => {
    return `│${padCell(a, leftWidth)}│${padCell(b, centerWidth)}│${padCell(c, rightWidth)}│`
  }

  const lines = [
    `┌${"─".repeat(totalWidth)}┐`,
    `│ ${padCell("[1] Top Navigation", totalWidth - 1)}│`,
    `├${"─".repeat(leftWidth)}┬${"─".repeat(centerWidth)}┬${"─".repeat(rightWidth)}┤`,
    row(` [${left.number}] ${left.title}`, ` [${center.number}] ${center.title}`, ` [${right.number}] ${right.title}`),
    row("", "", ""),
    row("", "", ""),
    row("", "", ""),
    `├${"─".repeat(leftWidth)}┴${"─".repeat(centerWidth)}┴${"─".repeat(rightWidth)}┤`,
    `│ ${padCell("[5] Footer and Secondary", totalWidth - 1)}│`,
    `└${"─".repeat(totalWidth)}┘`,
  ]

  return {
    diagram: lines.join("\n"),
    legend,
    generatedAt: new Date().toISOString(),
  }
}
