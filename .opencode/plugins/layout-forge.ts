import type { Plugin } from "@opencode-ai/plugin"
import { tool } from "@opencode-ai/plugin"
import { readFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

import { createSession } from "./lf/store"
import { startWorkbenchServer } from "./lf/server"
import type { WorkbenchServer } from "./lf/server"
import { formatToolResult } from "./lf/format"
import { exportMarkdownPlan } from "./lf/export"
import type { ContextSourceRef, WorkbenchSession } from "./lf/types"
import { openBrowser } from "./lf/browser"

const questionSchema = tool.schema.object({
  id: tool.schema.string().describe("Unique question ID"),
  type: tool.schema
    .enum(["single-select", "multi-select", "text", "slider", "toggle"])
    .describe("Question input type"),
  label: tool.schema.string().describe("Question label shown to user"),
  description: tool.schema
    .string()
    .optional()
    .describe("Additional context for the question"),
  options: tool.schema
    .array(
      tool.schema.object({
        id: tool.schema.string(),
        label: tool.schema.string(),
        description: tool.schema.string().optional(),
        tags: tool.schema.array(tool.schema.string()).optional(),
      }),
    )
    .optional()
    .describe("Options for select-type questions"),
  min: tool.schema.number().optional().describe("Minimum value for slider"),
  max: tool.schema.number().optional().describe("Maximum value for slider"),
  step: tool.schema.number().optional().describe("Step increment for slider"),
  defaultValue: tool.schema
    .union([tool.schema.string(), tool.schema.number(), tool.schema.boolean()])
    .optional(),
  dependsOn: tool.schema
    .object({
      questionId: tool.schema.string(),
      operator: tool.schema.enum(["eq", "neq", "includes", "excludes"]),
      value: tool.schema.union([tool.schema.string(), tool.schema.array(tool.schema.string())]),
    })
    .optional()
    .describe("Conditional display based on another answer"),
  required: tool.schema.boolean().optional(),
  allowCustom: tool.schema
    .boolean()
    .optional()
    .describe("Allow the user to type a custom answer beyond the provided options (for select-type questions)"),
})

const layoutIntentSchema = tool.schema.object({
  structure: tool.schema.string().optional().describe("Overall layout structure (e.g. 'sidebar + main', 'three-column')"),
  navigation: tool.schema.string().optional().describe("Navigation pattern"),
  mainContent: tool.schema.array(tool.schema.string()).optional().describe("Main content area descriptions"),
  detailPlacement: tool.schema.string().optional().describe("Where detail/inspector panels go"),
  bottomArea: tool.schema.string().optional().describe("Bottom area usage"),
  density: tool.schema.number().optional().describe("Information density (0-1)"),
  constraints: tool.schema.object({
    fixed: tool.schema.array(tool.schema.string()).describe("Fixed layout constraints"),
    flexible: tool.schema.array(tool.schema.string()).describe("Flexible layout elements"),
    avoid: tool.schema.array(tool.schema.string()).describe("Things to avoid"),
  }).describe("Layout constraints"),
})

const visualPreviewNodeSchema = tool.schema.object({
  id: tool.schema.string().describe("Unique node ID"),
  label: tool.schema.string().describe("Display label for this region"),
  role: tool.schema.enum(["nav", "sidebar", "main", "inspector", "bottom", "toolbar"]).describe("Region role"),
  x: tool.schema.number().describe("Grid column start (1-based)"),
  y: tool.schema.number().describe("Grid row start (1-based)"),
  w: tool.schema.number().describe("Grid column span"),
  h: tool.schema.number().describe("Grid row span"),
  summary: tool.schema.string().optional().describe("Brief description of this region's content"),
})

const visualPreviewSchema = tool.schema.object({
  id: tool.schema.string().describe("Unique preview ID"),
  title: tool.schema.string().describe("Preview title"),
  cols: tool.schema.number().describe("CSS Grid column count (e.g. 12)"),
  rows: tool.schema.number().describe("CSS Grid row count (e.g. 8)"),
  nodes: tool.schema.array(visualPreviewNodeSchema).describe("Layout regions"),
  outline: tool.schema.array(tool.schema.object({
    id: tool.schema.string(),
    title: tool.schema.string(),
    summary: tool.schema.string(),
  })).describe("Outline entries for each region"),
  raw: tool.schema.object({
    ascii: tool.schema.string().optional(),
    notes: tool.schema.array(tool.schema.string()).optional(),
  }).optional().describe("Raw ASCII preview and notes"),
  generatedAt: tool.schema.string().describe("ISO timestamp when preview was generated"),
})

export const LayoutForgePlugin: Plugin = async (ctx) => {
  const { client, directory } = ctx
  let activeServer: WorkbenchServer | null = null
  const pluginDir = dirname(fileURLToPath(import.meta.url))
  const promptDir = join(pluginDir, "lf/prompts")

  const readPrompt = async (fileName: string) => {
    const filePath = join(promptDir, fileName)
    return (await readFile(filePath, "utf8")).trim()
  }

  const [
    layoutOpenWorkbenchDescription,
    layoutPushQuestionsDescription,
    layoutPushPreviewDescription,
    layoutBuildPromptDescription,
    layoutAwaitCompletionDescription,
    layoutPushMessageDescription,
    layoutCloseDescription,
  ] = await Promise.all([
    readPrompt("layout_open_workbench.prompt"),
    readPrompt("layout_push_questions.prompt"),
    readPrompt("layout_push_preview.prompt"),
    readPrompt("layout_build_prompt.prompt"),
    readPrompt("layout_await_completion.prompt"),
    readPrompt("layout_push_message.prompt"),
    readPrompt("layout_close.prompt"),
  ])

  const layoutAddContextSourceDescription = "Registers a context source (file, document, or reference) that the LLM should use as ground truth for this session. Call this to explicitly scope what sources inform layout decisions. Sources not registered here should NOT influence the output."

  const startServer = async (
    session: ReturnType<typeof createSession>,
    abortSignal?: AbortSignal,
  ) => {
    const uiHtmlPath = join(pluginDir, "../layout-forge/ui/index.html")
    const uiHtml = await readFile(uiHtmlPath, "utf8")

    const server = await startWorkbenchServer(
      {
        session,
        baseDir: directory,
        uiHtml,
        onLog: (msg) => {
          void client.app.log({
            body: { service: "layout-forge", level: "info", message: msg },
          })
        },
      },
      abortSignal,
    )
    activeServer = server

    await openBrowser(server.url)
    return server
  }

  const cleanupServer = () => {
    if (activeServer) {
      activeServer.stop()
      activeServer = null
    }
  }

  const handleRoundResult = async (session: ReturnType<typeof createSession>) => {
    if (session.status === "completed") {
      const planPath = await exportMarkdownPlan(session, directory)
      void client.app.log({
        body: {
          service: "layout-forge",
          level: "info",
          message: `Plan exported to ${planPath}`,
        },
      })
    } else if (session.status === "refinement_requested") {
      void client.app.log({
        body: {
          service: "layout-forge",
          level: "info",
          message: `Refinement requested for question: ${session.refinementRequest?.questionLabel}`,
        },
      })
    }
  }

  return {
    tool: {
      layout_open_workbench: tool({
        description: layoutOpenWorkbenchDescription,
        args: {
          brief: tool.schema.string().describe("Brief description of what visual UI layout is being designed (e.g. 'Dashboard page layout', 'Settings panel structure'). Must describe a screen or visual component, not a project."),
          questions: tool.schema
            .array(questionSchema)
            .optional()
            .describe("Array of questions to present to the user. Omit to open with loading state for later push."),
        },
        async execute(args, context) {
          if (activeServer) {
            return "A layout forge session is already active. Complete or abandon it before starting a new one."
          }

          const questions = args.questions ?? []
          const session = createSession(context.sessionID, args.brief, questions)

          try {
            const server = await startServer(session, context.abort)

            context.metadata({
              title: `Layout Forge: ${args.brief}`,
              metadata: { url: server.url, sessionId: session.id },
            })

            // If questions were provided, block until first round submission
            if (args.questions && args.questions.length > 0) {
              const roundSession = await server.waitForRound()
              await handleRoundResult(roundSession)
              return formatToolResult(roundSession)
            }

            // No questions — return immediately for push-then-await pattern
            return [
              `Forge opened at ${server.url}`,
              `Session ID: ${session.id}`,
              "",
              "The forge is showing a loading state. Next steps:",
              "1. Generate questions using the orchestrator pattern",
              "2. Call layout_push_questions with the generated questions",
              "3. Call layout_await_completion to wait for the user's answers",
              "4. Process answers and either push more questions or call layout_close",
            ].join("\n")
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error)
            cleanupServer()
            return `Layout forge error: ${message}`
          }
        },
      }),

      layout_push_questions: tool({
        description: layoutPushQuestionsDescription,
        args: {
          questions: tool.schema
            .array(questionSchema)
            .describe("Array of questions to present to the user"),
        },
        async execute(args) {
          if (!activeServer) {
            return "No active layout forge session. Call layout_open_workbench first."
          }

          try {
            const res = await fetch(`${activeServer.url}/api/push-questions`, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "X-Session-Token": activeServer.token,
              },
              body: JSON.stringify({ questions: args.questions }),
            })

            if (!res.ok) {
              const errorBody = await res.text()
              return `Failed to push questions: ${res.status} ${errorBody}`
            }

            void client.app.log({
              body: {
                service: "layout-forge",
                level: "info",
                message: `Pushed ${args.questions.length} questions to layout forge`,
              },
            })

            return `Successfully pushed ${args.questions.length} questions to the layout forge. The user can now start answering. Call layout_await_completion to wait for their responses.`
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error)
            return `Failed to push questions: ${message}`
          }
        },
      }),

      layout_push_preview: tool({
        description: layoutPushPreviewDescription,
        args: {
          intent: layoutIntentSchema,
          preview: visualPreviewSchema,
        },
        async execute(args) {
          if (!activeServer) {
            return "No active layout forge session. Call layout_open_workbench first."
          }

          try {
            const res = await fetch(`${activeServer.url}/api/push-preview`, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "X-Session-Token": activeServer.token,
              },
              body: JSON.stringify({ intent: args.intent, preview: args.preview }),
            })

            if (!res.ok) {
              const errorBody = await res.text()
              return `Failed to push preview: ${res.status} ${errorBody}`
            }

            const state = await res.json() as { session: WorkbenchSession }
            return formatToolResult(state.session)
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error)
            return `Failed to push preview: ${message}`
          }
        },
      }),

      layout_build_prompt: tool({
        description: layoutBuildPromptDescription,
        args: {
          packet: tool.schema.object({
            summary: tool.schema.string().describe("Summary of all captured requirements"),
            approvedPreviewSummary: tool.schema.string().describe("Summary of the approved visual preview"),
            constraints: tool.schema.array(tool.schema.string()).describe("Fixed layout constraints"),
            avoid: tool.schema.array(tool.schema.string()).describe("Things to avoid in the layout"),
            outputFormat: tool.schema.string().describe("Output format description"),
          }).describe("The PromptPacket with exactly 5 fields"),
          renderedPrompt: tool.schema.string().describe("The fully rendered prompt text combining all PromptPacket fields"),
        },
        async execute(args) {
          if (!activeServer) {
            return "No active layout forge session. Call layout_open_workbench first."
          }

          try {
            const res = await fetch(`${activeServer.url}/api/build-prompt`, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "X-Session-Token": activeServer.token,
              },
              body: JSON.stringify({ packet: args.packet, renderedPrompt: args.renderedPrompt }),
            })

            if (!res.ok) {
              const errorBody = await res.text()
              return `Failed to build prompt: ${res.status} ${errorBody}`
            }

            const state = await res.json() as { session: WorkbenchSession }
            return formatToolResult(state.session)
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error)
            return `Failed to build prompt: ${message}`
          }
        },
      }),

      layout_await_completion: tool({
        description: layoutAwaitCompletionDescription,
        args: {},
        async execute() {
          if (!activeServer) {
            return "No active layout forge session. Call layout_open_workbench first."
          }

          try {
            const roundSession = await activeServer.waitForRound()
            await handleRoundResult(roundSession)
            return formatToolResult(roundSession)
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error)
            return `Layout forge error: ${message}`
          }
          // NOTE: Server is NOT cleaned up here. Use layout_close for that.
        },
      }),

      layout_push_message: tool({
        description: layoutPushMessageDescription,
        args: {
          content: tool.schema.string().describe("The message content to display to the user (plain text or markdown)"),
        },
        async execute(args) {
          if (!activeServer) {
            return "No active layout forge session. Call layout_open_workbench first."
          }

          try {
            const res = await fetch(`${activeServer.url}/api/push-message`, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "X-Session-Token": activeServer.token,
              },
              body: JSON.stringify({ content: args.content }),
            })

            if (!res.ok) {
              const errorBody = await res.text()
              return `Failed to push message: ${res.status} ${errorBody}`
            }

            return "Message pushed to the layout forge UI."
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error)
            return `Failed to push message: ${message}`
          }
        },
      }),

      layout_add_context_source: tool({
        description: layoutAddContextSourceDescription,
        args: {
          source: tool.schema.object({
            id: tool.schema.string().describe("Unique source ID"),
            type: tool.schema.enum(["file", "user-answer", "session-brief", "external-doc"]).describe("Source type"),
            path: tool.schema.string().optional().describe("File path if type is 'file'"),
            description: tool.schema.string().describe("What this source contains or represents"),
            addedAt: tool.schema.string().describe("ISO timestamp"),
          }).describe("Context source reference"),
        },
        async execute(args) {
          if (!activeServer) {
            return "No active layout forge session. Call layout_open_workbench first."
          }

          try {
            const res = await fetch(`${activeServer.url}/api/add-context-source`, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "X-Session-Token": activeServer.token,
              },
              body: JSON.stringify({ source: args.source }),
            })

            if (!res.ok) {
              const errorBody = await res.text()
              return `Failed to add context source: ${res.status} ${errorBody}`
            }

            return `Context source registered: [${args.source.type}] ${args.source.description}`
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error)
            return `Failed to add context source: ${message}`
          }
        },
      }),

      layout_close: tool({
        description: layoutCloseDescription,
        args: {},
        async execute() {
          if (!activeServer) {
            return "No active layout forge session."
          }

          // Phase guard: block close during prompt-ready
          try {
            const statusRes = await fetch(`${activeServer.url}/api/session`, {
              headers: { "X-Session-Token": activeServer.token },
            })
            if (statusRes.ok) {
              const state = await statusRes.json() as { phase?: string }
              if (state.phase === "prompt-ready") {
                return "Cannot close: the user is still reviewing the generated prompt in the browser. Wait for them to dismiss it first."
              }
            }
          } catch {
            // If session check fails, proceed with close anyway
          }

          try {
            const res = await fetch(`${activeServer.url}/api/close`, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "X-Session-Token": activeServer.token,
              },
            })

            if (!res.ok) {
              const errorBody = await res.text()
              return `Failed to close layout forge: ${res.status} ${errorBody}`
            }

            return "Layout forge session closed."
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error)
            return `Failed to close layout forge: ${message}`
          } finally {
            cleanupServer()
          }
        },
      }),
    },
  }
}
