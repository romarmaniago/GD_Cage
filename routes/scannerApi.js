/**
 * Passport scanner JSON API (Vertex AI Gemini extract). Mounted at /api/scanner
 */

const fs = require('fs');
const path = require('path');
const express = require('express');
const { v1 } = require('@google-cloud/aiplatform');

const router = express.Router();

const GCP_PROJECT_ID = (process.env.GCP_PROJECT_ID || 'passport-scanner-v1').trim();
const GCP_LOCATION = (process.env.GCP_LOCATION || 'us-central1').trim();
/** Vertex publisher model id; 1.5-flash-001 is often retired — default 2.5 Flash. Override: GCP_VERTEX_MODEL */
const VERTEX_MODEL_ID = (process.env.GCP_VERTEX_MODEL || 'gemini-2.5-flash').trim();

function modelResourceName() {
  return `projects/${GCP_PROJECT_ID}/locations/${GCP_LOCATION}/publishers/google/models/${VERTEX_MODEL_ID}`;
}

let predictionClient;

function getPredictionClient() {
  if (!predictionClient) {
    predictionClient = new v1.PredictionServiceClient({
      apiEndpoint: `${GCP_LOCATION}-aiplatform.googleapis.com`,
    });
  }
  return predictionClient;
}

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
  if (req.session?.user_id) return next();
  if (typeof req.isAuthenticated === 'function' && req.isAuthenticated()) return next();
  return res.status(401).json({ error: { message: 'Unauthorized' } });
}

function credentialsConfigError() {
  const raw = (process.env.GOOGLE_APPLICATION_CREDENTIALS || '').trim();
  if (!raw) return 'GOOGLE_APPLICATION_CREDENTIALS is not set.';
  const abs = path.isAbsolute(raw) ? raw : path.resolve(process.cwd(), raw);
  if (!fs.existsSync(abs)) {
    return `Credentials file not found: ${abs}`;
  }
  return null;
}

function jsonError(res, httpStatus, code, message, extra) {
  const error = { code: String(code || 'UNKNOWN_ERROR'), message: String(message || 'Error') };
  if (extra && typeof extra === 'object') {
    for (const k of Object.keys(extra)) error[k] = extra[k];
  }
  return res.status(httpStatus).json({ error });
}

function normalizeImageInput(imageBase64, fallbackMime) {
  let s = String(imageBase64).trim();
  const dataUrl = /^data:([^;]+);base64,(.+)$/i.exec(s);
  if (dataUrl) {
    return {
      mimeType: (dataUrl[1] || fallbackMime || 'image/jpeg').trim() || 'image/jpeg',
      base64: dataUrl[2].replace(/\s/g, ''),
    };
  }
  return {
    mimeType: (fallbackMime || 'image/jpeg').toString().trim() || 'image/jpeg',
    base64: s.replace(/\s/g, ''),
  };
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
  const bodyMime = (req.body?.imageMimeType || 'image/jpeg').toString().trim() || 'image/jpeg';

  if (!imageBase64 || typeof imageBase64 !== 'string') {
    return jsonError(res, 400, 'IMAGE_REQUIRED', 'Passport image is required (imageBase64).');
  }

  const credErr = credentialsConfigError();
  if (credErr) {
    return jsonError(res, 503, 'GCP_CREDENTIALS_MISCONFIGURED', 'Passport scanner is not configured on the server.', {
      details: credErr,
    });
  }

  const { mimeType, base64: b64 } = normalizeImageInput(imageBase64, bodyMime);
  let imageBytes;
  try {
    imageBytes = Buffer.from(b64, 'base64');
  } catch {
    return jsonError(res, 400, 'IMAGE_BASE64_INVALID', 'Invalid image data. Please upload/scan again.');
  }
  if (!imageBytes.length) {
    return jsonError(res, 400, 'IMAGE_EMPTY', 'Empty image payload. Please upload/scan again.');
  }

  try {
    const client = getPredictionClient();
    const [vertexResponse] = await client.generateContent({
      model: modelResourceName(),
      contents: [
        {
          role: 'user',
          parts: [
            { text: EXTRACTION_PROMPT },
            {
              inlineData: {
                mimeType,
                data: imageBytes,
              },
            },
          ],
        },
      ],
      generationConfig: {
        temperature: 0.1,
        responseMimeType: 'application/json',
      },
    });

    const parts = vertexResponse?.candidates?.[0]?.content?.parts || [];
    const text = parts.map((p) => p.text || '').join('').trim();
    if (!text) {
      return jsonError(res, 502, 'VERTEX_NO_TEXT', 'Scanner service returned no data. Please try again.');
    }

    let data;
    try {
      data = JSON.parse(text);
    } catch {
      return jsonError(res, 502, 'VERTEX_BAD_JSON', 'Scanner service returned an invalid response. Please try again.');
    }

    return res.json({ data });
  } catch (err) {
    console.error('passport-extract (Vertex) error:', err);
    const rawMsg = err?.message || err?.details || (typeof err === 'string' ? err : '');
    const msg = rawMsg ? String(rawMsg) : 'Extraction failed.';
    // If Vertex throws a quota/auth/permission error, keep it server-side but return a stable code.
    return jsonError(res, 500, 'EXTRACTION_FAILED', 'Passport scan failed. Please try again.', {
      details: msg,
    });
  }
}

router.post('/passport-extract', requireScannerKey, handlePassportExtract);
router.post('/passport-extract-internal', requireInternalSession, handlePassportExtract);

module.exports = router;
