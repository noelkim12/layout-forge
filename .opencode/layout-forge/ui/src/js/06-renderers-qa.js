    const renderSkeleton = () => `
      <div class="forge">
        <aside class="sidebar panel">
          <p class="section-title">Step List</p>
          <div class="steps">
            <div class="skeleton"></div>
            <div class="skeleton"></div>
            <div class="skeleton"></div>
            <div class="skeleton"></div>
            <div class="skeleton"></div>
          </div>
        </aside>
        <main class="main panel">
          <div class="skeleton" style="height:26px;"></div>
          <div class="skeleton" style="height:14px;"></div>
          <div class="skeleton" style="height:48px;"></div>
          <div class="skeleton" style="height:48px;"></div>
          <div class="skeleton" style="height:48px;"></div>
        </main>
        <aside class="info panel">
          <div class="skeleton" style="height:8px;"></div>
          <div class="skeleton" style="height:14px;margin-top:8px;"></div>
          <div class="skeleton" style="height:72px;margin-top:14px;"></div>
        </aside>
      </div>
    `

    const renderSteps = () => {
      const activeIndex = getCurrentQuestionIndex()

      if (state.waitingForQuestions) {
        return `
          <div class="steps">
            <div class="skeleton" style="height:42px;"></div>
            <div class="skeleton" style="height:42px;"></div>
            <div class="skeleton" style="height:42px;"></div>
            <div class="skeleton" style="height:42px;"></div>
          </div>
          <p class="muted" style="margin-top:8px;">Generating steps...</p>
        `
      }

      if (!state.applicableQuestions.length) {
        return "<p class=\"empty-note\">No applicable questions.</p>"
      }

      return `<div class="steps">${state.applicableQuestions.map((question, index) => {
        const answered = answerExists(question.id)
        const isActive = activeIndex === index
        const clickable = answered && !isActive
        const status = answered ? "done" : (isActive ? "active" : "next")
        const statusGlyph = answered ? "[x]" : (isActive ? "[>]" : "[ ]")

        return `
          <button
            class="step ${isActive ? "is-active" : ""} ${clickable ? "step-clickable" : ""}"
            data-action="goto-step"
            data-index="${index}"
            ${clickable ? "" : "disabled"}
            title="${clickable ? "Go back to this step" : "Step unavailable"}"
          >
            <div class="step-row">
              <span>${index + 1}. ${statusGlyph}</span>
              <span class="step-status">${status}</span>
            </div>
            <div class="step-label">${escapeHtml(question.label)}</div>
          </button>
        `
      }).join("")}</div>`
    }

    const renderSingleSelect = (question) => {
      const options = Array.isArray(question.options) ? question.options : []
      const isCustomSelected = state.activeAnswer && !options.find(o => o.id === state.activeAnswer)
      const customValue = isCustomSelected ? state.activeAnswer : ""

      return `
        <div class="choices">
          ${options.map((option, index) => {
            const selected = state.activeAnswer === option.id
            return `
              <button
                class="choice ${selected ? "selected" : ""}"
                data-action="select-single"
                data-value="${escapeHtml(option.id)}"
                type="button"
              >
                <span class="choice-indicator"></span>
                <span>
                  <span class="choice-title">${index + 1}. ${escapeHtml(option.label)}</span>
                  ${option.description ? `<span class="choice-description">${escapeHtml(option.description)}</span>` : ""}
                </span>
              </button>
            `
          }).join("")}
          <label class="choice ${isCustomSelected ? "selected" : ""}" style="cursor: text;">
            <span class="choice-indicator"></span>
            <div style="flex: 1; display: flex; flex-direction: column; gap: 4px;">
              <span class="choice-title">직접 입력</span>
              <input type="text" class="field" data-action="input-custom-single" value="${escapeHtml(customValue)}" placeholder="Type your custom answer..." style="margin-top: 4px; padding: 6px 10px; font-size: 13px;">
            </div>
          </label>
        </div>
      `
    }

    const renderMultiSelect = (question) => {
      const selectedValues = Array.isArray(state.activeAnswer) ? state.activeAnswer : []
      const options = Array.isArray(question.options) ? question.options : []

      const customValues = selectedValues.filter(val => !options.find(o => o.id === val))
      const customValue = customValues.length > 0 ? customValues[0] : ""
      const isCustomSelected = customValues.length > 0

      return `
        <div class="choices">
          ${options.map((option) => {
            const selected = selectedValues.includes(option.id)
            return `
              <button
                class="choice ${selected ? "selected" : ""}"
                data-action="toggle-multi"
                data-value="${escapeHtml(option.id)}"
                type="button"
              >
                <span class="choice-indicator checkbox"></span>
                <span>
                  <span class="choice-title">${escapeHtml(option.label)}</span>
                  ${option.description ? `<span class="choice-description">${escapeHtml(option.description)}</span>` : ""}
                </span>
              </button>
            `
          }).join("")}
          <label class="choice ${isCustomSelected ? "selected" : ""}" style="cursor: text;">
            <span class="choice-indicator checkbox"></span>
            <div style="flex: 1; display: flex; flex-direction: column; gap: 4px;">
              <span class="choice-title">직접 입력</span>
              <input type="text" class="field" data-action="input-custom-multi" value="${escapeHtml(customValue)}" placeholder="Type your custom answer..." style="margin-top: 4px; padding: 6px 10px; font-size: 13px;">
            </div>
          </label>
        </div>
      `
    }

    const renderTextQuestion = (question) => {
      const value = typeof state.activeAnswer === "string" ? state.activeAnswer : ""
      const needsTextarea = /long|detail|describe|explain|context|summary|paragraph|notes?/i.test(question.description || "")

      if (needsTextarea) {
        return `<textarea class="textarea" data-action="input-text" placeholder="Type your response...">${escapeHtml(value)}</textarea>`
      }

      return `<input class="field" data-action="input-text" type="text" value="${escapeHtml(value)}" placeholder="Type your response">`
    }

    const renderSliderQuestion = (question) => {
      const min = typeof question.min === "number" ? question.min : 0
      const max = typeof question.max === "number" ? question.max : 100
      const step = typeof question.step === "number" ? question.step : 1
      const value = typeof state.activeAnswer === "number" ? state.activeAnswer : min

      return `
        <div class="slider-row">
          <div class="slider-meta"><span>Range</span><span>${min} - ${max}</span></div>
          <div class="slider-value">${value}</div>
          <input class="range" data-action="input-slider" type="range" min="${min}" max="${max}" step="${step}" value="${value}">
        </div>
      `
    }

    const renderToggleQuestion = () => {
      const enabled = Boolean(state.activeAnswer)
      return `
        <div class="toggle-card">
          <div>
            <div class="choice-title">Toggle value</div>
            <div class="choice-description">Use this switch to choose on/off</div>
          </div>
          <button type="button" class="toggle-switch ${enabled ? "is-on" : ""}" data-action="toggle-boolean" aria-pressed="${enabled}"></button>
        </div>
      `
    }

    const renderQuestionInput = (question) => {
      if (question.type === "single-select") {
        return renderSingleSelect(question)
      }

      if (question.type === "multi-select") {
        return renderMultiSelect(question)
      }

      if (question.type === "text") {
        return renderTextQuestion(question)
      }

      if (question.type === "slider") {
        return renderSliderQuestion(question)
      }

      return renderToggleQuestion(question)
    }

    const renderHistory = () => {
      if (!state.session || !Array.isArray(state.session.history) || state.session.history.length === 0) {
        return "<p class=\"empty-note\">No decisions yet.</p>"
      }

      const recent = state.session.history.slice(-8).reverse()
      return `<div class="history">${recent.map((item) => {
        const question = state.session.questions.find((entry) => entry.id === item.questionId)
        const label = question ? question.label : item.questionId
        const answerText = question ? formatAnswerValue(question, item.value) : String(item.value)

        return `
          <div class="history-item">
            <div class="history-question">${escapeHtml(label)}</div>
            <div class="history-answer">${escapeHtml(answerText)}</div>
          </div>
        `
      }).join("")}</div>`
    }

    const canSubmitCurrentAnswer = () => {
      if (!state.currentQuestion) {
        return false
      }

      if (state.currentQuestion.type === "single-select") {
        return Boolean(state.activeAnswer)
      }

      if (state.currentQuestion.type === "multi-select") {
        return Array.isArray(state.activeAnswer) && state.activeAnswer.length > 0
      }

      if (state.currentQuestion.type === "text") {
        return typeof state.activeAnswer === "string" && state.activeAnswer.trim().length > 0
      }

      if (state.currentQuestion.type === "slider") {
        return typeof state.activeAnswer === "number"
      }

      if (state.currentQuestion.type === "toggle") {
        return typeof state.activeAnswer === "boolean"
      }

      return false
    }

    const renderProcessing = () => {
      const answers = state.session?.answers || {}
      const list = state.applicableQuestions.map((question) => {
        const answer = answers[question.id]
        const formatted = answer ? formatAnswerValue(question, answer.value) : "-"
        return `
          <li class="complete-item">
            <span class="complete-label">${escapeHtml(question.label)}</span>
            <span class="complete-value">${escapeHtml(formatted)}</span>
          </li>
        `
      }).join("")

      return `
        <section class="complete">
          <div style="display: flex; align-items: center; gap: 12px; margin-bottom: 16px;">
            <div class="skeleton" style="width: 24px; height: 24px; border-radius: 50%; margin: 0; animation: pulse 1s linear infinite;"></div>
            <h2 class="question-label" style="margin: 0;">AI가 응답을 처리하고 있습니다...</h2>
          </div>
          <p class="question-description">Please wait while the AI processes your answers.</p
          <ul class="complete-list">${list || "<li class=\"empty-note\">No answers recorded.</li>"}</ul>
        </section>
      `
    }

    const renderCompletion = () => {
      const answers = state.session?.answers || {}
      const list = state.applicableQuestions.map((question) => {
        const answer = answers[question.id]
        const formatted = answer ? formatAnswerValue(question, answer.value) : "-"
        return `
          <li class="complete-item">
            <span class="complete-label">${escapeHtml(question.label)}</span>
            <span class="complete-value">${escapeHtml(formatted)}</span>
          </li>
        `
      }).join("")

      if (state.finalized) {
        return `
          <section class="complete">
            <h2 class="question-label">Session Complete</h2>
            <p class="question-description">All rounds have been completed.</p>
            <ul class="complete-list">${list || "<li class=\"empty-note\">No answers recorded.</li>"}</ul>
            <div class="complete-final">[ok] Session complete. You can close this tab.</div>
          </section>
        `
      }

      return `
        <section class="complete">
          <h2 class="question-label">All decisions collected</h2>
          <p class="question-description">Review your answers, then submit to continue.</p>
          <ul class="complete-list">${list || "<li class=\"empty-note\">No answers recorded.</li>"}</ul>
          <div class="actions">
            <button class="btn btn-primary" data-action="submit-round" ${state.submitting ? "disabled" : ""}>Submit</button>
            <span class="muted">Session: ${escapeHtml(SESSION_ID)}</span>
          </div>
        </section>
      `
    }

    const renderRefineModal = () => {
      if (!state.refineModal.open) {
        return ""
      }

      const questionLabel = state.currentQuestion ? escapeHtml(state.currentQuestion.label) : ""

      return `
        <div class="modal" role="dialog" aria-modal="true" aria-label="Refine Options">
          <form class="modal-panel" id="refine-form">
            <h3 class="modal-title">Refine This Question</h3>
            <div class="modal-row">
              <label class="field-label">Current Question</label>
              <div style="padding:8px 12px;border:1px solid var(--border);border-radius:var(--radius);background:var(--bg-primary);color:var(--text-secondary);font-size:14px;">${questionLabel}</div>
            </div>
            <div class="modal-row">
              <label class="field-label" for="refine-intent">What would you like changed?</label>
              <textarea id="refine-intent" class="textarea" data-action="refine-intent" placeholder="Describe what options you need, what's missing, or how the question should be different..." style="min-height:120px;">${escapeHtml(state.refineModal.userIntent)}</textarea>
            </div>
            <div class="modal-actions">
              <button type="button" class="btn" data-action="close-refine-modal">Cancel</button>
              <button type="submit" class="btn btn-primary" ${state.submitting || !state.refineModal.userIntent.trim() ? "disabled" : ""}>Send to AI</button>
            </div>
          </form>
        </div>
      `
    }

    const renderPromptModal = () => {
      if (!state.promptModal.open) return ""
      const phase = state.session?.phase

      return `
        <div class="modal prompt-modal" role="dialog" aria-modal="true" aria-label="Generated Prompt">
          <div class="modal-panel" style="max-width: 700px; max-height: 80vh; overflow-y: auto;">
            <h3 class="modal-title">Generated Layout Prompt</h3>
            <div class="modal-row">
              <pre class="prompt-text">${escapeHtml(state.promptModal.text)}</pre>
            </div>
            <div class="modal-actions">
              ${phase === "prompt-ready" ? `
                <button class="btn btn-primary" data-action="dismiss-prompt">Done — Close Session</button>
              ` : `
                <button class="btn" data-action="close-prompt-modal">Close</button>
              `}
              <button class="btn" data-action="download-layout-artifacts">Download Layout + Prompt</button>
              <button class="btn btn-primary" data-action="copy-prompt-to-clipboard">Copy to Clipboard</button>
            </div>
          </div>
        </div>
      `
    }

