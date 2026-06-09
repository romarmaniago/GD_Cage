const express = require('express');
const router = express.Router();
const { checkSession } = require('./auth');
const { canEditRemarks, updateRemarks, REMARKS_TABLES } = require('../utils/remarksUpdate');

router.patch('/remarks/:source/:id', checkSession, async (req, res) => {
	const permissions = req.session?.permissions;
	if (!canEditRemarks(permissions)) {
		return res.status(403).json({ success: false, message: 'Not authorized to edit remarks.' });
	}

	const source = String(req.params.source || '').trim();
	if (!REMARKS_TABLES[source]) {
		return res.status(400).json({ success: false, message: 'Invalid remarks source.' });
	}

	try {
		const remarks = await updateRemarks(
			source,
			req.params.id,
			req.body && req.body.remarks,
			req.session.user_id
		);
		res.json({ success: true, message: 'Remarks updated.', remarks });
	} catch (err) {
		const status = err.status || 500;
		if (status >= 500) {
			console.error('Error updating remarks:', err);
		}
		res.status(status).json({
			success: false,
			message: err.message || 'Error updating remarks.'
		});
	}
});

module.exports = router;
