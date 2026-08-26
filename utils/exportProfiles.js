/**
 * Per-module Excel export column profiles (1-based column indices; i18n-safe).
 * @typedef {object} ExportProfile
 * @property {number[]} [amountCols]
 * @property {number[]} [outflowCols]
 * @property {number[]} [signedCols]
 * @property {number[]} [percentCols]
 * @property {number} [labelCols]
 * @property {number[]} [leftAlignCols]
 * @property {number[]} [centerAlignCols]
 * @property {boolean} [skipGrandTotal]
 * @property {boolean} [zebraRows]
 * @property {boolean} [highlightTotalCol]
 * @property {string} [grandTotalLabel]
 * @property {(headerCount: number, headers: string[]) => ExportProfile} [resolve]
 */

/** @type {Record<string, ExportProfile>} */
const PROFILES = {
	gameBook: {
		amountCols: [7, 8, 9, 10, 12, 13, 14],
		outflowCols: [8, 12, 14],
		signedCols: [9],
		labelCols: 6,
		leftAlignCols: [3, 5, 6],
		resolve(headerCount) {
			const amountCols = [7, 8, 9, 10, 12, 13, 14].filter((c) => c <= headerCount);
			if (headerCount >= 16) amountCols.push(15);
			return { amountCols };
		}
	},
	commission: {
		amountCols: [8, 9, 10, 11, 13, 14, 15],
		outflowCols: [9, 13, 15],
		signedCols: [10],
		percentCols: [12],
		labelCols: 7,
		leftAlignCols: [2, 3, 5, 6]
	},
	commissionPanelModal: {
		amountCols: [2, 3, 4, 5, 7, 8, 9],
		outflowCols: [3, 7, 9],
		signedCols: [4],
		percentCols: [6],
		labelCols: 1,
		leftAlignCols: [10]
	},
	commissionAnalytics: {
		amountCols: [3, 4, 5, 6, 7, 8],
		outflowCols: [4, 6, 8],
		signedCols: [5],
		labelCols: 2,
		leftAlignCols: [2],
		skipGrandTotal: true
	},
	junketLoss: {
		amountCols: [3],
		labelCols: 2,
		leftAlignCols: [1, 2, 4, 5]
	},
	authorizedMasterAccount: {
		amountCols: [3],
		signedCols: [3],
		labelCols: 2,
		leftAlignCols: [4, 5, 6],
		centerAlignCols: [1, 2],
		skipGrandTotal: true
	},
	fnbHotel: {
		amountCols: [6],
		labelCols: 5,
		leftAlignCols: [1, 2, 3, 4, 5, 7, 8]
	},
	multipurposeLedger: {
		amountCols: [6],
		labelCols: 5,
		leftAlignCols: [1, 2, 3, 4, 5, 7, 8]
	},
	houseExpense: {
		amountCols: [4],
		labelCols: 3,
		leftAlignCols: [1, 2, 3, 5]
	},
	markerHistory: {
		amountCols: [5],
		labelCols: 3,
		leftAlignCols: [1, 3, 4, 7, 8],
		centerAlignCols: [2, 6]
	},
	markerBalance: {
		amountCols: [2],
		labelCols: 1,
		leftAlignCols: [1]
	},
	netProfit: {
		amountCols: [2, 3, 5, 6, 7, 8],
		signedCols: [3],
		percentCols: [4],
		labelCols: 1,
		leftAlignCols: [1],
		zebraRows: true
	},
	gameRecordHistory: {
		amountCols: [2, 3, 4, 5, 6, 7],
		signedCols: [4, 5, 6, 7],
		labelCols: 1,
		centerAlignCols: [1],
		skipGrandTotal: true,
		amountNumFmt: '#,##0;#,##0'
	},
	guestPortal: {
		amountCols: [3, 4],
		labelCols: 2,
		leftAlignCols: [2, 5],
		centerAlignCols: [1],
		skipGrandTotal: true,
		amountNumFmt: '#,##0;#,##0'
	},
	dailyReportMatrix: {
		labelCols: 1,
		zebraRows: true,
		highlightTotalCol: true,
		resolve(headerCount) {
			const amountCols = [];
			for (let c = 2; c <= headerCount; c++) amountCols.push(c);
			return { amountCols };
		}
	},
	gameInformation: {
		amountCols: [7, 8, 9, 10, 12, 13, 14],
		outflowCols: [8, 12, 13, 14],
		signedCols: [9, 10],
		percentCols: [11],
		labelCols: 6,
		leftAlignCols: [1, 2, 3, 4, 5, 6, 15],
		centerAlignCols: [3, 4, 5, 6]
	},
	categorizeGroupSummary: {
		amountCols: [4, 5, 6, 7, 8, 9, 10],
		outflowCols: [5, 8, 9, 10],
		signedCols: [6, 7],
		labelCols: 3,
		leftAlignCols: [1, 2],
		centerAlignCols: [3]
	}
};

