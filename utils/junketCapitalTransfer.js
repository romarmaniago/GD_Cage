/**
 * House balance (junket_capital) Transfer ↔ account_ledger helpers.
 *
 * Sign convention (matches frontend signed amount):
 *   house txn 2 (-) = house out → account deposit (txn 1)
 *   house txn 1 (+) = house in  → account withdraw (txn 2)
 */

const HOUSE_BALANCE_TRANSFER_DESC_OUT = 'TRANSFERRED FROM HOUSE BALANCE';
const HOUSE_BALANCE_TRANSFER_DESC_IN = 'TRANSFERRED TO HOUSE BALANCE';

/** Mirror entries in account_ledger — house side is already in junket_capital. */
const SQL_EXCLUDE_HOUSE_BALANCE_LEDGER = `COALESCE(account_ledger.TRANSACTION_DESC, '') NOT IN ('${HOUSE_BALANCE_TRANSFER_DESC_OUT}', '${HOUSE_BALANCE_TRANSFER_DESC_IN}')`;
const SQL_EXCLUDE_HOUSE_BALANCE_LEDGER_AL = `COALESCE(al.TRANSACTION_DESC, '') NOT IN ('${HOUSE_BALANCE_TRANSFER_DESC_OUT}', '${HOUSE_BALANCE_TRANSFER_DESC_IN}')`;

function stripHtml(value) {
	return String(value || '').replace(/<[^>]*>/g, '').trim();
}

function isCapitalTransferType(description) {
	return stripHtml(description) === 'Transfer';
}

function parseAccountId(raw) {
	if (raw === undefined || raw === null || raw === '') return null;
	const n = parseInt(raw, 10);
	return !Number.isNaN(n) && n > 0 ? n : null;
}

async function getAccountCashBalance(connection, accountId) {
	const balanceQuery = `
		SELECT transaction_type.TRANSACTION, account_ledger.AMOUNT
		FROM account_ledger
		JOIN transaction_type ON transaction_type.IDNo = account_ledger.TRANSACTION_ID
		WHERE account_ledger.TRANSACTION_TYPE IN (2, 5, 3)
		  AND account_ledger.ACCOUNT_ID = ?
		  AND account_ledger.ACTIVE = 1
	`;
	const [rows] = await connection.execute(balanceQuery, [accountId]);

	let depositAmount = 0;
	let withdrawAmount = 0;
	let markerRedeemAmount = 0;
	let markerReturnDeposit = 0;

	(rows || []).forEach((row) => {
		const amount = parseFloat(row.AMOUNT) || 0;
		if (row.TRANSACTION === 'DEPOSIT') depositAmount += amount;
		if (row.TRANSACTION === 'WITHDRAW') withdrawAmount += amount;
		if (row.TRANSACTION === 'MARKER REDEEM') markerRedeemAmount += amount;
		if (row.TRANSACTION === 'IOU RETURN DEPOSIT') markerReturnDeposit += amount;
	});

	return depositAmount + markerRedeemAmount - withdrawAmount - markerReturnDeposit;
}

async function validateActiveAccount(connection, accountId) {
	const [rows] = await connection.execute(
		`SELECT acc.IDNo
		 FROM account acc
		 JOIN agent ag ON ag.IDNo = acc.AGENT_ID
		 WHERE acc.IDNo = ? AND acc.ACTIVE = 1 AND ag.ACTIVE = 1
		 LIMIT 1`,
		[accountId]
	);
	return rows && rows[0] ? rows[0] : null;
}

async function getAccountDisplayLabel(connection, accountId) {
	const [rows] = await connection.execute(
		`SELECT ag.AGENT_CODE, ag.NAME
		 FROM account acc
		 JOIN agent ag ON ag.IDNo = acc.AGENT_ID
		 WHERE acc.IDNo = ?
		 LIMIT 1`,
		[accountId]
	);
	if (!rows || !rows[0]) return '';
	const code = rows[0].AGENT_CODE ? String(rows[0].AGENT_CODE).trim() : '';
	const name = rows[0].NAME ? String(rows[0].NAME).trim() : '';
	if (code && name) return `${code} - ${name}`;
	return code || name || '';
}

