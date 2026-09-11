function sqlJunketReturnMoneyResetTotal() {
	return `SELECT SUM(AMOUNT) AS RESET_RETURN_MONEY
		FROM junket_return_money
		WHERE ACTIVE = 1 AND RESET = 1 AND MONTHLY_SETTLE_ID IS NULL`;
}

function sqlJunketReturnMoneyTotal() {
	return `SELECT SUM(AMOUNT) AS JUNKET_RETURN_MONEY
		FROM junket_return_money
		WHERE ACTIVE = 1`;
}

module.exports = {
	sqlJunketReturnMoneyResetTotal,
	sqlJunketReturnMoneyTotal
};
