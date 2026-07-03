var agent_id;

// Escape string for safe use inside JavaScript single-quoted string (prevents syntax error when name/remarks have apostrophes, newlines, etc.)
function escapeJsString(str) {
	if (str == null || str === undefined) return '';
	return String(str)
		.replace(/\\/g, '\\\\')
		.replace(/'/g, "\\'")
		.replace(/\r/g, '\\r')
		.replace(/\n/g, '\\n');
}

// Cache for Telegram usernames
var telegramUsernameCache = {};

function escapeHtml(s) {
	const div = document.createElement('div');
	div.textContent = s == null ? '' : String(s);
	return div.innerHTML;
}

function isAgentTelegramEnabledFlag(row) {
	const v = row && row.telegram_enabled;
	return v === 1 || v === true || v === '1' || v === undefined || v === null;
}

function showAgentTelegramToggleSwal(enabled) {
	const tr = window.translations?.agent || {};
	Swal.fire({
		title: tr.success || 'Success',
		text: enabled
			? (tr.chat_id_enabled || 'Notifications enabled for this account.')
			: (tr.chat_id_disabled || 'Notifications disabled for this account.'),
		icon: 'success',
		confirmButtonText: tr.ok || 'OK'
	});
}

function renderAgentTelegramToggle(row, readOnly) {
	if (!row || !row.agent_telegram) return '';
	const enabled = isAgentTelegramEnabledFlag(row);
	const tr = window.translations?.agent || {};
	return (
		'<div class="form-check form-switch d-inline-flex mb-0 align-items-center justify-content-center">' +
		'<input class="form-check-input notify-toggle-switch btn-toggle-agent-telegram" type="checkbox" role="switch"' +
		' data-agent-id="' + row.agent_id + '" data-chat-id="' + escapeHtml(String(row.agent_telegram)) + '"' +
		(readOnly ? ' disabled' : '') +
		(enabled ? ' checked' : '') +
		' title="' + escapeHtml(tr.toggle_notifications || 'Enable / disable notifications') + '">' +
		'</div>'
	);
}

function renderAgentActionCell(row, readOnly, isSuperAdmin) {
	const toggleSlot = row.agent_telegram ? renderAgentTelegramToggle(row, readOnly) : '';
	const editAttrs = readOnly
		? ' disabled'
		: ' onclick="edit_agent(' +
			row.agent_id +
			", '" +
			escapeJsString(row.agent_code) +
			"', '" +
			escapeJsString(row.agent_name) +
			"', '" +
			escapeJsString(row.agent_contact) +
			"', '" +
			escapeJsString(row.agent_telegram) +
			"', '" +
			escapeJsString(row.agent_remarks) +
			"')\"";
	const deleteSlot = isSuperAdmin
		? '<span class="agent-action-delete-slot">' +
			'<button type="button" class="btn btn-link text-danger p-0 border-0 shadow-none btn-delete-agent-icon js-bs-tooltip-enabled"' +
			' onclick="checkPermissionToDeleteAgent(' +
			row.agent_id +
			')" aria-label="Archive" data-bs-toggle="tooltip" title="Archive">' +
			'<i class="fa fa-trash-alt"></i></button></span>'
		: '';
	return (
		'<div class="agent-action-wrap">' +
		'<span class="agent-action-toggle-slot">' +
		toggleSlot +
		'</span>' +
		'<span class="agent-action-edit-slot">' +
		'<button type="button" class="btn btn-link text-primary p-0 border-0 shadow-none btn-edit-agent-icon js-bs-tooltip-enabled"' +
		editAttrs +
		' aria-label="Edit"><i class="fa fa-pencil-alt"></i></button>' +
		'</span>' +
		deleteSlot +
		'</div>'
	);
}

// Pending passport extraction (used to auto-fill New Guest + Passport Details modal before save)
window.__pendingPassportExtract = null;
window.__pendingPassportImageDataUrl = null;
window.__pendingPassportFile = null;
window.__pendingFaceFile = null;
window.__pendingFacePreviewDataUrl = null;
window.__passportScanInProgress = false;
window.__suppressLedgerReopen = false;
window.__returnToLedgerOnClose = false;
window.__returnToLedgerOnEditClose = false;

function setHidden(id, value) {
	if (!id) return;
	var el = document.getElementById(id);
	if (!el) return;
	el.value = value == null ? '' : String(value);
}

function applyPassportExtractToGuestForm(extract) {
	if (!extract || typeof extract !== 'object') return;

	// Fill visible fields (only the ones that make sense)
	if (extract.full_name) {
		// New Guest modal uses name="txtName" (no id), Edit Guest uses id="agentName"
		var editName = document.getElementById('agentName');
		if (editName) editName.value = extract.full_name;
		var newName = document.querySelector('#modal-new-agent input[name="txtName"]');
		if (newName) newName.value = extract.full_name;
	}

	// Hidden passport fields (New Guest)
	setHidden('txtDocumentType', extract.document_type);
	setHidden('txtCountryCode', extract.country_code);
	setHidden('txtPassportNo', extract.passport_number);
	setHidden('txtNationality', extract.nationality);
	setHidden('txtDateOfBirth', extract.date_of_birth);
	setHidden('txtExpiryDate', extract.expiry_date);
	setHidden('txtGender', extract.gender);
	setHidden('txtMrzLine', extract.mrz_line);

	// Hidden passport fields (Edit Guest)
	setHidden('txtDocumentType_edit', extract.document_type);
	setHidden('txtCountryCode_edit', extract.country_code);
	setHidden('txtPassportNo_edit', extract.passport_number);
	setHidden('txtNationality_edit', extract.nationality);
	setHidden('txtDateOfBirth_edit', extract.date_of_birth);
	setHidden('txtExpiryDate_edit', extract.expiry_date);
	setHidden('txtGender_edit', extract.gender);
	setHidden('txtMrzLine_edit', extract.mrz_line);
}

function resetNewGuestFormAfterCreate() {
	var form = document.getElementById('add_new_agent');
	var agencyLineEl = document.getElementById('txtAgencyLine');
	var agencyLineVal = agencyLineEl ? agencyLineEl.value : '';
	if (form && typeof form.reset === 'function') form.reset();
	if (agencyLineEl) agencyLineEl.value = agencyLineVal;

	// Clear hidden passport fields (New Guest)
	setHidden('txtDocumentType', '');
	setHidden('txtCountryCode', '');
	setHidden('txtPassportNo', '');
	setHidden('txtNationality', '');
	setHidden('txtDateOfBirth', '');
	setHidden('txtExpiryDate', '');
	setHidden('txtGender', '');
	setHidden('txtMrzLine', '');

	// Clear pending scan buffers so Passport Details won't show stale data.
	window.__pendingPassportExtract = null;
	window.__pendingPassportImageDataUrl = null;
	window.__pendingPassportFile = null;
	window.__pendingFaceFile = null;
	window.__pendingFacePreviewDataUrl = null;

	// File inputs don't always clear reliably across browsers after FormData submit.
	var fileInput = document.querySelector('#modal-new-agent .js-passport-file');
	if (fileInput) fileInput.value = '';

	hideNewGuestPassportPreview();
}

function getMrzLines(mrz) {
	if (!mrz || !String(mrz).trim()) return ['—', '—'];
	var lines = String(mrz)
		.trim()
		.split(/\r?\n/)
		.map(function (l) { return l.trim(); })
		.filter(Boolean);
	if (lines.length >= 2) return [lines[0], lines[1]];
	var t = String(mrz).replace(/\s+/g, '');
	if (!t) return ['—', '—'];
	return [t.slice(0, 44) || t, t.slice(44, 88) || '—'];
}

function expiryStatus(expiry) {
	if (!expiry) return 'unknown';
	var d = new Date(expiry);
	if (Number.isNaN(d.getTime())) return 'unknown';
	var t = new Date();
	t.setHours(0, 0, 0, 0);
	d.setHours(0, 0, 0, 0);
	return d >= t ? 'valid' : 'expired';
}

function hideNewGuestPassportPreview() {
	var wrap = document.getElementById('new-guest-passport-preview');
	if (!wrap) return;
	wrap.classList.add('d-none');
	var img = document.getElementById('ngp-face-thumb');
	if (img) {
		img.removeAttribute('src');
		img.alt = '';
	}
}

/** Clear passport upload + extracted data + name (New Guest only). Keeps account, contact, etc. */
function resetNewGuestPassportUpload() {
	setHidden('txtDocumentType', '');
	setHidden('txtCountryCode', '');
	setHidden('txtPassportNo', '');
	setHidden('txtNationality', '');
	setHidden('txtDateOfBirth', '');
	setHidden('txtExpiryDate', '');
	setHidden('txtGender', '');
	setHidden('txtMrzLine', '');

	window.__pendingPassportExtract = null;
	window.__pendingPassportImageDataUrl = null;
	window.__pendingPassportFile = null;
	window.__pendingFaceFile = null;
	window.__pendingFacePreviewDataUrl = null;

	var fileInput = document.querySelector('#modal-new-agent .js-passport-file');
	if (fileInput) fileInput.value = '';

	var newName = document.querySelector('#modal-new-agent input[name="txtName"]');
	if (newName) newName.value = '';

	hideNewGuestPassportPreview();
}

function renderNewGuestPassportPreview(extract, facePreviewDataUrl) {
	if (!extract) return;
	var wrap = document.getElementById('new-guest-passport-preview');
	if (!wrap) return;

	var countryTitle = ((extract.nationality || extract.country_code || 'PASSPORT') + '').toUpperCase();
	var docType = extract.document_type || 'P';
	var exp = expiryStatus(extract.expiry_date);
	var mrz = getMrzLines(extract.mrz_line);

	var elCountry = document.getElementById('ngp-country-title');
	var elDoc = document.getElementById('ngp-doc-badge');
	if (elCountry) elCountry.textContent = countryTitle;
	if (elDoc) elDoc.textContent = 'PASSPORT · ' + docType;

	var expBadge = document.getElementById('ngp-expiry-badge');
	if (expBadge) {
		if (exp === 'expired') {
			expBadge.textContent = 'Expired';
			expBadge.style.background = '#fee2e2';
			expBadge.style.color = '#991b1b';
		} else if (exp === 'valid') {
			expBadge.textContent = 'Valid';
			expBadge.style.background = '#dcfce7';
			expBadge.style.color = '#166534';
		} else {
			expBadge.textContent = 'Unknown';
			expBadge.style.background = '#f3f4f6';
			expBadge.style.color = '#374151';
		}
	}

	var thumb = document.getElementById('ngp-face-thumb');
	if (thumb) {
		if (facePreviewDataUrl) {
			thumb.src = facePreviewDataUrl;
			thumb.alt = 'Face';
		} else {
			thumb.removeAttribute('src');
			thumb.alt = '';
		}
	}

	var elName = document.getElementById('ngp-full-name');
	var elPp = document.getElementById('ngp-passport-no');
	var elGen = document.getElementById('ngp-gender');
	var elDob = document.getElementById('ngp-dob');
	if (elName) elName.textContent = extract.full_name || '—';
	if (elPp) elPp.textContent = extract.passport_number || '—';
	if (elGen) elGen.textContent = extract.gender || '—';
	if (elDob) elDob.textContent = extract.date_of_birth || '—';

	var expEl = document.getElementById('ngp-expiry');
	if (expEl) {
		expEl.textContent = extract.expiry_date || '—';
		if (exp === 'expired') {
			expEl.style.color = '#dc2626';
		} else if (exp === 'valid') {
			expEl.style.color = '#16a34a';
		} else {
			expEl.style.color = '#111827';
		}
	}

	var elMrz1 = document.getElementById('ngp-mrz-1');
	var elMrz2 = document.getElementById('ngp-mrz-2');
	if (elMrz1) elMrz1.textContent = mrz[0];
	if (elMrz2) elMrz2.textContent = mrz[1];

	wrap.classList.remove('d-none');
}

function setGuestSubmitButtonsDisabled(disabled) {
	$('#submit-new-agent-btn, #submit-edit-agent-btn').prop('disabled', !!disabled);
}

/** Ensure profile photo is cropped face, not the full passport scan. */
function prepareGuestPhotoFormData(formData) {
	if (window.__passportScanInProgress) {
		return { ok: false, message: 'Passport scan is still in progress. Please wait.' };
	}

	var hasPassportScan = !!(window.__pendingPassportExtract || window.__pendingPassportFile);
	if (hasPassportScan) {
		if (!window.__pendingFaceFile) {
			return {
				ok: false,
				message: 'Face photo is not ready. Wait for passport processing to finish or re-upload the passport.'
			};
		}
		formData.delete('photo');
		formData.append('photo', window.__pendingFaceFile);
		if (window.__pendingPassportFile) {
			formData.append('passportImage', window.__pendingPassportFile);
		}
		return { ok: true };
	}

	if (window.__pendingFaceFile) {
		formData.delete('photo');
		formData.append('photo', window.__pendingFaceFile);
	}

	return { ok: true };
}

function showGuestFormError(message) {
	if (typeof Swal !== 'undefined') {
		Swal.fire({ icon: 'warning', title: 'Cannot save', text: message });
	} else {
		alert(message);
	}
}

async function runPassportScanForNewGuest(file, options) {
	options = options || {};
	var showBusy = options.showBusy !== false;

	window.__passportScanInProgress = true;
	setGuestSubmitButtonsDisabled(true);
	try {
		if (showBusy && typeof Swal !== 'undefined') {
			Swal.fire({
				title: 'Scanning passport…',
				text: 'Please wait while we read the passport details.',
				allowOutsideClick: false,
				allowEscapeKey: false,
				didOpen: function () { Swal.showLoading(); }
			});
		}

		var r = await extractPassportFromFile(file);
		var extract = r.extract;
		if (!extract || extract.is_passport === false) {
			throw new Error('This does not appear to be a passport. Please upload a valid passport image.');
		}

		window.__pendingPassportExtract = extract;
		window.__pendingPassportImageDataUrl = r.dataUrl;
		applyPassportExtractToGuestForm(extract);

		var face = await cropFaceFromDataUrl(r.dataUrl);
		window.__pendingFaceFile = face.file;
		window.__pendingFacePreviewDataUrl = face.previewDataUrl || null;

		renderNewGuestPassportPreview(extract, window.__pendingFacePreviewDataUrl);
	} finally {
		window.__passportScanInProgress = false;
		setGuestSubmitButtonsDisabled(false);
		if (showBusy && typeof Swal !== 'undefined') Swal.close();
	}
}

function fileToDataUrl(file) {
	return new Promise(function (resolve, reject) {
		var reader = new FileReader();
		reader.onerror = function () { reject(new Error('Failed to read file')); };
		reader.onload = function () { resolve(String(reader.result || '')); };
		reader.readAsDataURL(file);
	});
}

function canvasToWebpDataUrl(canvas, quality) {
	var q = typeof quality === 'number' ? quality : 0.92;
	try {
		var url = canvas.toDataURL('image/webp', q);
		if (url && /^data:image\/webp/i.test(url)) return url;
	} catch (_) {
		/* ignore */
	}
	return canvas.toDataURL('image/jpeg', q);
}

function dataUrlToWebpFile(dataUrl, filename) {
	var name = (filename && String(filename)) || 'face.webp';
	if (!name.toLowerCase().endsWith('.webp')) name += '.webp';
	var blob = dataUrlToBlob(dataUrl);
	var mime = (blob && blob.type) || '';
	if (mime !== 'image/webp') {
		return new File([blob], name.replace(/\.webp$/i, '.jpg'), { type: mime || 'image/jpeg' });
	}
	return new File([blob], name, { type: 'image/webp' });
}

async function cropFaceFromDataUrl(dataUrl) {
	// Match passport-scanner behavior as close as possible using face-api.js + the same models.
	var img = new Image();
	img.crossOrigin = 'anonymous';
	await new Promise(function (resolve, reject) {
		img.onload = resolve;
		img.onerror = function () { reject(new Error('Failed to load image')); };
		img.src = dataUrl;
	});

	var w = img.naturalWidth || img.width;
	var h = img.naturalHeight || img.height;
	if (!w || !h) throw new Error('Invalid image dimensions');

	// Try face-api crop first (same models as passport-scanner).
	try {
		var faceDataUrl = await detectAndCropFaceLikePassportScanner(dataUrl, img);
		if (faceDataUrl) {
			return { file: dataUrlToWebpFile(faceDataUrl, 'face.webp'), previewDataUrl: faceDataUrl };
		}
	} catch (_) {
		// fall back below
	}

	// Fallback crop: left-ish portrait area (best-effort).
	var sx = Math.floor(w * 0.06);
	var sy = Math.floor(h * 0.42);
	var sw = Math.min(Math.floor(w * 0.30), w - sx);
	var sh = Math.min(Math.floor(h * 0.36), h - sy);

	var canvas = document.createElement('canvas');
	canvas.width = sw;
	canvas.height = sh;
	var ctx = canvas.getContext('2d');
	if (!ctx) throw new Error('Canvas not supported');
	ctx.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);

	var previewDataUrl = canvasToWebpDataUrl(canvas, 0.9);
	var blob;
	blob = await new Promise(function (resolve) {
		canvas.toBlob(function (b) { resolve(b); }, 'image/webp', 0.9);
	});
	if (!blob || blob.type !== 'image/webp') {
		previewDataUrl = canvas.toDataURL('image/jpeg', 0.9);
		blob = await new Promise(function (resolve) {
			canvas.toBlob(function (b) { resolve(b); }, 'image/jpeg', 0.9);
		});
	}
	if (!blob) throw new Error('Failed to create cropped image');

	var isWebp = blob.type === 'image/webp';
	return {
		file: new File([blob], isWebp ? 'face.webp' : 'face.jpg', { type: isWebp ? 'image/webp' : 'image/jpeg' }),
		previewDataUrl: previewDataUrl
	};
}
window.cropFaceFromDataUrl = cropFaceFromDataUrl;

