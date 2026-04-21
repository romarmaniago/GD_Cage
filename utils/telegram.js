const TelegramBot = require('node-telegram-bot-api');
const pool = require('../config/db');

let guestBotInstance; // GUEST bot instance
let employeeBotInstance; // EMPLOYEE bot instance
let managementBotInstance; // MANAGEMENT bot instance

// Get active token from DB based on user type (GUEST, EMPLOYEE, MANAGEMENT)
async function getTelegramToken(userType = 'GUEST') {
  const [rows] = await pool.execute(
    'SELECT TELEGRAM_API FROM telegram_api WHERE ACTIVE = 1 AND USER = ?',
    [userType]
  );
  return rows.length > 0 ? rows[0].TELEGRAM_API : null;
}

// Send a message with retry logic for network issues (GUEST bot only)
async function sendTelegramMessage(text, telegramId, retries = 2) {
  const { default: fetch } = await import('node-fetch');
  const token = await getTelegramToken('GUEST');
  if (!token) {
    console.warn('No Telegram token found for GUEST bot');
    return;
  }

  const url = `https://api.telegram.org/bot${token}/sendMessage`;
  
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 30000); // 30 second timeout
      
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: telegramId, text }),
        signal: controller.signal
      });
      
      clearTimeout(timeoutId);
      
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(`Telegram API error: ${errorData.description || response.statusText}`);
      }
      
      return; // Success, exit function
    } catch (error) {
      // If it's a network error and we have retries left, try again
      if (attempt < retries && (
        error.name === 'AbortError' || 
        error.message.includes('ETIMEDOUT') || 
        error.message.includes('ECONNRESET') ||
        error.message.includes('network') ||
        error.code === 'ETIMEDOUT' ||
        error.code === 'ECONNRESET'
      )) {
        console.warn(`⚠️ Network error sending message (attempt ${attempt + 1}/${retries + 1}), retrying...`);
        await new Promise(resolve => setTimeout(resolve, 1000 * (attempt + 1))); // Exponential backoff
        continue;
      }
      
      // If no retries left or not a network error, throw
      console.error(`❌ Error sending Telegram message after ${attempt + 1} attempts:`, error.message);
      throw error;
    }
  }
}

// Get additional chat IDs for GUEST (supports comma- or semicolon-separated in CHAT_ID column)
async function getAdditionalChatIds() {
  const [rows] = await pool.execute(
    'SELECT CHAT_ID FROM telegram_api WHERE ACTIVE = 1 AND USER = ? LIMIT 1',
    ['GUEST']
  );
  if (!rows.length || rows[0].CHAT_ID == null) return [];
  const raw = String(rows[0].CHAT_ID).trim();
  if (!raw) return [];
  return raw.split(/[\s,;]+/).map(s => s.trim()).filter(Boolean);
}

// Send message to all additional chat IDs (groups/channels) using GUEST bot
async function sendTelegramToAdditionalChats(text) {
  const chatIds = await getAdditionalChatIds();
  for (const id of chatIds) {
    try {
      await sendTelegramMessage(text, id);
    } catch (error) {
      console.error(`Error sending Telegram message to guest chat ID ${id}:`, error.message);
      // Continue sending to other chat IDs even if one fails
    }
  }
}

// Get employee chat IDs (supports comma- or semicolon-separated in CHAT_ID column for EMPLOYEE)
async function getEmployeeChatIds() {
  const [rows] = await pool.execute(
    'SELECT CHAT_ID FROM telegram_api WHERE ACTIVE = 1 AND USER = ? LIMIT 1',
    ['EMPLOYEE']
  );
  if (!rows.length || rows[0].CHAT_ID == null) return [];
  const raw = String(rows[0].CHAT_ID).trim();
  if (!raw) return [];
  return raw.split(/[\s,;]+/).map(s => s.trim()).filter(Boolean);
}

// Send message to all employee chat IDs using EMPLOYEE bot
async function sendTelegramToEmployees(text) {
  const { default: fetch } = await import('node-fetch');
  const token = await getTelegramToken('EMPLOYEE');
  if (!token) {
    console.warn('No Telegram token found for EMPLOYEE bot');
    return;
  }

  const chatIds = await getEmployeeChatIds();
  if (chatIds.length === 0) {
    console.log('No employee chat IDs found in CHAT_ID for EMPLOYEE');
    return;
  }
  
  for (const id of chatIds) {
    try {
      const url = `https://api.telegram.org/bot${token}/sendMessage`;
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: id, text })
      });
      
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(`Telegram API error: ${errorData.description || response.statusText}`);
      }
    } catch (error) {
      console.error(`Error sending Telegram message to employee chat ID ${id}:`, error.message);
      // Continue sending to other chat IDs even if one fails
    }
  }
}

