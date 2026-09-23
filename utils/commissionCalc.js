/**
 * Single source of truth for game commission (server side).
 * Mirrors public/assets/js/functions/commission_calc.js — keep both in sync.
 *
 * COMMISSION_TYPE:
 *   1 = Rolling          → |Rolling| × Rate%
 *   2 = Shared           → Win/Loss × Rate%            (can be negative)
 *   3 = Share + Rolling  → Win/Loss × Share% + |Rolling| × Rate% × RollingPct%
 *                          (share part can be negative; Share 0 / Rolling 100 = plain Rolling)
 */

const COMMISSION_TYPE = Object.freeze({
	ROLLING: 1,
	SHARED: 2,
	SHARE_ROLLING: 3
});

function toNum(value, fallback = 0) {
	const n = Number(value);
	return Number.isFinite(n) ? n : fallback;
}

/** Share / Rolling split for a game row. Non type-3 rows (and missing columns) fall back to 0 / 100. */
function getShareRollingSplit(game) {
	const g = game || {};
	return {
		sharePct: toNum(g.SHARE_PERCENTAGE ?? g.share_percentage, 0),
		rollingPct: toNum(g.ROLLING_PERCENTAGE ?? g.rolling_percentage, 100)
	};
}

/**
 * @param {object} game - row with COMMISSION_TYPE, COMMISSION_PERCENTAGE, SHARE_PERCENTAGE, ROLLING_PERCENTAGE
 * @param {number} winLoss
 * @param {number} rolling
 * @param {object} [opts]
 * @param {function} [opts.round=Math.round] - rounding applied once to the final amount
 * @param {boolean} [opts.absRolling=true] - use |rolling| for the rolling part
 */
function computeGameCommission(game, winLoss, rolling, opts = {}) {
	const round = opts.round || Math.round;
	const absRolling = opts.absRolling !== false;
	const type = parseInt(game?.COMMISSION_TYPE ?? game?.commission_type, 10);
	const rate = toNum(game?.COMMISSION_PERCENTAGE ?? game?.commission_percentage, 0);
	const wl = toNum(winLoss, 0);
	const rollingBase = absRolling ? Math.abs(toNum(rolling, 0)) : toNum(rolling, 0);

	// Multiply first, divide once — avoids float drift (e.g. 4,317,000 × 1.5% → 64,755).
	if (type === COMMISSION_TYPE.ROLLING) {
		return round((rollingBase * rate) / 100);
	}
	if (type === COMMISSION_TYPE.SHARED) {
		return round((wl * rate) / 100);
	}
	if (type === COMMISSION_TYPE.SHARE_ROLLING) {
		const { sharePct, rollingPct } = getShareRollingSplit(game);
		return round((wl * sharePct * 100 + rollingBase * rate * rollingPct) / 10000);
	}
	return 0;
}

/** Rolling-based types block services larger than the commission. */
function isRollingBasedType(commissionType) {
	const t = parseInt(commissionType, 10);
	return t === COMMISSION_TYPE.ROLLING || t === COMMISSION_TYPE.SHARE_ROLLING;
}

function commissionTypeLabel(game) {
	const t = parseInt(game?.COMMISSION_TYPE, 10);
	if (t === COMMISSION_TYPE.SHARED) return 'Share';
	if (t === COMMISSION_TYPE.SHARE_ROLLING) {
		const { sharePct, rollingPct } = getShareRollingSplit(game);
		return `Share + Rolling (S ${sharePct}% / R ${rollingPct}%)`;
	}
	return 'Rolling';
}

/** Validates/normalises Share % and Rolling % from a request body (0–100). */
function parseShareRollingInput(body, fallback = {}) {
	const read = (keys, def) => {
		for (const k of keys) {
			if (body && body[k] !== undefined && body[k] !== null && String(body[k]).trim() !== '') {
				return parseFloat(String(body[k]).replace(/[,%]/g, ''));
			}
		}
		return def;
	};
	const sharePct = read(['share_percentage', 'txtSharePercentage'], toNum(fallback.sharePct, 0));
	const rollingPct = read(['rolling_percentage', 'txtRollingPercentage'], toNum(fallback.rollingPct, 100));
	if (!Number.isFinite(sharePct) || sharePct < 0 || sharePct > 100) {
		return { error: 'Share % must be between 0 and 100.' };
	}
	if (!Number.isFinite(rollingPct) || rollingPct < 0 || rollingPct > 100) {
		return { error: 'Rolling % must be between 0 and 100.' };
	}
	return { sharePct, rollingPct };
}

module.exports = {
	COMMISSION_TYPE,
	computeGameCommission,
	getShareRollingSplit,
	isRollingBasedType,
	commissionTypeLabel,
	parseShareRollingInput
};
