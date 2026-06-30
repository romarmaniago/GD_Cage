const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const argon2 = require('argon2');
const crypto = require('crypto');

function isArgonHash(hash) {
    return typeof hash === 'string' && hash.startsWith('$argon2');
}

// Fallback MD5 for legacy support
function generateMD5(input) {
    return crypto.createHash('md5').update(input).digest('hex');
}

function getClientIp(req) {
    const forwarded = req.headers['x-forwarded-for'];
    if (forwarded) {
        return forwarded.split(',')[0].trim();
    }
    const rawIp = req.ip || req.connection?.remoteAddress || '';
    if (rawIp === '::1') {
        return '127.0.0.1';
    }
    if (rawIp.startsWith('::ffff:')) {
        return rawIp.replace('::ffff:', '');
    }
    return rawIp;
}

// Middleware to check session, enforce single-login, and update activity
const checkSession = async (req, res, next) => {
    if (!req.session || !req.session.username || !req.session.user_id) {
        console.warn('Session missing on request', {
            path: req.originalUrl,
            sessionId: req.sessionID,
            hasCookie: Boolean(req.headers?.cookie),
            cookies: req.cookies
        });
        return res.redirect('/login');
    }

    const userId = req.session.user_id;
    const sessionToken = req.session.sessionToken;

    try {
        const [rows] = await pool.execute(
            'SELECT SESSION_TOKEN FROM user_info WHERE IDNo = ? AND ACTIVE = 1',
            [userId]
        );

        // User no longer exists or is inactive
        if (!rows || rows.length === 0) {
            req.session.destroy(() => {
                res.redirect('/login');
            });
            return;
        }

        const currentToken = rows[0].SESSION_TOKEN;

        // If there's a token in DB and it doesn't match this session -> kicked out by another login
        // Exception: admin (permission = 1) allows multi-login — do not disconnect existing sessions
        const isAdmin = req.session.permissions === 1;
        if (currentToken && sessionToken && currentToken !== sessionToken && !isAdmin) {
            console.warn('Session token mismatch', {
                userId,
                path: req.originalUrl,
                sessionId: req.sessionID
            });
            req.session.destroy(() => {
                res.redirect('/login?kicked=1');
            });
            return;
        }

        // Still the valid session: keep user online and bump activity
        await pool.execute(
            'UPDATE user_info SET USER_STATUS = 1, LAST_ACTIVITY = NOW() WHERE IDNo = ?',
            [userId]
        );
    } catch (err) {
        console.error('Error checking/updating user activity status:', err);
        // Continue anyway; don't block page render
    }

    next();
};
function sessions(req, page) {
	return {
		username: req.session.username,
		firstname: req.session.firstname,
			lastname: req.session.lastname,
		user_id: req.session.user_id,
		currentPage: page
	};
}





router.get(["/", "/login"], (req, res) => {
    if (req.session && req.session.user_id && req.session.username) {
        return res.redirect('/dashboard');
    }
    res.render("login", { showKickedMessage: req.query.kicked === '1' });
});

router.get("/user_roles", checkSession, function (req, res) {
	const data = sessions(req, 'user_roles');
	data.permissions = req.session.permissions;
	res.render("user_accounts/user_roles", data);
});

router.get("/manage_users", checkSession, function (req, res) {
	const data = sessions(req, 'manage_users');
	data.permissions = req.session.permissions;
	res.render("user_accounts/manage_users", data);
});

