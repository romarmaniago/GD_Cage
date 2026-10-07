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

// Dashboard modals rendered by inline view scripts (W/L details, cash balance history)
window.gdAlignParenNumbers('#winloss-details-tbl', ['tbody td.text-end', 'tfoot th.text-end']);
window.gdAlignParenNumbers('#cash-balance-history-tbl', ['tbody td.text-end']);

// Dashboard modals rendered by dashboard_grid.js (On Game Details, Beyond Chips history)
window.gdAlignParenNumbers('#dash-on-game-details-tbl', ['tbody td.text-end']);
window.gdAlignParenNumbers('#dash-beyond-chips-history-tbl', ['tbody td.text-end', 'tbody td:nth-child(2)']);
window.gdAlignParenNumbers('#modal-guest-summary-quick-view', ['.dash-line-qv-guest-table tbody td:nth-child(n+3)', '.dash-line-qv-list-balance']);
