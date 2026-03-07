import { describe, expect, test } from "bun:test"
import { reduce } from "../.opencode/plugins/lw/reducer"
import type { QuestionDefinition, WorkbenchSession } from "../.opencode/plugins/lw/types"

function createTestSession(questions?: QuestionDefinition[]): WorkbenchSession {
  return {
    id: "test-session",
    opencodeSessionId: "ses_123",
    brief: "Test brief",
    questions:
      questions ??
      [
        {
          id: "q1",
          type: "single-select",
          label: "Q1",
          options: [
            { id: "a", label: "A" },
            { id: "b", label: "B" },
          ],
        },
        { id: "q2", type: "text", label: "Q2" },
        {
          id: "q3",
          type: "single-select",
          label: "Q3",
          options: [{ id: "x", label: "X" }],
          dependsOn: { questionId: "q1", operator: "eq", value: "a" },
        },
        { id: "q4", type: "toggle", label: "Q4" },
      ],
    currentIndex: 0,
    answers: {},
    history: [],
    messages: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    status: "active",
  }
}

describe("reduce", () => {
  test("ANSWER advances currentIndex", () => {
    const session = createTestSession()

    const next = reduce(session, { type: "ANSWER", questionId: "q1", value: "a" })

    expect(next.currentIndex).toBe(1)
  })

  test("ANSWER stores answer and appends to history", () => {
    const session = createTestSession()

    const next = reduce(session, { type: "ANSWER", questionId: "q2", value: "hello" })

    expect(next.answers.q2.questionId).toBe("q2")
    expect(next.answers.q2.value).toBe("hello")
    expect(next.answers.q2.answeredAt).toEqual(expect.any(String))
    expect(next.history).toHaveLength(1)
    expect(next.history[0]?.questionId).toBe("q2")
    expect(next.history[0]?.value).toBe("hello")
    expect(next.updatedAt).toEqual(expect.any(String))
  })

  test("ANSWER with dependency skipping skips q3 when q1 is b", () => {
    const session = createTestSession()

    const next = reduce(session, { type: "ANSWER", questionId: "q1", value: "b" })

    expect(next.currentIndex).toBe(1)
  })

  test("GO_BACK changes index and preserves answers/history", () => {
    const session = createTestSession()
    const answered = reduce(session, { type: "ANSWER", questionId: "q1", value: "a" })

    const next = reduce(answered, { type: "GO_BACK", toIndex: 0 })

    expect(next.currentIndex).toBe(0)
    expect(next.answers.q1?.value).toBe("a")
    expect(next.history).toHaveLength(1)
    expect(next.updatedAt).toEqual(expect.any(String))
  })

  test("GO_BACK with negative index throws", () => {
    const session = createTestSession()

    expect(() => reduce(session, { type: "GO_BACK", toIndex: -1 })).toThrow(
      /negative index/i,
    )
  })

  test("ADD_QUESTION appends to questions array", () => {
    const session = createTestSession()
    const newQuestion: QuestionDefinition = { id: "q5", type: "text", label: "Q5" }

    const next = reduce(session, { type: "ADD_QUESTION", question: newQuestion })

    expect(next.questions).toHaveLength(5)
    expect(next.questions[4]?.id).toBe("q5")
  })

  test("ADD_QUESTION inserts after specific index", () => {
    const session = createTestSession()
    const newQuestion: QuestionDefinition = { id: "q-insert", type: "text", label: "Inserted" }

    const next = reduce(session, {
      type: "ADD_QUESTION",
      question: newQuestion,
      afterIndex: 1,
    })

    expect(next.questions[2]?.id).toBe("q-insert")
    expect(next.questions).toHaveLength(5)
  })

  test("ADD_QUESTION marks userAdded true", () => {
    const session = createTestSession()
    const newQuestion: QuestionDefinition = { id: "q-user", type: "toggle", label: "User Added" }

    const next = reduce(session, { type: "ADD_QUESTION", question: newQuestion })

    expect(next.questions[4]?.userAdded).toBe(true)
  })

  test("COMPLETE sets status", () => {
    const session = createTestSession()

    const next = reduce(session, { type: "COMPLETE" })

    expect(next.status).toBe("completed")
    expect(next.updatedAt).toEqual(expect.any(String))
  })

  test("ABANDON sets status", () => {
    const session = createTestSession()

    const next = reduce(session, { type: "ABANDON" })

    expect(next.status).toBe("abandoned")
    expect(next.updatedAt).toEqual(expect.any(String))
  })

  test("ANSWER with unknown questionId throws", () => {
    const session = createTestSession()

    expect(() => reduce(session, { type: "ANSWER", questionId: "missing", value: "x" })).toThrow(
      /unknown question/i,
    )
  })

  test("multiple sequential ANSWER actions accumulate state", () => {
    const session = createTestSession()
    const s1 = reduce(session, { type: "ANSWER", questionId: "q1", value: "a" })
    const s2 = reduce(s1, { type: "ANSWER", questionId: "q2", value: "text" })
    const s3 = reduce(s2, { type: "ANSWER", questionId: "q3", value: "x" })

    expect(Object.keys(s3.answers)).toHaveLength(3)
    expect(s3.history).toHaveLength(3)
    expect(s3.currentIndex).toBe(3)
  })

  test("TOGGLE_SELECT_MODE switches single-select to multi-select", () => {
    const session = createTestSession()

    const next = reduce(session, { type: "TOGGLE_SELECT_MODE", questionId: "q1" })

    expect(next.questions[0]?.type).toBe("multi-select")
  })

  test("TOGGLE_SELECT_MODE switches multi-select to single-select", () => {
    const questions: QuestionDefinition[] = [
      {
        id: "q1",
        type: "multi-select",
        label: "Q1",
        options: [
          { id: "a", label: "A" },
          { id: "b", label: "B" },
        ],
      },
    ]
    const session = createTestSession(questions)

    const next = reduce(session, { type: "TOGGLE_SELECT_MODE", questionId: "q1" })

    expect(next.questions[0]?.type).toBe("single-select")
  })

  test("TOGGLE_SELECT_MODE converts existing single answer to array", () => {
    const session = createTestSession()
    const answered = reduce(session, { type: "ANSWER", questionId: "q1", value: "a" })

    const toggled = reduce(answered, { type: "TOGGLE_SELECT_MODE", questionId: "q1" })

    expect(toggled.questions[0]?.type).toBe("multi-select")
    expect(toggled.answers.q1?.value).toEqual(["a"])
  })

  test("TOGGLE_SELECT_MODE converts existing multi answer to single", () => {
    const questions: QuestionDefinition[] = [
      {
        id: "q1",
        type: "multi-select",
        label: "Q1",
        options: [
          { id: "a", label: "A" },
          { id: "b", label: "B" },
        ],
      },
    ]
    const session = createTestSession(questions)
    const answered = reduce(session, { type: "ANSWER", questionId: "q1", value: ["a", "b"] })

    const toggled = reduce(answered, { type: "TOGGLE_SELECT_MODE", questionId: "q1" })

    expect(toggled.questions[0]?.type).toBe("single-select")
    expect(toggled.answers.q1?.value).toBe("a")
  })

  test("TOGGLE_SELECT_MODE throws for non-select question types", () => {
    const session = createTestSession()

    expect(() => reduce(session, { type: "TOGGLE_SELECT_MODE", questionId: "q2" })).toThrow(
      /cannot toggle/i,
    )
  })

  test("TOGGLE_SELECT_MODE throws for unknown questionId", () => {
    const session = createTestSession()

    expect(() => reduce(session, { type: "TOGGLE_SELECT_MODE", questionId: "missing" })).toThrow(
      /unknown question/i,
    )
  })

  test("SET_QUESTIONS replaces all questions and resets state", () => {
    const session = createTestSession()
    const answered = reduce(session, { type: "ANSWER", questionId: "q1", value: "a" })

    const newQuestions: QuestionDefinition[] = [
      { id: "new-q1", type: "text", label: "New Q1" },
      { id: "new-q2", type: "toggle", label: "New Q2" },
    ]

    const next = reduce(answered, { type: "SET_QUESTIONS", questions: newQuestions })

    expect(next.questions).toHaveLength(2)
    expect(next.questions[0]?.id).toBe("new-q1")
    expect(next.currentIndex).toBe(0)
    expect(next.answers).toEqual({})
    expect(next.history).toEqual([])
    expect(next.status).toBe("active")
  })

  test("SET_QUESTIONS with empty array results in no questions", () => {
    const session = createTestSession()

    const next = reduce(session, { type: "SET_QUESTIONS", questions: [] })

    expect(next.questions).toHaveLength(0)
    expect(next.currentIndex).toBe(0)
  })
})

  test("SUBMIT_ROUND sets status to processing", () => {
    const session = createTestSession()
    const answered = reduce(session, { type: "ANSWER", questionId: "q1", value: "a" })

    const next = reduce(answered, { type: "SUBMIT_ROUND" })

    expect(next.status).toBe("processing")
    expect(next.updatedAt).toEqual(expect.any(String))
  })

  test("PUSH_MESSAGE appends a message", () => {
    const session = createTestSession()

    const next = reduce(session, { type: "PUSH_MESSAGE", content: "Hello from AI" })

    expect(next.messages).toHaveLength(1)
    expect(next.messages[0]?.content).toBe("Hello from AI")
    expect(next.messages[0]?.id).toEqual(expect.stringContaining("msg_"))
    expect(next.messages[0]?.pushedAt).toEqual(expect.any(String))
  })

  test("PUSH_MESSAGE accumulates multiple messages", () => {
    const session = createTestSession()
    const s1 = reduce(session, { type: "PUSH_MESSAGE", content: "First" })
    const s2 = reduce(s1, { type: "PUSH_MESSAGE", content: "Second" })

    expect(s2.messages).toHaveLength(2)
    expect(s2.messages[0]?.content).toBe("First")
    expect(s2.messages[1]?.content).toBe("Second")
  })

  test("SET_QUESTIONS resets status to active from processing", () => {
    const session = createTestSession()
    const processing = reduce(session, { type: "SUBMIT_ROUND" })
    expect(processing.status).toBe("processing")

    const newQuestions: QuestionDefinition[] = [
      { id: "round2-q1", type: "text", label: "Round 2 Q1" },
    ]
    const next = reduce(processing, { type: "SET_QUESTIONS", questions: newQuestions })

    expect(next.status).toBe("active")
    expect(next.questions).toHaveLength(1)
    expect(next.questions[0]?.id).toBe("round2-q1")
  })
