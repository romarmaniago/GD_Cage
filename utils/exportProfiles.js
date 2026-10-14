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
 * @property {string} [amountNumFmt]
 * @property {number[]} [dateCols]
 * @property {number[]} [plainNumberCols]
 * @property {(headerCount: number, headers: string[]) => ExportProfile} [resolve]
 */

/** Excel accounting style: "( )" negatives in red, positives padded by the width of ")" so digits line up. */
const ALIGNED_AMOUNT_FMT = '#,##0_);[Red](#,##0);0_)';

/** @type {Record<string, ExportProfile>} */
const PROFILES = {
	// Agent Win/Loss — Per Game (10 cols) or Per Day / Per Month (8 cols)
	agentWinlossReport: {
		amountNumFmt: ALIGNED_AMOUNT_FMT,
		resolve(headerCount) {
			if (headerCount >= 10) {
				// Program Date | Game # | Agent | Line | Guest | Game Type | Buy In | Cash Out | Win/Loss | Rolling
				return {
					amountCols: [7, 8, 9, 10],
					labelCols: 6,
					leftAlignCols: [3, 4, 5],
					centerAlignCols: [1, 2, 6],
					dateCols: [1],
					plainNumberCols: [2]
				};
			}
			// Program Date / Month | Agent | Line | Games | Buy In | Cash Out | Win/Loss | Rolling
			return {
				amountCols: [4, 5, 6, 7, 8],
				labelCols: 3,
				leftAlignCols: [2, 3],
				centerAlignCols: [1],
				dateCols: [1]
			};
		}
	},
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
		// Program Date | Date & Time | Account | Guest | Amount | Type | Person(s) Involved | Description
		amountCols: [5],
		labelCols: 4,
		leftAlignCols: [3, 4, 7, 8],
		centerAlignCols: [1, 2, 6],
		dateCols: [1, 2],
		amountNumFmt: ALIGNED_AMOUNT_FMT,
		grandTotalLabel: 'TOTAL',
		grandTotalAlign: 'center',
		centerHeaders: true,
		columnWidths: [16, 17, 22, 22, 15, 10, 26, 40]
	},
	tip: {
		// Program Date | Date & Time | Account | Guest | Game # | Remarks | Roller x4 | Dealer x4
		amountCols: [8, 12],
		signedCols: [8],
		labelCols: 6,
		leftAlignCols: [3, 4, 6, 10, 14],
		centerAlignCols: [1, 2, 5, 7, 9, 11, 13],
		dateCols: [1, 2],
		plainNumberCols: [5],
		amountNumFmt: ALIGNED_AMOUNT_FMT,
		grandTotalLabel: 'TOTAL',
		grandTotalAlign: 'center',
		centerHeaders: true,
		// all 14 columns fit one screen (no side scrolling); long names / remarks wrap
		columnWidths: [11, 17, 32, 20, 8, 26, 11, 13, 8, 11, 11, 13, 8, 11],
		headerHeight: 34
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
		// Program Date | Date | Account # / Name | Guest | Type | Amount | Payment | Remarks
		amountCols: [6],
		labelCols: 5,
		leftAlignCols: [3, 4, 5, 8],
		centerAlignCols: [1, 2, 7],
		dateCols: [1, 2],
		amountNumFmt: ALIGNED_AMOUNT_FMT,
		grandTotalLabel: 'TOTAL',
		grandTotalAlign: 'center',
		centerHeaders: true,
		columnWidths: [16, 17, 32, 26, 16, 15, 12, 36]
	},
	multipurposeLedger: {
		// Date and Time | Account | Guest | Type | Currency | Amount | Approved By | Remarks
		amountCols: [6],
		// "(x)" on screen is money out → a negative number in Excel
		signedCols: [6],
		labelCols: 5,
		leftAlignCols: [2, 3, 7, 8],
		centerAlignCols: [1, 4, 5],
		dateCols: [1],
		amountNumFmt: ALIGNED_AMOUNT_FMT,
		centerHeaders: true,
		// the rows are in different currencies, so a single total would be meaningless
		skipGrandTotal: true
	},
	houseExpense: {
		// Program Date | Date & Time | Name | Amount | In-Charge | Receiver | Description
		amountCols: [4],
		labelCols: 3,
		leftAlignCols: [3, 5, 6, 7],
		centerAlignCols: [1, 2],
		dateCols: [1, 2],
		amountNumFmt: ALIGNED_AMOUNT_FMT,
		// matches the Print's total row
		grandTotalLabel: 'TOTAL EXPENSES',
		grandTotalAlign: 'center',
		centerHeaders: true,
		// Balanced like the Print (sized for wide caps such as "MINA/VINCE/YANG/JEROME") — long text wraps inside its column
		columnWidths: [16, 17, 34, 15, 14, 29, 40]
	},
	markerHistory: {
		// Date & Time | Account | Name | Credit | Credit Total | Guarantor | Balance
		amountCols: [4, 5, 7],
		labelCols: 3,
		leftAlignCols: [2, 3, 6],
		centerAlignCols: [1],
		skipGrandTotal: true,
		amountIndent: 0,
		amountNumFmt: ALIGNED_AMOUNT_FMT,
		dateCols: [1]
	},
	markerHistorySummary: {
		// Account | Name | Total | Guarantor — On Credit/Finished Credit collapsed to 1 row/account
		amountCols: [3],
		labelCols: 2,
		leftAlignCols: [2, 4],
		centerAlignCols: [1],
		skipGrandTotal: true,
		amountIndent: 0,
		amountNumFmt: ALIGNED_AMOUNT_FMT
	},
	markerBalance: {
		amountCols: [2],
		labelCols: 1,
		leftAlignCols: [1],
		amountNumFmt: ALIGNED_AMOUNT_FMT
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
		amountCols: [2, 3],
		signedCols: [2],
		labelCols: 1,
		leftAlignCols: [4, 5],
		centerAlignCols: [1],
		skipGrandTotal: true,
		amountNumFmt: '#,##0;[Red](#,##0)'
	},
	creditDetails: {
		// Cols: 1 DATE, 2 AMOUNT, 3 BALANCE, 4 TRANSACTION, 5 REMARKS — Guest Portal Credit Details modal
		amountCols: [2, 3],
		signedCols: [2, 3],
		labelCols: 1,
		leftAlignCols: [4, 5],
		centerAlignCols: [1],
		skipGrandTotal: true,
		amountNumFmt: '#,##0;[Red](#,##0)'
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
	groupGamesDetail: {
		// Cols: 1 PROGRAM DATE, 2 GAME START, 3 TYPE, 4 GAME #, 5 ACCT NO, 6 GUEST, 7 BUY-IN,
		// 8 CASH-OUT, 9 WIN/LOSS, 10 ROLLING, 11 GAME RATE, 12 COMMISSION, 13 ADD CHG,
		// 14 TOTAL SETTLE, 15 GAME END — the Categorize Group "Group Games" modal table,
		// unrelated to the main Game Information table's column order.
		amountCols: [7, 8, 9, 10, 12, 13, 14],
		outflowCols: [8, 12, 13, 14],
		signedCols: [9, 10],
		percentCols: [11],
		labelCols: 6,
		leftAlignCols: [1, 2, 15],
		centerAlignCols: [3, 4, 5, 6]
	},
	accountGameHistory: {
		// Cols: 1 PROGRAM DATE, 2 GAME START, 3 TYPE, 4 GAME #, 5 GUEST, 6 BUY-IN,
		// 7 CASH-OUT, 8 WIN/LOSS, 9 ROLLING, 10 GAME RATE, 11 COMMISSION, 12 ADD CHG,
		// 13 TOTAL SETTLE, 14 GAME END
		amountCols: [6, 7, 8, 9, 11, 12, 13],
		outflowCols: [7],
		signedCols: [8],
		labelCols: 5,
		leftAlignCols: [1, 2, 3, 4, 5, 10, 14],
		centerAlignCols: [3, 4],
		amountNumFmt: '#,##0;(#,##0)'
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
		grandTotalAlign: base.grandTotalAlign || 'left',
		centerHeaders: !!base.centerHeaders,
		columnWidths: Array.isArray(base.columnWidths) ? base.columnWidths : null,
		headerHeight: base.headerHeight || null,
		amountNumFmt: resolved.amountNumFmt || base.amountNumFmt || null,
		// "YYYY-MM-DD" / "YYYY-MM" text → real Excel dates
		dateCols: (resolved.dateCols || base.dateCols || []).filter((c) => c <= headerCount),
		// numbers shown as-is (no thousands separator), e.g. Game #
		plainNumberCols: (resolved.plainNumberCols || base.plainNumberCols || []).filter((c) => c <= headerCount),
		amountIndent: resolved.amountIndent != null ? resolved.amountIndent : base.amountIndent
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
