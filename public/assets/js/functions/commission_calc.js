/**
 * Single source of truth for game commission (browser side).
 * Mirrors utils/commissionCalc.js — keep both in sync.
 *
 * COMMISSION_TYPE:
 *   1 = Rolling          → |Rolling| × Rate%
 *   2 = Shared           → Win/Loss × Rate%            (can be negative)
 *   3 = Share + Rolling  → Win/Loss × Share% + |Rolling| × Rate% × RollingPct%
 *                          (share part can be negative; Share 0 / Rolling 100 = plain Rolling)
 */
(function (window) {
	'use strict';

	function toNum(value, fallback) {
		var n = Number(value);
		return isFinite(n) && value !== null && value !== '' ? n : fallback;
	}

	function pick(row, upper, lower) {
		if (!row) return undefined;
		return row[upper] !== undefined && row[upper] !== null ? row[upper] : row[lower];
	}

	function getShareRollingSplit(row) {
		return {
			sharePct: toNum(pick(row, 'SHARE_PERCENTAGE', 'share_percentage'), 0),
			rollingPct: toNum(pick(row, 'ROLLING_PERCENTAGE', 'rolling_percentage'), 100)
		};
	}

	/**
	 * @param {object} row - COMMISSION_TYPE, COMMISSION_PERCENTAGE, SHARE_PERCENTAGE, ROLLING_PERCENTAGE
	 * @param {number} winLoss
	 * @param {number} rolling
	 * @param {object} [opts] - { round: fn (default Math.round), absRolling: bool (default true) }
	 */
	function computeGameCommission(row, winLoss, rolling, opts) {
		opts = opts || {};
		var round = opts.round || Math.round;
		var absRolling = opts.absRolling !== false;
		var type = parseInt(pick(row, 'COMMISSION_TYPE', 'commission_type'), 10);
		var rate = toNum(pick(row, 'COMMISSION_PERCENTAGE', 'commission_percentage'), 0);
		var wl = toNum(winLoss, 0);
		var r = toNum(rolling, 0);
		var rollingBase = absRolling ? Math.abs(r) : r;

		// Multiply first, divide once — avoids float drift (e.g. 4,317,000 × 1.5% → 64,755).
		if (type === 1) return round((rollingBase * rate) / 100);
		if (type === 2) return round((wl * rate) / 100);
		if (type === 3) {
			var split = getShareRollingSplit(row);
			return round((wl * split.sharePct * 100 + rollingBase * rate * split.rollingPct) / 10000);
		}
		return 0;
	}

	function isRollingBasedType(commissionType) {
		var t = parseInt(commissionType, 10);
		return t === 1 || t === 3;
	}

	/** Short label, e.g. "Share + Rolling (S 50% / R 100%)". */
	function commissionTypeLabel(row) {
		var t = parseInt(pick(row, 'COMMISSION_TYPE', 'commission_type'), 10);
		if (t === 2) return 'Shared Game';
		if (t === 3) {
			var s = getShareRollingSplit(row);
			return 'Share + Rolling (S ' + s.sharePct + '% / R ' + s.rollingPct + '%)';
		}
		return 'Rolling Game';
	}

	/**
	 * Merged receipts: returns a Share + Rolling row only when EVERY game is type 3 with the
	 * same split (so rolling/W-L totals can be re-computed); otherwise null (rolling × rate).
	 */
	function mergeShareRollingRow(rows) {
		if (!rows || !rows.length) return null;
		var first = null;
		for (var i = 0; i < rows.length; i++) {
			var r = rows[i];
			if (!r || parseInt(pick(r, 'COMMISSION_TYPE', 'commission_type'), 10) !== 3) return null;
			var split = getShareRollingSplit(r);
			if (!first) first = split;
			else if (first.sharePct !== split.sharePct || first.rollingPct !== split.rollingPct) return null;
		}
		return { COMMISSION_TYPE: 3, SHARE_PERCENTAGE: first.sharePct, ROLLING_PERCENTAGE: first.rollingPct };
	}

	/**
	 * Guest / Agent receipt edit panels + split calculators. Rolling / Shared keep rolling × rate.
	 * Share + Rolling: the share part (W/L × Share%) follows the panel's share of the rolling, so a
	 * panel holding the full rolling equals the main receipt, and Guest + Agent always add up to it:
	 *   (W/L × Share% × rolling / totalRolling) + (rolling × Rate% × Rolling%)
	 */
	function computeReceiptPanelSettlement(row, winLoss, rolling, ratePercent, totalRolling) {
		if (row && parseInt(pick(row, 'COMMISSION_TYPE', 'commission_type'), 10) === 3) {
			var split = getShareRollingSplit(row);
			var r = toNum(rolling, 0);
			var total = toNum(totalRolling, 0);
			var shareFactor = total ? r / total : 1;
			var rate = toNum(ratePercent, 0);
			return Math.round((toNum(winLoss, 0) * split.sharePct * shareFactor * 100 + r * rate * split.rollingPct) / 10000);
		}
		return Math.round((rolling * ratePercent) / 100);
	}

	window.mergeShareRollingRow = mergeShareRollingRow;
	window.computeReceiptPanelSettlement = computeReceiptPanelSettlement;
	window.computeGameCommission = computeGameCommission;
	window.getShareRollingSplit = getShareRollingSplit;
	window.isRollingBasedCommissionType = isRollingBasedType;
	window.commissionTypeText = commissionTypeLabel;
})(window);
