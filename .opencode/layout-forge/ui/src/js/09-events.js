    const shouldIgnoreGlobalKeys = () => {
      const active = document.activeElement
      if (!active) {
        return false
      }
      const tag = active.tagName.toLowerCase()
      return tag === "input" || tag === "textarea" || tag === "select"
    }

    document.addEventListener("click", async (event) => {
      const target = event.target.closest("[data-action]")
      if (!target) {
        if (state.refineModal.open && event.target.classList.contains("modal")) {
          closeRefineModal()
        }
        if (state.promptModal.open && event.target.classList.contains("modal")) {
          // Don't allow backdrop-click close during prompt-ready phase
          if (state.session?.phase !== "prompt-ready") {
            state.promptModal = { open: false, text: "" }
            render()
          }
        }
        return
      }

      const action = target.getAttribute("data-action")
      const value = target.getAttribute("data-value")
      const reviewLocked = isReviewInteractionLocked()

      if (action === "goto-step") {
        const index = Number(target.getAttribute("data-index"))
        if (Number.isFinite(index) && index >= 0) {
          await goBackToIndex(index)
        }
        return
      }

      if (action === "select-single") {
        state.activeAnswer = value || ""
        render()
        return
      }

      if (action === "toggle-multi") {
        const nextValues = Array.isArray(state.activeAnswer) ? [...state.activeAnswer] : []
        const existingIndex = nextValues.indexOf(value)
        if (existingIndex >= 0) {
          nextValues.splice(existingIndex, 1)
        } else if (value) {
          nextValues.push(value)
        }
        state.activeAnswer = nextValues
        render()
        return
      }

      if (action === "toggle-boolean") {
        state.activeAnswer = !state.activeAnswer
        render()
        return
      }

      if (action === "toggle-select-mode") {
        const questionId = target.getAttribute("data-question-id")
        if (!questionId || state.submitting) return
        state.submitting = true
        render()
        try {
          const payload = await api("/api/toggle-type", "POST", { questionId })
          applySessionPayload(payload)
        } catch (error) {
          console.error(error)
          setErrorToast("Could not toggle selection mode")
        } finally {
          state.submitting = false
          render()
        }
        return
      }

      if (action === "open-refine-modal") {
        openRefineModal()
        return
      }

      if (action === "close-refine-modal") {
        closeRefineModal()
        return
      }

      if (action === "dismiss-prompt") {
        try {
          await api("/api/dismiss-prompt", "POST")
          state.promptModal = { open: false, text: "" }
          setErrorToast("Session complete. You can close this tab.")
        } catch (error) {
          console.error(error)
          setErrorToast("Failed to dismiss prompt")
        }
        render()
        return
      }

      if (action === "close-prompt-modal") {
        state.promptModal = { open: false, text: "" }
        render()
        return
      }

      if (action === "copy-prompt-to-clipboard") {
        navigator.clipboard.writeText(state.promptModal.text).then(() => {
          setErrorToast("Prompt copied to clipboard!")
        }).catch(() => {
          setErrorToast("Failed to copy to clipboard")
        })
        return
      }

      if (action === "download-layout-artifacts") {
        downloadLayoutArtifacts()
        return
      }

      if (action === "submit-answer") {
        await submitAnswer()
        return
      }

      if (action === "back-prev") {
        const currentIndex = getCurrentQuestionIndex()
        if (currentIndex > 0) {
          await goBackToIndex(currentIndex - 1)
        }
        return
      }

      if (action === "submit-round") {
        await submitRound()
      }

      // Review mode handlers
      if (action === "switch-tab") {
        if (reviewLocked) return
        state.reviewTab = target.getAttribute("data-tab") || "visual"
        render()
        return
      }

      if (action === "select-node") {
        if (reviewLocked) return
        state.selectedNodeId = target.getAttribute("data-node-id") || null
        render()
        return
      }

      // Review action handlers
      if (action === "review-approve") {
        if (reviewLocked) return
        const previewId = state.session?.visualPreview?.id
        if (!previewId) return
        try {
          const payload = await api("/api/approve-preview", "POST", { previewId })
          applySessionPayload(payload)
        } catch (error) {
          console.error(error)
          setErrorToast("Failed to approve preview")
        }
        return
      }

      if (action === "review-revise") {
        if (reviewLocked) return
        const previewId = state.session?.visualPreview?.id
        if (!previewId || !state.selectedNodeId || !state.reviewFeedback.trim()) return
        const review = {
          id: "review_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 7),
          previewId,
          targetNodeId: state.selectedNodeId,
          type: "revise-node",
          message: state.reviewFeedback,
          createdAt: new Date().toISOString(),
        }
        try {
          const payload = await api("/api/preview-review", "POST", { review })
          state.reviewFeedback = ""
          applySessionPayload(payload)
        } catch (error) {
          console.error(error)
          setErrorToast("Failed to submit revision request")
        }
        return
      }

      if (action === "review-followup") {
        if (reviewLocked) return
        const previewId = state.session?.visualPreview?.id
        if (!previewId) return
        const review = {
          id: "review_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 7),
          previewId,
          type: "ask-followup",
          message: "Need more questions",
          createdAt: new Date().toISOString(),
        }
        try {
          const payload = await api("/api/preview-review", "POST", { review })
          applySessionPayload(payload)
        } catch (error) {
          console.error(error)
          setErrorToast("Failed to request more questions")
        }
        return
      }

      if (action === "review-finish") {
        if (reviewLocked) return
        const previewId = state.session?.visualPreview?.id
        if (!previewId) return
        const review = {
          id: "review_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 7),
          previewId,
          type: "finish",
          message: "Finish without prompt",
          createdAt: new Date().toISOString(),
        }
        try {
          const payload = await api("/api/preview-review", "POST", { review })
          applySessionPayload(payload)
        } catch (error) {
          console.error(error)
          setErrorToast("Failed to finish session")
        }
        return
      }

      if (action === "review-suggest-prompt") {
        if (reviewLocked) return
        if (state.session?.phase !== "approved") return
        await handleSuggestPrompt()
        return
      }

      if (action === "select-revision") {
        if (reviewLocked) return
        state.selectedRevisionId = target.getAttribute("data-revision-id") || null
        render()
        return
      }
    })

    document.addEventListener("input", (event) => {
      const target = event.target
      const action = target.getAttribute("data-action")

      if (action === "input-text") {
        state.activeAnswer = target.value
        // Selectively update submit button disabled state without full re-render
        const submitBtn = document.querySelector('[data-action="submit-answer"]')
        if (submitBtn) {
          submitBtn.disabled = state.submitting || !canSubmitCurrentAnswer()
        }
        return
      }

      if (action === "input-custom-single") {
        state.activeAnswer = target.value
        const submitBtn = document.querySelector('[data-action="submit-answer"]')
        if (submitBtn) {
          submitBtn.disabled = state.submitting || !canSubmitCurrentAnswer()
        }
        const choices = target.closest('.choices').querySelectorAll('.choice')
        choices.forEach((choice) => {
          choice.classList.remove("selected")
        })
        if (target.value) {
          target.closest('.choice').classList.add('selected')
        }
        return
      }

      if (action === "input-custom-multi") {
        const options = Array.isArray(state.currentQuestion.options) ? state.currentQuestion.options : []
        const standardValues = (Array.isArray(state.activeAnswer) ? state.activeAnswer : []).filter(val => options.find(o => o.id === val))
        
        if (target.value.trim()) {
          state.activeAnswer = [...standardValues, target.value]
          target.closest('.choice').classList.add('selected')
        } else {
          state.activeAnswer = standardValues
          target.closest('.choice').classList.remove('selected')
        }
        
        const submitBtn = document.querySelector('[data-action="submit-answer"]')
        if (submitBtn) {
          submitBtn.disabled = state.submitting || !canSubmitCurrentAnswer()
        }
        return
      }

      if (action === "input-slider") {
        const nextValue = Number(target.value)
        if (Number.isFinite(nextValue)) {
          state.activeAnswer = nextValue
          // Update slider value display without full re-render
          const sliderValue = target.closest('.slider-row')?.querySelector('.slider-value')
          if (sliderValue) {
            sliderValue.textContent = String(nextValue)
          }
          const submitBtn = document.querySelector('[data-action="submit-answer"]')
          if (submitBtn) {
            submitBtn.disabled = state.submitting || !canSubmitCurrentAnswer()
          }
        }
        return
      }

      if (action === "refine-intent") {
        state.refineModal.userIntent = target.value
        // Selectively update send button disabled state without full re-render
        const sendBtn = document.querySelector('#refine-form [type="submit"]')
        if (sendBtn) {
          sendBtn.disabled = state.submitting || !state.refineModal.userIntent.trim()
        }
        return
      }

      if (action === "input-review-feedback") {
        if (isReviewInteractionLocked()) {
          return
        }
        state.reviewFeedback = target.value
        // Update revise button disabled state without full re-render
        const reviseBtn = document.querySelector('[data-action="review-revise"]')
        if (reviseBtn) {
          reviseBtn.disabled = !state.selectedNodeId || !state.reviewFeedback.trim()
        }
        return
      }
    })

    document.addEventListener("submit", async (event) => {
      const form = event.target
      if (form && form.id === "refine-form") {
        event.preventDefault()
        await submitRefinement()
      }
    })

    document.addEventListener("keydown", async (event) => {
      if (state.refineModal.open && event.key === "Escape") {
        closeRefineModal()
        return
      }

      if (state.promptModal.open && event.key === "Escape") {
        // Don't allow Escape close during prompt-ready phase
        if (state.session?.phase !== "prompt-ready") {
          state.promptModal = { open: false, text: "" }
          render()
        }
        return
      }

      if (state.loading || state.submitting || !state.currentQuestion) {
        return
      }

      if (event.key === "Enter" && !state.refineModal.open) {
        const activeTag = document.activeElement ? document.activeElement.tagName.toLowerCase() : ""
        const isTextArea = activeTag === "textarea"
        if (!isTextArea) {
          event.preventDefault()
          await submitAnswer()
        }
        return
      }

      if (state.currentQuestion.type !== "single-select" || shouldIgnoreGlobalKeys()) {
        return
      }

      if (/^[1-9]$/.test(event.key)) {
        const choiceIndex = Number(event.key) - 1
        const options = Array.isArray(state.currentQuestion.options) ? state.currentQuestion.options : []
        const option = options[choiceIndex]
        if (option) {
          state.activeAnswer = option.id
          render()
        }
      }
    })

