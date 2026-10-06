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

	/** Header date/time like the other receipt slips, e.g. 10/6/2026 15:13 (UTC+8). */
	function formatReceiptDateTime(value) {
		if (!value) return '';
		if (window.moment) {
			var m = window.moment.utc(value).utcOffset(8);
			if (m.isValid()) return m.format('M/D/YYYY H:mm');
		}
		var d = new Date(value);
		if (Number.isNaN(d.getTime())) {
			return String(value).slice(0, 16).replace('T', ' ');
		}
		return (d.getMonth() + 1) + '/' + d.getDate() + '/' + d.getFullYear() +
			' ' + d.getHours() + ':' + pad2(d.getMinutes());
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

	/** Amount row, Excel number format: negative (money out) → red (x); otherwise plain with a
	 *  hidden ")" so the last digits line up. `n` is already signed (see signedAmount). */
	function amountRow(label, n) {
		var formatted = Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
		var isOut = n < 0;
		var display = isOut ? '(' + formatted + ')' : formatted + '<span class="fhr-paren-pad" aria-hidden="true">)</span>';
		return '<tr><td class="fhr-label">' + escapeHtml(label) +
			'</td><td class="fhr-value' + (isOut ? ' fhr-amount-out' : '') + '">' + display + '</td></tr>';
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
			remarks: String(service.REMARKS || '').trim(),
			// Settled rows are out of the running BALANCE (same as the table Total)
			settled: (service.SERVICE_SETTLEMENT_ID != null && service.SERVICE_SETTLEMENT_ID !== '') ||
				(service.COMMISSION_SETTLEMENT_ID != null && service.COMMISSION_SETTLEMENT_ID !== '')
		};
	}

	function buttonHtml(service) {
		var data = encodeURIComponent(JSON.stringify(payloadFromService(service)));
		return '<button type="button" class="btn btn-sm btn-alt-secondary js-fnb-hotel-receipt" ' +
			'data-receipt="' + data + '" title="Receipt"><i class="fa fa-receipt"></i></button>';
	}

	function receiptSortKey(data) {
		return [
			String(data.programDate || '').slice(0, 10),
			new Date(data.encodedDt || 0).getTime() || 0,
			Number(data.id) || 0
		];
	}

	function compareSortKeys(a, b) {
		for (var i = 0; i < a.length; i++) {
			if (a[i] < b[i]) return -1;
			if (a[i] > b[i]) return 1;
		}
		return 0;
	}

	/**
	 * Running BALANCE up to and including this charge (program date, then date & time), over the
	 * rows the table shows (date range / category / search) — same rules as the table Total:
	 * signed amounts, settled rows left out. Read from the receipt buttons of that table.
	 */
	function runningBalanceFor(receiptBtn, data) {
		var table = receiptBtn && receiptBtn.closest('table');
		if (!table || !window.jQuery || !window.jQuery.fn.DataTable || !window.jQuery.fn.DataTable.isDataTable(table)) {
			return null;
		}
		var target = receiptSortKey(data);
		var balance = 0;
		window.jQuery(table).DataTable().rows({ search: 'applied' }).data().each(function (rowData) {
			var cells = Array.isArray(rowData) ? rowData : [rowData];
			cells.forEach(function (cell) {
				var match = /data-receipt="([^"]+)"/.exec(typeof cell === 'string' ? cell : '');
				if (!match) return;
				var row;
				try {
					row = JSON.parse(decodeURIComponent(match[1]));
				} catch (err) {
					return;
				}
				if (row.settled || compareSortKeys(receiptSortKey(row), target) > 0) return;
				balance += signedAmount(row.amount, row.sourceType);
			});
		});
		return balance;
	}

	function buildReceiptHtml(data, balance) {
		data = data || {};
		var accountLine = [data.account, data.name].filter(hasValue).map(escapeHtml).join(' ');
		var amountRows =
			amountRow('IN & OUT', signedAmount(data.amount, data.sourceType)) +
			(balance != null ? amountRow('BALANCE', balance) : '');
		var infoRows =
			textRow('TYPE', data.type) +
			textRow('PAYMENT', paymentLabel(data.transactionId).toUpperCase()) +
			'<tr><td class="fhr-label">DESCRIPTION</td><td class="fhr-value">' +
			escapeHtml(hasValue(data.remarks) ? data.remarks : '-') + '</td></tr>';

		return (
			'<div class="fnb-hotel-receipt-slip">' +
			'<div class="fnb-hotel-receipt-slip-body">' +
			'<div class="fhr-header">* ADD CHARGE *</div>' +
			'<div class="fhr-content">' +
			'<p class="fhr-datetime">' + escapeHtml(formatReceiptDateTime(data.encodedDt)) + '</p>' +
			(accountLine ? '<p class="fhr-account">' + accountLine + '</p>' : '') +
			'<table class="fhr-table fhr-amounts"><tbody>' + amountRows + '</tbody></table>' +
			'<table class="fhr-table fhr-info"><tbody>' + infoRows + '</tbody></table>' +
			'</div>' +
			'</div>' +
			'<div class="fnb-hotel-receipt-slip-actions">' +
			'<button type="button" class="btn fnb-hotel-receipt-copy-btn js-copy-fnb-hotel-receipt-image">Copy image</button>' +
			'<button type="button" class="btn fnb-hotel-receipt-copy-btn js-copy-fnb-hotel-receipt-text">Copy text</button>' +
			'</div>' +
			'</div>'
		);
	}

	function show(data, balance) {
		var modalEl = document.getElementById('modal-fnb-hotel-receipt');
		var container = document.getElementById('fnb-hotel-receipt-container');
		if (!modalEl || !container) return;
		container.innerHTML = buildReceiptHtml(data, balance);
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
		// Blank line between the amounts (… BALANCE) and TYPE / PAYMENT / DESCRIPTION
		var infoTable = slipBody ? slipBody.querySelector('.fhr-info') : null;
		var infoText = infoTable && infoTable.innerText ? infoTable.innerText.trim() : '';
		if (infoText && text.indexOf(infoText) > 0) {
			text = text.replace(infoText, '\n' + infoText);
		}
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
			show(data, runningBalanceFor(receiptBtn, data));
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
