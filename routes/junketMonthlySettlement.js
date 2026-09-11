const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const { checkSession } = require('./auth');
const { getNextSettlementWindow, toIsoDate } = require('../utils/monthEndCutoffRange');
const { SQL_HOUSE_EXPENSE_APPROVED_ONLY } = require('../utils/houseExpenseQueries');
const {
	computeExpenseForPeriod,
	computeJunketLossForPeriod,
	computeAdditionalCommissionForPeriod,
	computeServiceCategoryAmountForPeriod
} = require('../utils/dashboardPeriodSummary');
const { resolveActiveServiceCategory } = require('../utils/serviceCategoryHelpers');

/**
 * Per-category Junket Monthly Settlement — independent from the legacy
 * month_settle (chips/rolling) mechanism. Each category (Expense, Loss,
 * Additional Commission, F&B, Hotel, Incidental) is settled on its own
 * schedule via its own page button, sharing one history table
 * (junket_monthly_settlement, distinguished by CATEGORY) and one new
 * MONTHLY_SETTLE_ID column per source table. Does not read/write the
 * existing RESET column on junket_house_expense / junket_return_money.
 */

const SERVICE_TABLE_UPDATE = async (connection, id, from, to, serviceKey) => {
	const label = await resolveActiveServiceCategory(connection, serviceKey);
	if (!label) return;
	await connection.execute(
		`UPDATE game_services
		 SET MONTHLY_SETTLE_ID = ?
		 WHERE MONTHLY_SETTLE_ID IS NULL AND ACTIVE = 1 AND SERVICE_TYPE = ?
		   AND COALESCE(PROGRAM_DATE, DATE(ENCODED_DT)) BETWEEN ? AND ?`,
		[id, label, from, to]
	);
};

const CATEGORY_CONFIG = {
	expense: {
		tables: ['junket_house_expense', 'junket_return_money'],
		computeAmount: (conn, from, to) => computeExpenseForPeriod(conn, from, to),
		applyTag: async (connection, id, from, to) => {
			await connection.execute(
				`UPDATE junket_house_expense
				 SET MONTHLY_SETTLE_ID = ?
				 WHERE MONTHLY_SETTLE_ID IS NULL AND ACTIVE = 1 AND ${SQL_HOUSE_EXPENSE_APPROVED_ONLY}
				   AND COALESCE(PROGRAM_DATE, DATE(ENCODED_DT)) BETWEEN ? AND ?`,
				[id, from, to]
			);
			await connection.execute(
				`UPDATE junket_return_money
				 SET MONTHLY_SETTLE_ID = ?
				 WHERE MONTHLY_SETTLE_ID IS NULL AND ACTIVE = 1
				   AND COALESCE(PROGRAM_DATE, DATE(ENCODED_DT)) BETWEEN ? AND ?`,
				[id, from, to]
			);
		}
	},
	loss: {
		tables: ['junket_loss'],
		computeAmount: (conn, from, to) => computeJunketLossForPeriod(conn, from, to),
		applyTag: async (connection, id, from, to) => {
			await connection.execute(
				`UPDATE junket_loss
				 SET MONTHLY_SETTLE_ID = ?
				 WHERE MONTHLY_SETTLE_ID IS NULL AND ACTIVE = 1
				   AND PROGRAM_DATE BETWEEN ? AND ?`,
				[id, from, to]
			);
		}
	},
	additional_commission: {
		tables: ['additional_commission'],
		computeAmount: (conn, from, to) => computeAdditionalCommissionForPeriod(conn, from, to),
		applyTag: async (connection, id, from, to) => {
			await connection.execute(
				`UPDATE additional_commission
				 SET MONTHLY_SETTLE_ID = ?
				 WHERE MONTHLY_SETTLE_ID IS NULL AND ACTIVE = 1
				   AND DATE(COALESCE(PROGRAM_DATE, ENCODED_DT)) BETWEEN ? AND ?`,
				[id, from, to]
			);
		}
	}
};

['fnb', 'hotel', 'incidental'].forEach((key) => {
	CATEGORY_CONFIG[key] = {
		tables: ['game_services'],
		computeAmount: (conn, from, to) => computeServiceCategoryAmountForPeriod(conn, from, to, key),
		applyTag: (connection, id, from, to) => SERVICE_TABLE_UPDATE(connection, id, from, to, key)
	};
});

function getCategoryConfig(category) {
	return CATEGORY_CONFIG[String(category || '').trim()] || null;
}

function toYmd(value) {
	if (value instanceof Date) return toIsoDate(value);
	return String(value || '').slice(0, 10);
}

