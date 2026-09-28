const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const { checkSession } = require('./auth');
const { SETTLEMENT_TYPES, voidSettlement } = require('../utils/settlementVoid');

function requireSuperAdmin(req, res, next) {
	const p = req.session.permissions;
	if (p !== 0 && p !== '0') {
		return res.status(403).json({ success: false, error: 'Only Super Admin can void a settlement.' });
	}
	next();
}

/**
 * VOID A SETTLEMENT (View settlement → Void)
 * :type = expense | loss | additional | service | commission. Body: { reason } (required).
 * Releases the batch's records, archives its junket_capital row and keeps the batch (ACTIVE = 0) for audit.
 */
router.post('/settlement/:type/:id/void', checkSession, requireSuperAdmin, async (req, res) => {
	if (!SETTLEMENT_TYPES[req.params.type]) {
		return res.status(400).json({ success: false, error: 'Unknown settlement type.' });
	}
	try {
		const result = await voidSettlement(pool, req.params.type, req.params.id, {
			userId: req.session?.user_id ?? null,
			reason: req.body?.reason
		});
		res.json({ success: true, released: result.released });
	} catch (err) {
		if (err.status) return res.status(err.status).json({ success: false, error: err.message });
		console.error('Error voiding settlement:', err);
		res.status(500).json({ success: false, error: 'Failed to void the settlement.' });
	}
});

module.exports = router;