var __faceModelsLoaded = false;

function dataUrlToBlob(dataUrl) {
	var parts = String(dataUrl || '').split(',');
	var meta = parts[0] || '';
	var b64 = parts[1] || '';
	var mime = (meta.match(/:(.*?);/) || [])[1] || 'image/jpeg';
	var bin = atob(b64);
	var len = bin.length;
	var u8 = new Uint8Array(len);
	for (var i = 0; i < len; i++) u8[i] = bin.charCodeAt(i);
	return new Blob([u8], { type: mime });
}

async function loadFaceApiModels() {
	if (__faceModelsLoaded) return;
	if (!window.faceapi) throw new Error('face-api.js not loaded');
	// Serve models from GD_Cage public/models (copied from passport-scanner)
	await Promise.all([
		window.faceapi.nets.tinyFaceDetector.loadFromUri('/models'),
		window.faceapi.nets.faceLandmark68TinyNet.loadFromUri('/models')
	]);
	__faceModelsLoaded = true;
}

function drawContainTo160x200(colorImg, source) {
	var OUT_W = 160;
	var OUT_H = 200;
	var canvas = document.createElement('canvas');
	canvas.width = OUT_W;
	canvas.height = OUT_H;
	var ctx = canvas.getContext('2d');
	if (!ctx) return null;
	ctx.fillStyle = '#ffffff';
	ctx.fillRect(0, 0, OUT_W, OUT_H);
	var scaleX = OUT_W / source.w;
	var scaleY = OUT_H / source.h;
	var scale = Math.max(scaleX, scaleY);
	var drawW = source.w * scale;
	var drawH = source.h * scale;
	var dx = (OUT_W - drawW) / 2;
	var dy = (OUT_H - drawH) / 2;
	ctx.drawImage(colorImg, source.x, source.y, source.w, source.h, dx, dy, drawW, drawH);
	return canvasToWebpDataUrl(canvas, 0.92);
}

