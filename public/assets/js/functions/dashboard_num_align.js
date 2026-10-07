// Dashboard amounts: digits line up right-to-left no matter the sign
// (see num_paren_align.js). Balance Total is centered on its own, so it is left out.
window.gdAlignParenNumbers('.dash-top-row', [
	'.dash-kv:not(.dash-kv-balance-total) > .dash-kv-value',
	'.dash-cage-balance-diff > .dash-kv-value',
	'.dash-rolling-body-cell.is-col-casino',
	'.dash-rolling-body-cell.is-col-gold',
	'.dash-wl-body-cell.is-col-casino',
	'.dash-wl-body-cell.is-col-gold',
	'.dash-wl-body-cell.is-col-diff'
]);
