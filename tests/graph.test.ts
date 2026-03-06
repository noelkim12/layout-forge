import { describe, expect, test } from "bun:test"
import {
  evaluateDependsOn,
  getApplicableQuestions,
  getCurrentQuestion,
  getNextQuestion,
  getProgress,
} from "../.opencode/plugins/lw/graph"
import type { Answer, QuestionDefinition } from "../.opencode/plugins/lw/types"

const SAMPLE_QUESTIONS: QuestionDefinition[] = [
  {
    id: "layout-mode",
    type: "single-select",
    label: "Layout Mode",
    options: [
      { id: "three-column", label: "Three Column" },
      { id: "center-focus", label: "Center Focus" },
    ],
  },
  {
    id: "left-panel",
    type: "single-select",
    label: "Left Panel",
    options: [
      { id: "tree", label: "Tree Nav" },
      { id: "tabs", label: "Tab Groups" },
    ],
    dependsOn: { questionId: "layout-mode", operator: "neq", value: "center-focus" },
  },
  {
    id: "center-content",
    type: "multi-select",
    label: "Center Content",
    options: [
      { id: "cards", label: "Cards" },
      { id: "preview", label: "Preview" },
    ],
  },
  {
    id: "right-panel",
    type: "single-select",
    label: "Right Panel",
    options: [
      { id: "log", label: "Decision Log" },
      { id: "inspector", label: "Inspector" },
    ],
    dependsOn: { questionId: "layout-mode", operator: "neq", value: "center-focus" },
  },
  {
    id: "detail-level",
    type: "slider",
    label: "Detail Level",
    min: 1,
    max: 5,
    step: 1,
    dependsOn: { questionId: "center-content", operator: "includes", value: "preview" },
  },
]

function createAnswer(questionId: string, value: Answer["value"]): Answer {
  return {
    questionId,
    value,
    answeredAt: "2026-03-06T00:00:00.000Z",
  }
}

describe("graph utilities", () => {
  test("basic question filtering with no dependencies returns all questions", () => {
    const questions = SAMPLE_QUESTIONS.filter((question) => question.dependsOn === undefined)

    const applicable = getApplicableQuestions(questions, {})

    expect(applicable).toHaveLength(2)
    expect(applicable.map((question) => question.id)).toEqual(["layout-mode", "center-content"])
  })

  test("single eq dependency hides question when value does not match", () => {
    const dep = { questionId: "layout-mode", operator: "eq", value: "center-focus" } as const
    const answers = {
      "layout-mode": createAnswer("layout-mode", "three-column"),
    }

    expect(evaluateDependsOn(dep, answers)).toBe(false)
  })

  test("single neq dependency respects inequality", () => {
    const dep = { questionId: "layout-mode", operator: "neq", value: "center-focus" } as const
    const answers = {
      "layout-mode": createAnswer("layout-mode", "three-column"),
    }

    expect(evaluateDependsOn(dep, answers)).toBe(true)
  })

  test("includes dependency works with string array answer", () => {
    const dep = { questionId: "center-content", operator: "includes", value: "preview" } as const
    const answers = {
      "center-content": createAnswer("center-content", ["cards", "preview"]),
    }

    expect(evaluateDependsOn(dep, answers)).toBe(true)
  })

  test("excludes dependency is opposite of includes", () => {
    const dep = { questionId: "center-content", operator: "excludes", value: "preview" } as const
    const answers = {
      "center-content": createAnswer("center-content", ["cards", "preview"]),
    }

    expect(evaluateDependsOn(dep, answers)).toBe(false)
  })

  test("unanswered dependency keeps question hidden", () => {
    const dep = { questionId: "layout-mode", operator: "neq", value: "center-focus" } as const

    expect(evaluateDependsOn(dep, {})).toBe(false)
  })

  test("getNextQuestion skips non-applicable questions", () => {
    const answers = {
      "layout-mode": createAnswer("layout-mode", "center-focus"),
    }

    const nextQuestion = getNextQuestion(SAMPLE_QUESTIONS, answers, "layout-mode")

    expect(nextQuestion?.id).toBe("center-content")
  })

  test("getNextQuestion returns null at end of applicable list", () => {
    const answers = {
      "layout-mode": createAnswer("layout-mode", "center-focus"),
      "center-content": createAnswer("center-content", ["cards"]),
    }

    const nextQuestion = getNextQuestion(SAMPLE_QUESTIONS, answers, "center-content")

    expect(nextQuestion).toBeNull()
  })

  test("getCurrentQuestion handles bounds against applicable list", () => {
    const answers = {
      "layout-mode": createAnswer("layout-mode", "center-focus"),
    }

    expect(getCurrentQuestion(SAMPLE_QUESTIONS, answers, 0)?.id).toBe("layout-mode")
    expect(getCurrentQuestion(SAMPLE_QUESTIONS, answers, 1)?.id).toBe("center-content")
    expect(getCurrentQuestion(SAMPLE_QUESTIONS, answers, 2)).toBeNull()
  })

  test("getProgress counts answered over applicable questions", () => {
    const answers = {
      "layout-mode": createAnswer("layout-mode", "center-focus"),
      "center-content": createAnswer("center-content", ["cards", "preview"]),
      "detail-level": createAnswer("detail-level", 3),
      "left-panel": createAnswer("left-panel", "tree"),
    }

    expect(getProgress(SAMPLE_QUESTIONS, answers)).toEqual({
      answered: 3,
      total: 3,
      percentage: 100,
    })
  })

  test("empty questions array edge case", () => {
    expect(getApplicableQuestions([], {})).toEqual([])
    expect(getCurrentQuestion([], {}, 0)).toBeNull()
    expect(getNextQuestion([], {}, "any")).toBeNull()
    expect(getProgress([], {})).toEqual({ answered: 0, total: 0, percentage: 0 })
  })
})
