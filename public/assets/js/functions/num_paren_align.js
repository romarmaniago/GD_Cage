// Amount columns: digits line up right-to-left no matter the sign.
// Negatives print as "(54,660,000)". Positive values stay where they are; a
// negative value is nudged right by the width of its closing ")" so the
// parenthesis hangs outside the digit column:
//    328,000,000
//    (54,660,000)
//
// Usage: window.gdAlignParenNumbers(rootSelector, targetSelectors)
// The targets are re-checked whenever the root's content changes (re-rendered
// panels, DataTables redraws).
(function () {
	'use strict';

	var measureCtx = null;

	// Width of ")" in the font the value is drawn with
	function closingParenWidth(el) {
		if (!measureCtx) measureCtx = document.createElement('canvas').getContext('2d');
		var cs = window.getComputedStyle(el.lastElementChild || el);
		measureCtx.font = cs.fontStyle + ' ' + cs.fontWeight + ' ' + cs.fontSize + ' ' + cs.fontFamily;
		return measureCtx.measureText(')').width;
	}

	function alignParenNumbers(root, targets) {
		Array.prototype.forEach.call(root.querySelectorAll(targets), function (el) {
			el.style.paddingRight = '';
			el.style.marginRight = '';
			if (!/\d\)$/.test((el.textContent || '').trim())) return;

			var w = closingParenWidth(el);
			var padRight = parseFloat(window.getComputedStyle(el).paddingRight) || 0;
			// Cells with their own padding: the ")" moves into the padding;
			// values without any slide into their row's padding instead.
			if (padRight > 0) el.style.paddingRight = Math.max(0, padRight - w) + 'px';
			else el.style.marginRight = -w + 'px';
		});
	}

	function watch(rootSelector, targets) {
		var root = document.querySelector(rootSelector);
		if (!root) return;
		alignParenNumbers(root, targets);
		if (document.fonts && document.fonts.ready) {
			document.fonts.ready.then(function () { alignParenNumbers(root, targets); });
		}
		if (typeof MutationObserver === 'undefined') return;

		var queued = false;
		new MutationObserver(function () {
			if (queued) return;
			queued = true;
			window.requestAnimationFrame(function () {
				queued = false;
				alignParenNumbers(root, targets);
			});
		}).observe(root, { childList: true, characterData: true, subtree: true });
	}

	window.gdAlignParenNumbers = function (rootSelector, targetSelectors) {
		var targets = [].concat(targetSelectors).join(',');
		var start = function () { watch(rootSelector, targets); };
		if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
		else start();
	};
})();
