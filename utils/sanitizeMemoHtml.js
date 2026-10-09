/**
 * Agent Portal MEMO: keep only plain formatting and text colors from the editor's HTML.
 * Everything else (scripts, links, images, event attributes, other styles) is dropped;
 * stray "<" / ">" in text are escaped.
 */

const ALLOWED_TAGS = new Set(['b', 'strong', 'i', 'em', 'u', 'br', 'div', 'p', 'span', 'font']);
const MAX_LENGTH = 50000;

function safeColor(value) {
	const v = String(value || '').trim();
	if (/^#[0-9a-f]{3,8}$/i.test(v)) return v;
	if (/^rgba?\(\s*[\d.\s,%]+\)$/i.test(v)) return v;
	if (/^[a-z]{3,20}$/i.test(v)) return v;
	return '';
}

function colorFromAttrs(tag, attrs) {
	const styleMatch = /style\s*=\s*("([^"]*)"|'([^']*)')/i.exec(attrs);
	if (styleMatch) {
		const style = styleMatch[2] != null ? styleMatch[2] : styleMatch[3];
		const colorMatch = /(?:^|;)\s*color\s*:\s*([^;]+)/i.exec(style);
		if (colorMatch) return safeColor(colorMatch[1]);
	}
	if (tag === 'font') {
		const fontMatch = /color\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(attrs);
		if (fontMatch) return safeColor(fontMatch[2] || fontMatch[3] || fontMatch[4]);
	}
	return '';
}

function escapeText(text) {
	return text.replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function sanitizeMemoHtml(input) {
	const html = String(input || '').replace(/<!--[\s\S]*?-->/g, '').slice(0, MAX_LENGTH);
	return html
		.split(/(<[^<>]*>)/)
		.map((part) => {
			const tagMatch = /^<\s*(\/)?\s*([a-z0-9]+)([^>]*)>$/i.exec(part);
			if (!tagMatch) return part.startsWith('<') && part.endsWith('>') ? '' : escapeText(part);
			const closing = !!tagMatch[1];
			const tag = tagMatch[2].toLowerCase();
			if (!ALLOWED_TAGS.has(tag)) return '';
			// <font color> becomes a <span>, so the matching </font> must too.
			const outTag = tag === 'font' ? 'span' : tag;
			if (closing) return tag === 'br' ? '' : `</${outTag}>`;
			if (tag === 'br') return '<br>';
			const color = tag === 'span' || tag === 'font' || tag === 'div' || tag === 'p' ? colorFromAttrs(tag, tagMatch[3]) : '';
			return color ? `<${outTag} style="color: ${color}">` : `<${outTag}>`;
		})
		.join('');
}

module.exports = { sanitizeMemoHtml };