// Get management chat IDs (supports comma- or semicolon-separated in CHAT_ID column for MANAGEMENT)
async function getManagementChatIds() {
  const [rows] = await pool.execute(
    'SELECT CHAT_ID FROM telegram_api WHERE ACTIVE = 1 AND USER = ? LIMIT 1',
    ['MANAGEMENT']
  );
  if (!rows.length || rows[0].CHAT_ID == null) return [];
  const raw = String(rows[0].CHAT_ID).trim();
  if (!raw) return [];
  return raw.split(/[\s,;]+/).map(s => s.trim()).filter(Boolean);
}

// Send message to all management chat IDs using MANAGEMENT bot
async function sendTelegramToManagement(text) {
  const { default: fetch } = await import('node-fetch');
  const token = await getTelegramToken('MANAGEMENT');
  if (!token) {
    console.warn('No Telegram token found for MANAGEMENT bot');
    return;
  }

  const chatIds = await getManagementChatIds();
  if (chatIds.length === 0) {
    console.log('No management chat IDs found in CHAT_ID for MANAGEMENT');
    return;
  }
  
  for (const id of chatIds) {
    try {
      const url = `https://api.telegram.org/bot${token}/sendMessage`;
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: id, text })
      });
      
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(`Telegram API error: ${errorData.description || response.statusText}`);
      }
    } catch (error) {
      console.error(`Error sending Telegram message to management chat ID ${id}:`, error.message);
      // Continue sending to other chat IDs even if one fails
    }
  }
}

// Compress image to fit Telegram's 10MB photo limit
async function compressImage(buffer, targetSize = 9 * 1024 * 1024) {
  try {
    // Try to use sharp if available, otherwise return original buffer
    const sharp = await import('sharp').catch(() => null);
    if (!sharp || !sharp.default) {
      console.warn('Sharp not available, cannot compress image');
      return buffer; // Return original if sharp not available
    }

    let compressed = buffer;
    let quality = 80;
    let attempts = 0;
    const maxAttempts = 10;
    const originalSize = buffer.length;

    // Get image metadata first
    const image = sharp.default(buffer);
    const metadata = await image.metadata();
    let currentWidth = metadata.width || 1920;
    let currentHeight = metadata.height || 1080;

    // Calculate initial scale based on file size
    const sizeRatio = targetSize / originalSize;
    let initialScale = Math.sqrt(sizeRatio); // Square root because we're reducing both width and height
    
    // Try compressing with decreasing quality and size until we're under the limit
    while (compressed.length > targetSize && attempts < maxAttempts) {
      // Calculate scale - more aggressive reduction
      const scale = Math.max(0.3, initialScale - (attempts * 0.1)); // Start aggressive, reduce more each time
      const newWidth = Math.floor(currentWidth * scale);
      const newHeight = Math.floor(currentHeight * scale);
      
      // Reduce quality more aggressively
      const currentQuality = Math.max(30, 85 - (attempts * 8)); // Start at 85, reduce by 8 each time, min 30
      
      try {
        // Always use original buffer as source, not the compressed one
        compressed = await sharp.default(buffer)
          .resize(newWidth, newHeight, { 
            fit: 'inside', 
            withoutEnlargement: true 
          })
          .jpeg({ 
            quality: currentQuality, 
            mozjpeg: true,
            progressive: true
          })
          .toBuffer();
        
        console.log(`Compression attempt ${attempts + 1}: ${(compressed.length / 1024 / 1024).toFixed(2)}MB (${newWidth}x${newHeight}, quality: ${currentQuality})`);
        
        // Update dimensions for next iteration
        currentWidth = newWidth;
        currentHeight = newHeight;
        
        // If we're under the limit, we're done
        if (compressed.length <= targetSize) {
          break;
        }
      } catch (compressError) {
        console.warn(`Compression attempt ${attempts + 1} failed:`, compressError.message);
        // If compression fails, try with even lower quality/size
        attempts++;
        continue;
      }
      
      attempts++;
    }

    // If still too large after all attempts, use sendDocument as fallback
    if (compressed.length > targetSize) {
      console.warn(`Could not compress below ${(targetSize / 1024 / 1024).toFixed(2)}MB, final size: ${(compressed.length / 1024 / 1024).toFixed(2)}MB`);
    } else {
      console.log(`Successfully compressed from ${(originalSize / 1024 / 1024).toFixed(2)}MB to ${(compressed.length / 1024 / 1024).toFixed(2)}MB`);
    }

    return compressed;
  } catch (error) {
    console.warn('Image compression failed, using original:', error.message);
    return buffer; // Return original if compression fails
  }
}

