import { describe, expect, test } from "bun:test"
import { exportMarkdownPlan, generateMarkdownPlan } from "../.opencode/plugins/lw/export"
import { formatToolResult } from "../.opencode/plugins/lw/format"
import type { WorkbenchSession } from "../.opencode/plugins/lw/types"

const COMPLETED_SESSION: WorkbenchSession = {
  id: "lw_test123",
  opencodeSessionId: "ses_abc",
  brief: "Design a user analytics dashboard",
  questions: [
    {
      id: "layout-mode",
      type: "single-select",
      label: "Layout Mode",
      options: [{ id: "three-column", label: "Three Column" }],
    },
    {
      id: "left-panel",
      type: "single-select",
      label: "Left Panel",
      options: [{ id: "tree", label: "Tree" }],
      dependsOn: { questionId: "layout-mode", operator: "neq", value: "center-focus" },
    },
    {
      id: "center-content",
      type: "multi-select",
      label: "Center Content",
      options: [
        { id: "cards", label: "Cards" },
        { id: "preview", label: "Preview" },
      ],
    },
  ],
  currentIndex: 2,
  answers: {
    "layout-mode": {
      questionId: "layout-mode",
      value: "three-column",
      answeredAt: "2026-03-06T10:00:00Z",
    },
    "left-panel": {
      questionId: "left-panel",
      value: "tree",
      answeredAt: "2026-03-06T10:01:00Z",
    },
    "center-content": {
      questionId: "center-content",
      value: ["cards", "preview"],
      answeredAt: "2026-03-06T10:02:00Z",
    },
  },
  history: [
    { questionId: "layout-mode", value: "three-column", answeredAt: "2026-03-06T10:00:00Z" },
    { questionId: "left-panel", value: "tree", answeredAt: "2026-03-06T10:01:00Z" },
    {
      questionId: "center-content",
      value: ["cards", "preview"],
      answeredAt: "2026-03-06T10:02:00Z",
    },
  ],
  messages: [],
  createdAt: "2026-03-06T10:00:00Z",
  updatedAt: "2026-03-06T10:05:00Z",
  status: "completed",
}

describe("format and export", () => {
  test("formatToolResult includes brief and answers for completed session", () => {
    const result = formatToolResult(COMPLETED_SESSION)

    expect(result).toContain(COMPLETED_SESSION.brief)
    expect(result).toContain("Layout Mode")
    expect(result).toContain("Three Column")
    expect(result).toContain("Center Content")
    expect(result).toContain("Cards, Preview")
    expect(result).toContain(COMPLETED_SESSION.id)
  })

  test("formatToolResult returns abandoned message for abandoned session", () => {
    const abandonedSession: WorkbenchSession = {
      ...COMPLETED_SESSION,
      status: "abandoned",
      messages: [],
    }

    const result = formatToolResult(abandonedSession)

    expect(result).toBe("사용자가 워크벤치를 중단했습니다.")
  })

  test("formatToolResult result is under 2048 characters", () => {
    const result = formatToolResult(COMPLETED_SESSION)
    expect(result.length).toBeLessThan(2048)
  })

  test("generateMarkdownPlan includes title, answers table, and metadata", () => {
    const markdown = generateMarkdownPlan(COMPLETED_SESSION)

    expect(markdown).toContain("# Layout Plan: Design a user analytics dashboard")
    expect(markdown).toContain("| Question | Answer | Time |")
    expect(markdown).toContain("| Layout Mode | Three Column | 2026-03-06T10:00:00Z |")
    expect(markdown).toContain("## Session Metadata")
    expect(markdown).toContain("- Session ID: lw_test123")
    expect(markdown).toContain("- Status: completed")
  })

  test("generateMarkdownPlan shows pending items when session is incomplete", () => {
    const incompleteSession: WorkbenchSession = {
      ...COMPLETED_SESSION,
      answers: {
        "layout-mode": COMPLETED_SESSION.answers["layout-mode"],
      },
      history: [COMPLETED_SESSION.history[0]],
      status: "active",
    }

    const markdown = generateMarkdownPlan(incompleteSession)

    expect(markdown).toContain("## Pending Questions")
    expect(markdown).toContain("- Left Panel")
    expect(markdown).toContain("- Center Content")
  })

  test("exportMarkdownPlan writes file under layout plans directory", async () => {
    const filePath = await exportMarkdownPlan(COMPLETED_SESSION, process.cwd())

    expect(filePath).toContain(".opencode/plans/layout/")
    expect(filePath).toContain("-layout-plan.md")
  })
})

describe("formatToolResult phase-aware output", () => {
  test("reviewing phase returns review guidance", () => {
    const session = {
      ...COMPLETED_SESSION,
      phase: "reviewing" as const,
      visualPreview: {
        id: "p1",
        title: "Test Layout",
        cols: 12,
        rows: 8,
        nodes: [],
        outline: [{ id: "o1", title: "Main", summary: "Main area" }],
        generatedAt: new Date().toISOString(),
      },
    }
    const result = formatToolResult(session)
    expect(result).toContain("Preview Ready for Review")
    expect(result).toContain("Approve Preview")
    expect(result).toContain("layout_await_completion")
    expect(result).not.toContain("Next Steps (MANDATORY)")
  })

  test("approved phase returns approval guidance", () => {
    const session = {
      ...COMPLETED_SESSION,
      phase: "approved" as const,
      approvedPreviewId: "p1",
    }
    const result = formatToolResult(session)
    expect(result).toContain("Preview Approved")
    expect(result).toContain("layout_build_prompt")
  })

  test("finished phase returns completion message", () => {
    const session = {
      ...COMPLETED_SESSION,
      phase: "finished" as const,
      renderedPrompt: "Build a dashboard with sidebar",
    }
    const result = formatToolResult(session)
    expect(result).toContain("Session Complete")
    expect(result).toContain("Build a dashboard with sidebar")
  })

  test("collecting phase (undefined) output unchanged", () => {
    const result = formatToolResult(COMPLETED_SESSION)
    expect(result).toContain("Next Steps (MANDATORY")
  })
})