// Login route
router.post('/login', async (req, res) => {
    const { username, password } = req.body;
    const query = 'SELECT * FROM user_info WHERE USERNAME = ? AND ACTIVE = 1';
  
    try {
      const [results] = await pool.execute(query, [username]);
  
      if (results.length > 0) {
        const user = results[0];
        const storedPassword = user.PASSWORD;
        const salt = user.SALT;
  
        let isValid = false;
        let isLegacy = false;
  
        if (isArgonHash(storedPassword)) {
          // ✅ Argon2 login
          isValid = await argon2.verify(storedPassword, password);
        } else {
          // 🔁 MD5 fallback
          const hashedMD5 = generateMD5(salt + password);
          isValid = (hashedMD5 === storedPassword);
          isLegacy = true;
        }
  
        if (isValid) {
          // Optional: auto-upgrade legacy MD5 password to Argon2
          if (isLegacy) {
            const newHash = await argon2.hash(password);
            await pool.execute(`UPDATE user_info SET PASSWORD = ?, SALT = NULL WHERE IDNo = ?`, [newHash, user.IDNo]);
          }

          // Generate a new session token for this login
          const newSessionToken = crypto.randomBytes(32).toString('hex');

          // Mark user as online, update timestamps, and store session token
          try {
            const loginIp = getClientIp(req);
            await pool.execute(
              'UPDATE user_info SET USER_STATUS = 1, LAST_LOGIN = NOW(), LAST_ACTIVITY = NOW(), SESSION_TOKEN = ?, LAST_IP = ? WHERE IDNo = ?',
              [newSessionToken, loginIp, user.IDNo]
            );
          } catch (err) {
            console.error('Error updating user status on login:', err);
          }
  
          req.session.username = username;
          req.session.firstname = user.FIRSTNAME;
          req.session.lastname = user.LASTNAME;
          req.session.user_id = user.IDNo;
          req.session.permissions = user.PERMISSIONS;
          req.session.sessionToken = newSessionToken;
  
          req.session.save(err => {
            if (err) {
              req.flash('error', 'Session error, please try again.');
              return res.redirect('/login');
            }
            return res.redirect('/dashboard');
          });
        } else {
          req.flash('error', 'Incorrect password');
          return res.redirect('/login');
        }
      } else {
        req.flash('error', 'User not found or inactive');
        return res.redirect('/login');
      }
    } catch (error) {
      console.error('Login error:', error);
      req.flash('error', 'Internal server error');
      return res.redirect('/login');
    }
  });

// Force login route (after confirmation)
router.post('/login/force', async (req, res) => {
  const pendingUserId = req.session.pending_login_user_id;

  if (!pendingUserId) {
    req.flash('error', 'Login confirmation expired. Please log in again.');
    return res.redirect('/login');
  }

  try {
    const [results] = await pool.execute(
      'SELECT * FROM user_info WHERE IDNo = ? AND ACTIVE = 1',
      [pendingUserId]
    );

    if (results.length === 0) {
      req.flash('error', 'User not found or inactive.');
      req.session.pending_login_user_id = null;
      req.session.pending_login_username = null;
      return res.redirect('/login');
    }

    const user = results[0];

    // Generate a new session token for this forced login
    const newSessionToken = crypto.randomBytes(32).toString('hex');

    // Mark this user as online, update timestamps, and store new session token
    try {
      const loginIp = getClientIp(req);
      await pool.execute(
        'UPDATE user_info SET USER_STATUS = 1, LAST_LOGIN = NOW(), LAST_ACTIVITY = NOW(), SESSION_TOKEN = ?, LAST_IP = ? WHERE IDNo = ?',
        [newSessionToken, loginIp, user.IDNo]
      );
    } catch (err) {
      console.error('Error updating user status on force login:', err);
    }

    // Clear pending login info
    req.session.pending_login_user_id = null;
    req.session.pending_login_username = null;

    // Create session
    req.session.username = user.USERNAME;
    req.session.firstname = user.FIRSTNAME;
    req.session.lastname = user.LASTNAME;
    req.session.user_id = user.IDNo;
    req.session.permissions = user.PERMISSIONS;
    req.session.sessionToken = newSessionToken;

    req.session.save(err => {
      if (err) {
        req.flash('error', 'Session error, please try again.');
        return res.redirect('/login');
      }
      return res.redirect('/dashboard');
    });
  } catch (error) {
    console.error('Force login error:', error);
    req.flash('error', 'Internal server error');
    return res.redirect('/login');
  }
});
  
// Verify Password route using async/await
router.post('/verify-password', async (req, res) => {
    try {
      const { password } = req.body;
      const query = 'SELECT * FROM user_info WHERE PERMISSIONS = 11 AND ACTIVE = 1';
      const [results] = await pool.execute(query);
      
      if (results.length > 0) {
        const manager = results[0]; // Assume there's only one manager
        const storedPassword = manager.PASSWORD;
        const salt = manager.SALT;
        let isValid = false;

        if (isArgonHash(storedPassword)) {
          isValid = await argon2.verify(storedPassword, password);
        } else {
          const hashedPassword = generateMD5(salt + password);
          isValid = (hashedPassword === storedPassword);
        }

        if (isValid) {
          return res.json({ permissions: manager.PERMISSIONS });
        }

        return res.status(403).json({ message: 'Incorrect password' });
      } else {
        return res.status(404).json({ message: 'Manager not found' });
      }
    } catch (error) {
      console.error('Error executing MySQL query: ' + error.stack);
      return res.status(500).json({ message: 'Error during password verification' });
    }
  });

// Check Permission route
router.post('/check-permission', (req, res) => {
    if (!req.session.permissions) {
        return res.status(401).json({ message: 'Not logged in' });
    }
    if (req.session.permissions === 11) {
        return res.json({ permissions: 11 });
    } else {
        return res.json({ permissions: req.session.permissions });
    }
});

