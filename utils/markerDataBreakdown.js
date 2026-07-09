const MARKER_ACCOUNT_BREAKDOWN_SUBQUERY = `
			SELECT sub.ACCOUNT_ID, sub.AGENT_ID, sub.AGENT_CODE, sub.AGENT_NAME,
				ROUND(
					GREATEST(
						0,
						sub.CREDIT_ISSUED -
						sub.RETURNS_TAGGED_CREDIT -
						COALESCE(sub.RETURNS_UNTAGGED * sub.CREDIT_ISSUED / NULLIF(sub.TOTAL_ISSUED, 0), 0)
					),
					0
				) AS BALANCE_CREDIT,
				ROUND(
					sub.TOTAL_ISSUED - sub.RETURNS_TAGGED_CREDIT - sub.RETURNS_TAGGED_BUYIN - sub.RETURNS_UNTAGGED,
					0
				) AS TOTAL_AMOUNT
			FROM (
				SELECT account.IDNo AS ACCOUNT_ID, agent.IDNo AS AGENT_ID, agent.AGENT_CODE, agent.NAME AS AGENT_NAME,
					SUM(CASE WHEN account_ledger.TRANSACTION_ID = 3 AND account_ledger.TRANSACTION_TYPE = 3 THEN account_ledger.AMOUNT ELSE 0 END) AS CREDIT_ISSUED,
					SUM(CASE WHEN account_ledger.TRANSACTION_ID = 10 AND account_ledger.TRANSACTION_TYPE = 3 THEN account_ledger.AMOUNT ELSE 0 END) AS BUYIN_ISSUED,
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
				FROM agent
				JOIN account ON agent.IDNo = account.AGENT_ID
				JOIN account_ledger ON account.IDNo = account_ledger.ACCOUNT_ID
				WHERE account_ledger.TRANSACTION_TYPE IN (3, 4) AND account_ledger.ACTIVE = 1 AND account.ACTIVE = 1 AND agent.ACTIVE = 1
				GROUP BY account.IDNo, agent.IDNo, agent.AGENT_CODE, agent.NAME
				HAVING (
					SUM(CASE WHEN account_ledger.TRANSACTION_ID IN (3, 10) THEN account_ledger.AMOUNT ELSE 0 END) -
					SUM(CASE WHEN account_ledger.TRANSACTION_ID IN (11, 12, 1) THEN account_ledger.AMOUNT ELSE 0 END)
				) <> 0
			) sub`;

function getMarkerDataBreakdownSql() {
	return `
		SELECT inner_sub.ACCOUNT_ID, inner_sub.AGENT_ID, inner_sub.AGENT_CODE, inner_sub.AGENT_NAME,
			inner_sub.BALANCE_CREDIT,
			inner_sub.TOTAL_AMOUNT - inner_sub.BALANCE_CREDIT AS BALANCE_BUYIN,
			inner_sub.TOTAL_AMOUNT
		FROM (
${MARKER_ACCOUNT_BREAKDOWN_SUBQUERY}
		) inner_sub`;
}

function getMarkerGrandTotalSql() {
	return `
		SELECT COALESCE(SUM(inner_sub.TOTAL_AMOUNT), 0) AS JUNKET_CREDIT
		FROM (
${MARKER_ACCOUNT_BREAKDOWN_SUBQUERY}
		) inner_sub`;
}

module.exports = {
	getMarkerDataBreakdownSql,
	getMarkerGrandTotalSql
};
