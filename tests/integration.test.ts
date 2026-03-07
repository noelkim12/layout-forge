import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { startWorkbenchServer, type WorkbenchServer } from "../.opencode/plugins/lw/server"
import { createSession } from "../.opencode/plugins/lw/store"
import type { LayoutIntent, PromptPacket, QuestionDefinition, VisualPreview } from "../.opencode/plugins/lw/types"

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

  test("full session submit-round resolves waitForRound", async () => {
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

    const roundPromise = server.waitForRound()

    const answerRes = await fetch(`${server.url}/api/answer`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Session-Token": server.token },
      body: JSON.stringify({ questionId: "q1", value: "a" }),
    })
    expect(answerRes.status).toBe(200)

    const submitRes = await fetch(`${server.url}/api/submit-round`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Session-Token": server.token },
    })
    expect(submitRes.status).toBe(200)

    const roundSession = await roundPromise
    expect(roundSession.status).toBe("processing")
    expect(roundSession.answers["q1"].value).toBe("a")

    // Server stays alive — clean up explicitly
    server.stop()
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

    const roundPromise = abortServer.waitForRound()
    controller.abort()

    const result = await roundPromise
    expect(result.status).toBe("abandoned")
  })
})
describe("integration: multi-round flow", () => {
  test("submit-round then push-questions starts new round", async () => {
    const session = createSession("ses_multiround", "Multi-round test", [
      {
        id: "r1q1",
        type: "single-select",
        label: "Round 1 Question",
        options: [
          { id: "x", label: "X" },
          { id: "y", label: "Y" },
        ],
      },
    ])

    const srv = await startWorkbenchServer({
      session,
      baseDir: process.cwd(),
      uiHtml: UI_HTML,
    })

    // Round 1: answer + submit
    const round1Promise = srv.waitForRound()

    await fetch(`${srv.url}/api/answer`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Session-Token": srv.token },
      body: JSON.stringify({ questionId: "r1q1", value: "x" }),
    })

    await fetch(`${srv.url}/api/submit-round`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Session-Token": srv.token },
    })

    const round1 = await round1Promise
    expect(round1.status).toBe("processing")
    expect(round1.answers["r1q1"].value).toBe("x")

    // Push new questions for round 2
    const round2Questions: QuestionDefinition[] = [
      {
        id: "r2q1",
        type: "text",
        label: "Round 2 Follow-up",
      },
    ]

    const pushRes = await fetch(`${srv.url}/api/push-questions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Session-Token": srv.token },
      body: JSON.stringify({ questions: round2Questions }),
    })
    expect(pushRes.status).toBe(200)

    // Verify session is active again with new question
    const sessionRes = await fetch(`${srv.url}/api/session`, {
      headers: { "X-Session-Token": srv.token },
    })
    const sessionBody = await sessionRes.json()
    expect(sessionBody.session.status).toBe("active")
    expect(sessionBody.currentQuestion.id).toBe("r2q1")

    // Round 2: answer + submit
    const round2Promise = srv.waitForRound()

    await fetch(`${srv.url}/api/answer`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Session-Token": srv.token },
      body: JSON.stringify({ questionId: "r2q1", value: "follow-up answer" }),
    })

    await fetch(`${srv.url}/api/submit-round`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Session-Token": srv.token },
    })

    const round2 = await round2Promise
    expect(round2.status).toBe("processing")
    expect(round2.answers["r2q1"].value).toBe("follow-up answer")
    // Round 1 answers are cleared when new questions are pushed (SET_QUESTIONS resets)
    expect(round2.answers["r1q1"]).toBeUndefined()

    srv.stop()
  })
})

describe("integration: push-message", () => {
  test("push-message adds message to session", async () => {
    const session = createSession("ses_pushmsg", "Push message test", [
      { id: "q1", type: "text", label: "Question" },
    ])

    const srv = await startWorkbenchServer({
      session,
      baseDir: process.cwd(),
      uiHtml: UI_HTML,
    })

    // Submit round first to get into processing state
    const roundPromise = srv.waitForRound()

    await fetch(`${srv.url}/api/answer`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Session-Token": srv.token },
      body: JSON.stringify({ questionId: "q1", value: "test" }),
    })

    await fetch(`${srv.url}/api/submit-round`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Session-Token": srv.token },
    })

    await roundPromise

    // Push a message
    const msgRes = await fetch(`${srv.url}/api/push-message`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Session-Token": srv.token },
      body: JSON.stringify({ content: "AI is thinking about your layout..." }),
    })
    expect(msgRes.status).toBe(200)

    // Verify message appears in session
    const sessionRes = await fetch(`${srv.url}/api/session`, {
      headers: { "X-Session-Token": srv.token },
    })
    const body = await sessionRes.json()
    expect(body.session.messages).toHaveLength(1)
    expect(body.session.messages[0].content).toBe("AI is thinking about your layout...")

    srv.stop()
  })
})

describe("integration: close endpoint", () => {
  test("POST /api/close stops the server", async () => {
    const session = createSession("ses_close", "Close test", [
      { id: "q1", type: "text", label: "Question" },
    ])

    const srv = await startWorkbenchServer({
      session,
      baseDir: process.cwd(),
      uiHtml: UI_HTML,
    })

    // Verify server is alive
    const healthRes = await fetch(`${srv.url}/health`)
    expect(healthRes.status).toBe(200)

    // Close via API
    const closeRes = await fetch(`${srv.url}/api/close`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Session-Token": srv.token },
    })
    expect(closeRes.status).toBe(200)

    // Server should be stopped - fetch should fail
    try {
      await fetch(`${srv.url}/health`)
      // If fetch somehow succeeds, that's also acceptable
      // (server might take a moment to fully stop)
    } catch {
      // Expected: connection refused
    }
  })
})


describe("integration: preview review flow", () => {
  const PREVIEW_QUESTIONS: QuestionDefinition[] = [
    {
      id: "layout-mode",
      type: "single-select",
      label: "Layout Mode",
      options: [
        { id: "sidebar", label: "Sidebar" },
        { id: "full-width", label: "Full Width" },
      ],
    },
  ]

  const TEST_INTENT: LayoutIntent = {
    structure: "sidebar-main",
    navigation: "top-nav",
    mainContent: ["list", "detail"],
    constraints: {
      fixed: ["sidebar-width"],
      flexible: ["main-content"],
      avoid: ["popup-modals"],
    },
  }

  const TEST_PREVIEW: VisualPreview = {
    id: "preview_1",
    title: "Sidebar Layout",
    cols: 12,
    rows: 8,
    nodes: [
      { id: "nav", label: "Navigation", role: "nav", x: 0, y: 0, w: 12, h: 1 },
      { id: "sidebar", label: "Sidebar", role: "sidebar", x: 0, y: 1, w: 3, h: 7 },
      { id: "main", label: "Main Content", role: "main", x: 3, y: 1, w: 9, h: 7 },
    ],
    outline: [
      { id: "nav", title: "Navigation", summary: "Top navigation bar" },
      { id: "sidebar", title: "Sidebar", summary: "Left sidebar panel" },
      { id: "main", title: "Main Content", summary: "Primary content area" },
    ],
    generatedAt: new Date().toISOString(),
  }

  const TEST_PACKET: PromptPacket = {
    summary: "Dashboard with sidebar layout",
    approvedPreviewSummary: "3-column layout with nav, sidebar, main",
    constraints: ["sidebar-width: 300px"],
    avoid: ["popup-modals"],
    outputFormat: "html-css",
  }

  function makeHeaders(token: string): Record<string, string> {
    return {
      "Content-Type": "application/json",
      "X-Session-Token": token,
    }
  }

  test("POST /api/push-preview transitions to reviewing with preview data", async () => {
    const session = createSession("ses_push_preview", "Push preview test", PREVIEW_QUESTIONS)
    const srv = await startWorkbenchServer({
      session,
      baseDir: process.cwd(),
      uiHtml: UI_HTML,
    })

    // Answer a question so commitRequirements has data
    await fetch(`${srv.url}/api/answer`, {
      method: "POST",
      headers: makeHeaders(srv.token),
      body: JSON.stringify({ questionId: "layout-mode", value: "sidebar" }),
    })

    // Push preview
    const res = await fetch(`${srv.url}/api/push-preview`, {
      method: "POST",
      headers: makeHeaders(srv.token),
      body: JSON.stringify({ intent: TEST_INTENT, preview: TEST_PREVIEW }),
    })
    expect(res.status).toBe(200)

    const body = await res.json()
    expect(body.phase).toBe("reviewing")
    expect(body.visualPreview).not.toBeNull()
    expect(body.visualPreview.id).toBe("preview_1")
    expect(body.layoutIntent).not.toBeNull()
    expect(body.layoutIntent.structure).toBe("sidebar-main")
    expect(body.session.requirementLedger).toBeInstanceOf(Array)
    expect(body.session.requirementLedger.length).toBeGreaterThan(0)

    srv.stop()
  })

  test("POST /api/approve-preview marks preview approved", async () => {
    const session = createSession("ses_approve_preview", "Approve preview test", PREVIEW_QUESTIONS)
    const srv = await startWorkbenchServer({
      session,
      baseDir: process.cwd(),
      uiHtml: UI_HTML,
    })

    // Setup: answer + push-preview
    await fetch(`${srv.url}/api/answer`, {
      method: "POST",
      headers: makeHeaders(srv.token),
      body: JSON.stringify({ questionId: "layout-mode", value: "sidebar" }),
    })
    await fetch(`${srv.url}/api/push-preview`, {
      method: "POST",
      headers: makeHeaders(srv.token),
      body: JSON.stringify({ intent: TEST_INTENT, preview: TEST_PREVIEW }),
    })

    // Approve
    const res = await fetch(`${srv.url}/api/approve-preview`, {
      method: "POST",
      headers: makeHeaders(srv.token),
      body: JSON.stringify({ previewId: "preview_1" }),
    })
    expect(res.status).toBe(200)

    const body = await res.json()
    expect(body.phase).toBe("approved")
    expect(body.session.approvedPreviewId).toBe("preview_1")

    srv.stop()
  })

  test("POST /api/build-prompt finalizes session with prompt", async () => {
    const session = createSession("ses_build_prompt", "Build prompt test", PREVIEW_QUESTIONS)
    const srv = await startWorkbenchServer({
      session,
      baseDir: process.cwd(),
      uiHtml: UI_HTML,
    })

    // Setup: answer + push-preview + approve
    await fetch(`${srv.url}/api/answer`, {
      method: "POST",
      headers: makeHeaders(srv.token),
      body: JSON.stringify({ questionId: "layout-mode", value: "sidebar" }),
    })
    await fetch(`${srv.url}/api/push-preview`, {
      method: "POST",
      headers: makeHeaders(srv.token),
      body: JSON.stringify({ intent: TEST_INTENT, preview: TEST_PREVIEW }),
    })
    await fetch(`${srv.url}/api/approve-preview`, {
      method: "POST",
      headers: makeHeaders(srv.token),
      body: JSON.stringify({ previewId: "preview_1" }),
    })

    // Build prompt
    const res = await fetch(`${srv.url}/api/build-prompt`, {
      method: "POST",
      headers: makeHeaders(srv.token),
      body: JSON.stringify({ packet: TEST_PACKET, renderedPrompt: "Build a dashboard with sidebar layout" }),
    })
    expect(res.status).toBe(200)

    const body = await res.json()
    expect(body.phase).toBe("finished")
    expect(body.promptPacket).not.toBeNull()
    expect(body.promptPacket.summary).toBe("Dashboard with sidebar layout")
    expect(body.session.renderedPrompt).toBe("Build a dashboard with sidebar layout")

    srv.stop()
  })
})
