    const submitAnswer = async () => {
      if (state.submitting || !state.currentQuestion) {
        return
      }

      let value = state.activeAnswer
      const question = state.currentQuestion

      if (question.type === "single-select") {
        if (!value) {
          setErrorToast("Pick one option to continue")
          return
        }
      }

      if (question.type === "multi-select") {
        if (!Array.isArray(value) || value.length === 0) {
          setErrorToast("Select at least one option to continue")
          return
        }
      }

      if (question.type === "text") {
        value = typeof value === "string" ? value.trim() : ""
        if (!value) {
          setErrorToast("Enter an answer to continue")
          return
        }
      }

      state.submitting = true
      render()

      try {
        const payload = await api("/api/answer", "POST", { questionId: question.id, value })
        applySessionPayload(payload)
      } catch (error) {
        console.error(error)
        setErrorToast("Could not save answer")
      } finally {
        state.submitting = false
        render()
      }
    }

    const goBackToIndex = async (toIndex) => {
      if (state.submitting || toIndex < 0) {
        return
      }

      state.submitting = true
      render()

      try {
        const payload = await api("/api/back", "POST", { toIndex })
        applySessionPayload(payload)
      } catch (error) {
        console.error(error)
        setErrorToast("Could not move to selected step")
      } finally {
        state.submitting = false
        render()
      }
    }

    const submitRefinement = async () => {
      const userIntent = state.refineModal.userIntent.trim()
      if (!userIntent) {
        setErrorToast("Please describe what you'd like changed")
        return
      }

      if (!state.currentQuestion) {
        setErrorToast("No question selected to refine")
        return
      }

      state.submitting = true
      render()

      try {
        const payload = await api("/api/refine", "POST", {
          questionId: state.currentQuestion.id,
          userIntent,
        })
        if (payload?.session) {
          state.session = payload.session
          state.refinementSent = payload.session.status === "refinement_requested"
          startPolling()
        }
        closeRefineModal()
      } catch (error) {
        console.error(error)
        setErrorToast("Could not send refinement request")
      } finally {
        state.submitting = false
        render()
      }
    }

    const submitRound = async () => {
      if (state.submitting || state.finalized) {
        return
      }

      state.submitting = true
      render()

      try {
        const payload = await api("/api/submit-round", "POST")
        applySessionPayload(payload)
      } catch (error) {
        console.error(error)
        setErrorToast("Could not submit round")
      } finally {
        state.submitting = false
        render()
      }
    }

    const openRefineModal = () => {
      state.refineModal.open = true
      state.refineModal.userIntent = ""
      render()
    }

    const closeRefineModal = () => {
      state.refineModal.open = false
      state.refineModal.userIntent = ""
      render()
    }

    const handleSuggestPrompt = async () => {
      const session = state.session
      if (!session || session.phase !== "approved" || !session.approvedPreviewId) return
      if (state.promptSuggestionPending) return

      state.submitting = true
      render()
      try {
        const payload = await api("/api/request-prompt-suggestion", "POST")
        state.promptSuggestionPending = true
        applySessionPayload(payload)
        startPolling()
        setErrorToast("Prompt suggestion requested. Generating prompt following Step 7 guidance now.")
      } catch (error) {
        console.error(error)
        setErrorToast("Failed to request prompt suggestion")
      } finally {
        state.submitting = false
        render()
      }
    }

    const autoCloseSessionAfterPromptReady = async () => {
      if (state.promptAutoCloseInFlight || state.promptAutoCloseDone) {
        return
      }

      state.promptAutoCloseInFlight = true
      try {
        const payload = await api("/api/close", "POST")
        if (payload?.session) {
          state.session = payload.session
          state.finalized = true
        }
        state.promptAutoCloseDone = true
        stopPolling()
      } catch (error) {
        console.error(error)
      } finally {
        state.promptAutoCloseInFlight = false
        render()
      }
    }

    const downloadBlobFile = (fileName, blob) => {
      const url = URL.createObjectURL(blob)
      const link = document.createElement("a")
      link.href = url
      link.download = fileName
      document.body.appendChild(link)
      link.click()
      link.remove()
      window.setTimeout(() => URL.revokeObjectURL(url), 1500)
    }

    const sanitizeFilePart = (value) => {
      const normalized = String(value || "layout")
        .toLowerCase()
        .replace(/[^a-z0-9_-]+/g, "-")
        .replace(/-+/g, "-")
        .replace(/^-|-$/g, "")
      return normalized || "layout"
    }

    const getArtifactBaseName = () => {
      const now = new Date()
      const stamp = [
        now.getFullYear(),
        String(now.getMonth() + 1).padStart(2, "0"),
        String(now.getDate()).padStart(2, "0"),
      ].join("") + "-" + [
        String(now.getHours()).padStart(2, "0"),
        String(now.getMinutes()).padStart(2, "0"),
        String(now.getSeconds()).padStart(2, "0"),
      ].join("")

      return `${sanitizeFilePart(state.session?.id || SESSION_ID)}-${stamp}`
    }