function extractVerticalStripFromImg(img, startYFrac, endYFrac) {
	var startY = Math.floor(img.height * startYFrac);
	var endY = Math.max(startY + 1, Math.floor(img.height * endYFrac));
	var cropHeight = endY - startY;
	var canvas = document.createElement('canvas');
	canvas.width = img.width;
	canvas.height = cropHeight;
	var ctx = canvas.getContext('2d');
	if (!ctx) throw new Error('Canvas 2d context not available');
	ctx.drawImage(img, 0, startY, img.width, cropHeight, 0, 0, img.width, cropHeight);
	return { dataUrl: canvasToWebpDataUrl(canvas, 0.95), offsetY: startY };
}

function buildLandmarkDrivenRect(positions, canvasW, canvasH, offsetY) {
	if (!positions || positions.length < 27) return null;
	function yf(py) { return py + offsetY; }
	var browTop = Infinity;
	for (var i = 17; i < 27; i++) browTop = Math.min(browTop, yf(positions[i].y));
	var chin = positions[8];
	var jawLeft = positions[0];
	var jawRight = positions[16];
	var faceWidth = jawRight.x - jawLeft.x;
	if (faceWidth <= 1) return null;
	var faceCenterX = (jawLeft.x + jawRight.x) / 2;
	var top = browTop - faceWidth * 1.0; // headroom
	var bottom = yf(chin.y) + faceWidth * 0.45; // chin pad
	var srcH = bottom - top;
	if (srcH <= 1) return null;
	var srcW = srcH * (4 / 5);
	var scaleFit = Math.min(1, canvasW / srcW, canvasH / srcH);
	srcW *= scaleFit;
	srcH *= scaleFit;
	var x = Math.max(0, Math.min(canvasW - srcW, faceCenterX - srcW / 2));
	var y = Math.max(0, Math.min(canvasH - srcH, top));
	return { x: x, y: y, w: srcW, h: srcH };
}

