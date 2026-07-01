/** Match house_expense.js houseExpenseIsApprovedForTotals: status 1 only (return money handled separately). */
const SQL_HOUSE_EXPENSE_APPROVED_ONLY = 'COALESCE(APPROVAL_STATUS, 1) = 1';

function sqlJunketExpenseResetTotal() {
	return `SELECT SUM(AMOUNT) AS RESET_EXPENSE
		FROM junket_house_expense
		WHERE ACTIVE = 1 AND RESET = 1 AND ${SQL_HOUSE_EXPENSE_APPROVED_ONLY}`;
}

function sqlJunketExpenseTotal() {
	return `SELECT SUM(AMOUNT) AS JUNKET_EXPENSE
		FROM junket_house_expense
		WHERE ACTIVE = 1 AND ${SQL_HOUSE_EXPENSE_APPROVED_ONLY}`;
}

function sqlJunketExpenseGoodsTotal() {
	return `SELECT SUM(jhe.AMOUNT) AS JUNKET_EXPENSE_GOODS
		FROM junket_house_expense jhe
		JOIN expense_category ec ON ec.IDNo = jhe.CATEGORY_ID
		WHERE jhe.ACTIVE = 1
			AND ec.TYPE = 1
			AND ${SQL_HOUSE_EXPENSE_APPROVED_ONLY.replace(/APPROVAL_STATUS/g, 'jhe.APPROVAL_STATUS')}`;
}

function sqlJunketExpenseNonGoodsTotal() {
	return `SELECT SUM(jhe.AMOUNT) AS JUNKET_EXPENSE_NON_GOODS
		FROM junket_house_expense jhe
		JOIN expense_category ec ON ec.IDNo = jhe.CATEGORY_ID
		WHERE jhe.ACTIVE = 1
			AND ec.TYPE = 2
			AND ${SQL_HOUSE_EXPENSE_APPROVED_ONLY.replace(/APPROVAL_STATUS/g, 'jhe.APPROVAL_STATUS')}`;
}

module.exports = {
	SQL_HOUSE_EXPENSE_APPROVED_ONLY,
	sqlJunketExpenseResetTotal,
	sqlJunketExpenseTotal,
	sqlJunketExpenseGoodsTotal,
	sqlJunketExpenseNonGoodsTotal
};
