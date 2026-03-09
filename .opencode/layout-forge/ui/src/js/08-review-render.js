    const renderRevisionList = () => {
      const history = state.session?.previewHistory ?? []
      const current = state.session?.visualPreview
      const reqCount = state.session?.requirementLedger?.length ?? 0
      const snapCount = state.session?.requirementSnapshots?.length ?? 0

      const allRevisions = [...history, ...(current ? [current] : [])]

      return `
        <p class="section-title">Preview Revisions</p>
        <div class="revision-list">
          ${allRevisions.length === 0
            ? '<p style="color: var(--text-muted)">No revisions yet</p>'
            : allRevisions.map((rev, i) => `
              <div class="revision-item ${rev.id === current?.id ? 'active' : ''} ${rev.id === state.selectedRevisionId ? 'selected-for-diff' : ''}"
                   data-action="select-revision"
                   data-revision-id="${rev.id}">
                <span class="revision-title">${escapeHtml(rev.title)}</span>
                <span class="revision-time">${new Date(rev.generatedAt).toLocaleTimeString()}</span>
              </div>
          `).join('')}
        </div>
        <p class="section-title" style="margin-top: 16px">Requirements</p>
        <div style="color: var(--text-secondary); font-size: 13px;">
          ${reqCount} requirements across ${snapCount} rounds
        </div>
      `
    }

    const renderVisualGrid = (vp) => {
      if (!vp || !vp.nodes || vp.nodes.length === 0) {
        return `<div class="empty-preview">Preview has no layout regions. The AI will generate a visual preview.</div>`
      }

      return `
        <div class="review-visual-grid" style="
          display: grid;
          grid-template-columns: repeat(${vp.cols}, 1fr);
          grid-template-rows: repeat(${vp.rows}, 1fr);
          gap: 4px;
          height: 400px;
        ">
          ${vp.nodes.map(node => `
            <div class="preview-node ${state.selectedNodeId === node.id ? 'selected' : ''}"
                 data-action="select-node"
                 data-node-id="${node.id}"
                 style="
                   grid-column: ${node.x} / span ${node.w};
                   grid-row: ${node.y} / span ${node.h};
                   background: var(--node-color-${node.role});
                   border: 1px solid var(--node-border-${node.role});
                   ${state.selectedNodeId === node.id ? 'border: 2px solid var(--accent);' : ''}
                 ">
              <span class="node-label">${escapeHtml(node.label)}</span>

            </div>
          `).join('')}
        </div>
      `
    }

    const renderOutlineTab = (vp) => {
      if (!vp || !vp.outline || vp.outline.length === 0) {
        return `<div class="empty-preview">No outline available.</div>`
      }

      return `
        <div class="review-outline-list">
          ${vp.outline.map((item, i) => `
            <div class="review-outline-item">
              <h4>${i + 1}. ${escapeHtml(item.title)}</h4>
              <p>${escapeHtml(item.summary)}</p>
            </div>
          `).join('')}
        </div>
      `
    }

    const renderRawTab = (vp) => {
      const ascii = vp?.raw?.ascii
      const notes = vp?.raw?.notes

      return `
        <div class="review-raw-tab">
          ${ascii ? `<pre class="review-raw-ascii">${escapeHtml(ascii)}</pre>` : '<div class="empty-preview">No ASCII preview available.</div>'}
          ${notes && notes.length > 0 ? `
            <div>
              <p class="section-title">Notes</p>
              <ul class="review-raw-notes">
                ${notes.map(note => `<li>${escapeHtml(note)}</li>`).join('')}
              </ul>
            </div>
          ` : ''}
        </div>
      `
    }

    const renderDiffTab = () => {
      const current = state.session?.visualPreview
      const allRevisions = [...(state.session?.previewHistory ?? []), ...(current ? [current] : [])]
      const selectedRev = allRevisions.find(r => r.id === state.selectedRevisionId)

      if (!selectedRev || selectedRev.id === current?.id) {
        return `<div class="review-diff-tab">Select a previous revision from the left panel to compare</div>`
      }

      return `
        <div class="diff-container">
          <div class="diff-side">
            <h4 class="diff-label">Previous: ${escapeHtml(selectedRev.title)}</h4>
            ${renderDiffGrid(selectedRev)}
          </div>
          <div class="diff-side">
            <h4 class="diff-label">Current: ${escapeHtml(current?.title ?? 'Current')}</h4>
            ${renderDiffGrid(current)}
          </div>
        </div>
      `
    }

    const renderDiffGrid = (vp) => {
      if (!vp || !vp.nodes || vp.nodes.length === 0) {
        return `<div class="empty-preview">No nodes</div>`
      }
      return `
        <div class="diff-grid" style="
          display: grid;
          grid-template-columns: repeat(${vp.cols}, 1fr);
          grid-template-rows: repeat(${vp.rows}, 1fr);
          gap: 2px;
          height: 200px;
        ">
          ${vp.nodes.map(node => `
            <div class="preview-node"
                 style="
                   grid-column: ${node.x} / span ${node.w};
                   grid-row: ${node.y} / span ${node.h};
                   background: var(--node-color-${node.role});
                   border: 1px solid var(--node-border-${node.role});
                 ">
              <span class="node-label">${escapeHtml(node.label)}</span>
            </div>
          `).join('')}
        </div>
      `
    }

    const renderPreviewTabs = (vp) => {
      const reviewLocked = isReviewInteractionLocked()
      const tabs = [
        { id: 'visual', label: 'Visual' },
        { id: 'outline', label: 'Outline' },
        { id: 'raw', label: 'Raw' },
        { id: 'diff', label: 'Diff' },
      ]

      let tabContent = ''
      if (state.reviewTab === 'visual') {
        tabContent = renderVisualGrid(vp)
      } else if (state.reviewTab === 'outline') {
        tabContent = renderOutlineTab(vp)
      } else if (state.reviewTab === 'raw') {
        tabContent = renderRawTab(vp)
      } else if (state.reviewTab === 'diff') {
        tabContent = renderDiffTab()
      }

      return `
        <div class="review-tab-bar">
          ${tabs.map(tab => `
            <button class="review-tab-btn ${state.reviewTab === tab.id ? 'active' : ''}"
                    data-action="switch-tab"
                    data-tab="${tab.id}"
                    ${reviewLocked ? 'disabled' : ''}>
              ${tab.label}
            </button>
          `).join('')}
        </div>
        <div class="review-tab-content">
          ${tabContent}
        </div>
      `
    }

    const renderReviewActions = (vp, phase) => {
      const selectedNode = vp?.nodes?.find(n => n.id === state.selectedNodeId)
      const reviewLocked = isReviewInteractionLocked()

      return `
        ${selectedNode ? `
          <div class="node-info-panel">
            <h4>${escapeHtml(selectedNode.label)}</h4>
            <p>${selectedNode.summary ? escapeHtml(selectedNode.summary) : 'No description available.'}</p>
            <div class="node-meta">
              Role: ${selectedNode.role} | Position: (${selectedNode.x}, ${selectedNode.y}) | Size: ${selectedNode.w}×${selectedNode.h}
            </div>
          </div>
        ` : `
          <div class="node-info-panel">
            <p style="color: var(--text-muted); margin: 0;">Click a region in the preview to see details.</p>
          </div>
        `}

        ${state.selectedNodeId ? `
          <div class="review-feedback-area">
            <textarea 
              data-action="input-review-feedback"
              placeholder="Describe what you'd like to change about this area..."
              rows="3"
              ${reviewLocked ? 'disabled' : ''}
            >${escapeHtml(state.reviewFeedback || '')}</textarea>
          </div>
        ` : ''}
        <div class="review-actions">
          <button class="btn btn-primary" data-action="review-approve" ${reviewLocked ? 'disabled' : ''}>Approve Preview</button>
          <button class="btn btn-secondary ${!state.selectedNodeId ? 'disabled' : ''}"
                  data-action="review-revise" ${(!state.selectedNodeId || reviewLocked) ? 'disabled' : ''}>
            Revise Selected Area
          </button>
          <button class="btn btn-secondary" data-action="review-followup" ${reviewLocked ? 'disabled' : ''}>Need More Questions</button>
          <button class="btn btn-danger" data-action="review-finish" ${reviewLocked ? 'disabled' : ''}>Finish Without Prompt</button>
          <button class="btn btn-primary ${phase !== 'approved' || state.promptSuggestionPending ? 'disabled' : ''}"
                  data-action="review-suggest-prompt" ${phase !== 'approved' || state.promptSuggestionPending || reviewLocked ? 'disabled' : ''}>
            ${state.promptSuggestionPending ? 'Generating Prompt...' : 'Suggest Prompt (LLM)'}
          </button>
        </div>
        ${state.promptSuggestionPending ? `
          <div class="node-info-panel" style="margin-top: 12px;">
            <p style="margin: 0; color: var(--text-secondary);">
              Prompt suggestion requested. The LLM is generating a richer implementation prompt.
            </p>
          </div>
        ` : ''}
        ${(state.session?.previewReviews ?? []).length > 0 ? `
          <div class="review-feedback-list">
            <p class="section-title">Review History</p>
            ${[...(state.session?.previewReviews ?? [])].reverse().map(r => `
              <div class="review-feedback-item">
                <span class="review-type-badge review-type-${r.type}">${r.type}</span>
                ${r.targetNodeId ? `<span class="review-node-ref">Node: ${escapeHtml(r.targetNodeId)}</span>` : ''}
                <p class="review-message">${escapeHtml(r.message)}</p>
                <span class="review-time">${new Date(r.createdAt).toLocaleTimeString()}</span>
              </div>
            `).join('')}
          </div>
        ` : ''}
      `
    }

    const renderReviewMode = () => {
      const vp = state.session?.visualPreview
      const phase = state.session?.phase

      // Desktop guard
      if (window.innerWidth < 1200) {
        return `<div class="review-desktop-guard">Review mode requires a desktop browser (minimum 1200px width).</div>`
      }

      return `
        <div class="forge review-mode">
          <aside class="sidebar panel">
            ${renderRevisionList()}
          </aside>
          <main class="main panel">
            ${renderPreviewTabs(vp)}
          </main>
          <aside class="info panel">
            ${renderReviewActions(vp, phase)}
          </aside>
        </div>
      `
    }

    // renderLayoutPreview removed - layout proposals are now shown via AI messages after Q&A

    const render = () => {
      if (state.loading) {
        appRoot.innerHTML = renderSkeleton()
        renderToasts()
        return
      }

      // Phase-based mode switching
      const phase = state.session?.phase
      if (phase === "reviewing" || phase === "approved" || phase === "prompt-ready") {
        appRoot.innerHTML = renderReviewMode() + renderPromptModal()
        renderToasts()
        return
      }

      appRoot.innerHTML = `
        <div class="forge">
          <aside class="sidebar panel">
            <p class="section-title">Step List</p>
            ${renderSteps()}
          </aside>
          <main class="main panel">
            ${renderMessages()}
            ${renderMainPanel()}
          </main>
          <aside class="info panel">
            <p class="section-title">Progress</p>
            <div class="progress-bar"><div class="progress-fill" style="width: ${state.progress.percentage}%;"></div></div>
            <div class="progress-text">${state.progress.answered}/${state.progress.total} (${state.progress.percentage}%)</div>
            <p class="section-title">Decision History</p>
            ${renderHistory()}
          </aside>
        </div>
        ${renderRefineModal()}
        ${renderPromptModal()}
      `

      renderToasts()
    }

