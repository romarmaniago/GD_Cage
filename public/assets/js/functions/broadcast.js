// Guest broadcast (by chat ID) — separate from announcement.js / agent list
document.addEventListener('DOMContentLoaded', function () {
	const form = document.getElementById('form-new-broadcast');
	const messageInput = document.getElementById('broadcast-message');
	const chatIdsInput = document.getElementById('broadcast-chat-ids');
	const pictureInput = document.getElementById('broadcast-picture');
	const picturePreview = document.getElementById('broadcast-picture-preview');
	const picturePreviewContainer = document.getElementById('broadcast-picture-preview-container');
	const removePictureBtn = document.getElementById('broadcast-remove-picture-btn');
	const submitBtn = document.getElementById('submit-broadcast-btn');
	const modal = document.getElementById('modal-new-broadcast');
	var t = window.broadcastModalTranslations || {};

	function parseChatIdsFromTextarea(text) {
		var lines = String(text || '').split(/\r?\n/);
		var out = [];
		var seen = {};
		for (var i = 0; i < lines.length; i++) {
			var s = lines[i].trim();
			if (!s || s.length > 200) continue;
			if (seen[s]) continue;
			seen[s] = true;
			out.push(s);
		}
		return out;
	}

	if (pictureInput && picturePreview && picturePreviewContainer) {
		pictureInput.addEventListener('change', function (e) {
			var file = e.target.files[0];
			if (file) {
				var reader = new FileReader();
				reader.onload = function (ev) {
					picturePreview.src = ev.target.result;
					picturePreviewContainer.classList.remove('d-none');
				};
				reader.readAsDataURL(file);
			}
		});
	}

	if (removePictureBtn && pictureInput && picturePreview && picturePreviewContainer) {
		removePictureBtn.addEventListener('click', function () {
			pictureInput.value = '';
			picturePreview.src = '';
			picturePreviewContainer.classList.add('d-none');
		});
	}

	if (modal && form) {
		modal.addEventListener('hidden.bs.modal', function () {
			form.reset();
			if (picturePreview) picturePreview.src = '';
			if (picturePreviewContainer) picturePreviewContainer.classList.add('d-none');
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

					if (sc === 0 && fc > 0) {
						Swal.fire({
							icon: 'error',
							title: t.error || 'Error',
							text: (result.message || 'Broadcast failed') + (errDetail ? '\n\n' + errDetail : '')
						});
					} else if (fc > 0) {
						Swal.fire({
							icon: 'warning',
							title: t.partial_success || 'Partially sent',
							html:
								'<p>' +
								(result.message || '') +
								'</p><pre style="text-align:left;font-size:12px;max-height:200px;overflow:auto">' +
								(errDetail || '') +
								'</pre>'
						});
					} else {
						Swal.fire({
							icon: 'success',
							title: t.success || 'Success!',
							text: result.message,
							timer: 3500,
							showConfirmButton: false
						});
						var instOk = bootstrap.Modal.getInstance(modal);
						if (instOk) instOk.hide();
					}
				} else {
					Swal.fire({
						icon: 'error',
						title: t.error || 'Error',
						text: result.error || (t.failed_to_send || 'Failed')
					});
				}
			} catch (error) {
				console.error(error);
				Swal.fire({
					icon: 'error',
					title: t.error || 'Error',
					text: error.message || (t.error_occurred || 'An error occurred')
				});
			} finally {
				if (submitBtn) {
					submitBtn.disabled = false;
					submitBtn.innerHTML = '<i class="fa fa-paper-plane"></i> ' + (t.send || 'Send');
				}
			}
		});
	}
});
