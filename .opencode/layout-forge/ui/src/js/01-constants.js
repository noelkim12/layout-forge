    const SESSION_TOKEN = "__SESSION_TOKEN__"
    const SESSION_ID = "__SESSION_ID__"

    const appRoot = document.getElementById("app")
    const toastWrap = document.getElementById("toast-wrap")

    const state = {
      session: null,
      currentQuestion: null,
      applicableQuestions: [],
      progress: { answered: 0, total: 0, percentage: 0 },
      layoutPreview: null,
      loading: true,
      waitingForQuestions: false,
      processing: false,
      messages: [],
      submitting: false,
      finalized: false,
      errorMessage: "",
      activeAnswer: null,
      questionKey: "",
      refineModal: {
        open: false,
        userIntent: "",
      },
      refinementSent: false,
      pollTimer: null,
      reviewTab: "visual",
      selectedNodeId: null,
      reviewFeedback: "",
      selectedRevisionId: null,
      promptSuggestionPending: false,
      promptModal: { open: false, text: "" },
      promptAutoCloseInFlight: false,
      promptAutoCloseDone: false,
    }

