const pool = require('../config/db');
const argon2 = require('argon2');
const crypto = require('crypto');

function isArgonHash(hash) {
    return typeof hash === 'string' && hash.startsWith('$argon2');
}

async function passwordMatches(user, password) {
    const stored = user.PASSWORD;
    if (isArgonHash(stored)) {
        try {
            return await argon2.verify(stored, password);
        } catch (_) {
            return false;
        }
    }
    return crypto.createHash('md5').update(String(user.SALT || '') + password).digest('hex') === stored;
}

/** True when the password belongs to any active Super Admin (PERMISSIONS = 0). */
async function isAnySuperAdminPassword(password) {
    if (!password) return false;
    const [users] = await pool.execute('SELECT PASSWORD, SALT FROM user_info WHERE PERMISSIONS = 0 AND ACTIVE = 1');
    for (const u of users) {
        if (await passwordMatches(u, String(password))) return true;
    }
    return false;
}

/** Route middleware: body.superAdminPassword must match any active Super Admin. */
async function requireSuperAdminPassword(req, res, next) {
    const password = req.body?.superAdminPassword;
    if (!password) return res.status(400).json({ error: 'Super Admin password is required.' });
    try {
        if (await isAnySuperAdminPassword(password)) return next();
        return res.status(403).json({ error: 'Incorrect Super Admin password.' });
    } catch (err) {
        console.error('Error verifying super admin password:', err);
        return res.status(500).json({ error: 'Error during password verification.' });
    }
}

module.exports = { isAnySuperAdminPassword, requireSuperAdminPassword };
