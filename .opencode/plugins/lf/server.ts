import type { AnswerValue, ContextSourceRef, LayoutIntent, PreviewReview, PromptPacket, QuestionDefinition, VisualPreview, WorkbenchSession } from "./types"
import { getApplicableQuestions, getCurrentQuestion, getProgress } from "./graph"
import { reduce } from "./reducer"
import { saveSession } from "./store"
import { buildAsciiPreview } from "./ascii"

interface BunServerInstance {
  port: number
  stop: () => void
}

interface BunServeOptions {
  hostname: string
  port: number
  fetch: (request: Request) => Promise<Response>
}

declare const Bun: {
  serve: (options: BunServeOptions) => BunServerInstance
}

export const WORKBENCH_SERVER_HOSTNAME = "127.0.0.1"
export const DEFAULT_WORKBENCH_SERVER_PORT = 0

export interface ServerConfig {
  session: WorkbenchSession
  baseDir: string
  uiHtml: string
  port?: number
  onLog?: (msg: string) => void
}

export interface WorkbenchServer {
  url: string
  port: number
  token: string
  stop: () => void
  /** Resolves when the user submits a round or requests refinement. Can be called multiple times. */
  waitForRound: () => Promise<WorkbenchSession>
}

function buildSessionState(session: WorkbenchSession): {
  session: WorkbenchSession
  currentQuestion: ReturnType<typeof getCurrentQuestion>
  applicableQuestions: ReturnType<typeof getApplicableQuestions>
  progress: ReturnType<typeof getProgress>
  layoutPreview: ReturnType<typeof buildAsciiPreview>
  visualPreview: VisualPreview | null
  previewHistory: VisualPreview[]
  previewReviews: PreviewReview[]
  layoutIntent: LayoutIntent | null
  promptPacket: PromptPacket | null
  renderedPrompt: string | null
  phase: "collecting" | "previewing" | "reviewing" | "approved" | "prompt-ready" | "finished"
} {
  return {
    session,
    currentQuestion: getCurrentQuestion(session.questions, session.answers, session.currentIndex),
    applicableQuestions: getApplicableQuestions(session.questions, session.answers),
    progress: getProgress(session.questions, session.answers),
    layoutPreview: buildAsciiPreview(session),
    visualPreview: session.visualPreview ?? null,
    previewHistory: session.previewHistory ?? [],
    previewReviews: session.previewReviews ?? [],
    layoutIntent: session.layoutIntent ?? null,
    promptPacket: session.promptPacket ?? null,
    renderedPrompt: session.renderedPrompt ?? null,
    phase: session.phase ?? "collecting",
  }
}

function unauthorizedResponse(originHeaders: HeadersInit): Response {
  return Response.json({ error: "Unauthorized" }, { status: 401, headers: originHeaders })
}

function forbiddenResponse(originHeaders: HeadersInit): Response {
  return Response.json({ error: "Forbidden" }, { status: 403, headers: originHeaders })
}

/**
 * Starts an ephemeral local HTTP server that serves the forge SPA and session API.
 * Supports multi-round flow: the server stays alive across multiple question rounds.
 */
