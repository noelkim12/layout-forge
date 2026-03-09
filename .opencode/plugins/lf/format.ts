import { getApplicableQuestions } from "./graph"
import type { AnswerValue, QuestionDefinition, WorkbenchSession } from "./types"
import { buildAsciiPreview } from "./ascii"

const MAX_TOOL_RESULT_LENGTH = 2047

function stringifyAnswerValue(question: QuestionDefinition, value: AnswerValue): string {
  if (Array.isArray(value)) {
    if (!question.options || question.options.length === 0) {
      return value.join(", ")
    }

    return value
      .map((selectedId) => question.options?.find((option) => option.id === selectedId)?.label ?? selectedId)
      .join(", ")
  }

  if (typeof value === "string" && question.options && question.options.length > 0) {
    return question.options.find((option) => option.id === value)?.label ?? value
  }

  if (typeof value === "boolean") {
    return value ? "Yes" : "No"
  }

  return String(value)
}

function clampLength(input: string): string {
  if (input.length <= MAX_TOOL_RESULT_LENGTH) {
    return input
  }

  const tailBudget = Math.min(420, Math.floor(MAX_TOOL_RESULT_LENGTH / 3))
  const headBudget = MAX_TOOL_RESULT_LENGTH - tailBudget - 3
  return `${input.slice(0, headBudget)}...${input.slice(-tailBudget)}`
}

function formatContextBoundaries(session: WorkbenchSession): string[] {
  const sources = session.contextSources
  if (!sources || sources.length === 0) {
    return [
      ``,
      `## Context Boundaries`,
      `Use ONLY the requirements collected in this session and any files explicitly linked by the user.`,
      `Do NOT reference or incorporate information from unrelated codebase documents.`,
    ]
  }
  return [
    ``,
    `## Context Boundaries`,
    `Use ONLY the following sources as ground truth:`,
    ...sources.map((s) => `- [${s.type}] ${s.description}${s.path ? ` (${s.path})` : ""}`),
    ``,
    `Do NOT reference or incorporate information from documents not listed above.`,
  ]
}