async function tryDetectAndCropStrip(colorImg, stripDataUrl, offsetY) {
	var detectionImg = await window.faceapi.fetchImage(stripDataUrl);
	var result = await window.faceapi
		.detectSingleFace(detectionImg, new window.faceapi.TinyFaceDetectorOptions({ inputSize: 416, scoreThreshold: 0.3 }))
		.withFaceLandmarks(true);
	if (!result || !result.detection || !result.detection.box) return null;
	var positions = result.landmarks && result.landmarks.positions ? result.landmarks.positions : null;

	// Landmark-driven rect first (same as passport-scanner).
	var rect = buildLandmarkDrivenRect(positions, colorImg.width, colorImg.height, offsetY);
	if (rect) return drawContainTo160x200(colorImg, rect);

	// Fallback: padded detection box (mapped to full image).
	var b = result.detection.box;
	var pad = Math.max(b.width, b.height) * 0.6;
	var cx = b.x + b.width / 2;
	var cy = b.y + b.height / 2 + offsetY;
	var rw = (b.width + pad) * 1.35;
	var rh = rw * (200 / 160);
	var sx = Math.max(0, Math.min(colorImg.width - rw, cx - rw / 2));
	var sy = Math.max(0, Math.min(colorImg.height - rh, cy - rh / 2));
	return drawContainTo160x200(colorImg, { x: sx, y: sy, w: rw, h: rh });
}