export async function startWorkbenchServer(
  config: ServerConfig,
  abortSignal?: AbortSignal,
): Promise<WorkbenchServer> {
  let currentSession = config.session
  const token = crypto.randomUUID()

  // Round-based promise pattern: each waitForRound() creates a new promise
  let roundResolve: ((value: WorkbenchSession) => void) | null = null
  let roundReject: ((reason?: unknown) => void) | null = null

  const idleTimeoutMs = 30 * 60 * 1000
  let stopped = false
  let idleTimer: ReturnType<typeof setTimeout> | undefined

  const resetIdleTimer = () => {
    if (idleTimer !== undefined) {
      clearTimeout(idleTimer)
    }

    idleTimer = setTimeout(async () => {
      try {
        currentSession = reduce(currentSession, { type: "ABANDON" })
        await saveSession(currentSession, config.baseDir)
        roundResolve?.(currentSession)
        roundResolve = null
        roundReject = null
        config.onLog?.(`Forge session timed out: ${currentSession.id}`)
      } catch (error) {
        roundReject?.(error instanceof Error ? error : new Error(String(error)))
        roundResolve = null
        roundReject = null
      } finally {
        if (!stopped) {
          stopped = true
          server.stop()
        }
      }
    }, idleTimeoutMs)
  }

  const stopServer = () => {
    if (idleTimer !== undefined) {
      clearTimeout(idleTimer)
    }
    if (!stopped) {
      stopped = true
      server.stop()
    }
  }

  const server = Bun.serve({
    hostname: WORKBENCH_SERVER_HOSTNAME,
    port: config.port ?? DEFAULT_WORKBENCH_SERVER_PORT,
    fetch: async (request: Request): Promise<Response> => {
      const requestUrl = new URL(request.url)
      const origin = request.headers.get("origin")
      const sameOrigin = `http://${WORKBENCH_SERVER_HOSTNAME}:${server.port}`
      const responseHeaders: HeadersInit = {
        "Access-Control-Allow-Origin": sameOrigin,
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, X-Session-Token",
        Vary: "Origin",
      }

      resetIdleTimer()

      if (request.method === "OPTIONS") {
        if (origin && origin !== sameOrigin) {
          return forbiddenResponse(responseHeaders)
        }

        return new Response(null, { status: 204, headers: responseHeaders })
      }

      try {
        if (origin && origin !== sameOrigin) {
          return forbiddenResponse(responseHeaders)
        }

        if (requestUrl.pathname.startsWith("/api/")) {
          const receivedToken =
            request.headers.get("x-session-token") ?? requestUrl.searchParams.get("token")
          if (receivedToken !== token) {
            return unauthorizedResponse(responseHeaders)
          }
        }

        if (request.method === "GET" && requestUrl.pathname === "/") {
          const html = config.uiHtml
            .replace(/__SESSION_TOKEN__/g, token)
            .replace(/__SESSION_ID__/g, currentSession.id)

          return new Response(html, {
            status: 200,
            headers: { ...responseHeaders, "Content-Type": "text/html; charset=utf-8" },
          })
        }

        if (request.method === "GET" && requestUrl.pathname === "/health") {
          return Response.json({ ok: true }, { headers: responseHeaders })
        }

        if (request.method === "GET" && requestUrl.pathname === "/api/session") {
          return Response.json(buildSessionState(currentSession), { headers: responseHeaders })
        }

        // User answers a single question (mid-round, does not resolve the round)
        if (request.method === "POST" && requestUrl.pathname === "/api/answer") {
          const body = (await request.json()) as { questionId: string; value: AnswerValue }
          currentSession = reduce(currentSession, {
            type: "ANSWER",
            questionId: body.questionId,
            value: body.value,
          })
          await saveSession(currentSession, config.baseDir)
          return Response.json(buildSessionState(currentSession), { headers: responseHeaders })
        }

        if (request.method === "POST" && requestUrl.pathname === "/api/back") {
          const body = (await request.json()) as { toIndex: number }
          currentSession = reduce(currentSession, { type: "GO_BACK", toIndex: body.toIndex })
          await saveSession(currentSession, config.baseDir)
          return Response.json(buildSessionState(currentSession), { headers: responseHeaders })
        }

        if (request.method === "POST" && requestUrl.pathname === "/api/add-question") {
          const body = (await request.json()) as { question: QuestionDefinition }
          currentSession = reduce(currentSession, { type: "ADD_QUESTION", question: body.question })
          await saveSession(currentSession, config.baseDir)
          return Response.json(buildSessionState(currentSession), { headers: responseHeaders })
        }

        if (request.method === "POST" && requestUrl.pathname === "/api/toggle-type") {
          const body = (await request.json()) as { questionId: string }
          currentSession = reduce(currentSession, { type: "TOGGLE_SELECT_MODE", questionId: body.questionId })
          await saveSession(currentSession, config.baseDir)
          return Response.json(buildSessionState(currentSession), { headers: responseHeaders })
        }

        // LLM pushes new questions (resets answers, sets status to active)
        if (request.method === "POST" && requestUrl.pathname === "/api/push-questions") {
          const body = (await request.json()) as { questions: QuestionDefinition[] }
          currentSession = reduce(currentSession, { type: "SET_QUESTIONS", questions: body.questions })
          await saveSession(currentSession, config.baseDir)
          config.onLog?.(`Questions pushed to forge: ${body.questions.length} questions`)
          return Response.json(buildSessionState(currentSession), { headers: responseHeaders })
        }

        // LLM pushes a message to the browser (does not change status)
        if (request.method === "POST" && requestUrl.pathname === "/api/push-message") {
          const body = (await request.json()) as { content: string }
          currentSession = reduce(currentSession, { type: "PUSH_MESSAGE", content: body.content })
          await saveSession(currentSession, config.baseDir)
          config.onLog?.(`Message pushed to forge`)
          return Response.json(buildSessionState(currentSession), { headers: responseHeaders })
        }

        // LLM pushes a visual preview for user review
        if (request.method === "POST" && requestUrl.pathname === "/api/push-preview") {
          const body = (await request.json()) as { intent: LayoutIntent; preview: VisualPreview }
          currentSession = reduce(currentSession, { type: "COMMIT_REQUIREMENTS" })
          currentSession = reduce(currentSession, { type: "SET_LAYOUT_INTENT", intent: body.intent })
          currentSession = reduce(currentSession, { type: "SET_VISUAL_PREVIEW", preview: body.preview })
          currentSession = reduce(currentSession, { type: "SET_PHASE", phase: "previewing" })
          currentSession = reduce(currentSession, { type: "SET_PHASE", phase: "reviewing" })
          await saveSession(currentSession, config.baseDir)

          roundResolve?.(currentSession)
          roundResolve = null
          roundReject = null

          return Response.json(buildSessionState(currentSession), { headers: responseHeaders })
        }

        // User submits a review of the preview
        if (request.method === "POST" && requestUrl.pathname === "/api/preview-review") {
          const body = (await request.json()) as { review: PreviewReview }
          currentSession = reduce(currentSession, { type: "PUSH_PREVIEW_REVIEW", review: body.review })
          if (body.review.type === "ask-followup") {
            currentSession = reduce(currentSession, { type: "SET_PHASE", phase: "collecting" })
          }
          await saveSession(currentSession, config.baseDir)

          roundResolve?.(currentSession)
          roundResolve = null
          roundReject = null

          return Response.json(buildSessionState(currentSession), { headers: responseHeaders })
        }

        // User approves the current preview
        if (request.method === "POST" && requestUrl.pathname === "/api/approve-preview") {
          const body = (await request.json()) as { previewId: string }
          currentSession = reduce(currentSession, { type: "APPROVE_PREVIEW", previewId: body.previewId })
          await saveSession(currentSession, config.baseDir)

          roundResolve?.(currentSession)
          roundResolve = null
          roundReject = null

          return Response.json(buildSessionState(currentSession), { headers: responseHeaders })
        }

        if (request.method === "POST" && requestUrl.pathname === "/api/request-prompt-suggestion") {
          currentSession = reduce(currentSession, { type: "REQUEST_PROMPT_SUGGESTION" })
          await saveSession(currentSession, config.baseDir)
          config.onLog?.(`Prompt suggestion requested: ${currentSession.id}`)

          roundResolve?.(currentSession)
          roundResolve = null
          roundReject = null

          return Response.json(buildSessionState(currentSession), { headers: responseHeaders })
        }

        // LLM provides the built prompt for the session
        if (request.method === "POST" && requestUrl.pathname === "/api/build-prompt") {
          const body = (await request.json()) as { packet: PromptPacket; renderedPrompt: string }
          currentSession = reduce(currentSession, { type: "SET_PROMPT_PROPOSAL", packet: body.packet, renderedPrompt: body.renderedPrompt })
          currentSession = reduce(currentSession, { type: "SET_PHASE", phase: "prompt-ready" })
          await saveSession(currentSession, config.baseDir)

          roundResolve?.(currentSession)
          roundResolve = null
          roundReject = null

          return Response.json(buildSessionState(currentSession), { headers: responseHeaders })
        }

        // User dismisses the prompt in the browser → transition to finished
        if (request.method === "POST" && requestUrl.pathname === "/api/dismiss-prompt") {
          currentSession = reduce(currentSession, { type: "DISMISS_PROMPT" })
          currentSession = reduce(currentSession, { type: "SET_PHASE", phase: "finished" })
          await saveSession(currentSession, config.baseDir)
          config.onLog?.(`Prompt dismissed: ${currentSession.id}`)

          roundResolve?.(currentSession)
          roundResolve = null
          roundReject = null

          return Response.json(buildSessionState(currentSession), { headers: responseHeaders })
        }

        // LLM registers a context source on the session
        if (request.method === "POST" && requestUrl.pathname === "/api/add-context-source") {
          const body = (await request.json()) as { source: ContextSourceRef }
          currentSession = reduce(currentSession, { type: "ADD_CONTEXT_SOURCE", source: body.source })
          await saveSession(currentSession, config.baseDir)
          return Response.json(buildSessionState(currentSession), { headers: responseHeaders })
        }

        // User submits all answers for this round → status becomes "processing", round resolves
        if (request.method === "POST" && requestUrl.pathname === "/api/submit-round") {
          currentSession = reduce(currentSession, { type: "SUBMIT_ROUND" })
          await saveSession(currentSession, config.baseDir)
          config.onLog?.(`Round submitted: ${currentSession.id}`)

          // Resolve the current round promise so the LLM tool unblocks
          roundResolve?.(currentSession)
          roundResolve = null
          roundReject = null

          return Response.json(buildSessionState(currentSession), { headers: responseHeaders })
        }

        // User requests refinement → round resolves with refinement status, server stays alive
        if (request.method === "POST" && requestUrl.pathname === "/api/refine") {
          const body = (await request.json()) as { questionId: string; userIntent: string }
          currentSession = reduce(currentSession, {
            type: "REFINE",
            questionId: body.questionId,
            userIntent: body.userIntent,
          })
          await saveSession(currentSession, config.baseDir)
          config.onLog?.(`Forge refinement requested: ${currentSession.id}`)

          // Resolve the round so the LLM can process the refinement
          roundResolve?.(currentSession)
          roundResolve = null
          roundReject = null

          return Response.json(
            { status: "refinement_requested", session: currentSession },
            { headers: responseHeaders },
          )
        }

        // LLM explicitly completes the session → marks completed, resolves any pending round
        if (request.method === "POST" && requestUrl.pathname === "/api/complete") {
          currentSession = reduce(currentSession, { type: "COMPLETE" })
          await saveSession(currentSession, config.baseDir)
          config.onLog?.(`Forge session completed: ${currentSession.id}`)

          roundResolve?.(currentSession)
          roundResolve = null
          roundReject = null

          return Response.json({ status: "completed", session: currentSession }, { headers: responseHeaders })
        }

        // LLM explicitly closes the server
        if (request.method === "POST" && requestUrl.pathname === "/api/close") {
          if (currentSession.status !== "completed" && currentSession.status !== "abandoned") {
            currentSession = reduce(currentSession, { type: "COMPLETE" })
            await saveSession(currentSession, config.baseDir)
          }
          config.onLog?.(`Forge server closed: ${currentSession.id}`)

          roundResolve?.(currentSession)
          roundResolve = null
          roundReject = null

          // Stop the server after responding
          setTimeout(() => stopServer(), 100)

          return Response.json({ status: "closed", session: currentSession }, { headers: responseHeaders })
        }

        return Response.json({ error: "Not Found" }, { status: 404, headers: responseHeaders })
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        config.onLog?.(`Forge server error: ${message}`)
        return Response.json({ error: message }, { status: 500, headers: responseHeaders })
      }
    },
  })

  async function abandonAndResolve(): Promise<void> {
    if (currentSession.status === "abandoned" || currentSession.status === "completed") {
      return
    }

    currentSession = reduce(currentSession, { type: "ABANDON" })
    await saveSession(currentSession, config.baseDir)
    config.onLog?.(`Forge session abandoned: ${currentSession.id}`)

    roundResolve?.(currentSession)
    roundResolve = null
    roundReject = null

    stopServer()
  }

  abortSignal?.addEventListener("abort", () => {
    abandonAndResolve().catch((error) => {
      roundReject?.(error instanceof Error ? error : new Error(String(error)))
      roundResolve = null
      roundReject = null
    })
  })

  const assignedPort = server.port ?? 0
  config.onLog?.(`Forge server started on ${WORKBENCH_SERVER_HOSTNAME}:${assignedPort}`)

  return {
    url: `http://${WORKBENCH_SERVER_HOSTNAME}:${assignedPort}`,
    port: assignedPort,
    token,
    stop: stopServer,
    waitForRound: () => {
      return new Promise<WorkbenchSession>((resolve, reject) => {
        roundResolve = resolve
        roundReject = reject
      })
    },
  }
}
