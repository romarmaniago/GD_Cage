/**
 * Game Information receipt — same card as the Game Book settlement receipt
 * (game_list.js buildGameReceiptSlipBodyHtml, styles in modals/game_book/game_start_receipt.ejs),
 * only the header reads "* Game Information *".
 * Row data comes from $(tr).data('giReceipt') set in game_information.js.
 * Other pages reuse the card via window.GameInfoReceipt.open(data); data may override
 * header, date_label, game_line and sections (Analytics uses this).
 */
(function () {
	var HEADER = '* Game Information *';
	var html2canvasPromise = null;

	function esc(value) {
		return String(value == null ? '' : value)
			.replace(/&/g, '&amp;')
			.replace(/</g, '&lt;')
			.replace(/>/g, '&gt;')
			.replace(/"/g, '&quot;');
	}

	function fmtWhole(value) {
		return Number(value || 0).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
	}

	/** Negative -> (x) red; positive gets a hidden ")" so digits line up */
	function cardAmount(value) {
		var n = Number(value || 0);
		return n < 0
			? '(' + fmtWhole(Math.abs(n)) + ')'
			: fmtWhole(n) + '<span class="gsr-paren-pad" aria-hidden="true">)</span>';
	}

	function textAmount(value) {
		var n = Number(value || 0);
		return n < 0 ? '(' + fmtWhole(Math.abs(n)) + ')' : fmtWhole(n);
	}

	function row(label, value, rowClass, textLabel) {
		return { label: label, value: Number(value || 0), rowClass: rowClass || '', textLabel: textLabel };
	}

	function getSections(d) {
		if (d.sections) return d.sections;
		return [
			{ cls: 'gsr-section-buyin', rows: [row('* BUY IN', d.buy_in)] },
			{ cls: 'gsr-section-cashout', rows: [row('* CASH OUT', -Math.abs(d.cash_out))] },
			{ cls: 'gsr-section-summary', rows: [
				row('* WIN/LOSS', d.win_loss, '', '* WIN / LOSS'),
				row('* ROLLING', d.rolling)
			] },
			{ cls: 'gsr-section-settlement', rows: [
				row('* SETTLEMENT', d.settlement, 'gsr-settle-row'),
				row('* ADD CHARGE', d.add_charge, 'gsr-charge-row'),
				row('* PAYMENT', d.payment, 'gsr-act-row')
			] }
		];
	}

	function headerText(d) {
		return d.header || HEADER;
	}

	function displayDate(d) {
		if (d.date_label) return String(d.date_label);
		return String(d.program_date || '').replace(/-/g, '/');
	}

	function gameLine(d) {
		if (d.game_line) return String(d.game_line);
		return d.game_no ? '#' + d.game_no : '';
	}

	function buildText(d) {
		var sections = getSections(d);
		var totals = [];
		sections.slice(0, -1).forEach(function (s) {
			s.rows.forEach(function (r) { totals.push((r.textLabel || r.label) + ' ' + textAmount(r.value)); });
		});
		var settle = sections[sections.length - 1].rows.map(function (r) { return r.label + ' ' + textAmount(r.value); });
		var gameType = String(d.game_type || '').toUpperCase();
		return [
			[headerText(d), displayDate(d)],
			[String(d.agent_code || '').toUpperCase(), String(d.guest_name || '').toUpperCase(), (gameType ? gameType + ' ' : '') + gameLine(d)].filter(Boolean),
			totals,
			settle
		].map(function (b) { return b.join('\n'); }).join('\n\n');
	}

	function buildSlipHtml(d) {
		var gameType = String(d.game_type || '').toUpperCase();
		var tables = getSections(d).map(function (s) {
			var rows = s.rows.map(function (r) {
				return '<tr class="gsr-total-row' + (r.rowClass ? ' ' + r.rowClass : '') + '">' +
					'<td class="gsr-label">' + esc(r.label) + '</td>' +
					'<td class="gsr-value' + (r.value < 0 ? ' gsr-negative' : '') + '">' + cardAmount(r.value) + '</td></tr>';
			}).join('');
			return '<table class="gsr-table ' + s.cls + '"><tbody>' + rows + '</tbody></table>';
		}).join('');

		return (
			'<div class="game-start-receipt-slip game-start-receipt-slip--latest" data-receipt-text="' + esc(encodeURIComponent(buildText(d))) + '">' +
			'<div class="game-start-receipt-slip-body">' +
			'<div class="gsr-header gsr-header--gi">' + esc(headerText(d)) + '</div>' +
			'<div class="gsr-content">' +
			'<div class="gsr-meta-row"><div class="gsr-meta-tags"></div>' +
			'<div class="gsr-datetime">' + esc(displayDate(d)) + '</div>' +
			'<div class="gsr-meta-spacer"></div></div>' +
			'<p class="gsr-account">' + esc(String(d.agent_code || '').toUpperCase()) + '</p>' +
			(d.guest_name ? '<p class="gsr-guest">' + esc(String(d.guest_name).toUpperCase()) + '</p>' : '') +
			'<p class="gsr-game-no"><span class="gsr-game-type' + (gameType === 'LIVE' ? ' gsr-game-type--live' : '') + '">' + esc(gameType) + '</span> ' + esc(gameLine(d)) + '</p>' +
			tables +
			'</div>' +
			'</div>' +
			'<div class="game-start-receipt-slip-actions">' +
			'<button type="button" class="btn btn-sm game-receipt-copy-btn js-gi-receipt-copy-image">Copy image</button>' +
			'<button type="button" class="btn btn-sm game-receipt-copy-btn js-gi-receipt-copy-text">Copy text</button>' +
			'</div>' +
			'</div>'
		);
	}

	function showModal() {
		var el = document.getElementById('modal-game-start-receipt');
		if (!el) return;
		if (window.bootstrap && bootstrap.Modal) {
			bootstrap.Modal.getOrCreateInstance(el).show();
		} else {
			$(el).modal('show');
		}
	}

	function loadHtml2Canvas() {
		if (typeof html2canvas !== 'undefined') return Promise.resolve();
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

	function buildImageBlob(slipBodyEl) {
		return loadHtml2Canvas()
			.then(function () {
				return html2canvas(slipBodyEl, { backgroundColor: '#ffffff', scale: 2, useCORS: true, logging: false });
			})
			.then(function (canvas) {
				return new Promise(function (resolve, reject) {
					canvas.toBlob(function (blob) {
						if (blob) resolve(blob);
						else reject(new Error('Failed to create receipt image.'));
					}, 'image/png');
				});
			});
	}

	function copyUi($btn) {
		var originalHtml = $btn.html();
		$btn.prop('disabled', true).html('<span class="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span>');
		return {
			success: function (message) {
				if (typeof Swal !== 'undefined') {
					Swal.fire({ icon: 'success', title: 'Copied!', text: message, timer: 2000, showConfirmButton: false });
				}
			},
			error: function (err, fallback) {
				var msg = (err && err.message) ? err.message : fallback;
				if (typeof Swal !== 'undefined') Swal.fire({ icon: 'error', title: 'Copy failed', text: msg, confirmButtonText: 'OK' });
				else alert(msg);
			},
			restore: function () {
				$btn.prop('disabled', false).html(originalHtml);
			}
		};
	}

	function copyImage($btn) {
		var slipBody = $btn.closest('.game-start-receipt-slip').find('.game-start-receipt-slip-body')[0];
		if (!slipBody) return;
		var ui = copyUi($btn);
		var blobPromise = buildImageBlob(slipBody);

		if (navigator.clipboard && typeof ClipboardItem !== 'undefined') {
			// clipboard.write must start during the click gesture; the blob may resolve later.
			navigator.clipboard.write([new ClipboardItem({ 'image/png': blobPromise })])
				.then(function () { ui.success('Receipt image copied. You can paste it anywhere.'); })
				.catch(function (err) { ui.error(err, 'Unable to copy receipt image.'); })
				.finally(ui.restore);
			return;
		}

		blobPromise
			.then(function (blob) {
				var url = URL.createObjectURL(blob);
				var link = document.createElement('a');
				link.href = url;
				link.download = 'receipt.png';
				link.click();
				URL.revokeObjectURL(url);
				ui.success('Receipt image downloaded.');
			})
			.catch(function (err) { ui.error(err, 'Unable to copy receipt image.'); })
			.finally(ui.restore);
	}

	function copyText($btn) {
		var encoded = $btn.closest('.game-start-receipt-slip').attr('data-receipt-text');
		var text = encoded ? decodeURIComponent(encoded) : '';
		var ui = copyUi($btn);
		if (!text || !navigator.clipboard || typeof navigator.clipboard.writeText !== 'function') {
			ui.error(null, text ? 'Clipboard is not supported in this browser.' : 'Receipt has no text to copy.');
			ui.restore();
			return;
		}
		navigator.clipboard.writeText(text)
			.then(function () { ui.success('Receipt text copied. You can paste it anywhere.'); })
			.catch(function (err) { ui.error(err, 'Unable to copy receipt text.'); })
			.finally(ui.restore);
	}

	function setBackdrop(active) {
		$('body').toggleClass('game-start-receipt-open', active);
		document.querySelectorAll('.modal-backdrop').forEach(function (el) {
			el.classList.toggle('game-start-receipt-backdrop', active);
		});
	}

	function open(data) {
		if (!data) return;
		$('#game-receipts-container .game-receipts-track').html(buildSlipHtml(data));
		showModal();
	}

	window.GameInfoReceipt = { open: open, row: row };

	$(document).on('click', '#game_information-tbl .gi-receipt-btn', function (e) {
		e.preventDefault();
		open($(this).closest('tr').data('giReceipt'));
	});

	$(document).on('click', '.js-gi-receipt-copy-image', function (e) {
		e.preventDefault();
		copyImage($(this));
	});

	$(document).on('click', '.js-gi-receipt-copy-text', function (e) {
		e.preventDefault();
		copyText($(this));
	});

	$(document).on('shown.bs.modal', '#modal-game-start-receipt', function () {
		setBackdrop(true);
		loadHtml2Canvas().catch(function () {});
	});

	$(document).on('hidden.bs.modal', '#modal-game-start-receipt', function () {
		setBackdrop(false);
	});
})();