async function detectAndCropFaceLikePassportScanner(imageDataUrl, colorImg) {
	await loadFaceApiModels();

	// Prefer opposite page strip (top half) then data page (bottom 60%), like passport-scanner.
	var photoPage = extractVerticalStripFromImg(colorImg, 0, 0.52);
	var fromPhoto = await tryDetectAndCropStrip(colorImg, photoPage.dataUrl, photoPage.offsetY);
	if (fromPhoto) return fromPhoto;

	var dataPage = extractVerticalStripFromImg(colorImg, 0.4, 1);
	var fromData = await tryDetectAndCropStrip(colorImg, dataPage.dataUrl, dataPage.offsetY);
	return fromData || null;
}

async function extractPassportFromFile(file) {
	if (!file || !file.type || !file.type.startsWith('image/')) {
		throw new Error('Please choose an image file.');
	}
	var dataUrl = await fileToDataUrl(file);

	// Keep payload small: downscale + JPEG encode when needed.
	// Base64 JSON overhead is big; large camera images can otherwise hit HTTP 413.
	async function toReasonableJpegDataUrl(inputDataUrl) {
		try {
			var img = await window.faceapi.fetchImage(inputDataUrl);
			var maxDim = 1600;
			var w = img.naturalWidth || img.width;
			var h = img.naturalHeight || img.height;
			if (!w || !h) return inputDataUrl;
			var scale = Math.min(1, maxDim / Math.max(w, h));
			if (scale >= 0.999) return inputDataUrl;
			var canvas = document.createElement('canvas');
			canvas.width = Math.max(1, Math.round(w * scale));
			canvas.height = Math.max(1, Math.round(h * scale));
			var ctx = canvas.getContext('2d');
			ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
			return canvas.toDataURL('image/jpeg', 0.85);
		} catch (_) {
			return inputDataUrl;
		}
	}

	// If the original base64 is huge, compress. Threshold ~12MB base64 (≈9MB binary).
	var rawBase64 = (dataUrl.split(',')[1] || '').trim();
	if (!rawBase64) throw new Error('Invalid image.');
	if (rawBase64.length > 12 * 1024 * 1024) {
		dataUrl = await toReasonableJpegDataUrl(dataUrl);
	}

	var base64 = (dataUrl.split(',')[1] || '').trim();
	if (!base64) throw new Error('Invalid image.');

	var res = await fetch('/api/scanner/passport-extract-internal', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ imageBase64: base64, imageMimeType: 'image/jpeg' })
	});
	var json = await res.json().catch(function () { return null; });
	if (!res.ok) {
		var errObj = json && json.error ? json.error : null;
		var code = errObj && errObj.code ? String(errObj.code).toUpperCase() : '';
		var serverMsg = errObj && (errObj.message || errObj.error) ? String(errObj.message || errObj.error) : '';
		var msg = '';
		if (res.status === 401) {
			msg = 'Unauthorized: not logged in. Please re-login and try again.';
		} else if (res.status === 413) {
			msg = 'Image is too large for the server. Please use a smaller/clearer photo.';
		} else if (res.status === 503 && code === 'GCP_CREDENTIALS_MISCONFIGURED') {
			msg = 'Passport scanner is not configured on the server. Please contact admin.';
		} else if (code === 'IMAGE_REQUIRED') {
			msg = 'Passport image is required. Please scan again.';
		} else if (code === 'IMAGE_BASE64_INVALID' || code === 'IMAGE_EMPTY') {
			msg = 'Invalid passport image. Please scan again (clear photo, no glare).';
		} else if (code === 'VERTEX_NO_TEXT') {
			msg = 'Scanner could not read the passport. Please retake photo (good lighting, focus, no blur).';
		} else if (code === 'VERTEX_BAD_JSON') {
			msg = 'Scanner returned an invalid response. Please try again.';
		} else if (code === 'EXTRACTION_FAILED') {
			msg = 'Passport scan failed. Please try again.';
		} else {
			msg = serverMsg || ('HTTP ' + res.status);
		}
		throw new Error(msg);
	}
	return { extract: json && json.data ? json.data : null, dataUrl: dataUrl };
}
window.extractPassportFromFile = extractPassportFromFile;

// Function to fetch Telegram username from chat ID
function fetchTelegramUsername(chatId, userType) {
	if (!chatId || chatId === '' || chatId === null) {
		return Promise.resolve(null);
	}

	// Return cached value if available
	if (telegramUsernameCache[chatId]) {
		return Promise.resolve(telegramUsernameCache[chatId]);
	}

	return new Promise(function(resolve) {
		$.ajax({
			url: '/telegramAPI/chat-info/' + (userType || 'GUEST') + '/' + encodeURIComponent(chatId),
			method: 'GET',
			success: function(data) {
				if (data && data.chat && data.chat.username) {
					telegramUsernameCache[chatId] = data.chat.username;
					resolve(data.chat.username);
				} else {
					telegramUsernameCache[chatId] = null;
					resolve(null);
				}
			},
			error: function() {
				telegramUsernameCache[chatId] = null;
				resolve(null);
			}
		});
	});
}

