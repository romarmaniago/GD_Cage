/**
 * Mass soft-delete all active games (mirrors DELETE /game_list/delete/:id).
 * Does NOT touch: game_services, SERVICES ledger, agency/agent/account masters.
 *
 * Usage:
 *   node scripts/mass_soft_delete_games.js           # preview only
 *   node scripts/mass_soft_delete_games.js --execute # apply updates
 */
const pool = require('../config/db');

const EXECUTE = process.argv.includes('--execute');
const EDITED_BY = 1;

async function preview(conn) {
  const [rows] = await conn.query(`
    SELECT 'game_list' AS tbl, COUNT(*) AS cnt FROM game_list WHERE ACTIVE != 0
    UNION ALL
    SELECT 'game_record', COUNT(*) FROM game_record WHERE ACTIVE != 0
    UNION ALL
    SELECT 'account_ledger (GAME_ID, excl SERVICES)', COUNT(*) FROM account_ledger
      WHERE ACTIVE = 1 AND GAME_ID IS NOT NULL AND COALESCE(TRANSACTION_DESC, '') != 'SERVICES'
    UNION ALL
    SELECT 'cash_tx via game_record', COUNT(*) FROM cash_transaction ct
      JOIN game_record gr ON gr.IDNo = ct.TRANSACTION_ID AND gr.ACTIVE != 0
      WHERE ct.ACTIVE = 1
    UNION ALL
    SELECT 'cash_tx via game_list', COUNT(*) FROM cash_transaction ct
      JOIN game_list gl ON gl.IDNo = ct.TRANSACTION_ID AND gl.ACTIVE != 0
      WHERE ct.ACTIVE = 1
    UNION ALL
    SELECT 'junket_loss (GAME_ID)', COUNT(*) FROM junket_loss
      WHERE ACTIVE = 1 AND GAME_ID IS NOT NULL
    UNION ALL
    SELECT 'tip (GAME_ID) [NOT in UI delete]', COUNT(*) FROM tip
      WHERE ACTIVE = 1 AND GAME_ID IS NOT NULL
    UNION ALL
    SELECT 'game_services [EXCLUDED]', COUNT(*) FROM game_services WHERE ACTIVE = 1
  `);
  console.table(rows);
  return rows;
}

