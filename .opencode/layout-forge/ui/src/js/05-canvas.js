    const roleStyles = {
      nav: { fill: "#0b4f61", stroke: "#22d3ee" },
      sidebar: { fill: "#312e81", stroke: "#818cf8" },
      main: { fill: "#064e3b", stroke: "#34d399" },
      inspector: { fill: "#78350f", stroke: "#fbbf24" },
      bottom: { fill: "#701a75", stroke: "#e879f9" },
      toolbar: { fill: "#334155", stroke: "#94a3b8" },
    }

    const buildLayoutCanvas = (preview) => {
      const cell = 80
      const padX = 28
      const padY = 68
      const footer = 36
      const width = preview.cols * cell + padX * 2
      const height = preview.rows * cell + padY + footer

      const canvas = document.createElement("canvas")
      canvas.width = width
      canvas.height = height
      const ctx = canvas.getContext("2d")
      if (!ctx) {
        return null
      }

      const gradient = ctx.createLinearGradient(0, 0, width, height)
      gradient.addColorStop(0, "#0d1117")
      gradient.addColorStop(1, "#111827")
      ctx.fillStyle = gradient
      ctx.fillRect(0, 0, width, height)

      ctx.fillStyle = "#e6edf3"
      ctx.font = "600 20px 'JetBrains Mono', monospace"
      ctx.fillText(preview.title || "Layout Preview", padX, 34)

      const gridLeft = padX
      const gridTop = padY
      const gridWidth = preview.cols * cell
      const gridHeight = preview.rows * cell

      ctx.strokeStyle = "rgba(148, 163, 184, 0.25)"
      ctx.lineWidth = 1
      for (let col = 0; col <= preview.cols; col += 1) {
        const x = gridLeft + col * cell
        ctx.beginPath()
        ctx.moveTo(x, gridTop)
        ctx.lineTo(x, gridTop + gridHeight)
        ctx.stroke()
      }
      for (let row = 0; row <= preview.rows; row += 1) {
        const y = gridTop + row * cell
        ctx.beginPath()
        ctx.moveTo(gridLeft, y)
        ctx.lineTo(gridLeft + gridWidth, y)
        ctx.stroke()
      }

      for (const node of preview.nodes || []) {
        const style = roleStyles[node.role] || roleStyles.toolbar
        const x = gridLeft + (node.x - 1) * cell + 2
        const y = gridTop + (node.y - 1) * cell + 2
        const w = node.w * cell - 4
        const h = node.h * cell - 4

        ctx.fillStyle = style.fill
        ctx.strokeStyle = style.stroke
        ctx.lineWidth = 2
        ctx.fillRect(x, y, w, h)
        ctx.strokeRect(x, y, w, h)

        ctx.fillStyle = "#f8fafc"
        ctx.font = "600 14px 'JetBrains Mono', monospace"
        const clippedLabel = String(node.label || "").slice(0, 40)
        ctx.fillText(clippedLabel, x + 10, y + 22)
      }

      ctx.fillStyle = "#94a3b8"
      ctx.font = "12px 'JetBrains Mono', monospace"
      ctx.fillText(`Generated: ${preview.generatedAt}`, padX, height - 12)

      return canvas
    }

    const downloadLayoutArtifacts = () => {
      const preview = state.session?.visualPreview
      const promptText = state.promptModal.text

      if (!preview) {
        setErrorToast("No approved layout preview to download")
        return
      }

      if (!promptText || !promptText.trim()) {
        setErrorToast("No prompt available to download")
        return
      }

      const base = getArtifactBaseName()
      const canvas = buildLayoutCanvas(preview)
      if (!canvas) {
        setErrorToast("Could not render layout image")
        return
      }

      canvas.toBlob((blob) => {
        if (!blob) {
          setErrorToast("Could not export layout image")
          return
        }

        downloadBlobFile(`${base}-layout.png`, blob)

        const promptPayload = [
          `Session ID: ${state.session?.id || SESSION_ID}`,
          `Preview ID: ${preview.id}`,
          `Preview Title: ${preview.title}`,
          "",
          "----- Prompt -----",
          promptText,
        ].join("\n")
        downloadBlobFile(`${base}-prompt.txt`, new Blob([promptPayload], { type: "text/plain;charset=utf-8" }))
        setErrorToast("Downloaded layout image and prompt")
      }, "image/png")
    }

