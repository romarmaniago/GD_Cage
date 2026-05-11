// Announcement functionality
document.addEventListener('DOMContentLoaded', function() {
	const form = document.getElementById('form-new-announcement');
	const messageInput = document.getElementById('announcement-message');
	const pictureInput = document.getElementById('announcement-picture');
	const picturePreview = document.getElementById('picture-preview');
	const picturePreviewContainer = document.getElementById('picture-preview-container');
	const removePictureBtn = document.getElementById('remove-picture-btn');
	const submitBtn = document.getElementById('submit-announcement-btn');
	const modal = document.getElementById('modal-new-announcement');
	const agentListEl = document.getElementById('announcement-agents-list');
	const selectAllMasterCb = document.getElementById('announcement-select-all-cb');
	const agentsSearchInput = document.getElementById('announcement-agents-search');
	var t = window.announcementModalTranslations || {};

	function getVisibleAgentCheckboxes() {
		if (!agentListEl) return [];
		return Array.from(agentListEl.querySelectorAll('.announcement-agent-row')).filter(function(row) {
			return !row.classList.contains('d-none');
		}).map(function(row) {
			return row.querySelector('input.announcement-agent-cb');
		}).filter(Boolean);
	}

	function applyAnnouncementAgentFilter() {
		if (!agentListEl) return;
		var q = agentsSearchInput ? String(agentsSearchInput.value || '').trim().toLowerCase() : '';
		agentListEl.querySelectorAll('.announcement-agent-row').forEach(function(row) {
			var hay = row.getAttribute('data-search') || '';
			var show = !q || hay.indexOf(q) !== -1;
			row.classList.toggle('d-none', !show);
		});
		syncSelectAllMaster();
	}

	function syncSelectAllMaster() {
		if (!selectAllMasterCb || !agentListEl) return;
		var boxes = getVisibleAgentCheckboxes();
		if (boxes.length === 0) {
			selectAllMasterCb.checked = false;
			selectAllMasterCb.indeterminate = false;
			selectAllMasterCb.disabled = true;
			return;
		}
		selectAllMasterCb.disabled = false;
		var n = boxes.length;
		var checked = boxes.filter(function(cb) { return cb.checked; }).length;
		if (checked === 0) {
			selectAllMasterCb.checked = false;
			selectAllMasterCb.indeterminate = false;
		} else if (checked === n) {
			selectAllMasterCb.checked = true;
			selectAllMasterCb.indeterminate = false;
		} else {
			selectAllMasterCb.checked = false;
			selectAllMasterCb.indeterminate = true;
		}
	}

	function appendAgentsListMessage(text) {
		if (!agentListEl) return;
		var col = document.createElement('div');
		col.className = 'col-12';
		var span = document.createElement('span');
		span.className = 'text-muted small';
		span.textContent = text;
		col.appendChild(span);
		agentListEl.appendChild(col);
	}

	function getSelectedAgentIds() {
		if (!agentListEl) return [];
		return Array.from(agentListEl.querySelectorAll('input.announcement-agent-cb:checked'))
			.map(function(cb) { return parseInt(cb.value, 10); })
			.filter(function(n) { return Number.isInteger(n) && n > 0; });
	}

	async function loadAnnouncementAgents() {
		if (!agentListEl) return;
		t = window.announcementModalTranslations || {};
		agentListEl.innerHTML = '';
		appendAgentsListMessage(t.loading_agents || 'Loading agents...');
		if (selectAllMasterCb) {
			selectAllMasterCb.disabled = true;
			selectAllMasterCb.checked = false;
			selectAllMasterCb.indeterminate = false;
		}
		if (agentsSearchInput) {
			agentsSearchInput.value = '';
			agentsSearchInput.disabled = true;
		}
		if (submitBtn) submitBtn.disabled = true;

		try {
			var response = await fetch('/announcement/agents', { credentials: 'same-origin' });
			var data = await response.json().catch(function() { return {}; });
			agentListEl.innerHTML = '';
			if (!response.ok || !data.success || !Array.isArray(data.agents)) {
				appendAgentsListMessage(t.load_agents_failed || 'Could not load agent list.');
				syncSelectAllMaster();
				return;
			}
			if (data.agents.length === 0) {
				appendAgentsListMessage(t.no_agents_available || 'No active agents with Telegram ID.');
				syncSelectAllMaster();
				return;
			}
			data.agents.forEach(function(a) {
				var col = document.createElement('div');
				col.className = 'col-12 col-sm-6 col-md-3 announcement-agent-row';
				var wrap = document.createElement('div');
				wrap.className = 'form-check mb-0';
				var cb = document.createElement('input');
				cb.type = 'checkbox';
				cb.className = 'form-check-input announcement-agent-cb';
				cb.value = String(a.IDNo);
				cb.id = 'announcement-agent-' + a.IDNo;
				var label = document.createElement('label');
				label.className = 'form-check-label small text-break';
				label.setAttribute('for', cb.id);
				var code = a.AGENT_CODE != null ? String(a.AGENT_CODE) : '';
				var name = a.NAME != null ? String(a.NAME) : '';
				label.textContent = (code ? code + ' — ' : '') + name;
				col.setAttribute('data-search', (code + ' ' + name).toLowerCase());
				wrap.appendChild(cb);
				wrap.appendChild(label);
				col.appendChild(wrap);
				agentListEl.appendChild(col);
			});
			if (agentsSearchInput) agentsSearchInput.disabled = false;
			syncSelectAllMaster();
		} catch (e) {
			console.error(e);
			agentListEl.innerHTML = '';
			appendAgentsListMessage(t.load_agents_failed || 'Could not load agent list.');
			syncSelectAllMaster();
		} finally {
			if (submitBtn) submitBtn.disabled = false;
			if (agentsSearchInput && agentListEl && !agentListEl.querySelector('.announcement-agent-row')) {
				agentsSearchInput.disabled = true;
			}
		}
	}

	if (agentsSearchInput && agentListEl) {
		agentsSearchInput.addEventListener('input', applyAnnouncementAgentFilter);
		agentsSearchInput.addEventListener('search', applyAnnouncementAgentFilter);
	}

	if (selectAllMasterCb && agentListEl) {
		selectAllMasterCb.addEventListener('change', function() {
			var on = selectAllMasterCb.checked;
			getVisibleAgentCheckboxes().forEach(function(cb) {
				cb.checked = on;
			});
			selectAllMasterCb.indeterminate = false;
		});
		agentListEl.addEventListener('change', function(e) {
			if (e.target && e.target.classList && e.target.classList.contains('announcement-agent-cb')) {
				syncSelectAllMaster();
			}
		});
	}

	if (modal && agentListEl) {
		modal.addEventListener('show.bs.modal', function() {
			loadAnnouncementAgents();
		});
	}

	// Picture preview functionality
	if (pictureInput) {
		pictureInput.addEventListener('change', function(e) {
			const file = e.target.files[0];
			if (file) {
				const reader = new FileReader();
				reader.onload = function(e) {
					picturePreview.src = e.target.result;
					picturePreviewContainer.classList.remove('d-none');
				};
				reader.readAsDataURL(file);
			}
		});
	}

	// Remove picture
	if (removePictureBtn) {
		removePictureBtn.addEventListener('click', function() {
			pictureInput.value = '';
			picturePreview.src = '';
			picturePreviewContainer.classList.add('d-none');
		});
	}

	// Reset modal when it closes
	if (modal) {
		modal.addEventListener('hidden.bs.modal', function() {
			form.reset();
			picturePreview.src = '';
			picturePreviewContainer.classList.add('d-none');
			if (submitBtn) submitBtn.disabled = false;
		});
	}

	// Form submission
	if (form) {
		form.addEventListener('submit', async function(e) {
			e.preventDefault();

			const message = messageInput.value.trim();
			const hasPicture = pictureInput.files[0];
			t = window.announcementModalTranslations || {};
			// At least one of message or picture must be provided
			if (!message && !hasPicture) {
				Swal.fire({
					icon: 'error',
					title: t.validation_error || 'Validation Error',
					text: t.please_enter_message_or_picture || 'Please enter a message or upload a picture'
				});
				return;
			}

			var selectedAgentIds = getSelectedAgentIds();
			if (selectedAgentIds.length === 0) {
				Swal.fire({
					icon: 'error',
					title: t.validation_error || 'Validation Error',
					text: t.please_select_at_least_one_agent || 'Please select at least one agent'
				});
				return;
			}

			// Disable submit button
			if (submitBtn) submitBtn.disabled = true;
			submitBtn.innerHTML = '<i class="fa fa-spinner fa-spin"></i> ' + (t.sending || 'Sending...');

			try {
				const formData = new FormData();
				formData.append('message', message);
				formData.append('agent_ids', JSON.stringify(selectedAgentIds));
				
				if (pictureInput.files[0]) {
					formData.append('picture', pictureInput.files[0]);
				}

				const response = await fetch('/announcement/create', {
					method: 'POST',
					body: formData
				});

				// Check if response is ok
				if (!response.ok) {
					let errorMessage = t.failed_to_send || 'Failed to send announcement';
					try {
						const errorData = await response.json();
						errorMessage = errorData.error || errorMessage;
					} catch (e) {
						errorMessage = `Server error: ${response.status} ${response.statusText}`;
					}
					throw new Error(errorMessage);
				}

				const result = await response.json();

				if (result.success) {
					Swal.fire({
						icon: 'success',
						title: t.success || 'Success!',
						text: result.message,
						timer: 3000,
						showConfirmButton: false
					});

					// Close modal and reset form
					const modalInstance = bootstrap.Modal.getInstance(modal);
					if (modalInstance) {
						modalInstance.hide();
					}

					// Reset button state
					if (submitBtn) {
						submitBtn.disabled = false;
						submitBtn.innerHTML = '<i class="fa fa-paper-plane"></i> ' + (t.send_announcement || 'Send Announcement');
					}
				} else {
					Swal.fire({
						icon: 'error',
						title: t.error || 'Error',
						text: result.error || (t.failed_to_send || 'Failed to send announcement')
					});
					if (submitBtn) {
						submitBtn.disabled = false;
						submitBtn.innerHTML = '<i class="fa fa-paper-plane"></i> ' + (t.send_announcement || 'Send Announcement');
					}
				}
			} catch (error) {
				console.error('Error:', error);
				Swal.fire({
					icon: 'error',
					title: t.error || 'Error',
					text: error.message || (t.error_occurred || 'An error occurred while sending the announcement')
				});
				if (submitBtn) {
					submitBtn.disabled = false;
					submitBtn.innerHTML = '<i class="fa fa-paper-plane"></i> ' + (t.send_announcement || 'Send Announcement');
				}
			}
		});
	}
});
