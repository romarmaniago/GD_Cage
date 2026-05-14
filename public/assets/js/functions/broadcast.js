// Guest broadcast (by chat ID) — separate from announcement.js / agent list
document.addEventListener('DOMContentLoaded', function () {
	const form = document.getElementById('form-new-broadcast');
	const messageInput = document.getElementById('broadcast-message');
	const chatIdsInput = document.getElementById('broadcast-chat-ids');
	const pictureInput = document.getElementById('broadcast-picture');
	const pictureDropzone = document.getElementById('broadcast-picture-dropzone');
	const picturePreview = document.getElementById('broadcast-picture-preview');
	const picturePreviewContainer = document.getElementById('broadcast-picture-preview-container');
	const removePictureBtn = document.getElementById('broadcast-remove-picture-btn');
	const submitBtn = document.getElementById('submit-broadcast-btn');
	const modal = document.getElementById('modal-new-broadcast');
	var t = window.broadcastModalTranslations || {};

	function escapeSwalHtml(s) {
		return String(s == null ? '' : s)
			.replace(/&/g, '&amp;')
			.replace(/</g, '&lt;')
			.replace(/>/g, '&gt;')
			.replace(/"/g, '&quot;');
	}

	function closeBroadcastProgressSwal() {
		if (typeof Swal !== 'undefined' && Swal.isVisible && Swal.isVisible()) {
			Swal.close();
		}
	}

	function openBroadcastSendingProgress(recipientCount, t0) {
		if (typeof Swal === 'undefined') return;
		var tm = t0 || {};
		var hint = String(tm.sending_to_recipients || 'Sending to {n} recipient(s)…').replace(/\{n\}/g, String(recipientCount));
		Swal.fire({
			title: tm.sending || 'Sending...',
			html:
				'<p class="small text-muted mb-2">' +
				escapeSwalHtml(hint) +
				'</p>' +
				'<div class="bc-swal-indet-track" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-label="Sending">' +
				'<div class="bc-swal-indet-chunk"></div>' +
				'</div>',
			allowOutsideClick: false,
			allowEscapeKey: false,
			showConfirmButton: false
		});
	}

	function parseChatIdsFromTextarea(text) {
		var lines = String(text || '').split(/\r?\n/);
		var out = [];
		var seen = {};
		for (var i = 0; i < lines.length; i++) {
			var line = lines[i].trim();
			if (!line) continue;
			// Bawat linya: IDs / @username — hiwalay ng newline, o ng space/comma sa iisang linya
			var parts = line.split(/[\s,]+/).filter(function (p) {
				return p.length > 0;
			});
			for (var j = 0; j < parts.length; j++) {
				var s = parts[j].trim();
				if (!s || s.length > 200) continue;
				if (seen[s]) continue;
				seen[s] = true;
				out.push(s);
			}
		}
		return out;
	}

	function previewPictureFile(file) {
		if (!file || !picturePreview || !picturePreviewContainer) return;
		var reader = new FileReader();
		reader.onload = function (ev) {
			picturePreview.src = ev.target.result;
			picturePreviewContainer.classList.remove('d-none');
		};
		reader.readAsDataURL(file);
	}

	function clearPictureDropzoneHighlight() {
		if (pictureDropzone) pictureDropzone.classList.remove('is-dragover');
	}

	if (pictureInput) {
		pictureInput.addEventListener('change', function (e) {
			var file = e.target.files && e.target.files[0];
			if (file) previewPictureFile(file);
		});
	}

	if (pictureDropzone && pictureInput) {
		pictureDropzone.addEventListener('dragover', function (e) {
			e.preventDefault();
			e.stopPropagation();
			try {
				e.dataTransfer.dropEffect = 'copy';
			} catch (err) { /* ignore */ }
			pictureDropzone.classList.add('is-dragover');
		});
		pictureDropzone.addEventListener('dragleave', function (e) {
			e.preventDefault();
			e.stopPropagation();
			if (e.relatedTarget == null || !pictureDropzone.contains(e.relatedTarget)) {
				pictureDropzone.classList.remove('is-dragover');
			}
		});
		pictureDropzone.addEventListener('drop', function (e) {
			e.preventDefault();
			e.stopPropagation();
			pictureDropzone.classList.remove('is-dragover');
			var files = e.dataTransfer && e.dataTransfer.files;
			if (!files || !files.length) return;
			var file = files[0];
			if (!file.type || file.type.indexOf('image/') !== 0) return;
			try {
				var dt = new DataTransfer();
				dt.items.add(file);
				pictureInput.files = dt.files;
			} catch (err) {
				console.error(err);
				return;
			}
			previewPictureFile(file);
		});
	}

	if (removePictureBtn && pictureInput && picturePreview && picturePreviewContainer) {
		removePictureBtn.addEventListener('click', function () {
			pictureInput.value = '';
			picturePreview.src = '';
			picturePreviewContainer.classList.add('d-none');
			clearPictureDropzoneHighlight();
		});
	}

	if (modal && form) {
		modal.addEventListener('hidden.bs.modal', function () {
			form.reset();
			if (picturePreview) picturePreview.src = '';
			if (picturePreviewContainer) picturePreviewContainer.classList.add('d-none');
			clearPictureDropzoneHighlight();
			if (submitBtn) {
				submitBtn.disabled = false;
				submitBtn.innerHTML = '<i class="fa fa-paper-plane"></i> ' + ((window.broadcastModalTranslations || {}).send || 'Send');
			}
		});
	}

	if (form && messageInput && chatIdsInput && pictureInput && modal) {
		form.addEventListener('submit', async function (e) {
			e.preventDefault();
			t = window.broadcastModalTranslations || {};

			var message = messageInput.value.trim();
			var hasPicture = pictureInput.files[0];
			var ids = parseChatIdsFromTextarea(chatIdsInput.value);

			if (!message && !hasPicture) {
				Swal.fire({
					icon: 'error',
					title: t.validation_error || 'Validation Error',
					text: t.please_enter_message_or_picture || 'Please enter a message or upload a picture'
				});
				return;
			}
			if (ids.length === 0) {
				Swal.fire({
					icon: 'error',
					title: t.validation_error || 'Validation Error',
					text: t.please_enter_chat_ids || 'Please enter at least one chat ID'
				});
				return;
			}

			if (submitBtn) submitBtn.disabled = true;
			if (submitBtn) submitBtn.innerHTML = '<i class="fa fa-spinner fa-spin"></i> ' + (t.sending || 'Sending...');

			openBroadcastSendingProgress(ids.length, t);

			try {
				var formData = new FormData();
				formData.append('message', message);
				formData.append('chat_ids', JSON.stringify(ids));
				if (pictureInput.files[0]) {
					formData.append('picture', pictureInput.files[0]);
				}

				var response = await fetch('/broadcast/guest', {
					method: 'POST',
					body: formData
				});

				closeBroadcastProgressSwal();

				if (!response.ok) {
					var errMsg = t.failed_to_send || 'Failed to send';
					try {
						var errData = await response.json();
						errMsg = errData.error || errMsg;
					} catch (ex) {
						errMsg = 'Server error: ' + response.status;
					}
					throw new Error(errMsg);
				}

				var result = await response.json();

				if (result.success) {
					var sc = typeof result.successCount === 'number' ? result.successCount : 0;
					var fc = typeof result.failCount === 'number' ? result.failCount : 0;
					var errs = Array.isArray(result.errors) ? result.errors : [];
					var errDetail = errs.length
						? errs
								.slice(0, 5)
								.map(function (e) {
									return (e.chatId != null ? String(e.chatId) : '?') + ': ' + (e.error || '');
								})
								.join('\n')
						: '';
					var totalOk = sc + fc;
					var pctOk = totalOk > 0 ? Math.round((100 * sc) / totalOk) : 0;

					if (sc === 0 && fc > 0) {
						if (typeof Swal !== 'undefined') {
							Swal.fire({
								icon: 'error',
								title: t.error || 'Error',
								html:
									'<p class="mb-2">' +
									escapeSwalHtml(result.message || 'Broadcast failed') +
									'</p>' +
									'<div class="bc-swal-fill-track mb-2">' +
									'<div class="bc-swal-fill-inner" style="width:0%;background:#dc3545"></div></div>' +
									(errDetail
										? '<pre style="text-align:left;font-size:12px;max-height:200px;overflow:auto">' +
											escapeSwalHtml(errDetail) +
											'</pre>'
										: ''),
								showConfirmButton: true
							});
						}
					} else if (fc > 0) {
						if (typeof Swal !== 'undefined') {
							Swal.fire({
								icon: 'warning',
								title: t.partial_success || 'Partially sent',
								html:
									'<p class="mb-2">' +
									escapeSwalHtml(result.message || '') +
									'</p>' +
									'<div class="bc-swal-fill-track mb-2">' +
									'<div class="bc-swal-fill-inner" id="bc-partial-bar" style="width:0%;background:#ffc107"></div>' +
									'</div>' +
									(errDetail
										? '<pre style="text-align:left;font-size:12px;max-height:200px;overflow:auto">' +
											escapeSwalHtml(errDetail) +
											'</pre>'
										: ''),
								timer: 6000,
								timerProgressBar: true,
								showConfirmButton: true,
								customClass: { timerProgressBar: 'bc-swal-timer-bar' },
								didOpen: function () {
									requestAnimationFrame(function () {
										requestAnimationFrame(function () {
											var b = document.getElementById('bc-partial-bar');
											if (b) b.style.width = pctOk + '%';
										});
									});
								}
							});
						}
					} else {
						if (typeof Swal !== 'undefined') {
							Swal.fire({
								icon: 'success',
								title: t.success || 'Success!',
								html:
									'<p class="mb-2">' + escapeSwalHtml(result.message || '') + '</p>' +
									'<div class="bc-swal-fill-track">' +
									'<div class="bc-swal-fill-inner" id="bc-fullsuccess-bar" style="width:0%;background:#198754"></div>' +
									'</div>',
								timer: 3500,
								timerProgressBar: true,
								showConfirmButton: false,
								customClass: { timerProgressBar: 'bc-swal-timer-bar' },
								didOpen: function () {
									requestAnimationFrame(function () {
										requestAnimationFrame(function () {
											var b = document.getElementById('bc-fullsuccess-bar');
											if (b) b.style.width = '100%';
										});
									});
								}
							});
						}
						var instOk = bootstrap.Modal.getInstance(modal);
						if (instOk) instOk.hide();
					}
				} else {
					if (typeof Swal !== 'undefined') {
						Swal.fire({
							icon: 'error',
							title: t.error || 'Error',
							text: result.error || (t.failed_to_send || 'Failed')
						});
					}
				}
			} catch (error) {
				console.error(error);
				closeBroadcastProgressSwal();
				if (typeof Swal !== 'undefined') {
					Swal.fire({
						icon: 'error',
						title: t.error || 'Error',
						text: error.message || (t.error_occurred || 'An error occurred')
					});
				}
			} finally {
				if (submitBtn) {
					submitBtn.disabled = false;
					submitBtn.innerHTML = '<i class="fa fa-paper-plane"></i> ' + (t.send || 'Send');
				}
			}
		});
	}
});
