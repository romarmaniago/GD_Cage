(function (window) {
	'use strict';

	function getPermissions() {
		var el = document.getElementById('user-role');
		if (!el) return 99;
		return parseInt(el.getAttribute('data-permissions') || el.dataset.permissions || '99', 10);
	}

	function canEdit() {
		return getPermissions() !== 2;
	}

	function escapeHtml(value) {
		return String(value || '')
			.replace(/&/g, '&amp;')
			.replace(/</g, '&lt;')
			.replace(/>/g, '&gt;')
			.replace(/"/g, '&quot;');
	}

	function renderCell(text, options) {
		options = options || {};
		var raw = text != null ? String(text) : '';
		var displayText = options.displayText != null ? String(options.displayText) : raw;
		var source = options.source;
		var recordId = options.recordId;
		var suffixHtml = options.suffixHtml || '';
		var editable = options.editable !== false && source && recordId && canEdit();

		var safe = escapeHtml(displayText);
		var textHtml = safe || '<span class="text-muted">—</span>';

		if (!editable) {
			return (safe ? safe : '') + suffixHtml;
		}

		var enc = encodeURIComponent(raw);
		return (
			'<div class="remarks-editor-cell d-flex align-items-start gap-2 justify-content-between">' +
			'<span class="remarks-editor-text flex-grow-1 text-break">' + textHtml + '</span>' +
			'<button type="button" class="btn btn-sm btn-light border flex-shrink-0 js-edit-remarks-btn"' +
			' data-remarks-source="' + escapeHtml(source) + '"' +
			' data-record-id="' + escapeHtml(String(recordId)) + '"' +
			' data-remarks="' + enc + '"' +
			' title="Edit remarks"><i class="fa fa-pen"></i></button>' +
			'</div>' + suffixHtml
		);
	}

	function patchRemarks(source, recordId, remarks, callbacks) {
		callbacks = callbacks || {};
		$.ajax({
			url: '/remarks/' + encodeURIComponent(source) + '/' + encodeURIComponent(recordId),
			method: 'PATCH',
			contentType: 'application/json',
			data: JSON.stringify({ remarks: remarks != null ? String(remarks) : '' }),
			success: function (res) {
				if (res && res.success) {
					if (typeof callbacks.onSuccess === 'function') {
						callbacks.onSuccess(res);
					}
				} else if (typeof callbacks.onError === 'function') {
					callbacks.onError(res);
				}
			},
			error: function (xhr) {
				if (typeof callbacks.onError === 'function') {
					var msg = (xhr.responseJSON && xhr.responseJSON.message) || 'Could not update remarks.';
					callbacks.onError({ message: msg });
				}
			}
		});
	}

	function openEditor(initialValue, onSave) {
		if (!canEdit()) return;
		if (!window.Swal) {
			var val = window.prompt('Remarks', initialValue || '');
			if (val !== null && typeof onSave === 'function') onSave(val);
			return;
		}

		window.Swal.fire({
			title: 'Edit remarks',
			input: 'textarea',
			inputValue: initialValue || '',
			inputAttributes: { maxlength: '500', rows: '4' },
			showCancelButton: true,
			confirmButtonText: 'Save',
			preConfirm: function (value) {
				return value != null ? String(value) : '';
			}
		}).then(function (result) {
			if (result.isConfirmed && typeof onSave === 'function') {
				onSave(result.value != null ? String(result.value) : '');
			}
		});
	}

	function updateCell($btn, newText) {
		var $cell = $btn.closest('.remarks-editor-cell');
		var safe = escapeHtml(newText);
		$cell.find('.remarks-editor-text').html(safe || '<span class="text-muted">—</span>');
		$btn.attr('data-remarks', encodeURIComponent(newText || ''));
	}

	$(document).on('click', '.js-edit-remarks-btn', function (e) {
		e.preventDefault();
		e.stopPropagation();
		if (!canEdit()) return;

		var $btn = $(this);
		var source = $btn.data('remarks-source');
		var recordId = $btn.data('record-id');
		if (!source || !recordId) return;

		var rawRemarks = '';
		try {
			rawRemarks = decodeURIComponent(String($btn.attr('data-remarks') || ''));
		} catch (err) {
			rawRemarks = '';
		}

		openEditor(rawRemarks, function (newVal) {
			$btn.prop('disabled', true);
			patchRemarks(source, recordId, newVal, {
				onSuccess: function (res) {
					$btn.prop('disabled', false);
					updateCell($btn, res.remarks != null ? res.remarks : newVal);
					if (window.Swal) {
						window.Swal.fire({ icon: 'success', title: 'Saved', text: res.message || 'Remarks updated.', timer: 1500, showConfirmButton: false });
					}
				},
				onError: function (err) {
					$btn.prop('disabled', false);
					if (window.Swal) {
						window.Swal.fire({ icon: 'error', title: 'Error', text: (err && err.message) || 'Could not update remarks.' });
					}
				}
			});
		});
	});

	window.RemarksEditor = {
		canEdit: canEdit,
		escapeHtml: escapeHtml,
		renderCell: renderCell,
		patchRemarks: patchRemarks,
		openEditor: openEditor
	};
})(window);
