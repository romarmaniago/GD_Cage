/**
 * Split a marker return across Cash Credit (junket) then Game Credit (buy-in).
 * @param {number} balanceCredit
 * @param {number} balanceBuyin
 * @param {number} returnAmount
 * @returns {{ source: 'credit'|'buyin', amount: number }[]}
 */
function allocateMarkerReturn(balanceCredit, balanceBuyin, returnAmount) {
	const creditBal = Math.max(0, Number(balanceCredit) || 0);
	const buyinBal = Math.max(0, Number(balanceBuyin) || 0);
	let remaining = Math.max(0, Number(returnAmount) || 0);
	const allocations = [];

	const fromCredit = Math.min(remaining, creditBal);
	if (fromCredit > 0) {
		allocations.push({ source: 'credit', amount: fromCredit });
		remaining -= fromCredit;
	}

	const fromBuyin = Math.min(remaining, buyinBal);
	if (fromBuyin > 0) {
		allocations.push({ source: 'buyin', amount: fromBuyin });
	}

	return allocations;
}

function getMarkerReturnSourceDesc(source) {
	return source === 'credit' ? 'RETURN_SOURCE:CREDIT' : 'RETURN_SOURCE:BUYIN';
}

const MARKER_SOURCE_BALANCE_QUERY = `
	SELECT
		SUM(CASE WHEN account_ledger.TRANSACTION_ID = 3 AND account_ledger.TRANSACTION_TYPE = 3 THEN account_ledger.AMOUNT ELSE 0 END) AS CREDIT_ISSUED,
		SUM(CASE WHEN account_ledger.TRANSACTION_ID IN (11, 12, 1) AND account_ledger.TRANSACTION_DESC = 'RETURN_SOURCE:CREDIT' THEN account_ledger.AMOUNT ELSE 0 END) AS RETURNS_TAGGED_CREDIT,
		SUM(CASE WHEN (account_ledger.TRANSACTION_ID IN (11, 12, 1) AND account_ledger.TRANSACTION_DESC = 'RETURN_SOURCE:BUYIN') OR (account_ledger.TRANSACTION_ID IN (11, 12) AND (account_ledger.TRANSACTION_DESC IS NULL OR TRIM(account_ledger.TRANSACTION_DESC) = '')) OR (account_ledger.TRANSACTION_ID = 1 AND account_ledger.TRANSACTION_TYPE = 4) THEN account_ledger.AMOUNT ELSE 0 END) AS RETURNS_TAGGED_BUYIN,
		SUM(CASE
			WHEN account_ledger.TRANSACTION_ID IN (11, 12, 1)
				AND NOT (account_ledger.TRANSACTION_ID = 1 AND account_ledger.TRANSACTION_TYPE = 4)
				AND (account_ledger.TRANSACTION_DESC IS NULL OR account_ledger.TRANSACTION_DESC NOT IN ('RETURN_SOURCE:CREDIT', 'RETURN_SOURCE:BUYIN'))
				AND NOT (account_ledger.TRANSACTION_ID IN (11, 12) AND (account_ledger.TRANSACTION_DESC IS NULL OR TRIM(account_ledger.TRANSACTION_DESC) = ''))
			THEN account_ledger.AMOUNT
			ELSE 0
		END) AS RETURNS_UNTAGGED,
		SUM(CASE WHEN account_ledger.TRANSACTION_ID IN (3, 10) THEN account_ledger.AMOUNT ELSE 0 END) AS TOTAL_ISSUED
	FROM account_ledger
	WHERE account_ledger.ACCOUNT_ID = ?
		AND account_ledger.TRANSACTION_TYPE IN (3, 4)
		AND account_ledger.ACTIVE = 1
`;

function computeMarkerSourceBalances(row) {
	const data = row || {};
	const creditIssued = Number(data.CREDIT_ISSUED) || 0;
	const returnsTaggedCredit = Number(data.RETURNS_TAGGED_CREDIT) || 0;
	const returnsTaggedBuyin = Number(data.RETURNS_TAGGED_BUYIN) || 0;
	const returnsUntagged = Number(data.RETURNS_UNTAGGED) || 0;
	const totalIssued = Number(data.TOTAL_ISSUED) || 0;
	const proportionalUntaggedCredit = totalIssued > 0 ? (returnsUntagged * creditIssued / totalIssued) : 0;
	const balanceCredit = Math.round(Math.max(0, creditIssued - returnsTaggedCredit - proportionalUntaggedCredit));
	const totalAmount = Math.round(totalIssued - returnsTaggedCredit - returnsTaggedBuyin - returnsUntagged);
	const balanceBuyin = Math.max(0, totalAmount - balanceCredit);
	return { balanceCredit, balanceBuyin, totalAmount };
}

async function getMarkerSourceBalances(db, accountId) {
	const [rows] = await db.query(MARKER_SOURCE_BALANCE_QUERY, [accountId]);
	return computeMarkerSourceBalances(rows[0]);
}

module.exports = {
	allocateMarkerReturn,
	getMarkerReturnSourceDesc,
	getMarkerSourceBalances,
	computeMarkerSourceBalances
};
