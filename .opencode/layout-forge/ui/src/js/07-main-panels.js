    const renderMainPanel = () => {
      const activeIndex = getCurrentQuestionIndex()
      const isLastQuestion = activeIndex === state.applicableQuestions.length - 1

      if (state.refinementSent) {
        return `
          <section class="complete">
            <h2 class="question-label">Refinement request sent</h2>
            <p class="question-description">The AI is updating this question now. Keep this tab open and new questions will appear automatically.</p>
            <div class="complete-final">[ok] Waiting for updated questions...</div>
          </section>
        `
      }

      if (state.processing) {
        return renderProcessing()
      }

      if (state.finalized) {
        return renderCompletion()
      }
      if (state.waitingForQuestions) {
        return `
          <section class="question-wrap" style="min-height:360px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:16px;">
            <div class="skeleton" style="width:60%;height:24px;"></div>
            <div class="skeleton" style="width:40%;height:14px;"></div>
            <div style="display:grid;gap:10px;width:100%;margin-top:12px;">
              <div class="skeleton" style="height:52px;"></div>
              <div class="skeleton" style="height:52px;"></div>
              <div class="skeleton" style="height:52px;"></div>
            </div>
            <p class="muted" style="margin-top:8px;">AI is generating questions...</p>
          </section>
        `
      }

      if (!state.currentQuestion && state.progress.answered === state.progress.total) {
        return renderCompletion()
      }

      if (!state.currentQuestion) {
        return "<div class=\"empty-note\">No current question.</div>"
      }

      const nextLabel = isLastQuestion ? "Finish" : "Next"

      return `
        <section class="question-wrap" data-question-key="${escapeHtml(state.questionKey)}">
          <div class="question-header">
            <h1 class="question-label">${escapeHtml(state.currentQuestion.label)}</h1>
            ${(state.currentQuestion.type === "single-select" || state.currentQuestion.type === "multi-select")
              ? `<button class="toggle-mode-btn" data-action="toggle-select-mode" data-question-id="${escapeHtml(state.currentQuestion.id)}" title="Switch between single and multiple selection">${state.currentQuestion.type === "single-select" ? "Single \u2192 Multi" : "Multi \u2192 Single"}</button>`
              : ""}
          </div>
          ${state.currentQuestion.description ? `<p class="question-description">${escapeHtml(state.currentQuestion.description)}</p>` : ""}
          ${renderQuestionInput(state.currentQuestion)}
          <div class="actions">
            <button class="btn btn-add" data-action="open-refine-modal">Refine Options</button>
            <div>
              <button class="btn" data-action="back-prev" ${state.submitting || activeIndex <= 0 ? "disabled" : ""}>Back</button>
              <button class="btn btn-primary" data-action="submit-answer" ${state.submitting || !canSubmitCurrentAnswer() ? "disabled" : ""}>${nextLabel}</button>
            </div>
          </div>
        </section>
      `
    }

    const renderToasts = () => {
      toastWrap.innerHTML = state.errorMessage ? `<div class="toast">${escapeHtml(state.errorMessage)}</div>` : ""
    }

    const renderMessages = () => {
      if (!state.messages || state.messages.length === 0) {
        return ""
      }

      return `
        <div style="display: grid; gap: 12px; margin-bottom: 8px;">
          ${state.messages.map(msg => `
            <div style="border: 1px solid var(--border); border-radius: var(--radius); background: var(--bg-secondary); padding: 16px; line-height: 1.6;">
              <pre style="margin: 0; white-space: pre-wrap; word-break: break-word; overflow-x: auto; font-family: var(--font-mono); font-size: 14px; color: var(--text-primary); line-height: 1.45;">${escapeHtml(msg.content)}</pre>
            </div>
          `).join("")}
        </div>
      `
    }

    // Review Mode Functions
