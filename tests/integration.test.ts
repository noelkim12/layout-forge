import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { startWorkbenchServer, type WorkbenchServer } from "../.opencode/plugins/lw/server"
import { createSession } from "../.opencode/plugins/lw/store"
import type { QuestionDefinition } from "../.opencode/plugins/lw/types"

const TEST_QUESTIONS: QuestionDefinition[] = [
  {
    id: "layout-mode",
    type: "single-select",
    label: "Layout Mode",
    options: [
      { id: "sidebar", label: "Sidebar" },
      { id: "full-width", label: "Full Width" },
    ],
  },
  {
    id: "sidebar-width",
    type: "slider",
    label: "Sidebar Width",
    min: 200,
    max: 500,
    step: 50,
    dependsOn: { questionId: "layout-mode", operator: "eq", value: "sidebar" },
  },
  {
    id: "features",
    type: "multi-select",
    label: "Features",
    options: [
      { id: "search", label: "Search" },
      { id: "filters", label: "Filters" },
      { id: "sort", label: "Sort" },
    ],
  },
  {
    id: "dark-mode",
    type: "toggle",
    label: "Dark Mode Default",
  },
  {
    id: "custom-note",
    type: "text",
    label: "Additional Notes",
  },
]

const UI_HTML = `<!doctype html><html><body><h1>Test</h1>
<script>const SESSION_TOKEN = '__SESSION_TOKEN__'; const SESSION_ID = '__SESSION_ID__';</script>
</body></html>`

describe("integration: server lifecycle", () => {
  let server: WorkbenchServer
  let baseUrl: string

  function apiUrl(path: string): string {
    return `${baseUrl}${path}`
  }

  function headers(): Record<string, string> {
    return {
      "Content-Type": "application/json",
      "X-Session-Token": server.token,
    }
  }

  beforeAll(async () => {
    const session = createSession("ses_integration", "Integration test brief", TEST_QUESTIONS)
    server = await startWorkbenchServer({
      session,
      baseDir: process.cwd(),
      uiHtml: UI_HTML,
    })
    baseUrl = server.url
  })

  afterAll(() => {
    server?.stop()
  })

  test("GET /health returns ok", async () => {
    const res = await fetch(apiUrl("/health"))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)
  })

  test("GET / serves HTML with injected token", async () => {
    const res = await fetch(apiUrl("/"))
    expect(res.status).toBe(200)
    const html = await res.text()
    expect(html).toContain(server.token)
    expect(html).not.toContain("__SESSION_TOKEN__")
  })

  test("GET /api/session returns initial state", async () => {
    const res = await fetch(apiUrl("/api/session"), { headers: headers() })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.session.brief).toBe("Integration test brief")
    expect(body.session.status).toBe("active")
    expect(body.currentQuestion.id).toBe("layout-mode")
    expect(body.progress.answered).toBe(0)
    expect(body.progress.total).toBe(4)
  })

  test("GET /api/session rejects without token", async () => {
    const res = await fetch(apiUrl("/api/session"))
    expect(res.status).toBe(401)
  })

  test("POST /api/answer advances question", async () => {
    const res = await fetch(apiUrl("/api/answer"), {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({ questionId: "layout-mode", value: "sidebar" }),
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.session.answers["layout-mode"].value).toBe("sidebar")
    expect(body.progress.answered).toBe(1)
    expect(body.currentQuestion.id).toBe("sidebar-width")
  })

  test("POST /api/answer for slider question", async () => {
    const res = await fetch(apiUrl("/api/answer"), {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({ questionId: "sidebar-width", value: 300 }),
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.session.answers["sidebar-width"].value).toBe(300)
    expect(body.currentQuestion.id).toBe("features")
  })

  test("POST /api/answer for multi-select", async () => {
    const res = await fetch(apiUrl("/api/answer"), {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({ questionId: "features", value: ["search", "filters"] }),
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.session.answers["features"].value).toEqual(["search", "filters"])
    expect(body.currentQuestion.id).toBe("dark-mode")
  })

  test("POST /api/back navigates to previous question", async () => {
    const res = await fetch(apiUrl("/api/back"), {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({ toIndex: 1 }),
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.currentQuestion.id).toBe("sidebar-width")
  })

  test("POST /api/answer re-answer after back", async () => {
    const res = await fetch(apiUrl("/api/answer"), {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({ questionId: "sidebar-width", value: 350 }),
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.session.answers["sidebar-width"].value).toBe(350)
  })

  test("POST /api/add-question inserts new question", async () => {
    const newQuestion: QuestionDefinition = {
      id: "user-q-1",
      type: "text",
      label: "User Custom Question",
      userAdded: true,
    }
    const res = await fetch(apiUrl("/api/add-question"), {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({ question: newQuestion }),
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    const ids = body.applicableQuestions.map((q: QuestionDefinition) => q.id)
    expect(ids).toContain("user-q-1")
    expect(body.progress.total).toBe(6)
  })

  test("GET /api/404 returns not found", async () => {
    const res = await fetch(apiUrl("/api/nonexistent"), { headers: headers() })
    expect(res.status).toBe(404)
  })
})

describe("integration: complete flow", () => {
  let server: WorkbenchServer

  test("full session complete resolves waitForCompletion", async () => {
    const session = createSession("ses_complete_test", "Complete flow test", [
      {
        id: "q1",
        type: "single-select",
        label: "Only Question",
        options: [
          { id: "a", label: "A" },
          { id: "b", label: "B" },
        ],
      },
    ])

    server = await startWorkbenchServer({
      session,
      baseDir: process.cwd(),
      uiHtml: UI_HTML,
    })

    const completionPromise = server.waitForCompletion()

    const answerRes = await fetch(`${server.url}/api/answer`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Session-Token": server.token },
      body: JSON.stringify({ questionId: "q1", value: "a" }),
    })
    expect(answerRes.status).toBe(200)

    const completeRes = await fetch(`${server.url}/api/complete`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Session-Token": server.token },
    })
    expect(completeRes.status).toBe(200)

    const completedSession = await completionPromise
    expect(completedSession.status).toBe("completed")
    expect(completedSession.answers["q1"].value).toBe("a")
  })
})

describe("integration: abort flow", () => {
  test("abort signal abandons session", async () => {
    const session = createSession("ses_abort_test", "Abort flow test", [
      { id: "q1", type: "text", label: "Question" },
    ])

    const controller = new AbortController()

    const abortServer = await startWorkbenchServer(
      { session, baseDir: process.cwd(), uiHtml: UI_HTML },
      controller.signal,
    )

    const completionPromise = abortServer.waitForCompletion()
    controller.abort()

    const result = await completionPromise
    expect(result.status).toBe("abandoned")
  })
})
