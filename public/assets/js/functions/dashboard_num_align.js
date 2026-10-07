// Dashboard amounts: digits line up right-to-left no matter the sign.
// Negatives print as "(54,660,000)". Positive values stay where they are; a
// negative value is nudged right by the width of its closing ")" so the
// parenthesis hangs outside the digit column:
//    328,000,000
//    (54,660,000)
// The panels are re-rendered by several scripts, so this is re-applied
// whenever their content changes.
(function () {
	'use strict';

	var TARGETS = [
		'.dash-kv:not(.dash-kv-balance-total) > .dash-kv-value',
		'.dash-cage-balance-diff > .dash-kv-value',
		'.dash-rolling-body-cell.is-col-casino',
		'.dash-rolling-body-cell.is-col-gold',
		'.dash-wl-body-cell.is-col-casino',
		'.dash-wl-body-cell.is-col-gold',
		'.dash-wl-body-cell.is-col-diff'
	].join(',');

	var measureCtx = null;

	// Width of ")" in the font the value is drawn with
	function closingParenWidth(el) {
		if (!measureCtx) measureCtx = document.createElement('canvas').getContext('2d');
		var cs = window.getComputedStyle(el.lastElementChild || el);
		measureCtx.font = cs.fontStyle + ' ' + cs.fontWeight + ' ' + cs.fontSize + ' ' + cs.fontFamily;
		return measureCtx.measureText(')').width;
	}

	function alignDashNumbers(root) {
		Array.prototype.forEach.call(root.querySelectorAll(TARGETS), function (el) {
			el.style.paddingRight = '';
			el.style.marginRight = '';
			if (!/\d\)$/.test((el.textContent || '').trim())) return;

			var w = closingParenWidth(el);
			var padRight = parseFloat(window.getComputedStyle(el).paddingRight) || 0;
			// Table cells carry their own padding (and a border), so the ")" moves into the padding;
			// panel values have none, so they slide into the row's padding instead.
			if (padRight > 0) el.style.paddingRight = Math.max(0, padRight - w) + 'px';
			else el.style.marginRight = -w + 'px';
		});
	}

	function init() {
		var root = document.querySelector('.dash-top-row');
		if (!root) return;
		alignDashNumbers(root);
		if (document.fonts && document.fonts.ready) {
			document.fonts.ready.then(function () { alignDashNumbers(root); });
		}
		if (typeof MutationObserver === 'undefined') return;

		var queued = false;
		new MutationObserver(function () {
			if (queued) return;
			queued = true;
			window.requestAnimationFrame(function () {
				queued = false;
				alignDashNumbers(root);
			});
		}).observe(root, { childList: true, characterData: true, subtree: true });
	}

	if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
	else init();
})();