async function run() {
  const conn = await pool.getConnection();
  try {
    console.log(EXECUTE ? 'MODE: EXECUTE (will commit)' : 'MODE: PREVIEW only (no changes)');
    console.log('--- BEFORE ---');
    await preview(conn);

    if (!EXECUTE) {
      console.log('\nRe-run with --execute to apply soft-deletes.');
      return;
    }

    await conn.beginTransaction();
    const editedDt = new Date();

    // Target: all currently active games
    await conn.query('DROP TEMPORARY TABLE IF EXISTS target_games');
    await conn.query(`
      CREATE TEMPORARY TABLE target_games AS
      SELECT IDNo AS game_id, ACCOUNT_ID, JUNKET_LOSS_ID
      FROM game_list
      WHERE ACTIVE != 0
    `);

    const [[{ n }]] = await conn.query('SELECT COUNT(*) AS n FROM target_games');
    console.log(`\nSoft-deleting ${n} games...`);

    // 1) cash via game_record
    const [r1] = await conn.query(`
      UPDATE cash_transaction ct
      JOIN game_record gr ON gr.IDNo = ct.TRANSACTION_ID AND gr.ACTIVE != 0
      JOIN target_games t ON t.game_id = gr.GAME_ID
      SET ct.ACTIVE = 0, ct.EDITED_BY = ?, ct.EDITED_DT = ?
      WHERE ct.ACTIVE = 1
    `, [EDITED_BY, editedDt]);

    // 2) cash via game_list id
    const [r2] = await conn.query(`
      UPDATE cash_transaction ct
      JOIN target_games t ON t.game_id = ct.TRANSACTION_ID
      SET ct.ACTIVE = 0, ct.EDITED_BY = ?, ct.EDITED_DT = ?
      WHERE ct.ACTIVE = 1
    `, [EDITED_BY, editedDt]);

    // 3) account_ledger (exclude SERVICES)
    const [r3] = await conn.query(`
      UPDATE account_ledger al
      JOIN target_games t ON t.game_id = al.GAME_ID
      SET al.ACTIVE = 0, al.EDITED_BY = ?, al.EDITED_DT = ?
      WHERE al.ACTIVE = 1
        AND COALESCE(al.TRANSACTION_DESC, '') != 'SERVICES'
    `, [EDITED_BY, editedDt]);

    // 4) junket_loss
    const [r4] = await conn.query(`
      UPDATE junket_loss jl
      JOIN target_games t
        ON t.game_id = jl.GAME_ID
        OR (t.JUNKET_LOSS_ID IS NOT NULL AND t.JUNKET_LOSS_ID = jl.IDNo)
      SET jl.ACTIVE = 0, jl.EDITED_BY = ?, jl.EDITED_DT = ?
      WHERE jl.ACTIVE = 1
    `, [EDITED_BY, editedDt]);

    // 5) game_record
    const [r5] = await conn.query(`
      UPDATE game_record gr
      JOIN target_games t ON t.game_id = gr.GAME_ID
      SET gr.ACTIVE = 0, gr.EDITED_BY = ?, gr.EDITED_DT = ?
      WHERE gr.ACTIVE != 0
    `, [EDITED_BY, editedDt]);

    // 5b) tip (roller/dealer game tips) - keep tip listing + roller tip balance in sync
    const [r5b] = await conn.query(`
      UPDATE tip tp
      JOIN target_games t ON t.game_id = tp.GAME_ID
      SET tp.ACTIVE = 0, tp.EDITED_BY = ?, tp.EDITED_DT = ?
      WHERE tp.ACTIVE = 1
    `, [EDITED_BY, editedDt]);

    // 6) clear cutoff on partners
    try {
      await conn.query(`
        UPDATE game_list gl
        JOIN target_games t
          ON t.game_id = gl.CUTOFF_PARENT_GAME_ID
          OR t.game_id = gl.CUTOFF_CONTINUED_GAME_ID
        SET gl.CUTOFF_PARENT_GAME_ID = NULL,
            gl.CUTOFF_CONTINUED_GAME_ID = NULL,
            gl.EDITED_BY = ?,
            gl.EDITED_DT = ?
        WHERE gl.ACTIVE != 0
          AND gl.IDNo NOT IN (SELECT game_id FROM target_games)
      `, [EDITED_BY, editedDt]);
    } catch (e) {
      console.warn('Cutoff clear skipped:', e.message);
    }

    // 7) game_list
    let r7;
    try {
      [r7] = await conn.query(`
        UPDATE game_list gl
        JOIN target_games t ON t.game_id = gl.IDNo
        SET gl.ACTIVE = 0,
            gl.CUTOFF_PARENT_GAME_ID = NULL,
            gl.CUTOFF_CONTINUED_GAME_ID = NULL,
            gl.EDITED_BY = ?,
            gl.EDITED_DT = ?
        WHERE gl.ACTIVE != 0
      `, [EDITED_BY, editedDt]);
    } catch (e) {
      [r7] = await conn.query(`
        UPDATE game_list gl
        JOIN target_games t ON t.game_id = gl.IDNo
        SET gl.ACTIVE = 0, gl.EDITED_BY = ?, gl.EDITED_DT = ?
        WHERE gl.ACTIVE != 0
      `, [EDITED_BY, editedDt]);
    }

    await conn.commit();

    console.log('\nUpdated rows (affectedRows):');
    console.table([
      { step: 'cash_tx via record', affected: r1.affectedRows },
      { step: 'cash_tx via game', affected: r2.affectedRows },
      { step: 'account_ledger', affected: r3.affectedRows },
      { step: 'junket_loss', affected: r4.affectedRows },
      { step: 'game_record', affected: r5.affectedRows },
      { step: 'tip', affected: r5b.affectedRows },
      { step: 'game_list', affected: r7.affectedRows },
    ]);

    console.log('\n--- AFTER ---');
    await preview(conn);
    console.log('\nDone. game_services / SERVICES ledger left intact.');
  } catch (err) {
    try { await conn.rollback(); } catch (_) {}
    console.error('FAILED, rolled back:', err);
    process.exitCode = 1;
  } finally {
    conn.release();
    // pool may keep process alive
    try { await pool.end(); } catch (_) {}
  }
}

run();
