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
	var parenWidthByFont = {};

	// Width of ")" in the font the value is drawn with (cached per font)
	function closingParenWidth(el) {
		var cs = window.getComputedStyle(el.lastElementChild || el);
		var font = cs.fontStyle + ' ' + cs.fontWeight + ' ' + cs.fontSize + ' ' + cs.fontFamily;
		if (parenWidthByFont[font] === undefined) {
			if (!measureCtx) measureCtx = document.createElement('canvas').getContext('2d');
			measureCtx.font = font;
			parenWidthByFont[font] = measureCtx.measureText(')').width;
		}
		return parenWidthByFont[font];
	}

	// Write → read → write in three passes. Interleaving a style write with a
	// getComputedStyle read per cell forced a full layout for EVERY cell, which
	// froze big tables (thousands of rows on "Show All").
	function alignParenNumbers(root, targets) {
		var els = root.querySelectorAll(targets);
		var i;
		var el;

		// 1) Clear previous nudges (writes only)
		for (i = 0; i < els.length; i++) {
			el = els[i];
			if (el.style.paddingRight) el.style.paddingRight = '';
			if (el.style.marginRight) el.style.marginRight = '';
		}

		// 2) Measure the negatives (reads only — one layout for the whole pass)
		var jobs = [];
		for (i = 0; i < els.length; i++) {
			el = els[i];
			if (!/\d\)$/.test((el.textContent || '').trim())) continue;
			jobs.push({
				el: el,
				w: closingParenWidth(el),
				padRight: parseFloat(window.getComputedStyle(el).paddingRight) || 0
			});
		}

		// 3) Apply (writes only). Cells with their own padding: the ")" moves into
		// the padding; values without any slide into their row's padding instead.
		for (i = 0; i < jobs.length; i++) {
			var job = jobs[i];
			if (job.padRight > 0) job.el.style.setProperty('padding-right', Math.max(0, job.padRight - job.w) + 'px', 'important');
			else job.el.style.marginRight = -job.w + 'px';
		}
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
