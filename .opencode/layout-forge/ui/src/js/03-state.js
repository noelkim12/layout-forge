    const syncDraftFromCurrentQuestion = () => {
      if (!state.currentQuestion || !state.session) {
        state.activeAnswer = null
        return
      }

      const existing = state.session.answers[state.currentQuestion.id]
      const value = existing ? existing.value : state.currentQuestion.defaultValue

      if (state.currentQuestion.type === "multi-select") {
        if (Array.isArray(value)) {
          state.activeAnswer = [...value]
        } else {
          state.activeAnswer = []
        }
        return
      }

      if (state.currentQuestion.type === "toggle") {
        state.activeAnswer = Boolean(value)
        return
      }

      if (state.currentQuestion.type === "slider") {
        const fallback = typeof state.currentQuestion.min === "number" ? state.currentQuestion.min : 0
        const sliderValue = typeof value === "number" ? value : fallback
        state.activeAnswer = sliderValue
        return
      }

      if (value === undefined || value === null) {
        state.activeAnswer = ""
        return
      }

      state.activeAnswer = value
    }

    const applySessionPayload = (payload) => {
      const hadPendingPromptSuggestion = state.promptSuggestionPending
      state.session = payload.session
      state.currentQuestion = payload.currentQuestion
      state.applicableQuestions = Array.isArray(payload.applicableQuestions) ? payload.applicableQuestions : []
      state.progress = payload.progress || { answered: 0, total: 0, percentage: 0 }
      state.layoutPreview = payload.layoutPreview || null
      state.finalized = payload.session && payload.session.status === "completed"
      state.processing = payload.session && payload.session.status === "processing"
      state.refinementSent = payload.session && payload.session.status === "refinement_requested"
      state.messages = payload.session && payload.session.messages ? payload.session.messages : []
      if (payload.session?.promptSuggestionRequestedAt) {
        state.promptSuggestionPending = true
      }

      // Deterministic prompt modal: show when phase is prompt-ready and renderedPrompt exists
      const generatedPrompt = typeof payload.session?.renderedPrompt === "string"
        ? payload.session.renderedPrompt
        : ""
      if (payload.session?.phase === "prompt-ready" && generatedPrompt.trim().length > 0) {
        state.promptSuggestionPending = false
        state.promptModal = { open: true, text: generatedPrompt }
        if (hadPendingPromptSuggestion) {
          setErrorToast("Prompt suggestion generated following Step 7 guidance.")
        }
        if (!state.promptAutoCloseDone && !state.promptAutoCloseInFlight) {
          void autoCloseSessionAfterPromptReady()
        }
      }

      // Detect waiting-for-questions state
      const hasQuestions = state.session && Array.isArray(state.session.questions) && state.session.questions.length > 0
      state.waitingForQuestions = !hasQuestions && state.session && state.session.status === "active"

      const newQuestionKey = state.currentQuestion ? state.currentQuestion.id : "complete"
      if (newQuestionKey !== state.questionKey) {
        state.questionKey = newQuestionKey
        syncDraftFromCurrentQuestion()
      }

      // Start or stop polling based on waiting state or processing state
      if (state.waitingForQuestions || state.processing || state.refinementSent || state.promptSuggestionPending || payload.session?.phase === "prompt-ready") {
        startPolling()
      } else {
        stopPolling()
      }

      render()
    }

    const startPolling = () => {
      if (state.pollTimer) return
      state.pollTimer = window.setInterval(async () => {
        try {
          const payload = await api("/api/session")
          const currentStatus = state.session?.status
          const newStatus = payload.session?.status
          const currentPhase = state.session?.phase
          const newPhase = payload.session?.phase
          const currentMessagesCount = state.messages?.length || 0
          const newMessagesCount = payload.session?.messages?.length || 0
          const currentQuestionsCount = state.session?.questions?.length || 0
          const newQuestionsCount = payload.session?.questions?.length || 0
          const hasVisualPreview = Boolean(state.session?.visualPreview)
          const newHasVisualPreview = Boolean(payload.session?.visualPreview)
          const hasRenderedPrompt = Boolean(state.session?.renderedPrompt)
          const newHasRenderedPrompt = Boolean(payload.session?.renderedPrompt)
          const currentPromptSuggestionRequestedAt = state.session?.promptSuggestionRequestedAt || ""
          const newPromptSuggestionRequestedAt = payload.session?.promptSuggestionRequestedAt || ""

          if (
            currentStatus !== newStatus
            || currentPhase !== newPhase
            || currentMessagesCount !== newMessagesCount
            || currentQuestionsCount !== newQuestionsCount
            || hasVisualPreview !== newHasVisualPreview
            || hasRenderedPrompt !== newHasRenderedPrompt
            || currentPromptSuggestionRequestedAt !== newPromptSuggestionRequestedAt
          ) {
            applySessionPayload(payload)
          }
        } catch (error) {
          console.error("Poll error:", error)
        }
      }, 1500)
    }

    const stopPolling = () => {
      if (state.pollTimer) {
        window.clearInterval(state.pollTimer)
        state.pollTimer = null
      }
    }

    const loadSession = async () => {
      state.loading = true
      render()

      try {
        const payload = await api("/api/session")
        applySessionPayload(payload)
      } catch (error) {
        console.error(error)
        setErrorToast("Failed to load session")
      } finally {
        state.loading = false
        render()
      }
    }