$(document).ready(function () {
	if ($.fn.DataTable.isDataTable('#agent-tbl')) {
		$('#agent-tbl').DataTable().destroy();
	}

	const permissions = parseInt($('#user-role').data('permissions'));

	// Get translations or use defaults
	const translations = window.translations?.agent || {};
	const activeText = translations.active || 'ACTIVE';
	const inactiveText = translations.inactive || 'INACTIVE';
	const searchText = translations.search || 'Search:';
	const showingEntriesText = translations.showing_entries || 'Showing _START_ to _END_ of _TOTAL_ entries';
	const previousText = translations.previous || 'Previous';
	const nextText = translations.next || 'Next';

	const dataTable = $('#agent-tbl').DataTable({
		ajax: {
			url: '/account_data',
			dataSrc: function (json) {
				return json;
			}
		},
		language: {
			search: searchText,
			info: showingEntriesText,
			paginate: {
				previous: previousText,
				next: nextText
			}
		},
		order: [[6, 'desc']], // Latest Game column
		columnDefs: [
			{ targets: 6, className: 'text-center' },
			{ targets: 7, className: 'text-center' },
			{ targets: 8, className: 'text-center agent-action-cell', orderable: false, searchable: false }
		],
		columns: [
			{ data: 'agency_name' },
			{
				data: 'agent_code',
				render: function (data, type, row) {
					if (type !== 'display') {
						return data;
					}
					if (permissions === 2) {
						return row.agent_code;
					}
					return `
						<a href="#"
							onclick="account_details(${row.account_id}, '${escapeJsString(row.agent_code)}', '${escapeJsString(row.agent_name)}')">
							${row.agent_code}
						</a>
					`;
				}
			},
			{ data: 'agent_name' },
			{ data: 'agent_contact' },
			{
				data: 'agent_telegram',
				render: function (data, type, row) {
					if (type !== 'display') {
						return data || '';
					}

					if (!data || data === '' || data === null) {
						return '';
					}

					const cellId = 'telegram-' + row.agent_id + '-' + row.account_id;
					const rowClass = isAgentTelegramEnabledFlag(row) ? '' : 'text-muted opacity-75';
					return '<span id="' + cellId + '" class="' + rowClass + '"><code>' + escapeHtml(String(data)) + '</code></span>';
				}
			},
			{
				data: 'agent_remarks',
				render: function (data, type, row) {
					var raw = data != null ? String(data) : '';
					if (type !== 'display') return raw;
					if (!window.RemarksEditor || !row.agent_id) return raw;
					return window.RemarksEditor.renderCell(raw, {
						source: 'agent',
						recordId: row.agent_id
					});
				}
			},
			{
				data: 'LATEST_GAME_DATE',
				render: function (data, type) {
					if (type === 'sort' || type === 'type') {
						return data ? new Date(data).getTime() : 0;
					}
					if (!data) return '';
					return moment(data).isValid()
						? moment(data).format('YYYY-MM-DD HH:mm')
						: '';
				}
			},
			{
				data: 'active',
				render: function (data) {
					var val = Number(data);
					var isActive = val === 1 || data === true || data === 'true' || data === '1';
					return isActive
						? '<span class="css-blue">' + activeText + '</span>'
						: '<span class="css-red">' + inactiveText + '</span>';
				}
			},
			{
				data: null,
				render: function (data, type, row) {
					if (type !== 'display') return '';
					return renderAgentActionCell(row, permissions === 2, permissions === 0);
				}
			}
		],
		drawCallback: function () {
			// Fetch Telegram usernames for all visible rows after table draw
			const api = this.api();
			const rows = api.rows({ page: 'current' }).nodes();
			
			$(rows).each(function() {
				const row = api.row(this).data();
				if (row && row.agent_telegram) {
					const cellId = 'telegram-' + row.agent_id + '-' + row.account_id;
					const $cell = $('#' + cellId);
					
					if ($cell.length && !$cell.data('username-fetched')) {
						$cell.data('username-fetched', true);
						fetchTelegramUsername(row.agent_telegram, 'GUEST').then(function(username) {
							if (username) {
								const currentText = $cell.text().trim();
								if (currentText && !currentText.includes('@')) {
									$cell.html('<code>' + escapeHtml(currentText) + '</code> <span class="text-muted">(@' + escapeHtml(username) + ')</span>');
								}
							}
						});
					}
				}
			});
		}
	});

	window.reloadAgentTable = function () {
		dataTable.ajax.reload(null, false);
	};

	$(document).on('change', '.btn-toggle-agent-telegram', function () {
		if (permissions === 2) return;

		const $toggle = $(this);
		const agentId = parseInt($toggle.data('agent-id'), 10);
		const enabled = $toggle.prop('checked');

		if (!Number.isFinite(agentId) || agentId <= 0) return;

		$toggle.prop('disabled', true);
		$.ajax({
			url: '/agent/' + agentId + '/telegram-enabled',
			type: 'PUT',
			contentType: 'application/json',
			data: JSON.stringify({ enabled: enabled }),
			success: function () {
				showAgentTelegramToggleSwal(enabled);
				window.reloadAgentTable();
			},
			error: function () {
				$toggle.prop('checked', !enabled);
				const tr = window.translations?.agent || {};
				Swal.fire({
					title: tr.error_title || 'Error',
					text: tr.failed_to_update || 'Failed to save.',
					icon: 'error',
					confirmButtonText: tr.ok || 'OK'
				});
			},
			complete: function () {
				$toggle.prop('disabled', false);
			}
		});
	});

	$('#add_new_agent').on('submit', function(event) {
		event.preventDefault(); // Prevent default form submission
	
		var formData = new FormData(this); // FormData for file upload
		var $btn = $('#submit-new-agent-btn'); // Reference to the button
		var savedAgencyLine = Number(formData.get('txtAgencyLine') || $('#txtAgencyLine').val() || 0);

		var photoPrep = prepareGuestPhotoFormData(formData);
		if (!photoPrep.ok) {
			showGuestFormError(photoPrep.message);
			return;
		}
	
		// Show spinner loading
		$btn.prop('disabled', true).html(`
			<span class="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span>
			Loading...
		`);
	
		$.ajax({
			url: '/add_agent',
			type: 'POST',
			data: formData,
			processData: false,
			contentType: false,
			dataType: 'json',
			headers: { Accept: 'application/json' },
			success: function(response) {
				// Prevent auto-reopening Records/ledger modal after a successful save.
				window.__suppressLedgerReopen = true;

				// Close New Guest modal explicitly (we removed data-bs-dismiss).
				var m = document.getElementById('modal-new-agent');
				var Modal = typeof bootstrap !== 'undefined' ? bootstrap.Modal : (typeof Bootstrap !== 'undefined' ? Bootstrap.Modal : null);
				if (m) {
					if (Modal) {
						var inst = Modal.getInstance(m) || Modal.getOrCreateInstance(m);
						inst.hide();
					} else {
						$(m).modal('hide');
					}
				}

				// Refresh table (stay on same screen).
				if (typeof window.reloadAgentTable === 'function') window.reloadAgentTable();
				var newAgentId = response && response.agent_id ? parseInt(response.agent_id, 10) : null;
				var agentCode = formData.get('txtAgenctCode') || (response && response.agent_code) || '';
				var agentName = formData.get('txtName') || (response && response.agent_name) || '';
				$(document).trigger('guest:created', [{
					agencyId: savedAgencyLine,
					agentId: newAgentId,
					agentCode: agentCode,
					agentName: agentName
				}]);

				if (typeof Swal !== 'undefined') {
					Swal.fire({
						title: 'Success!',
						text: (response && response.message) ? response.message : 'Saved successfully.',
						icon: 'success',
						confirmButtonText: 'OK'
					});
				}
			},
			error: function(xhr) {
				console.error('Error:', xhr.responseJSON ? xhr.responseJSON.error : 'Unknown error occurred');
				Swal.fire({
					title: 'Error!',
					text: xhr.responseJSON ? xhr.responseJSON.error : 'Unknown error',
					icon: 'error',
					confirmButtonText: 'OK'
				});
			},
			complete: function() {
				// Reset button on complete
				$btn.prop('disabled', false).html('Save');
			}
		});
	});
	
	
	$('#edit_agent').submit(function (event) {
		event.preventDefault();
	
		var $btn = $('#submit-edit-agent-btn'); // button reference
		var formData = new FormData(this);

		var photoPrep = prepareGuestPhotoFormData(formData);
		if (!photoPrep.ok) {
			showGuestFormError(photoPrep.message);
			return;
		}
	
		// Show spinner while processing
		$btn.prop('disabled', true).html(`
			<span class="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span>
			Loading...
		`);
	
		$.ajax({
			url: '/agent/' + agent_id,
			type: 'PUT',
			data: formData,
			processData: false,
			contentType: false,
			success: function (response) {
				Swal.fire({
					title: 'Updated Successfully!',
					text: 'The agent details have been updated.',
					icon: 'success',
					confirmButtonText: 'OK'
				}).then((result) => {
					if (result.isConfirmed) {
						const isAgencyPage = window.location.pathname === '/agency' || $('#agent-list').length > 0;

						if (isAgencyPage) {
							$('#modal-edit-agent').modal('hide');
							if (typeof window.refreshSelectedAgencyPanels === 'function') {
								window.refreshSelectedAgencyPanels();
							}
							return;
						}

						window.location.href = '/agent';
					}
				});
			},
			error: function (error) {
				console.error('Error updating agent:', error);
				Swal.fire({
					title: 'Error!',
					text: 'There was an error updating the agent.',
					icon: 'error',
					confirmButtonText: 'OK'
				});
			},
			complete: function () {
				// Reset the button text after submission
				$btn.prop('disabled', false).html('Save');
			}
		});
	});
	
	// Function when clicking 'Add Guest'
	function addAgent() {
		window.__returnToLedgerOnClose = true;
		$('#modal-account-ledger').modal('hide');
		$('#modal-new-agent').modal('show');
	}

	// Make globally accessible if needed
	window.addAgent = addAgent;

	$('#modal-new-agent').on('show.bs.modal', function () {
		// Reopen Records only when New Guest was launched from Records modal.
		window.__returnToLedgerOnClose = $('#modal-account-ledger').hasClass('show');
	});

	// Clear New Guest form whenever the modal closes (Close, X, or after save).
	$('#modal-new-agent').on('hidden.bs.modal', function () {
		resetNewGuestFormAfterCreate();
		if (window.__suppressLedgerReopen) {
			window.__suppressLedgerReopen = false;
			window.__returnToLedgerOnClose = false;
			return;
		}
		if (window.__returnToLedgerOnClose) {
			$('#modal-account-ledger').modal('show');
		}
		window.__returnToLedgerOnClose = false;
	});

		// Auto re-open ledger modal when closing new-agent modal
		$('#modal-edit-agent').on('hidden.bs.modal', function () {
			if (window.__suppressLedgerReopen) {
				window.__suppressLedgerReopen = false;
				return;
			}
			if (window.__returnToLedgerOnEditClose) {
				$('#modal-account-ledger').modal('show');
			}
			window.__returnToLedgerOnEditClose = false;
		});

	// Auto-extract passport data when choosing file (New Guest / Edit Guest)
	$(document).on('change', '.js-passport-file', function () {
		var file = this.files && this.files[0];
		var inNewGuest = !!this.closest && this.closest('#modal-new-agent');

		if (!file) {
			if (inNewGuest) hideNewGuestPassportPreview();
			return;
		}

		window.__pendingPassportFile = file;
		window.__pendingPassportExtract = null;
		window.__pendingPassportImageDataUrl = null;
		window.__pendingFaceFile = null;
		window.__pendingFacePreviewDataUrl = null;

		if (inNewGuest) {
			runPassportScanForNewGuest(file, { showBusy: true }).catch(function (err) {
				window.__pendingPassportExtract = null;
				window.__pendingPassportImageDataUrl = null;
				window.__pendingFaceFile = null;
				window.__pendingFacePreviewDataUrl = null;
				hideNewGuestPassportPreview();
				if (typeof Swal !== 'undefined') {
					Swal.fire({ icon: 'error', title: 'Passport scan failed', text: (err && err.message) ? err.message : 'Failed to scan passport.' });
				} else {
					alert((err && err.message) ? err.message : 'Failed to scan passport.');
				}
			});
			return;
		}

		window.__passportScanInProgress = true;
		setGuestSubmitButtonsDisabled(true);

		if (typeof Swal !== 'undefined') {
			Swal.fire({
				title: 'Scanning passport…',
				text: 'Please wait while we read the passport details.',
				allowOutsideClick: false,
				allowEscapeKey: false,
				didOpen: function () { Swal.showLoading(); }
			});
		}

		extractPassportFromFile(file)
			.then(function (r) {
				var extract = r.extract;
				if (!extract || extract.is_passport === false) {
					throw new Error('This does not appear to be a passport. Please upload a valid passport image.');
				}
				window.__pendingPassportExtract = extract;
				window.__pendingPassportImageDataUrl = r.dataUrl;
				applyPassportExtractToGuestForm(extract);

				return cropFaceFromDataUrl(r.dataUrl).then(function (face) {
					window.__pendingFaceFile = face.file;
					window.__pendingFacePreviewDataUrl = face.previewDataUrl || null;
					if (typeof Swal !== 'undefined') Swal.close();
				});
			})
			.catch(function (err) {
				window.__pendingPassportExtract = null;
				window.__pendingPassportImageDataUrl = null;
				window.__pendingFaceFile = null;
				window.__pendingFacePreviewDataUrl = null;
				if (typeof Swal !== 'undefined') {
					Swal.fire({ icon: 'error', title: 'Passport scan failed', text: (err && err.message) ? err.message : 'Failed to scan passport.' });
				} else {
					alert((err && err.message) ? err.message : 'Failed to scan passport.');
				}
			})
			.finally(function () {
				window.__passportScanInProgress = false;
				setGuestSubmitButtonsDisabled(false);
			});
	});

	$(document).on('click', '#btn-new-guest-reextract', function () {
		var file = window.__pendingPassportFile;
		if (!file) {
			if (typeof Swal !== 'undefined') {
				Swal.fire({ icon: 'warning', title: 'No passport image', text: 'Choose a passport image first.' });
			}
			return;
		}
		var $btn = $(this);
		$btn.prop('disabled', true);
		runPassportScanForNewGuest(file, { showBusy: true })
			.catch(function (err) {
				if (typeof Swal !== 'undefined') {
					Swal.fire({ icon: 'error', title: 'Re-extract failed', text: (err && err.message) ? err.message : 'Failed to re-extract passport.' });
				}
			})
			.finally(function () {
				$btn.prop('disabled', false);
			});
	});

	$(document).on('click', '#btn-new-guest-change-passport', function () {
		resetNewGuestPassportUpload();
	});


});



