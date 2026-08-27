const { getMonthEndCutoffRange } = require('./monthEndCutoffRange');

function isYmd(value) {
	return /^\d{4}-\d{2}-\d{2}$/.test(String(value || '').trim());
}

function resolveDateRange(dateFrom, dateTo) {
	const from = String(dateFrom || '').trim().slice(0, 10);
	const to = String(dateTo || '').trim().slice(0, 10);
	if (isYmd(from) && isYmd(to)) {
		return from <= to ? { dateFrom: from, dateTo: to } : { dateFrom: to, dateTo: from };
	}
	const cutoff = getMonthEndCutoffRange();
	return {
		dateFrom: cutoff.startDate,
		dateTo: cutoff.endDateApi || cutoff.endDate
	};
}

async function fetchAgentGameWinlossRows(pool, dateFrom, dateTo, agentId = null) {
	const params = [dateFrom, dateTo];
	let agentFilter = '';
	if (agentId != null && agentId !== '' && !Number.isNaN(Number(agentId))) {
		agentFilter = 'AND ag.IDNo = ?';
		params.push(Number(agentId));
	}

	const [rows] = await pool.execute(
		`SELECT
			gl.IDNo AS game_id,
			DATE_FORMAT(gl.PROGRAM_DATE, '%Y-%m-%d') AS program_date,
			DATE_FORMAT(gl.PROGRAM_DATE, '%Y-%m') AS program_month,
			ag.IDNo AS agent_id,
			ag.AGENT_CODE AS agent_code,
			ag.NAME AS agent_name,
			agency.AGENCY AS agency_name,
			gl.GAME_TYPE AS game_type,
			COALESCE(NULLIF(TRIM(g.NAME), ''), '-') AS guest_name,
			COALESCE(SUM(CASE WHEN gr.CAGE_TYPE = 1 THEN gr.NN_CHIPS + gr.CC_CHIPS ELSE 0 END), 0) AS buy_in,
			COALESCE(SUM(CASE WHEN gr.CAGE_TYPE = 2 THEN gr.NN_CHIPS + gr.CC_CHIPS ELSE 0 END), 0) AS cash_out,
			COALESCE(SUM(
				CASE
					WHEN gr.CAGE_TYPE = 3 THEN COALESCE(gr.NN_CHIPS, 0) + COALESCE(gr.AMOUNT, 0)
					WHEN gr.CAGE_TYPE = 4 THEN COALESCE(gr.AMOUNT, 0) + COALESCE(gr.NN_CHIPS, 0) + COALESCE(gr.CC_CHIPS, 0)
					WHEN gr.CAGE_TYPE = 5 AND gr.ROLLER_TRANSACTION = 2 THEN COALESCE(gr.ROLLER_CC_CHIPS, 0)
					WHEN gr.CAGE_TYPE = 2 THEN -COALESCE(gr.NN_CHIPS, 0)
					ELSE 0
				END
			), 0) AS rolling
		 FROM game_list gl
		 INNER JOIN account acc ON acc.IDNo = gl.ACCOUNT_ID
		 INNER JOIN agent ag ON ag.IDNo = acc.AGENT_ID AND ag.ACTIVE = 1
		 LEFT JOIN agency ON agency.IDNo = ag.AGENCY
		 LEFT JOIN guest g ON g.IDNo = gl.GUEST_ID
		 LEFT JOIN game_record gr ON gr.GAME_ID = gl.IDNo AND gr.ACTIVE = 1
		 WHERE gl.ACTIVE IN (1, 2)
			AND acc.ACTIVE = 1
			AND gl.PROGRAM_DATE IS NOT NULL
			AND DATE(gl.PROGRAM_DATE) BETWEEN ? AND ?
			${agentFilter}
		 GROUP BY gl.IDNo, gl.PROGRAM_DATE, ag.IDNo, ag.AGENT_CODE, ag.NAME, agency.AGENCY, gl.GAME_TYPE, g.NAME
		 ORDER BY gl.PROGRAM_DATE DESC, ag.AGENT_CODE ASC, gl.IDNo DESC`,
		params
	);

	return (rows || []).map((row) => {
		const buyIn = Number(row.buy_in) || 0;
		const cashOut = Number(row.cash_out) || 0;
		const rolling = Number(row.rolling) || 0;
		return {
			game_id: Number(row.game_id),
			program_date: row.program_date,
			program_month: row.program_month,
			agent_id: Number(row.agent_id),
			agent_code: row.agent_code || '',
			agent_name: row.agent_name || '',
			agency_name: row.agency_name || '',
			game_type: row.game_type || '',
			guest_name: row.guest_name || '-',
			buy_in: buyIn,
			cash_out: cashOut,
			win_loss: buyIn - cashOut,
			rolling: rolling
		};
	});
}