// Send photo with caption (accepts buffer or file path) - GUEST bot only
// Automatically compresses images > 10MB to fit Telegram's photo limit
async function sendTelegramPhoto(photoBufferOrPath, filename, caption, telegramId) {
  const { default: fetch } = await import('node-fetch');
  const FormData = (await import('form-data')).default;
  const token = await getTelegramToken('GUEST');
  if (!token) {
    console.error('Telegram token not found for GUEST bot');
    return;
  }

  try {
    const TELEGRAM_PHOTO_LIMIT = 10 * 1024 * 1024; // 10MB
    let fileBuffer;
    let fileSize;

    // Get buffer and size
    if (Buffer.isBuffer(photoBufferOrPath)) {
      fileBuffer = photoBufferOrPath;
      fileSize = fileBuffer.length;
    } else {
      // Fallback for file path (if needed in future)
      const fs = await import('fs');
      fileBuffer = fs.readFileSync(photoBufferOrPath);
      fileSize = fileBuffer.length;
    }

    // Compress if file is too large
    if (fileSize > TELEGRAM_PHOTO_LIMIT) {
      console.log(`Compressing image from ${(fileSize / 1024 / 1024).toFixed(2)}MB...`);
      fileBuffer = await compressImage(fileBuffer, TELEGRAM_PHOTO_LIMIT);
      fileSize = fileBuffer.length;
    }

    // If still too large after compression, use sendDocument
    const useDocument = fileSize > TELEGRAM_PHOTO_LIMIT;
    const endpoint = useDocument ? 'sendDocument' : 'sendPhoto';
    const fieldName = useDocument ? 'document' : 'photo';

    const url = `https://api.telegram.org/bot${token}/${endpoint}`;
    const form = new FormData();
    form.append('chat_id', String(telegramId));
    form.append('caption', caption || '');
    form.append(fieldName, fileBuffer, {
      filename: filename || 'photo.jpg',
      contentType: 'image/jpeg'
    });

    const response = await fetch(url, {
      method: 'POST',
      body: form,
      headers: form.getHeaders()
    });

    const result = await response.json();
    if (!result.ok) {
      const errorMsg = result.description || 'Telegram API error';
      console.error('Telegram API error:', errorMsg);
      throw new Error(errorMsg);
    }
    return result;
  } catch (error) {
    console.error('Error sending photo via Telegram:', error.message);
    throw error;
  }
}

// Helper function to setup bot error handlers
function setupBotErrorHandlers(bot, botType) {
  // Handle polling errors (network issues, connection resets, etc.)
  bot.on('polling_error', (error) => {
    const errorMsg = error.message || String(error);
    
    // Check for network-related errors (slow internet, connection issues)
    const isNetworkError = 
      error.code === 'EFATAL' || 
      error.code === 'ETIMEDOUT' ||
      error.code === 'ECONNRESET';
    
    if (isNetworkError) {
      console.warn(`⚠️ Network issue detected for ${botType} bot (slow/unstable internet):`, errorMsg);
      console.log('🔄 Bot will automatically retry. If this persists, check your internet connection.');
      // The bot will automatically retry, no need to restart manually
    } else {
      console.error(`❌ Fatal polling error for ${botType} bot:`, errorMsg);
    }
  });

  // Handle general errors
  bot.on('error', (error) => {
    console.error(`❌ Telegram ${botType} bot error:`, error.message);
  });
}