function edit_agent(id, agent_code, agentName, contact, telegram, remarks) {
	window.__returnToLedgerOnEditClose = $('#modal-account-ledger').hasClass('show');
	$('#modal-edit-agent').modal('show');
	$('#modal-account-ledger').modal('hide');
	$('#txtAgent_code').val(agent_code);
	$('#agentName').val(agentName);
	$('#contact').val(contact);
	$('#telegram').val(telegram);
	$('#remarks').val(remarks);

	agent_id = id;

	// Remove this part:
	// edit_get_agency(agency_id);

	// Keep input sanitization
	const contactInput = document.querySelector('#contact');
	const telegramInput = document.querySelector('#telegram');

	contactInput.addEventListener('input', function () {
		this.value = this.value.replace(/\D/g, '');
	});
	telegramInput.addEventListener('input', function () {
		this.value = this.value.replace(/\D/g, '');
	});
}


function checkPermissionToDeleteAgent(id) {
	const permissions = parseInt($('#user-role').data('permissions'), 10);
	if (permissions === 0) {
		archive_agent(id);
	} else {
		Swal.fire({
			title: 'Access Denied',
			text: 'Not allowed to delete this data.',
			icon: 'error',
			confirmButtonText: 'OK',
			confirmButtonColor: '#6f9c40'
		});
	}
}


