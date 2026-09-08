// Dashboard "Copy" buttons — render parts of the dashboard to a PNG and copy it
// to the clipboard (falling back to a download when the Clipboard API is
// missing).
//   #btn-dash-copy-image  : the two narrow summary columns (Cage Balance / Main
//                           and Current Time W/L → Anticipated Profit) side by
//                           side. The wide Rolling / W/L matrix is never included.
//   #btn-dash-rolling-copy : the Main Cage Rolling Check table (header + full,
//                           un-scrolled table + footer).
//   #btn-dash-wl-copy      : the W/L Check table, same treatment.
(function () {
	'use strict';

	var HTML2CANVAS_SRC = 'https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.min.js';
	var html2canvasPromise = null;

	var SCALE = 2;
	var BG = '#1c1c1c';

	function loadHtml2Canvas() {
		if (typeof html2canvas !== 'undefined') return Promise.resolve();
		if (html2canvasPromise) return html2canvasPromise;
		html2canvasPromise = new Promise(function (resolve, reject) {
			var script = document.createElement('script');
			script.src = HTML2CANVAS_SRC;
			script.onload = function () { resolve(); };
			script.onerror = function () {
				html2canvasPromise = null;
				reject(new Error('Failed to load the image library.'));
			};
			document.head.appendChild(script);
		});
		return html2canvasPromise;
	}

	function notifyOk(text) {
		if (typeof Swal !== 'undefined') {
			Swal.fire({ icon: 'success', title: 'Copied', text: text, timer: 1800, showConfirmButton: false });
		}
	}

	function notifyErr(text) {
		if (typeof Swal !== 'undefined') Swal.fire({ icon: 'error', title: 'Copy failed', text: text });
		else window.alert(text);
	}

	function canvasToBlob(canvas) {
		return new Promise(function (resolve, reject) {
			canvas.toBlob(function (blob) {
				if (blob) resolve(blob);
				else reject(new Error('Could not build the image.'));
			}, 'image/png');
		});
	}

	function hideCopyButtons(doc) {
		var btns = doc.querySelectorAll('#btn-dash-copy-image, .btn-dash-matrix-copy');
		Array.prototype.forEach.call(btns, function (b) { b.style.display = 'none'; });
	}

	// ---- Summary columns ----------------------------------------------------
	function shotColumn(col) {
		return html2canvas(col, {
			backgroundColor: BG, scale: SCALE, useCORS: true, logging: false,
			onclone: hideCopyButtons
		});
	}

	function renderSummaryBlob() {
		var cols = document.querySelectorAll('.dash-top-row .dash-top-stack-col');
		if (cols.length < 2) return Promise.reject(new Error('Dashboard panels not found.'));

		var gapPx = Math.max(0, Math.round(cols[1].getBoundingClientRect().left - cols[0].getBoundingClientRect().right));

		return loadHtml2Canvas()
			.then(function () { return Promise.all([shotColumn(cols[0]), shotColumn(cols[1])]); })
			.then(function (canvases) {
				var gap = gapPx * SCALE;
				var out = document.createElement('canvas');
				out.width = canvases[0].width + gap + canvases[1].width;
				out.height = Math.max(canvases[0].height, canvases[1].height);
				var ctx = out.getContext('2d');
				ctx.fillStyle = BG;
				ctx.fillRect(0, 0, out.width, out.height);
				ctx.drawImage(canvases[0], 0, 0);
				ctx.drawImage(canvases[1], canvases[0].width + gap, 0);
				return canvasToBlob(out);
			});
	}

	// ---- Rolling / W/L matrix tables --------------------------------------
	function renderMatrixBlob(kind) {
		var sel = kind === 'wl' ? '.dash-dual-matrix-col.is-wl' : '.dash-dual-matrix-col.is-rolling';
		var col = document.querySelector(sel);
		var card = col && col.querySelector('.card.dash-dual-matrix-panel');
		if (!card) return Promise.reject(new Error('Table not found.'));

		return loadHtml2Canvas()
			.then(function () {
				return html2canvas(card, {
					backgroundColor: '#F5E7BD', scale: SCALE, useCORS: true, logging: false,
					onclone: function (doc) {
						hideCopyButtons(doc);
						var clonedCol = doc.querySelector(sel);
						if (!clonedCol) return;
						var clonedCard = clonedCol.querySelector('.card.dash-dual-matrix-panel');
						if (clonedCard) { clonedCard.style.height = 'auto'; clonedCard.style.maxHeight = 'none'; }
						// Let the whole table render instead of the fixed-height scroll box.
						['.dash-matrix-panel', '.dash-matrix-scroll', '.card-body'].forEach(function (s) {
							var el = clonedCard && clonedCard.querySelector(s);
							if (el) {
								el.style.height = 'auto';
								el.style.maxHeight = 'none';
								el.style.minHeight = '0';
								el.style.overflow = 'visible';
							}
						});
					}
				});
			})
			.then(canvasToBlob);
	}

	// ---- Wiring -----------------------------------------------------------
	function runCopy(btn, blobMaker, okMsg, fileName) {
		if (!btn || btn.disabled) return;
		var originalHtml = btn.innerHTML;
		btn.disabled = true;
		btn.innerHTML = '<i class="fa fa-spinner fa-spin" aria-hidden="true"></i><span>Copying...</span>';
		var restore = function () { btn.disabled = false; btn.innerHTML = originalHtml; };

		if (navigator.clipboard && typeof ClipboardItem !== 'undefined') {
			navigator.clipboard.write([new ClipboardItem({ 'image/png': blobMaker() })])
				.then(function () { notifyOk(okMsg); })
				.catch(function (err) { notifyErr((err && err.message) || 'Unable to copy the image.'); })
				.finally(restore);
		} else {
			blobMaker()
				.then(function (blob) {
					var link = document.createElement('a');
					link.href = URL.createObjectURL(blob);
					link.download = fileName;
					document.body.appendChild(link);
					link.click();
					document.body.removeChild(link);
					URL.revokeObjectURL(link.href);
					notifyOk('Image downloaded.');
				})
				.catch(function (err) { notifyErr((err && err.message) || 'Unable to copy the image.'); })
				.finally(restore);
		}
	}

	function init() {
		var summaryBtn = document.getElementById('btn-dash-copy-image');
		if (summaryBtn) {
			summaryBtn.addEventListener('click', function () {
				runCopy(summaryBtn, renderSummaryBlob, 'Dashboard image copied. Paste it anywhere.', 'dashboard.png');
			});
		}

		document.querySelectorAll('.btn-dash-matrix-copy').forEach(function (btn) {
			btn.addEventListener('click', function () {
				var kind = btn.getAttribute('data-matrix') === 'wl' ? 'wl' : 'rolling';
				var label = kind === 'wl' ? 'W/L Check' : 'Main Cage Rolling Check';
				runCopy(btn, function () { return renderMatrixBlob(kind); },
					label + ' image copied. Paste it anywhere.',
					(kind === 'wl' ? 'wl-check' : 'main-cage-rolling-check') + '.png');
			});
		});
	}

	if (document.readyState === 'loading') {
		document.addEventListener('DOMContentLoaded', init);
	} else {
		init();
	}
})();
