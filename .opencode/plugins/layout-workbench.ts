import type { Plugin } from "@opencode-ai/plugin"
import { tool } from "@opencode-ai/plugin"

import { createSession } from "./lw/store"
import { startWorkbenchServer } from "./lw/server"
import type { WorkbenchServer } from "./lw/server"
import { formatToolResult } from "./lw/format"
import { exportMarkdownPlan } from "./lw/export"
import type { WorkbenchSession } from "./lw/types"
import { openBrowser } from "./lw/browser"

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

export const LayoutWorkbenchPlugin: Plugin = async (ctx) => {
  const { client, directory } = ctx
  let activeServer: WorkbenchServer | null = null

  const startServer = async (
    session: ReturnType<typeof createSession>,
    abortSignal?: AbortSignal,
  ) => {
    const uiHtml = await Bun.file(`${import.meta.dir}/../layout-workbench/ui/index.html`).text()

    const server = await startWorkbenchServer(
      {
        session,
        baseDir: directory,
        uiHtml,
        onLog: (msg) => {
          void client.app.log({
            body: { service: "layout-workbench", level: "info", message: msg },
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
          service: "layout-workbench",
          level: "info",
          message: `Plan exported to ${planPath}`,
        },
      })
    } else if (session.status === "refinement_requested") {
      void client.app.log({
        body: {
          service: "layout-workbench",
          level: "info",
          message: `Refinement requested for question: ${session.refinementRequest?.questionLabel}`,
        },
      })
    }
  }

  return {
    tool: {
      layout_open_workbench: tool({
        description:
          "Opens a browser-based layout workbench for visual UI layout decisions. Questions should focus on what the user sees on screen — page structure, component placement, navigation patterns, spacing, and responsive behavior. NOT for technical decisions like framework choice, build tools, or state management. IMPORTANT: All question labels, option labels, descriptions, and any text that may appear inside ASCII layout diagrams MUST be written in English regardless of the user's language — this is required for proper monospace ASCII art alignment. If questions are provided, blocks until the user completes the first round. If questions are omitted, opens the workbench with a loading state and returns immediately — use layout_push_questions to populate and layout_await_completion to wait.",
        args: {
          brief: tool.schema.string().describe("Brief description of what visual UI layout is being designed (e.g. 'Dashboard page layout', 'Settings panel structure'). Must describe a screen or visual component, not a project."),
          questions: tool.schema
            .array(questionSchema)
            .optional()
            .describe("Array of questions to present to the user. Omit to open with loading state for later push."),
        },
        async execute(args, context) {
          if (activeServer) {
            return "A layout workbench session is already active. Complete or abandon it before starting a new one."
          }

          const questions = args.questions ?? []
          const session = createSession(context.sessionID, args.brief, questions)

          try {
            const server = await startServer(session, context.abort)

            context.metadata({
              title: `Layout Workbench: ${args.brief}`,
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
              `Workbench opened at ${server.url}`,
              `Session ID: ${session.id}`,
              "",
              "The workbench is showing a loading state. Next steps:",
              "1. Generate questions using the orchestrator pattern",
              "2. Call layout_push_questions with the generated questions",
              "3. Call layout_await_completion to wait for the user's answers",
              "4. Process answers and either push more questions or call layout_close",
            ].join("\n")
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error)
            cleanupServer()
            return `Layout workbench error: ${message}`
          }
        },
      }),

      layout_push_questions: tool({
        description:
          "Pushes questions to an already-open layout workbench. The workbench UI will transition from loading/processing state to showing the questions. Can be called multiple times for multi-round flows. Call layout_await_completion after this to wait for user answers. IMPORTANT: All question labels, option labels, and descriptions MUST be in English for proper ASCII diagram alignment.",
        args: {
          questions: tool.schema
            .array(questionSchema)
            .describe("Array of questions to present to the user"),
        },
        async execute(args) {
          if (!activeServer) {
            return "No active workbench session. Call layout_open_workbench first."
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
                service: "layout-workbench",
                level: "info",
                message: `Pushed ${args.questions.length} questions to workbench`,
              },
            })

            return `Successfully pushed ${args.questions.length} questions to the workbench. The user can now start answering. Call layout_await_completion to wait for their responses.`
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error)
            return `Failed to push questions: ${message}`
          }
        },
      }),

      layout_push_preview: tool({
        description: "Pushes a visual preview to the workbench for user review. The preview consists of a LayoutIntent (structured layout decisions) and a VisualPreview (grid-based node layout). This atomically commits current requirements, sets the preview, and transitions to review mode. Call layout_await_completion after this to wait for user review action (approve/revise/more questions/finish).",
        args: {
          intent: layoutIntentSchema,
          preview: visualPreviewSchema,
        },
        async execute(args) {
          if (!activeServer) {
            return "No active workbench session. Call layout_open_workbench first."
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
        description: "Generates a PromptPacket from the approved preview and requirements. Only callable after preview approval (phase === 'approved'). Transitions session to finished phase. The LLM builds the PromptPacket from session context; this tool submits it to the server.",
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
            return "No active workbench session. Call layout_open_workbench first."
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
        description:
          "Blocks until the user submits their answers for the current round, requests refinement, or abandons the session. The workbench server stays alive after this returns — you can push more questions or a message, then await again. Call layout_close when fully done.",
        args: {},
        async execute() {
          if (!activeServer) {
            return "No active workbench session. Call layout_open_workbench first."
          }

          try {
            const roundSession = await activeServer.waitForRound()
            await handleRoundResult(roundSession)
            return formatToolResult(roundSession)
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error)
            return `Layout workbench error: ${message}`
          }
          // NOTE: Server is NOT cleaned up here. Use layout_close for that.
        },
      }),

      layout_push_message: tool({
        description:
          "Pushes a text message to the workbench browser UI. Use this to show intermediate results, layout proposals, or status updates to the user while they remain in the browser. After pushing a layout proposal, you MUST follow up with layout_push_questions to ask the user for approval/feedback, then call layout_await_completion. Do NOT call layout_close immediately after pushing a message.",
        args: {
          content: tool.schema.string().describe("The message content to display to the user (plain text or markdown)"),
        },
        async execute(args) {
          if (!activeServer) {
            return "No active workbench session. Call layout_open_workbench first."
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

            return "Message pushed to the workbench UI."
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error)
            return `Failed to push message: ${message}`
          }
        },
      }),

      layout_close: tool({
        description:
          "Closes the layout workbench session and stops the server. IMPORTANT: Only call this AFTER the user has explicitly approved the layout. The typical flow is: push layout message → push feedback questions → await user approval → close. Do NOT call this immediately after pushing a layout proposal without getting user feedback first.",
        args: {},
        async execute() {
          if (!activeServer) {
            return "No active workbench session."
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
              return `Failed to close workbench: ${res.status} ${errorBody}`
            }

            return "Workbench session closed."
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error)
            return `Failed to close workbench: ${message}`
          } finally {
            cleanupServer()
          }
        },
      }),
    },
  }
}
