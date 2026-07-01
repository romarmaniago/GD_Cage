const pool = require('../config/db');

const REMARKS_TABLES = {
	junket_capital: {
		table: 'junket_capital',
		column: 'REMARKS',
		activeCol: 'ACTIVE',
		activeValue: 1
	},
	account_ledger: {
		table: 'account_ledger',
		column: 'REMARKS',
		activeCol: 'ACTIVE',
		activeValue: 1
	},
	game_services: {
		table: 'game_services',
		column: 'REMARKS',
		activeCol: 'ACTIVE',
		activeValue: 1,
		editedByCol: 'UPDATED_BY',
		editedDtCol: 'UPDATED_DT'
	},
	game_record: {
		table: 'game_record',
		column: 'REMARKS',
		activeCol: 'ACTIVE',
		activeValue: 1
	},
	junket_total_chips: {
		table: 'junket_total_chips',
		column: 'DESCRIPTION',
		activeCol: 'ACTIVE',
		activeValue: 1
	},
	junket_house_expense: {
		table: 'junket_house_expense',
		column: 'DESCRIPTION',
		activeCol: 'ACTIVE',
		activeValue: 1
	},
	guest: {
		table: 'guest',
		column: 'REMARKS',
		activeCol: 'ACTIVE',
		activeValue: 1
	},
	game_list: {
		table: 'game_list',
		column: 'REMARKS',
		activeCol: 'ACTIVE',
		activeNotZero: true
	},
	junket_funds_ledger: {
		table: 'junket_funds_ledger',
		column: 'REMARKS',
		activeCol: 'ACTIVE',
		activeValue: 1
	},
	booking: {
		table: 'booking',
		column: 'REMARKS',
		activeCol: 'ACTIVE',
		activeValue: 1
	},
	junket_credit: {
		table: 'junket_credit',
		column: 'REMARKS',
		activeCol: 'ACTIVE',
		activeValue: 1
	},
	agent: {
		table: 'agent',
		column: 'REMARKS',
		activeCol: 'ACTIVE',
		activeValue: 1
	},
	tip: {
		table: 'tip',
		column: 'REMARKS',
		activeCol: 'ACTIVE',
		activeValue: 1
	},
	tip_settlement: {
		table: 'tip_settlement',
		column: 'REMARKS',
		activeCol: 'ACTIVE',
		activeValue: 1
	}
};

function normalizeRemarks(raw, maxLen) {
	let remarks = raw != null ? String(raw).trim() : '';
	const limit = maxLen || 500;
	if (remarks.length > limit) remarks = remarks.slice(0, limit);
	return remarks;
}

function canEditRemarks(permissions) {
	return permissions !== 2;
}

async function updateRemarks(source, id, rawRemarks, userId) {
	const config = REMARKS_TABLES[source];
	if (!config) {
		const err = new Error('Invalid remarks source.');
		err.status = 400;
		throw err;
	}

	const recordId = parseInt(id, 10);
	if (!recordId || isNaN(recordId)) {
		const err = new Error('Invalid record id.');
		err.status = 400;
		throw err;
	}

	const remarks = normalizeRemarks(rawRemarks);
	const dateNow = new Date();

	let activeClause = '';
	const params = [];
	if (config.activeCol) {
		if (config.activeNotZero) {
			activeClause = ` AND ${config.activeCol} != 0`;
		} else {
			activeClause = ` AND ${config.activeCol} = ?`;
			params.push(config.activeValue);
		}
	}

	const [rows] = await pool.execute(
		`SELECT IDNo FROM ${config.table} WHERE IDNo = ?${activeClause}`,
		[recordId, ...params]
	);

	if (!rows.length) {
		const err = new Error('Record not found.');
		err.status = 404;
		throw err;
	}

	const editedByCol = config.editedByCol || 'EDITED_BY';
	const editedDtCol = config.editedDtCol || 'EDITED_DT';
	await pool.execute(
		`UPDATE ${config.table} SET ${config.column} = ?, ${editedByCol} = ?, ${editedDtCol} = ? WHERE IDNo = ?`,
		[remarks || null, userId, dateNow, recordId]
	);

	return remarks;
}

module.exports = {
	REMARKS_TABLES,
	normalizeRemarks,
	canEditRemarks,
	updateRemarks
};