function buildPeriodLabel(window) {
	return `${window.startDisplay} - ${window.endDisplay}`;
}

function todayYmd() {
	return toIsoDate(new Date());
}

async function getLastSettledPeriodEnd(conn, category) {
	const [rows] = await conn.execute(
		`SELECT PERIOD_END FROM junket_monthly_settlement WHERE CATEGORY = ? AND ACTIVE = 1 ORDER BY PERIOD_END DESC LIMIT 1`,
		[category]
	);
	return rows && rows[0] ? toYmd(rows[0].PERIOD_END) : null;
}

async function resolveWindowForCategory(conn, category) {
	const lastEnd = await getLastSettledPeriodEnd(conn, category);
	return getNextSettlementWindow(lastEnd);
}

// GET /junket-monthly-settlement/check?category=expense
router.get('/junket-monthly-settlement/check', checkSession, async (req, res) => {
	const category = req.query.category;
	const cfg = getCategoryConfig(category);
	if (!cfg) return res.status(400).json({ canSettle: false, message: 'Invalid category.' });

	try {
		const window = await resolveWindowForCategory(pool, category);
		const dateFrom = window.startDate;
		const dateTo = window.endDate;
		const periodLabel = buildPeriodLabel(window);

		if (dateTo > todayYmd()) {
			return res.json({ canSettle: false, message: `Cannot settle ${periodLabel} yet - cycle has not ended.`, periodLabel });
		}

		const [existing] = await pool.execute(
			`SELECT IDNo FROM junket_monthly_settlement WHERE CATEGORY = ? AND ACTIVE = 1 AND PERIOD_START = ? AND PERIOD_END = ? LIMIT 1`,
			[category, dateFrom, dateTo]
		);
		if (existing && existing.length > 0) {
			return res.json({ canSettle: false, message: `${periodLabel} has already been settled.`, periodLabel });
		}

		res.json({ canSettle: true, periodLabel, dateFrom, dateTo });
	} catch (err) {
		console.error('junket-monthly-settlement/check:', err);
		res.status(500).json({ canSettle: false, message: 'Unable to check settle status.' });
	}
});

// GET /junket-monthly-settlement/preview?category=expense
router.get('/junket-monthly-settlement/preview', checkSession, async (req, res) => {
	const category = req.query.category;
	const cfg = getCategoryConfig(category);
	if (!cfg) return res.status(400).json({ error: 'Invalid category.' });

	try {
		const window = await resolveWindowForCategory(pool, category);
		const dateFrom = window.startDate;
		const dateTo = window.endDate;
		const amount = await cfg.computeAmount(pool, dateFrom, dateTo);
		res.json({ periodLabel: buildPeriodLabel(window), dateFrom, dateTo, amount });
	} catch (err) {
		console.error('junket-monthly-settlement/preview:', err);
		res.status(500).json({ error: 'Unable to compute settlement preview.' });
	}
});

// POST /junket-monthly-settlement/settle  body: { categories: string[] }
router.post('/junket-monthly-settlement/settle', checkSession, async (req, res) => {
	const encodedBy = req.session && req.session.user_id;
	if (!encodedBy) return res.status(401).json({ error: 'Not authenticated' });

	const categories = Array.isArray(req.body && req.body.categories) ? req.body.categories : [];
	if (categories.length === 0) return res.status(400).json({ error: 'At least one category is required.' });

	const invalid = categories.filter((c) => !getCategoryConfig(c));
	if (invalid.length > 0) return res.status(400).json({ error: `Invalid category: ${invalid.join(', ')}` });

	let connection;
	try {
		connection = await pool.getConnection();
		await connection.beginTransaction();

		const settlements = [];
		for (const category of categories) {
			const cfg = getCategoryConfig(category);
			const window = await resolveWindowForCategory(connection, category);
			const dateFrom = window.startDate;
			const dateTo = window.endDate;
			const periodLabel = buildPeriodLabel(window);

			if (dateTo > todayYmd()) {
				throw new Error(`Cannot settle ${category} for ${periodLabel} yet - cycle has not ended.`);
			}

			const amount = await cfg.computeAmount(connection, dateFrom, dateTo);

			let insertResult;
			try {
				[insertResult] = await connection.execute(
					`INSERT INTO junket_monthly_settlement (CATEGORY, PERIOD_START, PERIOD_END, PERIOD_LABEL, AMOUNT, ENCODED_BY, ENCODED_DT)
					 VALUES (?, ?, ?, ?, ?, ?, NOW())`,
					[category, dateFrom, dateTo, periodLabel, amount, encodedBy]
				);
			} catch (insertErr) {
				if (insertErr && insertErr.code === 'ER_DUP_ENTRY') {
					throw new Error(`${category} for ${periodLabel} has already been settled.`);
				}
				throw insertErr;
			}

			const monthlySettleId = insertResult.insertId;
			await cfg.applyTag(connection, monthlySettleId, dateFrom, dateTo);

			settlements.push({ category, id: monthlySettleId, amount, periodLabel, dateFrom, dateTo });
		}

		await connection.commit();
		res.json({ success: true, settlements });
	} catch (err) {
		if (connection) { try { await connection.rollback(); } catch (_) {} }
		console.error('junket-monthly-settlement/settle:', err);
		res.status(400).json({ success: false, message: err.message || 'Error settling period.' });
	} finally {
		if (connection) connection.release();
	}
});

