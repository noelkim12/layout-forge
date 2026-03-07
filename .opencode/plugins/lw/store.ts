import { mkdir, unlink } from "fs/promises"
import { join } from "path"
import type { QuestionDefinition, WorkbenchSession } from "./types"

const SESSIONS_RELATIVE_DIR = ".opencode/layout-workbench/sessions"

function getSessionsDir(baseDir: string): string {
  return join(baseDir, SESSIONS_RELATIVE_DIR)
}

function getSessionFilePath(sessionId: string, baseDir: string): string {
  return join(getSessionsDir(baseDir), `${sessionId}.json`)
}

export function generateId(): string {
  return `lw_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

export function createSession(
  opencodeSessionId: string,
  brief: string,
  questions: QuestionDefinition[],
): WorkbenchSession {
  const now = new Date().toISOString()

  return {
    id: generateId(),
    opencodeSessionId,
    brief,
    questions,
    currentIndex: 0,
    answers: {},
    history: [],
    messages: [],
    createdAt: now,
    updatedAt: now,
    status: "active",
  }
}

export async function saveSession(session: WorkbenchSession, baseDir: string): Promise<void> {
  const sessionsDir = getSessionsDir(baseDir)
  const sessionFilePath = getSessionFilePath(session.id, baseDir)

  await mkdir(sessionsDir, { recursive: true })
  await Bun.write(sessionFilePath, JSON.stringify(session, null, 2))
}

export async function loadSession(
  sessionId: string,
  baseDir: string,
): Promise<WorkbenchSession | null> {
  const sessionFilePath = getSessionFilePath(sessionId, baseDir)
  const sessionFile = Bun.file(sessionFilePath)

  if (!(await sessionFile.exists())) {
    return null
  }

  const content = await sessionFile.text()
  const session = JSON.parse(content) as WorkbenchSession
  // Backward compat: sessions saved before multi-round support lack messages
  if (!session.messages) {
    session.messages = []
  }
  return session
}

export async function listSessions(baseDir: string): Promise<string[]> {
  const sessionsDir = getSessionsDir(baseDir)
  const ids: string[] = []
  const glob = new Bun.Glob("*.json")

  try {
    for await (const fileName of glob.scan({ cwd: sessionsDir, onlyFiles: true })) {
      ids.push(fileName.replace(/\.json$/, ""))
    }
  } catch {
    return []
  }

  return ids
}

export async function deleteSession(sessionId: string, baseDir: string): Promise<void> {
  const sessionFilePath = getSessionFilePath(sessionId, baseDir)
  const sessionFile = Bun.file(sessionFilePath)

  if (await sessionFile.exists()) {
    await unlink(sessionFilePath)
  }
}