// Logout route
router.post('/logout', async (req, res) => {
    const userId = req.session ? req.session.user_id : null;

    try {
        if (userId) {
            await pool.execute(
                'UPDATE user_info SET USER_STATUS = 0, LAST_ACTIVITY = NOW() WHERE IDNo = ?',
                [userId]
            );
        }
    } catch (err) {
        console.error('Error updating user status on logout:', err);
    } finally {
        req.session.destroy(() => {
            res.redirect('/login');
        });
    }
});

// Add user route
router.post('/add_user', async (req, res) => {
    try {
      const {
        txtFirstName,
        txtLastName,
        txtUserName,
        txtPassword,
        txtPassword2,
        user_role
      } = req.body;
  
      let date_now = new Date();
  
      if (txtPassword !== txtPassword2) {
        return res.status(400).json({ error: 'Passwords do not match' });
      }

      // Check if username already exists (active or inactive)
      const [existing] = await pool.execute(
        'SELECT IDNo FROM user_info WHERE USERNAME = ?',
        [txtUserName ? txtUserName.trim() : '']
      );
      if (existing && existing.length > 0) {
        return res.status(400).json({ error: 'username_exists' });
      }
  
      const hashedPassword = await argon2.hash(txtPassword); // ✅ Secure password
      const salt = crypto.randomBytes(16).toString('hex');
  
      const query = `
        INSERT INTO user_info 
        (FIRSTNAME, LASTNAME, USERNAME, PASSWORD, SALT, PERMISSIONS, LAST_LOGIN, ENCODED_BY, ENCODED_DT) 
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `;
  
      await pool.execute(query, [
        txtFirstName,
        txtLastName,
        txtUserName,
        hashedPassword,
        salt,
        user_role,
        date_now,
        req.session.user_id,
        date_now
      ]);
  
      res.redirect('/users');
    } catch (err) {
      console.error('Error inserting user:', err);
      res.status(500).send('Error inserting user');
    }
  });
  

/// ADD USER ROLE
router.post('/add_user_role', async (req, res) => {
	try {
		const { role } = req.body;
		const date_now = new Date();
		const query = `INSERT INTO user_role (ROLE, ENCODED_BY, ENCODED_DT) VALUES (?, ?, ?)`;

		await pool.execute(query, [role, req.session.user_id, date_now]);
		res.redirect('/user_roles');
	} catch (err) {
		console.error('Error inserting user role:', err);
		res.status(500).send('Error inserting user');
	}
});

// GET USER ROLE
router.get('/user_role_data', async (req, res) => {
	try {
		const [results] = await pool.execute('SELECT * FROM user_role WHERE ACTIVE = 1');
		res.json(results);
	} catch (error) {
		console.error('Error fetching data:', error);
		res.status(500).send('Error fetching data');
	}
});

// UPDATE USER ROLE
router.put('/user_role/:id', async (req, res) => {
	try {
		const id = parseInt(req.params.id);
		const { role } = req.body;
		const date_now = new Date();
		const query = `UPDATE user_role SET ROLE = ?, EDITED_BY = ?, EDITED_DT = ? WHERE IDNo = ?`;

		await pool.execute(query, [role, req.session.user_id, date_now, id]);
		res.send('User role updated successfully');
	} catch (err) {
		console.error('Error updating user role:', err);
		res.status(500).send('Error updating user role');
	}
});

// ARCHIVE USER ROLE
router.put('/user_role/remove/:id', async (req, res) => {
	try {
		const id = parseInt(req.params.id);
		const date_now = new Date();
		const query = `UPDATE user_role SET ACTIVE = ?, EDITED_BY = ?, EDITED_DT = ? WHERE IDNo = ?`;

		await pool.execute(query, [0, req.session.user_id, date_now, id]);
		res.send('User role updated successfully');
	} catch (err) {
		console.error('Error archiving user role:', err);
		res.status(500).send('Error updating user role');
	}
});


// GET USERS
router.get('/users', async (req, res) => {
	try {
		const query = `
			SELECT user_info.*, user_info.IDNo AS user_id,
				COALESCE(user_role.ROLE, IF(user_info.PERMISSIONS = 0, 'SuperAdmin', NULL)) AS role
			FROM user_info
			LEFT JOIN user_role ON user_role.IDNo = user_info.PERMISSIONS
			WHERE user_info.ACTIVE = 1
		`;
		const [results] = await pool.execute(query);
		res.json(results);
	} catch (error) {
		console.error('Error fetching data:', error);
		res.status(500).send('Error fetching data');
	}
});

