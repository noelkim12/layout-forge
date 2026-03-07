import { describe, expect, test } from "bun:test"
import { commitRequirements, reduce } from "../.opencode/plugins/lw/reducer"
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

describe("COMMIT_REQUIREMENTS", () => {
  test("creates a snapshot from current answers", () => {
    const session = createTestSession()
    const answered = reduce(session, { type: "ANSWER", questionId: "q1", value: "a" })
    const answered2 = reduce(answered, { type: "ANSWER", questionId: "q2", value: "hello" })

    const next = reduce(answered2, { type: "COMMIT_REQUIREMENTS" })

    expect(next.requirementSnapshots).toHaveLength(1)
    expect(next.requirementSnapshots![0]!.items).toHaveLength(2)
    expect(next.requirementSnapshots![0]!.id).toEqual(expect.stringContaining("snap_"))
    expect(next.requirementSnapshots![0]!.createdAt).toEqual(expect.any(String))
  })

  test("appends items to requirementLedger", () => {
    const session = createTestSession()
    const answered = reduce(session, { type: "ANSWER", questionId: "q1", value: "a" })
    const committed1 = reduce(answered, { type: "COMMIT_REQUIREMENTS" })

    const answered2 = reduce(committed1, { type: "ANSWER", questionId: "q2", value: "text" })
    const committed2 = reduce(answered2, { type: "COMMIT_REQUIREMENTS" })

    expect(committed2.requirementSnapshots).toHaveLength(2)
    // Ledger accumulates items from all snapshots
    expect(committed2.requirementLedger!.length).toBeGreaterThanOrEqual(1)
  })
})

describe("SET_PHASE", () => {
  test("valid transition: undefined → previewing", () => {
    const session = createTestSession()
    expect(session.phase).toBeUndefined()

    const next = reduce(session, { type: "SET_PHASE", phase: "previewing" })

    expect(next.phase).toBe("previewing")
    expect(next.updatedAt).toEqual(expect.any(String))
  })

  test("valid transition: collecting → previewing", () => {
    const session = createTestSession()
    const collecting = reduce(session, { type: "SET_PHASE", phase: "previewing" })
    const reviewing = reduce(collecting, { type: "SET_PHASE", phase: "reviewing" })
    const backToCollecting = reduce(reviewing, { type: "SET_PHASE", phase: "collecting" })

    const next = reduce(backToCollecting, { type: "SET_PHASE", phase: "previewing" })

    expect(next.phase).toBe("previewing")
  })

  test("valid transition chain: previewing → reviewing → approved → finished", () => {
    const session = createTestSession()
    const s1 = reduce(session, { type: "SET_PHASE", phase: "previewing" })
    const s2 = reduce(s1, { type: "SET_PHASE", phase: "reviewing" })
    const s3 = reduce(s2, { type: "SET_PHASE", phase: "approved" })
    const s4 = reduce(s3, { type: "SET_PHASE", phase: "finished" })

    expect(s4.phase).toBe("finished")
  })

  test("invalid transition throws: collecting → reviewing", () => {
    const session = createTestSession()
    const collecting = { ...session, phase: "collecting" as const }

    expect(() => reduce(collecting, { type: "SET_PHASE", phase: "reviewing" })).toThrow(
      /invalid phase transition/i,
    )
  })

  test("invalid transition throws: approved → collecting", () => {
    const session = createTestSession()
    const approved = { ...session, phase: "approved" as const }

    expect(() => reduce(approved, { type: "SET_PHASE", phase: "collecting" })).toThrow(
      /invalid phase transition/i,
    )
  })
})

describe("SET_QUESTIONS preserves cumulative state", () => {
  test("after COMMIT_REQUIREMENTS then SET_QUESTIONS, ledger and snapshots intact", () => {
    const session = createTestSession()
    const answered = reduce(session, { type: "ANSWER", questionId: "q1", value: "a" })
    const committed = reduce(answered, { type: "COMMIT_REQUIREMENTS" })

    expect(committed.requirementSnapshots).toHaveLength(1)

    const newQuestions: QuestionDefinition[] = [
      { id: "round2-q1", type: "text", label: "Round 2 Q1" },
    ]
    const next = reduce(committed, { type: "SET_QUESTIONS", questions: newQuestions })

    // Cumulative fields preserved
    expect(next.requirementSnapshots).toHaveLength(1)
    expect(next.requirementLedger).toBeDefined()
    // Reset fields cleared
    expect(next.answers).toEqual({})
    expect(next.history).toEqual([])
    expect(next.currentIndex).toBe(0)
    expect(next.phase).toBe("collecting")
  })
})

describe("commitRequirements helper", () => {
  test("produces correct snapshot from session state", () => {
    const session = createTestSession()
    const answered = reduce(session, { type: "ANSWER", questionId: "q1", value: "a" })
    const answered2 = reduce(answered, { type: "ANSWER", questionId: "q2", value: "my text" })

    const snapshot = commitRequirements(answered2)

    expect(snapshot.id).toEqual(expect.stringContaining("snap_"))
    expect(snapshot.createdAt).toEqual(expect.any(String))
    expect(snapshot.items).toHaveLength(2)
    const q1Item = snapshot.items.find(i => i.key === "q1")
    expect(q1Item?.value).toBe("a")
    expect(q1Item?.label).toBe("Q1")
    expect(q1Item?.sourceQuestionId).toBe("q1")
    expect(q1Item?.capturedAt).toEqual(expect.any(String))
  })
})
