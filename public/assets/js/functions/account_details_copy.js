// Account Info modal (views/modals/accounts/account_details.ejs): copy the GOLDEN DRAGON
// details card to the clipboard as an image or as plain text.
(function () {
	'use strict';

	var btnCopyGdDetails = document.getElementById('btn-copy-gd-details');
	var btnCopyGdDetailsText = document.getElementById('btn-copy-gd-details-text');

	// Spinner while copying, "Copied" on success, error popup on failure, then the button's own label again
	var runGdDetailsCopy = function (btn, copyFn) {
		var label = btn.innerHTML;
		var copiedText = btn.getAttribute('data-copied') || 'Copied';
		var failText = btn.getAttribute('data-fail') || 'Copy failed';
		btn.disabled = true;
		btn.innerHTML = '<span class="spinner-border spinner-border-sm" role="status"></span>';
		Promise.resolve()
			.then(function () { return copyFn(failText); })
			.then(function () {
				btn.innerHTML = '<i class="fa fa-check me-1"></i>' + copiedText;
			})
			.catch(function (err) {
				if (typeof Swal !== 'undefined') {
					Swal.fire({ icon: 'error', title: failText, text: (err && err.message) || '' });
				} else {
					alert((err && err.message) || failText);
				}
			})
			.finally(function () {
				setTimeout(function () {
					btn.disabled = false;
					btn.innerHTML = label;
				}, 1200);
			});
	};

	if (btnCopyGdDetails) {
		var ensureGdHtml2Canvas = function (failText) {
			if (typeof html2canvas !== 'undefined') return Promise.resolve();
			if (typeof loadGuestPortalReceiptHtml2Canvas === 'function') return loadGuestPortalReceiptHtml2Canvas();
			return new Promise(function (resolve, reject) {
				var s = document.createElement('script');
				s.src = 'https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.min.js';
				s.onload = function () { resolve(); };
				s.onerror = function () { reject(new Error(failText)); };
				document.head.appendChild(s);
			});
		};

		btnCopyGdDetails.addEventListener('click', function () {
			var target = document.getElementById('gd-details-capture');
			if (!target) return;
			runGdDetailsCopy(btnCopyGdDetails, function (failText) {
				return ensureGdHtml2Canvas(failText)
					.then(function () {
						return html2canvas(target, {
							backgroundColor: '#ffffff',
							scale: 2,
							useCORS: true,
							logging: false,
							ignoreElements: function (el) { return el.id === 'gd-details-copy-actions'; }
						});
					})
					.then(function (canvas) {
						return new Promise(function (resolve, reject) {
							canvas.toBlob(function (blob) {
								if (blob) resolve(blob);
								else reject(new Error(failText));
							}, 'image/png');
						});
					})
					.then(function (blob) {
						if (!navigator.clipboard || typeof ClipboardItem === 'undefined') {
							throw new Error(failText);
						}
						return navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
					});
			});
		});
	}

	// Plain-text version of the card: "Label: value" per row, a blank line between sections
	var buildGdDetailsText = function (target) {
		var clean = function (el) { return el ? el.textContent.replace(/\s+/g, ' ').trim() : ''; };
		var lines = [];
		Array.prototype.forEach.call(target.querySelectorAll('table tbody tr'), function (tr) {
			if (tr.classList.contains('passport-section-gap')) {
				lines.push('');
				return;
			}
			var title = tr.querySelector('.passport-section-title');
			if (title) {
				lines.push(clean(title));
				return;
			}
			var label = clean(tr.querySelector('th'));
			if (label) lines.push(label + ': ' + clean(tr.querySelector('td')));
		});
		return lines.join('\n').trim();
	};

	if (btnCopyGdDetailsText) {
		btnCopyGdDetailsText.addEventListener('click', function () {
			var target = document.getElementById('gd-details-capture');
			if (!target) return;
			runGdDetailsCopy(btnCopyGdDetailsText, function (failText) {
				var text = buildGdDetailsText(target);
				if (!text || !navigator.clipboard || typeof navigator.clipboard.writeText !== 'function') {
					throw new Error(failText);
				}
				return navigator.clipboard.writeText(text);
			});
		});
	}
})();
