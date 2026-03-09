    const setErrorToast = (message) => {
      if (!message) {
        return
      }

      state.errorMessage = message
      renderToasts()
      window.setTimeout(() => {
        state.errorMessage = ""
        renderToasts()
      }, 3000)
    }

    const isReviewInteractionLocked = () => {
      return Boolean(state.promptSuggestionPending || state.session?.phase === "prompt-ready")
    }

    const escapeHtml = (value) => String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;")

    const optionLabelById = (question, optionId) => {
      if (!question || !Array.isArray(question.options)) {
        return optionId
      }

      const option = question.options.find((entry) => entry.id === optionId)
      return option ? option.label : optionId
    }

    const formatAnswerValue = (question, rawValue) => {
      if (rawValue === undefined || rawValue === null) {
        return "-"
      }

      if (question.type === "toggle") {
        return rawValue ? "On" : "Off"
      }

      if (Array.isArray(rawValue)) {
        return rawValue.map((item) => optionLabelById(question, item)).join(", ")
      }

      if (typeof rawValue === "string" && (question.type === "single-select" || question.type === "multi-select")) {
        return optionLabelById(question, rawValue)
      }

      return String(rawValue)
    }

    const answerExists = (questionId) => Boolean(state.session?.answers?.[questionId])

    const getCurrentQuestionIndex = () => {
      if (!state.currentQuestion) {
        return -1
      }

      return state.applicableQuestions.findIndex((question) => question.id === state.currentQuestion.id)
    }

    const makeQuestionId = () => `user_q_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`

    async function api(path, method = "GET", body = null) {
      const res = await fetch(path, {
        method,
        headers: { "Content-Type": "application/json", "X-Session-Token": SESSION_TOKEN },
        body: body ? JSON.stringify(body) : null,
      })
      if (!res.ok) {
        throw new Error(`API error: ${res.status}`)
      }
      return res.json()
    }

    const isSessionPayload = (payload) => {
      if (!payload || typeof payload !== "object") {
        return false
      }

      return (
        "session" in payload
        && "currentQuestion" in payload
        && "applicableQuestions" in payload
        && "progress" in payload
      )
    }