function mergeTransferRemarks(userRemarks, accountLabel) {
	const label = String(accountLabel || '').trim();
	const notes = String(userRemarks || '').trim();
	if (!label) return notes;
	if (!notes) return label;
	if (notes.includes(label)) return notes;
	return `${label} — ${notes}`;
}

async function buildCapitalTransferRemarks(connection, accountId, userRemarks) {
	const label = await getAccountDisplayLabel(connection, accountId);
	return mergeTransferRemarks(userRemarks, label);
}

async function insertCapitalTransferAccountLedger(connection, {
	accountId,
	amount,
	houseTxn,
	remarks,
	userId,
	dateNow
}) {
	const houseTxnNum = parseInt(houseTxn, 10);
	const accountTxnId = houseTxnNum === 2 ? 1 : 2;
	const transactionDesc =
		houseTxnNum === 2 ? HOUSE_BALANCE_TRANSFER_DESC_OUT : HOUSE_BALANCE_TRANSFER_DESC_IN;
	const ledgerRemarks = String(remarks || '').trim() || transactionDesc;

	const [result] = await connection.execute(
		`INSERT INTO account_ledger (
			ACCOUNT_ID, TRANSACTION_ID, TRANSACTION_TYPE, TRANSACTION_DESC,
			AMOUNT, REMARKS, ENCODED_BY, ENCODED_DT
		) VALUES (?, ?, 2, ?, ?, ?, ?, ?)`,
		[accountId, accountTxnId, transactionDesc, amount, ledgerRemarks, userId, dateNow]
	);
	return result.insertId;
}

async function updateCapitalTransferAccountLedger(connection, {
	accountLedgerId,
	accountId,
	amount,
	houseTxn,
	remarks,
	userId,
	dateNow
}) {
	const houseTxnNum = parseInt(houseTxn, 10);
	const accountTxnId = houseTxnNum === 2 ? 1 : 2;
	const transactionDesc =
		houseTxnNum === 2 ? HOUSE_BALANCE_TRANSFER_DESC_OUT : HOUSE_BALANCE_TRANSFER_DESC_IN;
	const ledgerRemarks = String(remarks || '').trim() || transactionDesc;

	await connection.execute(
		`UPDATE account_ledger
		 SET ACCOUNT_ID = ?, TRANSACTION_ID = ?, TRANSACTION_TYPE = 2,
		     TRANSACTION_DESC = ?, AMOUNT = ?, REMARKS = ?,
		     EDITED_BY = ?, EDITED_DT = ?
		 WHERE IDNo = ? AND ACTIVE = 1`,
		[accountId, accountTxnId, transactionDesc, amount, ledgerRemarks, userId, dateNow, accountLedgerId]
	);
}

async function archiveCapitalTransferAccountLedger(connection, accountLedgerId, userId, dateNow) {
	if (!accountLedgerId) return;
	await connection.execute(
		`UPDATE account_ledger
		 SET ACTIVE = 0, EDITED_BY = ?, EDITED_DT = ?
		 WHERE IDNo = ? AND ACTIVE = 1`,
		[userId, dateNow, accountLedgerId]
	);
}

module.exports = {
	HOUSE_BALANCE_TRANSFER_DESC_OUT,
	HOUSE_BALANCE_TRANSFER_DESC_IN,
	SQL_EXCLUDE_HOUSE_BALANCE_LEDGER,
	SQL_EXCLUDE_HOUSE_BALANCE_LEDGER_AL,
	stripHtml,
	isCapitalTransferType,
	parseAccountId,
	getAccountCashBalance,
	validateActiveAccount,
	getAccountDisplayLabel,
	mergeTransferRemarks,
	buildCapitalTransferRemarks,
	insertCapitalTransferAccountLedger,
	updateCapitalTransferAccountLedger,
	archiveCapitalTransferAccountLedger
};
