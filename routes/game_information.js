const express = require('express');
const router = express.Router();
const { checkSession, sessions } = require('./auth');

router.get('/game_information', checkSession, function (req, res) {
	const data = sessions(req, 'game_information');
	data.permissions = req.session.permissions;
	res.render('game_information/game_information', data);
});

module.exports = router;