export function formatToolResult(session: WorkbenchSession): string {
  const preview = buildAsciiPreview(session)
  const legendLines = preview.legend.map(
    (item) => `- [${item.number}] ${item.title}: ${item.summary} (${item.status})`,
  )

  // Phase-aware output for review/preview phases
  if (session.phase === "reviewing") {
    const preview = session.visualPreview
    const contextLines = formatContextBoundaries(session)
    const lines = [
      `## Preview Ready for Review`,
      ``,
      `**Preview**: ${preview?.title ?? "Untitled"}`,
      `**Regions**: ${preview?.nodes.length ?? 0} layout regions`,
      ``,
      `## Outline`,
      ...(preview?.outline.map(o => `- **${o.title}**: ${o.summary}`) ?? ["- (no outline)"]),
      ``,
      `## Requirements Captured`,
      `${session.requirementLedger?.length ?? 0} requirements accumulated across ${session.requirementSnapshots?.length ?? 0} rounds`,
      ``,
      `## Available Review Actions`,
      `- **Approve Preview** — Accept this layout and proceed to prompt generation`,
      `- **Revise Selected Area** — Request changes to a specific region`,
      `- **Need More Questions** — Return to collecting mode for more requirements`,
      `- **Finish Without Prompt** — End session without generating a prompt`,
      ...contextLines,
      ``,
      `The user is reviewing the preview in the browser. Call layout_await_completion to wait for their review action.`,
      ``,
      `Session ID: ${session.id}`,
    ]
    return clampLength(lines.join("\n"))
  }

  if (session.phase === "approved") {
    const contextLines = formatContextBoundaries(session)
    const promptRequestLines = session.promptSuggestionRequestedAt
      ? [
          ``,
          `**Prompt Suggestion Request**: Received at ${session.promptSuggestionRequestedAt}`,
          `Generate the prompt by following Step 7 guidance (rich structure, explicit constraints, acceptance criteria), then call layout_build_prompt.`,
        ]
      : []

    const lines = [
      `## Preview Approved`,
      ``,
      `**Approved Preview**: ${session.visualPreview?.title ?? "Untitled"}`,
      `**Approved Preview ID**: ${session.approvedPreviewId}`,
      ``,
      `The preview has been approved. Next steps:`,
      `1. Call layout_build_prompt with a PromptPacket to generate the final prompt, OR`,
      `2. Call layout_close to finish without a prompt.`,
      ...promptRequestLines,
      ...contextLines,
      ``,
      `Session ID: ${session.id}`,
    ]
    return clampLength(lines.join("\n"))
  }
  if (session.phase === "prompt-ready") {
    const contextLines = formatContextBoundaries(session)
    const lines = [
      `## Prompt Ready for Review`,
      ``,
      `The generated prompt is now displayed in the browser for the user to review, copy, or download.`,
      ``,
      `**DO NOT** call layout_close — the user is still reviewing the prompt.`,
      `**DO NOT** output the prompt in chat — it is already visible in the browser.`,
      ``,
      `Wait for the user to dismiss the prompt in the browser. The session will transition to "finished" automatically.`,
      ...contextLines,
      ``,
      `Session ID: ${session.id}`,
    ]
    return clampLength(lines.join("\n"))
  }

  if (session.phase === "finished") {
    const lines = [
      `## Session Complete`,
      ``,
      `The user has finished reviewing. You may now call layout_close to clean up.`,
      ``,
      `Session ID: ${session.id}`,
    ]
    return clampLength(lines.join("\n"))
  }

  if (session.status === "abandoned") {
    return "사용자가 레이아웃 포지를 중단했습니다."
  }

  if (session.status === "refinement_requested" && session.refinementRequest) {
    const req = session.refinementRequest
    const refinementLines = [
      `## Refinement Requested`,
      "",
      `**Question**: ${req.questionLabel}`,
      `**User Intent**: ${req.userIntent}`,
    ]

    if (req.currentOptions && req.currentOptions.length > 0) {
      refinementLines.push("", "**Current Options**:")
      for (const opt of req.currentOptions) {
        refinementLines.push(`- ${opt.label}${opt.description ? `: ${opt.description}` : ""}`)
      }
    }

    const refApplicable = getApplicableQuestions(session.questions, session.answers)
    const refAnswered = refApplicable
      .filter((question) => session.answers[question.id] !== undefined)
      .map((question) => {
        const answer = session.answers[question.id]
        const value = stringifyAnswerValue(question, answer.value)
        return `- ${question.label}: ${value}`
      })

    if (refAnswered.length > 0) {
      refinementLines.push("", "## Previous Answers", ...refAnswered)
    }

    refinementLines.push(
      "",
      "## Numbered ASCII Layout",
      "```text",
      preview.diagram,
      "```",
      "",
      "## Legend",
      ...legendLines,
      "",
      "Provide feedback by section number. Example: I want section [3] to be wider.",
    )

    refinementLines.push("", `Session ID: ${session.id}`)

    return clampLength(refinementLines.join("\n"))
  }

  const applicableQuestions = getApplicableQuestions(session.questions, session.answers)
  const answeredLines = applicableQuestions
    .filter((question) => session.answers[question.id] !== undefined)
    .map((question) => {
      const answer = session.answers[question.id]
      const value = stringifyAnswerValue(question, answer.value)
      return `- ${question.label}: ${value}`
    })

  const unansweredLines = applicableQuestions
    .filter((question) => session.answers[question.id] === undefined)
    .map((question) => `- ${question.label}`)

  const lines = [
    `## Brief`,
    session.brief,
    "",
    "## Answers",
    ...(answeredLines.length > 0 ? answeredLines : ["- (none)"]),
    "",
    "## Numbered ASCII Layout",
    "```text",
    preview.diagram,
    "```",
    "",
    "## Legend",
    ...legendLines,
    "",
    "Provide feedback by section number. Example: I want section [2] to be more compact.",
  ]

  if (unansweredLines.length > 0) {
    lines.push("", "## Unanswered Questions", ...unansweredLines)
  }

  lines.push(
    "",
    "## Next Steps (MANDATORY — do NOT skip)",
    "1. Push the layout proposal as a message to the forge using layout_push_message (include the ASCII diagram and a summary of key decisions).",
    "2. Push a feedback question round using layout_push_questions with a single-select question asking: 'Does this layout match your vision?' with options like 'Approve — looks good', 'Needs changes — I have feedback', etc.",
    "3. Call layout_await_completion to wait for the user's response.",
    "4. If the user requests changes, refine and repeat from step 1.",
    "5. Only call layout_close AFTER the user explicitly approves the layout.",
    "",
    "CRITICAL: Do NOT call layout_close before the user has reviewed and approved the layout.",
  )

  lines.push("", `Session ID: ${session.id}`)

  return clampLength(lines.join("\n"))
}
