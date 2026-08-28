/*
 * Shared "Add Charge" (F&B / Hotel / Incidental / Delivery / Others) receipt slip.
 * Used by the junket Add Charge page and the dashboard service detail modals.
 *
 * window.fnbHotelReceipt.buttonHtml(service) -> receipt button markup for an action cell
 * window.fnbHotelReceipt.show(data)          -> render + open the receipt modal
 */
(function (window, document) {
	if (window.fnbHotelReceipt) return;

	function escapeHtml(value) {
		return String(value == null ? '' : value)
			.replace(/&/g, '&amp;')
			.replace(/</g, '&lt;')
			.replace(/>/g, '&gt;')
			.replace(/"/g, '&quot;')
			.replace(/'/g, '&#39;');
	}

	function pad2(n) {
		return String(n).padStart(2, '0');
	}

	function formatReceiptDate(value) {
		if (!value) return '';
		var raw = String(value).slice(0, 10);
		if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
		if (typeof window.fmtDate === 'function') {
			return window.fmtDate(value, '') || '';
		}
		var d = new Date(value);
		if (Number.isNaN(d.getTime())) return '';
		return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
	}

	function formatReceiptDateTime(value) {
		if (!value) return '';
		if (typeof window.fmtDtUtc8 === 'function') {
			var out = window.fmtDtUtc8(value, '');
			if (out) return out;
		}
		var d = new Date(value);
		if (Number.isNaN(d.getTime())) {
			return String(value).slice(0, 16).replace('T', ' ');
		}
		return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()) +
			' ' + pad2(d.getHours()) + ':' + pad2(d.getMinutes());
	}

	function paymentLabel(transactionId) {
		switch (parseInt(transactionId, 10)) {
			case 1: return 'Cash';
			case 2: return 'Deposit';
			case 3: return 'Settle';
			default: return '';
		}
	}

	function hasValue(value) {
		if (value == null) return false;
		if (typeof value === 'number') return Number.isFinite(value) && value !== 0;
		var s = String(value).trim();
		return s !== '' && s !== '-' && s !== '—';
	}

	function textRow(label, value) {
		if (!hasValue(value)) return '';
		return '<tr><td class="fhr-label">' + escapeHtml(label) +
			'</td><td class="fhr-value">' + escapeHtml(String(value)) + '</td></tr>';
	}

	/** Signed like window.formatServiceChargeAmount: legacy positive JUNKET rows are outflow. */
	function signedAmount(value, sourceType) {
		var n = Number(value) || 0;
		if (n > 0 && String(sourceType || '').toUpperCase() === 'JUNKET') n = -n;
		return n;
	}

	function amountRow(label, value, sourceType) {
		var n = signedAmount(value, sourceType);
		var abs = Math.abs(n);
		var formatted = abs.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
		var display = n < 0 ? '(' + formatted + ')' : formatted;
		var cls = n < 0 ? 'fhr-amount-value' : 'fhr-amount-pos';
		return '<tr class="fhr-total-row"><td class="fhr-label fhr-total-label">' + escapeHtml(label) +
			'</td><td class="fhr-value ' + cls + '">' + display + '</td></tr>';
	}

	function payloadFromService(service) {
		service = service || {};
		return {
			id: service.IDNo,
			programDate: String(service.PROGRAM_DATE || '').slice(0, 10),
			encodedDt: service.ENCODED_DT || '',
			account: String(service.agent_code || '').trim(),
			name: String(service.agent_name || '').trim(),
			guest: String(service.guest_name || '').trim(),
			type: String(service.SERVICE_TYPE || '').trim(),
			amount: service.AMOUNT,
			sourceType: String(service.SOURCE_TYPE || '').trim(),
			transactionId: service.TRANSACTION_ID,
			remarks: String(service.REMARKS || '').trim()
		};
	}

	function buttonHtml(service) {
		var data = encodeURIComponent(JSON.stringify(payloadFromService(service)));
		return '<button type="button" class="btn btn-sm btn-alt-secondary js-fnb-hotel-receipt" ' +
			'data-receipt="' + data + '" title="Receipt"><i class="fa fa-receipt"></i></button>';
	}

	function buildReceiptHtml(data) {
		data = data || {};
		var titleText = data.type ? ('* ' + data.type + ' *') : '* Add Charge *';
		var rowsHtml =
			textRow('PROGRAM DATE', formatReceiptDate(data.programDate)) +
			textRow('ACCOUNT', data.account) +
			textRow('NAME', data.name) +
			amountRow('AMOUNT', data.amount, data.sourceType) +
			textRow('REMARKS', data.remarks);

		return (
			'<div class="fnb-hotel-receipt-slip">' +
			'<div class="fnb-hotel-receipt-slip-body">' +
			'<p class="fhr-brand">GOLDEN DRAGON</p>' +
			'<p class="fhr-title">' + escapeHtml(titleText) + '</p>' +
			'<p class="fhr-datetime">' + escapeHtml(formatReceiptDateTime(data.encodedDt)) + '</p>' +
			'<table class="fhr-table"><tbody>' + rowsHtml + '</tbody></table>' +
			'</div>' +
			'<div class="fnb-hotel-receipt-slip-actions">' +
			'<button type="button" class="btn fnb-hotel-receipt-copy-btn js-copy-fnb-hotel-receipt-image">Copy image</button>' +
			'<button type="button" class="btn fnb-hotel-receipt-copy-btn js-copy-fnb-hotel-receipt-text">Copy text</button>' +
			'</div>' +
			'</div>'
		);
	}

	function show(data) {
		var modalEl = document.getElementById('modal-fnb-hotel-receipt');
		var container = document.getElementById('fnb-hotel-receipt-container');
		if (!modalEl || !container) return;
		container.innerHTML = buildReceiptHtml(data);
		if (window.jQuery) window.jQuery(modalEl).appendTo('body');
		// Stack above an open dashboard service detail modal.
		if (document.getElementById('modal-dash-fnb') || document.getElementById('modal-dash-service-category')) {
			modalEl.style.zIndex = '1065';
		}
		if (window.bootstrap && window.bootstrap.Modal) {
			window.bootstrap.Modal.getOrCreateInstance(modalEl).show();
		} else if (window.jQuery && window.jQuery(modalEl).modal) {
			window.jQuery(modalEl).modal('show');
		}
	}

	var html2canvasPromise = null;
	function loadHtml2Canvas() {
		if (typeof window.html2canvas !== 'undefined') return Promise.resolve();
		if (html2canvasPromise) return html2canvasPromise;
		html2canvasPromise = new Promise(function (resolve, reject) {
			var script = document.createElement('script');
			script.src = 'https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.min.js';
			script.onload = function () { resolve(); };
			script.onerror = function () {
				html2canvasPromise = null;
				reject(new Error('Failed to load image copy library.'));
			};
			document.body.appendChild(script);
		});
		return html2canvasPromise;
	}

	function copyUi(btn) {
		var originalHtml = btn.innerHTML;
		btn.disabled = true;
		btn.innerHTML = '<span class="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span>';
		return {
			success: function (message) {
				if (typeof window.Swal !== 'undefined') {
					window.Swal.fire({ icon: 'success', title: 'Copied!', text: message, timer: 1800, showConfirmButton: false });
				}
			},
			error: function (message) {
				if (typeof window.Swal !== 'undefined') {
					window.Swal.fire({ icon: 'error', title: 'Copy failed', text: message });
				}
			},
			restore: function () {
				btn.disabled = false;
				btn.innerHTML = originalHtml;
			}
		};
	}

	function copyImage(btn) {
		var slip = btn.closest('.fnb-hotel-receipt-slip');
		var slipBody = slip ? slip.querySelector('.fnb-hotel-receipt-slip-body') : null;
		if (!slipBody) return;
		var ui = copyUi(btn);
		var blobPromise = loadHtml2Canvas()
			.then(function () {
				return window.html2canvas(slipBody, { backgroundColor: '#ffffff', scale: 2, useCORS: true, logging: false });
			})
			.then(function (canvas) {
				return new Promise(function (resolve, reject) {
					canvas.toBlob(function (blob) {
						if (blob) resolve(blob);
						else reject(new Error('Failed to create receipt image.'));
					}, 'image/png');
				});
			});

		if (navigator.clipboard && typeof window.ClipboardItem !== 'undefined') {
			navigator.clipboard
				.write([new window.ClipboardItem({ 'image/png': blobPromise })])
				.then(function () { ui.success('Receipt image copied. You can paste it anywhere.'); })
				.catch(function (err) { ui.error((err && err.message) || 'Unable to copy receipt image.'); })
				.finally(function () { ui.restore(); });
		} else {
			blobPromise
				.then(function (blob) {
					var link = document.createElement('a');
					link.href = URL.createObjectURL(blob);
					link.download = 'add-charge-receipt.png';
					document.body.appendChild(link);
					link.click();
					document.body.removeChild(link);
					ui.success('Receipt image downloaded.');
				})
				.catch(function (err) { ui.error((err && err.message) || 'Unable to copy receipt image.'); })
				.finally(function () { ui.restore(); });
		}
	}

	function copyText(btn) {
		var slip = btn.closest('.fnb-hotel-receipt-slip');
		var slipBody = slip ? slip.querySelector('.fnb-hotel-receipt-slip-body') : null;
		var text = slipBody && slipBody.innerText ? slipBody.innerText.trim() : '';
		var ui = copyUi(btn);
		if (!text || !navigator.clipboard || typeof navigator.clipboard.writeText !== 'function') {
			ui.error('Clipboard is not supported in this browser.');
			ui.restore();
			return;
		}
		navigator.clipboard
			.writeText(text)
			.then(function () { ui.success('Receipt text copied. You can paste it anywhere.'); })
			.catch(function (err) { ui.error((err && err.message) || 'Unable to copy receipt text.'); })
			.finally(function () { ui.restore(); });
	}

	document.addEventListener('click', function (event) {
		var receiptBtn = event.target.closest('.js-fnb-hotel-receipt');
		if (receiptBtn) {
			var raw = receiptBtn.getAttribute('data-receipt') || '';
			var data = {};
			try {
				data = JSON.parse(decodeURIComponent(raw));
			} catch (err) {
				data = {};
			}
			show(data);
			return;
		}
		var imageBtn = event.target.closest('.js-copy-fnb-hotel-receipt-image');
		if (imageBtn) {
			copyImage(imageBtn);
			return;
		}
		var textBtn = event.target.closest('.js-copy-fnb-hotel-receipt-text');
		if (textBtn) {
			copyText(textBtn);
		}
	});

	(function () {
		var modalEl = document.getElementById('modal-fnb-hotel-receipt');
		if (!modalEl) return;
		modalEl.addEventListener('shown.bs.modal', function () {
			document.body.classList.add('fnb-hotel-receipt-open');
			loadHtml2Canvas().catch(function () {});
		});
		modalEl.addEventListener('hidden.bs.modal', function () {
			document.body.classList.remove('fnb-hotel-receipt-open');
		});
	})();

	window.fnbHotelReceipt = {
		buttonHtml: buttonHtml,
		buildHtml: buildReceiptHtml,
		show: show
	};
})(window, document);