function aggregateByDay(gameRows) {
	const map = new Map();
	for (const row of gameRows) {
		const key = `${row.agent_id}|${row.program_date}`;
		if (!map.has(key)) {
			map.set(key, {
				agent_id: row.agent_id,
				agent_code: row.agent_code,
				agent_name: row.agent_name,
				agency_name: row.agency_name,
				program_date: row.program_date,
				buy_in: 0,
				cash_out: 0,
				win_loss: 0,
				rolling: 0,
				game_count: 0
			});
		}
		const agg = map.get(key);
		agg.buy_in += row.buy_in;
		agg.cash_out += row.cash_out;
		agg.win_loss += row.win_loss;
		agg.rolling += row.rolling;
		agg.game_count += 1;
	}
	return Array.from(map.values()).sort((a, b) => {
		const dateCmp = String(b.program_date).localeCompare(String(a.program_date));
		if (dateCmp !== 0) return dateCmp;
		return String(a.agent_code || '').localeCompare(String(b.agent_code || ''));
	});
}

function aggregateByMonth(gameRows) {
	const map = new Map();
	for (const row of gameRows) {
		const key = `${row.agent_id}|${row.program_month}`;
		if (!map.has(key)) {
			map.set(key, {
				agent_id: row.agent_id,
				agent_code: row.agent_code,
				agent_name: row.agent_name,
				agency_name: row.agency_name,
				program_month: row.program_month,
				buy_in: 0,
				cash_out: 0,
				win_loss: 0,
				rolling: 0,
				game_count: 0
			});
		}
		const agg = map.get(key);
		agg.buy_in += row.buy_in;
		agg.cash_out += row.cash_out;
		agg.win_loss += row.win_loss;
		agg.rolling += row.rolling;
		agg.game_count += 1;
	}
	return Array.from(map.values()).sort((a, b) => {
		const monthCmp = String(b.program_month).localeCompare(String(a.program_month));
		if (monthCmp !== 0) return monthCmp;
		return String(a.agent_code || '').localeCompare(String(b.agent_code || ''));
	});
}

function computeTotals(rows) {
	return (rows || []).reduce(
		(totals, row) => ({
			buy_in: totals.buy_in + (Number(row.buy_in) || 0),
			cash_out: totals.cash_out + (Number(row.cash_out) || 0),
			win_loss: totals.win_loss + (Number(row.win_loss) || 0),
			rolling: totals.rolling + (Number(row.rolling) || 0),
			game_count: totals.game_count + (Number(row.game_count) || 1)
		}),
		{ buy_in: 0, cash_out: 0, win_loss: 0, rolling: 0, game_count: 0 }
	);
}

async function buildAgentWinlossReport(pool, options = {}) {
	const { dateFrom, dateTo } = resolveDateRange(options.date_from, options.date_to);
	const groupBy = String(options.group_by || 'game').trim().toLowerCase();
	const gameRows = await fetchAgentGameWinlossRows(pool, dateFrom, dateTo, options.agent_id);

	let rows;
	if (groupBy === 'day') {
		rows = aggregateByDay(gameRows);
	} else if (groupBy === 'month') {
		rows = aggregateByMonth(gameRows);
	} else {
		rows = gameRows;
	}

	return {
		date_from: dateFrom,
		date_to: dateTo,
		group_by: groupBy === 'day' || groupBy === 'month' ? groupBy : 'game',
		rows,
		totals: computeTotals(rows)
	};
}

module.exports = {
	resolveDateRange,
	fetchAgentGameWinlossRows,
	aggregateByDay,
	aggregateByMonth,
	computeTotals,
	buildAgentWinlossReport
};
