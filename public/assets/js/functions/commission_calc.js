/**
 * Single source of truth for game commission (browser side).
 * Mirrors utils/commissionCalc.js — keep both in sync.
 *
 * COMMISSION_TYPE:
 *   1 = Rolling          → Rolling × Rate%
 *   2 = Shared           → Win/Loss × Rate%
 *   3 = Share + Rolling  → Win/Loss × Share% + Rolling × Rate% × RollingPct%
 *                          (Share 0 / Rolling 100 = plain Rolling)
 *
 * Signed: positive = paid out to the agent; negative = the agent pays (a negative rolling or a
 * share of a guest win). Settlement posts that sign as-is (negative PAYMENT = agent pays).
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
	 * @param {object} [opts] - { round: fn (default Math.round), absRolling: bool (legacy |rolling|, default false) }
	 */
	function computeGameCommission(row, winLoss, rolling, opts) {
		opts = opts || {};
		var round = opts.round || Math.round;
		var absRolling = opts.absRolling === true;
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

	/** Standard company rolling rate — mirrors DEFAULT_ROLLING_RATE_PERCENT in utils/commissionSettlementCalc.js */
	var DEFAULT_ROLLING_RATE_PERCENT = 1.5;

	/**
	 * RATE / SHARE / ROLLING shown on settlement receipts (same as the game receipt cards):
	 *   Rolling         → game rate,  Share 0,          Rolling 100
	 *   Shared          → 1.5%,       Share game rate,  Rolling 0   (a shared game's rate IS its share %)
	 *   Share + Rolling → game rate,  its own split
	 */
	function getReceiptRateSplit(row) {
		var type = parseInt(pick(row, 'COMMISSION_TYPE', 'commission_type'), 10);
		var rate = toNum(pick(row, 'COMMISSION_PERCENTAGE', 'commission_percentage'), 0);
		if (type === 2) return { ratePct: DEFAULT_ROLLING_RATE_PERCENT, sharePct: rate, rollingPct: 0 };
		var split = type === 3 ? getShareRollingSplit(row) : { sharePct: 0, rollingPct: 100 };
		return { ratePct: rate, sharePct: split.sharePct, rollingPct: split.rollingPct };
	}

	/**
	 * Guest / Agent settlement panels with their own Rate / Share % / Rolling %:
	 *   W/L × Share% × (rolling / totalRolling) + rolling × Rate% × Rolling%
	 * With the game's own split and the full rolling this equals computeGameCommission for every type.
	 */
	function computeSplitPanelSettlement(winLoss, rolling, ratePercent, sharePct, rollingPct, totalRolling) {
		var r = toNum(rolling, 0);
		var total = toNum(totalRolling, 0);
		var shareFactor = total ? r / total : 1;
		return Math.round((toNum(winLoss, 0) * toNum(sharePct, 0) * shareFactor * 100 + r * toNum(ratePercent, 0) * toNum(rollingPct, 0)) / 10000);
	}

	window.DEFAULT_ROLLING_RATE_PERCENT = DEFAULT_ROLLING_RATE_PERCENT;
	window.getReceiptRateSplit = getReceiptRateSplit;
	window.computeSplitPanelSettlement = computeSplitPanelSettlement;
	window.mergeShareRollingRow = mergeShareRollingRow;
	window.computeReceiptPanelSettlement = computeReceiptPanelSettlement;
	window.computeGameCommission = computeGameCommission;
	window.getShareRollingSplit = getShareRollingSplit;
	window.isRollingBasedCommissionType = isRollingBasedType;
	window.commissionTypeText = commissionTypeLabel;
})(window);