// ADD USER
router.post('/add_user', async (req, res) => {
	try {
		const {
			txtFirstName,
			txtLastName,
			txtUserName,
			txtPassword,
			txtPassword2,
			user_role,
			salt
		} = req.body;

		let date_now = new Date();

		if (txtPassword !== txtPassword2) {
			return res.status(500).json({ error: 'password' });
		}

		// Check if username already exists (active or inactive)
		const [existing] = await pool.execute(
			'SELECT IDNo FROM user_info WHERE USERNAME = ?',
			[txtUserName ? txtUserName.trim() : '']
		);
		if (existing && existing.length > 0) {
			return res.status(400).json({ error: 'username_exists' });
		}

		const generated_pw = await argon2.hash(txtPassword);
		const query = `
			INSERT INTO user_info 
			(FIRSTNAME, LASTNAME, USERNAME, PASSWORD, SALT, PERMISSIONS, LAST_LOGIN, ENCODED_BY, ENCODED_DT) 
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
		`;

		await pool.execute(query, [
			txtFirstName,
			txtLastName,
			txtUserName,
			generated_pw,
			salt,
			user_role,
			date_now,
			req.session.user_id,
			date_now
		]);

		res.redirect('/users');
	} catch (err) {
		console.error('Error inserting user:', err);
		res.status(500).send('Error inserting user');
	}
});

// CHANGE USER PASSWORD
router.put('/user/password/:id', async (req, res) => {
	try {
		const id = parseInt(req.params.id, 10);
		const { txtPassword, txtPassword2 } = req.body;

		if (!id) {
			return res.status(400).json({ error: 'invalid_user' });
		}
		if (!txtPassword || !txtPassword2) {
			return res.status(400).json({ error: 'required' });
		}
		if (txtPassword !== txtPassword2) {
			return res.status(400).json({ error: 'password' });
		}

		const newHash = await argon2.hash(txtPassword);
		const date_now = new Date();
		const editedBy = req.session && req.session.user_id != null ? req.session.user_id : null;

		const [result] = await pool.execute(
			`UPDATE user_info SET PASSWORD = ?, SALT = NULL, EDITED_BY = ?, EDITED_DT = ? WHERE IDNo = ? AND ACTIVE = 1`,
			[newHash, editedBy, date_now, id]
		);

		if (!result || result.affectedRows === 0) {
			return res.status(404).json({ error: 'user_not_found' });
		}

		res.json({ success: true, message: 'Password changed successfully' });
	} catch (err) {
		console.error('Error changing user password:', err);
		res.status(500).json({ error: 'server_error' });
	}
});

// UPDATE USER
router.put('/user/:id', async (req, res) => {
	try {
		const id = parseInt(req.params.id);
		const {
			txtFirstName,
			txtLastName,
			txtUserName,
			user_role
		} = req.body;

		const date_now = new Date();

		const query = `
			UPDATE user_info 
			SET FIRSTNAME = ?, LASTNAME = ?, USERNAME = ?, PERMISSIONS = ?, EDITED_BY = ?, EDITED_DT = ? 
			WHERE IDNo = ?
		`;

		await pool.execute(query, [
			txtFirstName,
			txtLastName,
			txtUserName,
			user_role,
			req.session.user_id,
			date_now,
			id
		]);

		res.send('User role updated successfully');
	} catch (err) {
		console.error('Error updating user role:', err);
		res.status(500).send('Error updating user role');
	}
});

// ARCHIVE USER
router.put('/user/remove/:id', async (req, res) => {
	try {
		const id = parseInt(req.params.id);
		const date_now = new Date();

		const [rows] = await pool.execute(
			'SELECT PERMISSIONS FROM user_info WHERE IDNo = ? AND ACTIVE = 1 LIMIT 1',
			[id]
		);
		if (!rows || rows.length === 0) {
			return res.status(404).json({ error: 'user_not_found' });
		}
		if (Number(rows[0].PERMISSIONS) === 0) {
			return res.status(403).json({ error: 'cannot_delete_superadmin' });
		}

		const query = `
			UPDATE user_info 
			SET ACTIVE = ?, EDITED_BY = ?, EDITED_DT = ? 
			WHERE IDNo = ?
		`;

		await pool.execute(query, [0, req.session.user_id, date_now, id]);

		res.send('User role removed successfully');
	} catch (err) {
		console.error('Error updating user:', err);
		res.status(500).send('Error updating user');
	}
});

module.exports = {
    router,
    checkSession,
    sessions
  };
  