function archive_agent(id) {
	Swal.fire({
		title: 'Are you sure you want to delete this?',
		icon: 'warning',
		showCancelButton: true,
		confirmButtonColor: '#3085d6',
		cancelButtonColor: '#d33',
		confirmButtonText: 'Yes'
	}).then((result) => {
		if (result.isConfirmed) {
			$.ajax({
				url: '/agent/remove/' + id,
				type: 'PUT',
				success: function (response) {
					window.location.reload();
				},
				error: function (xhr) {
					const message = xhr.status === 403
						? 'Only Super Admin can delete agents.'
						: 'Something went wrong while archiving.';
					Swal.fire({
						title: 'Error',
						text: message,
						icon: 'error',
						confirmButtonText: 'OK'
					});
					console.error('Error deleting agent:', xhr.responseText);
				}
			});
		}
	})
}

function get_agency() {
	$.ajax({
		url: '/agency_data',
		method: 'GET',
		success: function (response) {
			var selectOptions = $('#agency');
			selectOptions.empty();
			response.forEach(function (option) {
				var selected = false;
				if (option.IDNo == 1) {
					selected = true;
				}
				selectOptions.append($('<option></option>'));
				selectOptions.append($('<option>', {
					selected: selected,
					value: option.IDNo,
					text: option.AGENCY
				}));
			});
		},
		error: function (xhr, status, error) {
			console.error('Error fetching options:', error);
		}
	});
}

