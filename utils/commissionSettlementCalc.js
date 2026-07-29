function parseRatePercent(value) {
	const n = parseFloat(String(value == null ? '' : value).replace(/%/g, '').replace(/,/g, ''));
	return Number.isFinite(n) ? n : 0;
}

/** Map game_list commission type to Excel Share % / Rolling % decimals (0.5 = 50%). */
function getShareRollingPct(commissionType, commissionPercentage) {
	const rate = parseRatePercent(commissionPercentage);
	const type = parseInt(commissionType, 10);
	const shareDecimal = rate / 100;
	if (type === 2) {
		return { sharePct: shareDecimal, rollingPct: 0 };
	}
	if (type === 1 || type === 3) {
		// Excel: rolling settlement uses column H as multiplier on G25 rolling rate.
		return { sharePct: 0, rollingPct: 1 };
	}
	return { sharePct: 0, rollingPct: 0 };
}

/**
 * Excel settlement formulas (settlement.xlsx):
 * - W/L = Buy In - Cash Out
 * - Settlement (M) = -W/L * Share% + (-Rolling * Rolling% * rollingRate)
 * - Actual Settlement (Q) = -Rolling * rollingRate
 */
function computeSettlementAmounts({ winLoss, rolling, sharePct, rollingPct, rollingRateDecimal }) {
	const rate = Number.isFinite(rollingRateDecimal) ? rollingRateDecimal : 0.015;
	const sharePart = Math.round(-winLoss * sharePct);
	const rollingPart = Math.round(-rolling * rollingPct * rate);
	const settlement = sharePart + rollingPart;
	const actualSettlement = Math.round(-rolling * rate);
	return { sharePart, rollingPart, settlement, actualSettlement };
}

function categorizeGameServices(services) {
	let fnb = 0;
	let hotel = 0;
	let incidental = 0;

	(services || []).forEach((item) => {
		const amt = (parseFloat(item.AMOUNT) || 0) + (parseFloat(item.DELIVERY_FEE) || 0);
		const svc = String(item.SERVICE_TYPE || '').toLowerCase().trim();
		if (svc === 'hotel') {
			hotel += amt;
		} else if (svc === 'fnb' || svc === 'f & b') {
			fnb += amt;
		} else {
			incidental += amt;
		}
	});

	return {
		fnb: Math.round(fnb),
		hotel: Math.round(hotel),
		incidental: Math.round(incidental)
	};
}

function formatPctDisplay(decimal) {
	if (!decimal) return '0%';
	const pct = Math.round(decimal * 10000) / 100;
	return parseFloat(pct.toFixed(2)) + '%';
}

const DEFAULT_ROLLING_RATE_PERCENT = 1.5;

module.exports = {
	parseRatePercent,
	getShareRollingPct,
	computeSettlementAmounts,
	categorizeGameServices,
	formatPctDisplay,
	DEFAULT_ROLLING_RATE_PERCENT
};
