import type { Plugin } from "/home/noel/.config/opencode/skills/opencode-plugin-dev/opencode-ai/plugin"
import { tool } from "/home/noel/.config/opencode/skills/opencode-plugin-dev/opencode-ai/plugin"

import type { QuestionDefinition } from "./lw/types"
import { createSession } from "./lw/store"
import { startWorkbenchServer } from "./lw/server"
import type { WorkbenchServer } from "./lw/server"
import { formatToolResult } from "./lw/format"
import { exportMarkdownPlan } from "./lw/export"
import { openBrowser } from "./lw/browser"

interface LayoutWorkbenchPluginContext {
  client: {
    app: {
      log(input: { body: { service: string; level: string; message: string } }): unknown
    }
  }
  directory: string
}

interface LayoutWorkbenchArgs {
  brief: string
  questions: QuestionDefinition[]
}

interface LayoutWorkbenchToolContext {
  sessionID: string
  abort: AbortSignal
  metadata(input: { title?: string; metadata?: Record<string, unknown> }): void
}

export const LayoutWorkbenchPlugin: Plugin = async (ctx: LayoutWorkbenchPluginContext) => {
  const { client, directory } = ctx
  let activeServer: WorkbenchServer | null = null

  return {
    tool: {
      layout_open_workbench: tool({
        description:
          "Opens a browser-based layout workbench with the given questions. Returns the user's answers when the session is completed or abandoned.",
        args: {
          brief: tool.schema.string().describe("Brief description of what layout decisions are being made"),
          questions: tool.schema
            .array(
              tool.schema.object({
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
              }),
            )
            .describe("Array of questions to present to the user"),
        },
        async execute(args: LayoutWorkbenchArgs, context: LayoutWorkbenchToolContext) {
          if (activeServer) {
            return "A layout workbench session is already active. Complete or abandon it before starting a new one."
          }

          try {
            const session = createSession(
              context.sessionID,
              args.brief,
              args.questions as QuestionDefinition[],
            )

            const uiHtml = await Bun.file(`${import.meta.dir}/../layout-workbench/ui/index.html`).text()

            const baseDir = directory
            const server = await startWorkbenchServer(
              {
                session,
                baseDir,
                uiHtml,
                onLog: (msg) => {
                  void client.app.log({
                    body: { service: "layout-workbench", level: "info", message: msg },
                  })
                },
              },
              context.abort,
            )
            activeServer = server

            await openBrowser(server.url)

            context.metadata({
              title: `Layout Workbench: ${args.brief}`,
              metadata: { url: server.url, sessionId: session.id },
            })

            const completedSession = await server.waitForCompletion()

            if (completedSession.status === "completed") {
              const planPath = await exportMarkdownPlan(completedSession, baseDir)
              void client.app.log({
                body: {
                  service: "layout-workbench",
                  level: "info",
                  message: `Plan exported to ${planPath}`,
                },
              })
            }

            return formatToolResult(completedSession)
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error)
            return `Layout workbench error: ${message}`
          } finally {
            if (activeServer) {
              activeServer.stop()
              activeServer = null
            }
          }
        },
      }),
    },
  }
}