// POST /junket-monthly-settlement/undo  body: { ids: number[] }
router.post('/junket-monthly-settlement/undo', checkSession, async (req, res) => {
	const editedBy = req.session && req.session.user_id;
	if (!editedBy) return res.status(401).json({ error: 'Not authenticated' });

	const ids = Array.isArray(req.body && req.body.ids)
		? req.body.ids.map((n) => Number(n)).filter((n) => Number.isInteger(n) && n > 0)
		: [];
	if (ids.length === 0) return res.status(400).json({ error: 'At least one settlement id is required.' });

	let connection;
	try {
		connection = await pool.getConnection();
		await connection.beginTransaction();

		for (const id of ids) {
			const [rows] = await connection.execute(
				`SELECT IDNo, CATEGORY, ACTIVE FROM junket_monthly_settlement WHERE IDNo = ? LIMIT 1 FOR UPDATE`,
				[id]
			);
			if (!rows || rows.length === 0) throw new Error(`Settlement ${id} not found.`);
			const row = rows[0];
			if (Number(row.ACTIVE) === 0) throw new Error(`Settlement ${id} is already undone.`);

			const [latestRows] = await connection.execute(
				`SELECT IDNo FROM junket_monthly_settlement WHERE CATEGORY = ? AND ACTIVE = 1 ORDER BY PERIOD_END DESC, IDNo DESC LIMIT 1`,
				[row.CATEGORY]
			);
			if (!latestRows || latestRows.length === 0 || Number(latestRows[0].IDNo) !== Number(id)) {
				throw new Error(`Only the latest ${row.CATEGORY} settlement can be undone.`);
			}

			const cfg = getCategoryConfig(row.CATEGORY);
			if (cfg) {
				for (const table of cfg.tables) {
					await connection.execute(
						`UPDATE ${table} SET MONTHLY_SETTLE_ID = NULL WHERE MONTHLY_SETTLE_ID = ?`,
						[id]
					);
				}
			}

			await connection.execute(
				`UPDATE junket_monthly_settlement SET ACTIVE = 0, EDITED_BY = ?, EDITED_DT = NOW() WHERE IDNo = ?`,
				[editedBy, id]
			);
		}

		await connection.commit();
		res.json({ success: true });
	} catch (err) {
		if (connection) { try { await connection.rollback(); } catch (_) {} }
		console.error('junket-monthly-settlement/undo:', err);
		res.status(400).json({ success: false, message: err.message || 'Error undoing settlement.' });
	} finally {
		if (connection) connection.release();
	}
});

// GET /junket-monthly-settlement/history?category=expense
router.get('/junket-monthly-settlement/history', checkSession, async (req, res) => {
	const category = req.query.category;
	const cfg = getCategoryConfig(category);
	if (!cfg) return res.status(400).json({ error: 'Invalid category.' });

	try {
		const [rows] = await pool.execute(
			`SELECT jms.IDNo, jms.CATEGORY, jms.PERIOD_START, jms.PERIOD_END, jms.PERIOD_LABEL, jms.AMOUNT,
			        jms.ENCODED_DT, user_info.FIRSTNAME
			 FROM junket_monthly_settlement jms
			 LEFT JOIN user_info ON user_info.IDNo = jms.ENCODED_BY
			 WHERE jms.CATEGORY = ? AND jms.ACTIVE = 1
			 ORDER BY jms.PERIOD_END DESC, jms.IDNo DESC`,
			[category]
		);
		res.json(rows || []);
	} catch (err) {
		console.error('junket-monthly-settlement/history:', err);
		res.status(500).json({ error: 'Unable to load settlement history.' });
	}
});

module.exports = router;