// Start GUEST bot
async function startGuestBot() {
  const token = await getTelegramToken('GUEST');
  if (!token) {
    console.error('❌ Telegram bot token not found for GUEST.');
    return;
  }

  if (guestBotInstance) {
    console.log('⚠️ GUEST bot already running.');
    return;
  }

  const bot = new TelegramBot(token, { 
    polling: {
      interval: 1000,
      autoStart: true,
      params: {
        timeout: 30 // Increased timeout for slow internet (was 10, now 30 seconds)
      }
    },
    request: {
      agentOptions: {
        keepAlive: true,
        keepAliveMsecs: 30000
      }
    }
  });
  guestBotInstance = bot;

  console.log('✅ Telegram GUEST bot is running...');
  setupBotErrorHandlers(bot, 'GUEST');

  // Check balance functionality - uses GUEST bot only
  async function sendBalanceToUser(telegramId) {
    const connection = await pool.getConnection();
    try {
      const [accountResults] = await connection.query(`
        SELECT agent.AGENT_CODE, agent.NAME, account.IDNo AS ACCOUNT_ID
        FROM agent
        JOIN account ON account.AGENT_ID = agent.IDNo
        WHERE agent.TELEGRAM_ID = ?
        LIMIT 1
      `, [telegramId]);

      if (accountResults.length === 0) {
        bot.sendMessage(telegramId, '❌ No account linked.');
        return;
      }

      const { AGENT_CODE, NAME, ACCOUNT_ID } = accountResults[0];

      const [ledgerResults] = await connection.query(`
        SELECT transaction_type.TRANSACTION, account_ledger.AMOUNT
        FROM account_ledger
        JOIN transaction_type ON transaction_type.IDNo = account_ledger.TRANSACTION_ID
        WHERE account_ledger.TRANSACTION_TYPE IN (2, 5, 3)
        AND account_ledger.ACCOUNT_ID = ?
      `, [ACCOUNT_ID]);

      let deposit = 0, withdraw = 0, markerRedeem = 0, iouReturn = 0;
      ledgerResults.forEach(row => {
        const amt = parseFloat(row.AMOUNT) || 0;
        if (row.TRANSACTION === 'DEPOSIT') deposit += amt;
        if (row.TRANSACTION === 'WITHDRAW') withdraw += amt;
        if (row.TRANSACTION === 'MARKER REDEEM') markerRedeem += amt;
        if (row.TRANSACTION === 'IOU RETURN DEPOSIT') iouReturn += amt;
      });

      const balance = deposit + markerRedeem - withdraw - iouReturn;

      const date_now = new Date().toLocaleDateString();
      const time_now = new Date().toLocaleTimeString();

      const msg = `Demo Cage\n\n* 잔고 확인  *\n\n계정: ${AGENT_CODE} - ${NAME}\n잔고: ${balance.toLocaleString()}\n\n날짜: ${date_now}\n시간: ${time_now}`;
      bot.sendMessage(telegramId, msg);

    } catch (err) {
      console.error('❌ Error:', err);
      bot.sendMessage(telegramId, '❌ Error getting balance.');
    } finally {
      connection.release();
    }
  }

  // Handle /checkbalance command (GUEST bot only)
  bot.onText(/\/checkbalance/i, (msg) => {
    sendBalanceToUser(msg.chat.id);
  });

  // Handle "Check Balance" button click (with or without emoji) - GUEST bot only
  bot.onText(/(💰\s*)?Check Balance/i, (msg) => {
    sendBalanceToUser(msg.chat.id);
  });

  // Helper function to escape HTML special characters
  function escapeHtml(text) {
    if (!text) return '';
    return String(text)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  // Get chat_id (for group or private) — type /getchatid in the chat
  bot.onText(/\/getchatid/i, (msg) => {
    const chatId = msg.chat.id;
    const user = msg.from || {};
    const userName = escapeHtml(user.first_name || '');
    const userLastName = escapeHtml(user.last_name || '');
    const userFullName = `${userName} ${userLastName}`.trim() || 'N/A';
    const userUsername = user.username ? `@${user.username}` : 'N/A';
   
    
    const reply =  `👤 <b>User Information</b>\n\n` +
      `<b>Chat ID:</b> <code>${chatId}</code>\n` +
      `<b>Name:</b> ${userFullName}\n` +
      `<b>Username:</b> ${userUsername}\n\n`;
    
    bot.sendMessage(chatId, reply, { parse_mode: 'HTML' });
  });

  // Handle /start command - show welcome message with keyboard
  bot.onText(/\/start/i, async (msg) => {
    const chatId = msg.chat.id;
    const connection = await pool.getConnection();
    
    try {
      // Get AGENT_CODE from database
      const [accountResults] = await connection.query(`
        SELECT agent.AGENT_CODE
        FROM agent
        WHERE agent.TELEGRAM_ID = ?
        LIMIT 1
      `, [chatId]);

      // If no agent found, send generic welcome message
      if (accountResults.length === 0) {
        bot.sendMessage(chatId, "Welcome to Demo Cage!", {
          reply_markup: {
            keyboard: [[{ text: "💰 Check Balance" }]],
            resize_keyboard: true,
            one_time_keyboard: false,
          }
        });
        return;
      }

      // Agent found, send Korean welcome message with agent code
      const agentCode = accountResults[0].AGENT_CODE;

      const welcomeMessage = `Welcome to Demo Cage!`;

      bot.sendMessage(chatId, welcomeMessage, {
        reply_markup: {
          keyboard: [[{ text: "💰 Check Balance" }]],
          resize_keyboard: true,
          one_time_keyboard: false,
        }
      });
    } catch (err) {
      console.error('❌ Error sending welcome message:', err);
      bot.sendMessage(chatId, "Welcome to Demo Cage!", {
        reply_markup: {
          keyboard: [[{ text: "💰 Check Balance" }]],
          resize_keyboard: true,
          one_time_keyboard: false,
        }
      });
    } finally {
      connection.release();
    }
  });
}

// Start EMPLOYEE bot
async function startEmployeeBot() {
  const token = await getTelegramToken('EMPLOYEE');
  if (!token) {
    console.error('❌ Telegram bot token not found for EMPLOYEE.');
    return;
  }

  if (employeeBotInstance) {
    console.log('⚠️ EMPLOYEE bot already running.');
    return;
  }

  const bot = new TelegramBot(token, { 
    polling: {
      interval: 1000,
      autoStart: true,
      params: {
        timeout: 30
      }
    },
    request: {
      agentOptions: {
        keepAlive: true,
        keepAliveMsecs: 30000
      }
    }
  });
  employeeBotInstance = bot;

  console.log('✅ Telegram EMPLOYEE bot is running...');
  setupBotErrorHandlers(bot, 'EMPLOYEE');

  // Helper function to escape HTML special characters
  function escapeHtml(text) {
    if (!text) return '';
    return String(text)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  // Get chat_id (for group or private) — type /getchatid in the chat
  bot.onText(/\/getchatid/i, (msg) => {
    const chatId = msg.chat.id;
    const user = msg.from || {};
    const userName = escapeHtml(user.first_name || '');
    const userLastName = escapeHtml(user.last_name || '');
    const userFullName = `${userName} ${userLastName}`.trim() || 'N/A';
    const userUsername = user.username ? `@${user.username}` : 'N/A';
   
    const reply = `👤 <b>User Information (EMPLOYEE Bot)</b>\n\n` +
      `<b>Chat ID:</b> <code>${chatId}</code>\n` +
      `<b>Name:</b> ${userFullName}\n` +
      `<b>Username:</b> ${userUsername}\n\n`;
    
    bot.sendMessage(chatId, reply, { parse_mode: 'HTML' });
  });
}

// Start MANAGEMENT bot
async function startManagementBot() {
  const token = await getTelegramToken('MANAGEMENT');
  if (!token) {
    console.error('❌ Telegram bot token not found for MANAGEMENT.');
    return;
  }

  if (managementBotInstance) {
    console.log('⚠️ MANAGEMENT bot already running.');
    return;
  }

  const bot = new TelegramBot(token, { 
    polling: {
      interval: 1000,
      autoStart: true,
      params: {
        timeout: 30
      }
    },
    request: {
      agentOptions: {
        keepAlive: true,
        keepAliveMsecs: 30000
      }
    }
  });
  managementBotInstance = bot;

  console.log('✅ Telegram MANAGEMENT bot is running...');
  setupBotErrorHandlers(bot, 'MANAGEMENT');

  // Helper function to escape HTML special characters
  function escapeHtml(text) {
    if (!text) return '';
    return String(text)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  // Get chat_id (for group or private) — type /getchatid in the chat
  bot.onText(/\/getchatid/i, (msg) => {
    const chatId = msg.chat.id;
    const user = msg.from || {};
    const userName = escapeHtml(user.first_name || '');
    const userLastName = escapeHtml(user.last_name || '');
    const userFullName = `${userName} ${userLastName}`.trim() || 'N/A';
    const userUsername = user.username ? `@${user.username}` : 'N/A';
   
    const reply = `👤 <b>User Information (MANAGEMENT Bot)</b>\n\n` +
      `<b>Chat ID:</b> <code>${chatId}</code>\n` +
      `<b>Name:</b> ${userFullName}\n` +
      `<b>Username:</b> ${userUsername}\n\n`;
    
    bot.sendMessage(chatId, reply, { parse_mode: 'HTML' });
  });
}

// Start all Telegram bots (GUEST, EMPLOYEE, MANAGEMENT)
async function startTelegramBot() {
  await startGuestBot();
  await startEmployeeBot();
  await startManagementBot();
}

module.exports = {
  sendTelegramMessage,
  sendTelegramToAdditionalChats,
  sendTelegramToEmployees,
  getEmployeeChatIds,
  sendTelegramToManagement,
  getManagementChatIds,
  sendTelegramPhoto,
  startTelegramBot,
  startGuestBot,
  startEmployeeBot,
  startManagementBot
};
