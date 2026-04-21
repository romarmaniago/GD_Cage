/**
 * Passport scanner JSON API (Gemini extract). Mounted at /api/scanner
 */

const express = require('express');
const router = express.Router();
const pool = require('../config/db');

const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';

function requireScannerKey(req, res, next) {
  const expected = (process.env.SCANNER_API_KEY || '').trim();
  const key = (req.headers['x-api-key'] || '').toString().trim();
  if (!expected) {
    return res.status(500).json({ error: { message: 'Server SCANNER_API_KEY is not configured.' } });
  }
  if (key !== expected) {
    return res.status(401).json({ error: { message: 'Invalid or missing x-api-key.' } });
  }
  next();
}

function requireInternalSession(req, res, next) {
  // For Cage web UI: allow extraction without exposing SCANNER_API_KEY to browser.
  if (req.session?.user_id) return next();
  if (typeof req.isAuthenticated === 'function' && req.isAuthenticated()) return next();
  return res.status(401).json({ error: { message: 'Unauthorized' } });
}

async function resolveGeminiApiKey() {
  const fromEnv = (process.env.GEMINI_API_KEY || '').trim();
  if (fromEnv) return fromEnv;
  try {
    const [rows] = await pool.query(
      'SELECT GEMINI_API AS k FROM passportscanner_api LIMIT 1'
    );
    const k = rows?.[0]?.k;
    if (k) return String(k).trim();
  } catch (_) {
    /* table/column may not exist */
  }
  return null;
}

const EXTRACTION_PROMPT = `You are an expert at reading passport and travel document photos.
Analyze the image. Return ONLY valid JSON (no markdown) with these keys, using null when unknown:
{
  "full_name": string|null,
  "passport_number": string|null,
  "nationality": string|null,
  "date_of_birth": string|null (YYYY-MM-DD if possible),
  "expiry_date": string|null (YYYY-MM-DD if possible),
  "gender": string|null (M/F or full word),
  "place_of_birth": string|null,
  "document_type": string|null,
  "country_code": string|null (3-letter ICAO if visible),
  "mrz_line": string|null (longest MRZ line if visible),
  "extraction_confidence": "high"|"medium"|"low",
  "is_passport": boolean (true only for a passport or official passport-style ID page)
}

CRITICAL for "document_type":
- Copy the SHORT TYPE CODE exactly as printed next to the field labeled Type, Tipo, 종류, 类型, 種類, or similar — NOT a generic description.
- Examples: Korean passports often show "PM" or "P" next to 종류/Type — return "PM" or "P" exactly as shown. Many passports show a 1–3 character code (e.g. P, PM, CO, PD).
- NEVER return the English word "Passport" or "Ordinary passport" for document_type unless that exact text is printed as the type code on the page. If you only see a code like PM, return "PM".`;

async function handlePassportExtract(req, res) {
  const imageBase64 = req.body?.imageBase64;
  const imageMimeType = (req.body?.imageMimeType || 'image/jpeg').toString().trim() || 'image/jpeg';

  if (!imageBase64 || typeof imageBase64 !== 'string') {
    return res.status(400).json({ error: { message: 'imageBase64 is required.' } });
  }

  const geminiKey = await resolveGeminiApiKey();
  if (!geminiKey) {
    return res.status(503).json({
      error: { message: 'Gemini API key not configured (set GEMINI_API_KEY or passportscanner_api.GEMINI_API).' },
    });
  }

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${encodeURIComponent(geminiKey)}`;

  try {
    const geminiRes = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              { text: EXTRACTION_PROMPT },
              { inlineData: { mimeType: imageMimeType, data: imageBase64 } },
            ],
          },
        ],
        generationConfig: {
          temperature: 0.1,
          responseMimeType: 'application/json',
        },
      }),
    });

    const rawText = await geminiRes.text();
    let geminiJson;
    try {
      geminiJson = JSON.parse(rawText);
    } catch {
      return res.status(502).json({
        error: { message: `Gemini returned non-JSON (HTTP ${geminiRes.status}).` },
      });
    }

    if (!geminiRes.ok) {
      const msg = geminiJson?.error?.message || geminiJson?.error || `Gemini HTTP ${geminiRes.status}`;
      return res.status(502).json({ error: { message: String(msg) } });
    }

    const text =
      geminiJson?.candidates?.[0]?.content?.parts?.map((p) => p.text).join('') || '';
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      return res.status(502).json({ error: { message: 'Could not parse Gemini extraction JSON.' } });
    }

    return res.json({ data });
  } catch (err) {
    console.error('passport-extract error:', err);
    return res.status(500).json({ error: { message: err.message || 'Extraction failed.' } });
  }
}

// External/mobile apps: require x-api-key
router.post('/passport-extract', requireScannerKey, handlePassportExtract);

// Cage web UI: require session (no x-api-key in browser)
router.post('/passport-extract-internal', requireInternalSession, handlePassportExtract);

module.exports = router;
