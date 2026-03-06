import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdtemp, mkdir, rm } from "fs/promises"
import { tmpdir } from "os"
import { join } from "path"
import {
  createSession,
  deleteSession,
  generateId,
  listSessions,
  loadSession,
  saveSession,
} from "../.opencode/plugins/lw/store"
import type { QuestionDefinition } from "../.opencode/plugins/lw/types"

const SAMPLE_QUESTIONS: QuestionDefinition[] = [
  {
    id: "layout-mode",
    type: "single-select",
    label: "Layout Mode",
    options: [
      { id: "focus", label: "Focus" },
      { id: "split", label: "Split" },
    ],
  },
  {
    id: "density",
    type: "slider",
    label: "Density",
    min: 1,
    max: 5,
    step: 1,
  },
]

let tempDir: string

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), "lw-store-test-"))
  await mkdir(join(tempDir, ".opencode/layout-workbench/sessions"), { recursive: true })
})

afterEach(async () => {
  await rm(tempDir, { recursive: true })
})

describe("store", () => {
  test("generateId returns lw-prefixed id", () => {
    const id = generateId()

    expect(id).toMatch(/^lw_/)
  })

  test("createSession initializes core state", () => {
    const session = createSession("opencode-123", "Build a dashboard", SAMPLE_QUESTIONS)

    expect(session.id).toMatch(/^lw_/)
    expect(session.opencodeSessionId).toBe("opencode-123")
    expect(session.brief).toBe("Build a dashboard")
    expect(session.currentIndex).toBe(0)
    expect(session.answers).toEqual({})
    expect(session.history).toEqual([])
    expect(session.status).toBe("active")
    expect(session.createdAt).toBeString()
    expect(session.updatedAt).toBeString()
  })

  test("createSession embeds provided questions", () => {
    const session = createSession("opencode-456", "Design layout", SAMPLE_QUESTIONS)

    expect(session.questions).toEqual(SAMPLE_QUESTIONS)
  })

  test("saveSession and loadSession round-trip session data", async () => {
    const session = createSession("opencode-789", "Round trip", SAMPLE_QUESTIONS)

    await saveSession(session, tempDir)
    const loaded = await loadSession(session.id, tempDir)

    expect(loaded).toEqual(session)
  })

  test("loadSession returns null when session file is missing", async () => {
    const loaded = await loadSession("lw_missing", tempDir)

    expect(loaded).toBeNull()
  })

  test("listSessions returns ids for saved session files", async () => {
    const sessionA = createSession("opencode-a", "A", SAMPLE_QUESTIONS)
    const sessionB = createSession("opencode-b", "B", SAMPLE_QUESTIONS)

    await saveSession(sessionA, tempDir)
    await saveSession(sessionB, tempDir)

    const sessionIds = await listSessions(tempDir)

    expect(sessionIds).toContain(sessionA.id)
    expect(sessionIds).toContain(sessionB.id)
    expect(sessionIds).toHaveLength(2)
  })

  test("deleteSession removes session file", async () => {
    const session = createSession("opencode-delete", "Delete", SAMPLE_QUESTIONS)

    await saveSession(session, tempDir)
    await deleteSession(session.id, tempDir)
    const loaded = await loadSession(session.id, tempDir)

    expect(loaded).toBeNull()
  })
})