/**
 * @param {string} profileKey
 * @param {number} headerCount
 * @param {string[]} [headers]
 * @returns {ExportProfile & { amountCols: number[], outflowCols: number[], signedCols: number[], percentCols: number[], labelCols: number }}
 */
function resolveExportProfile(profileKey, headerCount, headers) {
	let key = profileKey;
	if (!key || !PROFILES[key]) {
		key = inferProfileKey(headerCount, headers);
	}
	const base = PROFILES[key] || PROFILES.gameBook;
	const resolved = base.resolve ? base.resolve(headerCount, headers || []) : {};
	const amountCols = (resolved.amountCols || base.amountCols || []).filter((c) => c <= headerCount);
	return {
		amountCols,
		outflowCols: (resolved.outflowCols || base.outflowCols || []).filter((c) => c <= headerCount),
		signedCols: (resolved.signedCols || base.signedCols || []).filter((c) => c <= headerCount),
		percentCols: (resolved.percentCols || base.percentCols || []).filter((c) => c <= headerCount),
		labelCols: resolved.labelCols != null ? resolved.labelCols : (base.labelCols != null ? base.labelCols : 1),
		leftAlignCols: resolved.leftAlignCols || base.leftAlignCols || [],
		centerAlignCols: resolved.centerAlignCols || base.centerAlignCols || [],
		skipGrandTotal: resolved.skipGrandTotal != null ? resolved.skipGrandTotal : !!base.skipGrandTotal,
		zebraRows: resolved.zebraRows != null ? resolved.zebraRows : !!base.zebraRows,
		highlightTotalCol: resolved.highlightTotalCol != null ? resolved.highlightTotalCol : !!base.highlightTotalCol,
		grandTotalLabel: base.grandTotalLabel || 'GRAND TOTAL',
		amountNumFmt: resolved.amountNumFmt || base.amountNumFmt || null
	};
}

/**
 * @param {number} headerCount
 * @param {string[]} [headers]
 * @returns {string}
 */
function inferProfileKey(headerCount, headers) {
	if (headerCount === 16) return 'commission';
	if (headerCount === 10) return 'commissionPanelModal';
	if (headerCount === 15) return 'gameBook';
	if (headerCount === 2) return 'markerBalance';
	if (headerCount === 5 && headers) {
		const h1 = String(headers[1] || '').toLowerCase();
		const h3 = String(headers[3] || '').toLowerCase();
		if (h1.includes('transaction') || h1.includes('amount')) return 'markerHistory';
		if (h3.includes('amount')) return 'houseExpense';
		return 'junketLoss';
	}
	if (headerCount === 8 && headers) {
		const h0 = String(headers[0] || '').toLowerCase();
		if (h0.includes('rank') || h0 === 'account name') return 'commissionAnalytics';
		if (h0.includes('month') || h0.includes('program')) return 'netProfit';
		if (h0.includes('agent') || h0.includes('game')) return 'dailyReportMatrix';
		return 'fnbHotel';
	}
	if (headerCount >= 9) return 'dailyReportMatrix';
	return 'junketLoss';
}

module.exports = { PROFILES, resolveExportProfile, inferProfileKey };
