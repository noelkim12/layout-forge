import type { AnswerValue, QuestionDefinition, WorkbenchSession } from "./types"
import { getApplicableQuestions, getCurrentQuestion, getProgress } from "./graph"
import { reduce } from "./reducer"
import { saveSession } from "./store"

export interface ServerConfig {
  session: WorkbenchSession
  baseDir: string
  uiHtml: string
  onLog?: (msg: string) => void
}

export interface WorkbenchServer {
  url: string
  port: number
  token: string
  stop: () => void
  waitForCompletion: () => Promise<WorkbenchSession>
}

function buildSessionState(session: WorkbenchSession): {
  session: WorkbenchSession
  currentQuestion: ReturnType<typeof getCurrentQuestion>
  applicableQuestions: ReturnType<typeof getApplicableQuestions>
  progress: ReturnType<typeof getProgress>
} {
  return {
    session,
    currentQuestion: getCurrentQuestion(session.questions, session.answers, session.currentIndex),
    applicableQuestions: getApplicableQuestions(session.questions, session.answers),
    progress: getProgress(session.questions, session.answers),
  }
}

function unauthorizedResponse(originHeaders: HeadersInit): Response {
  return Response.json({ error: "Unauthorized" }, { status: 401, headers: originHeaders })
}

function forbiddenResponse(originHeaders: HeadersInit): Response {
  return Response.json({ error: "Forbidden" }, { status: 403, headers: originHeaders })
}

/**
 * Starts an ephemeral local HTTP server that serves the workbench SPA and session API.
 */
export async function startWorkbenchServer(
  config: ServerConfig,
  abortSignal?: AbortSignal,
): Promise<WorkbenchServer> {
  let currentSession = config.session
  const token = crypto.randomUUID()
  let resolveCompletion: (value: WorkbenchSession) => void = () => undefined
  let rejectCompletion: (reason?: unknown) => void = () => undefined
  const completionPromise = new Promise<WorkbenchSession>((resolve, reject) => {
    resolveCompletion = resolve
    rejectCompletion = reject
  })
  const idleTimeoutMs = 30 * 60 * 1000
  let completed = false
  let stopped = false
  let idleTimer: ReturnType<typeof setTimeout> | undefined

  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: async (request): Promise<Response> => {
      const requestUrl = new URL(request.url)
      const origin = request.headers.get("origin")
      const sameOrigin = `http://127.0.0.1:${server.port}`
      const responseHeaders: HeadersInit = {
        "Access-Control-Allow-Origin": sameOrigin,
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, X-Session-Token",
        Vary: "Origin",
      }

      if (idleTimer !== undefined) {
        clearTimeout(idleTimer)
      }

      idleTimer = setTimeout(async () => {
        if (completed) {
          return
        }

        try {
          currentSession = reduce(currentSession, { type: "ABANDON" })
          await saveSession(currentSession, config.baseDir)
          completed = true
          resolveCompletion(currentSession)
          config.onLog?.(`Workbench session timed out: ${currentSession.id}`)
        } catch (error) {
          rejectCompletion(error instanceof Error ? error : new Error(String(error)))
        } finally {
          if (!stopped) {
            stopped = true
            server.stop()
          }
        }
      }, idleTimeoutMs)

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

        if (request.method === "POST" && requestUrl.pathname === "/api/complete") {
          currentSession = reduce(currentSession, { type: "COMPLETE" })
          await saveSession(currentSession, config.baseDir)
          if (!completed) {
            completed = true
            resolveCompletion(currentSession)
            config.onLog?.(`Workbench session completed: ${currentSession.id}`)
          }
          if (!stopped) {
            stopped = true
            server.stop()
          }

          return Response.json({ status: "completed", session: currentSession }, { headers: responseHeaders })
        }

        return Response.json({ error: "Not Found" }, { status: 404, headers: responseHeaders })
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        config.onLog?.(`Workbench server error: ${message}`)
        return Response.json({ error: message }, { status: 500, headers: responseHeaders })
      }
    },
  })

  const abandonAndResolve = async (): Promise<void> => {
    if (completed) {
      return
    }

    currentSession = reduce(currentSession, { type: "ABANDON" })
    await saveSession(currentSession, config.baseDir)
    completed = true
    resolveCompletion(currentSession)
    config.onLog?.(`Workbench session abandoned: ${currentSession.id}`)
    if (!stopped) {
      stopped = true
      server.stop()
    }
  }

  abortSignal?.addEventListener("abort", () => {
    abandonAndResolve().catch((error) => {
      rejectCompletion(error instanceof Error ? error : new Error(String(error)))
    })
  })

  const assignedPort = server.port ?? 0
  config.onLog?.(`Workbench server started on 127.0.0.1:${assignedPort}`)

  return {
    url: `http://127.0.0.1:${assignedPort}`,
    port: assignedPort,
    token,
    stop: () => {
      if (idleTimer !== undefined) {
        clearTimeout(idleTimer)
      }
      if (!stopped) {
        stopped = true
        server.stop()
      }
    },
    waitForCompletion: () => completionPromise,
  }
}
