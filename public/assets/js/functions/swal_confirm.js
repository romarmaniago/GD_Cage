/**
 * Shared SweetAlert2 confirmation dialog with aligned label/value rows.
 * Labels right-align; text values left-align; amounts right-align to column end.
 */
(function (window) {
    'use strict';

    var GRID_STYLE = 'display:inline-grid;grid-template-columns:auto auto;column-gap:12px;row-gap:4px;justify-content:center;width:100%;';
    var LABEL_STYLE = 'font-weight:600;text-align:right;white-space:nowrap;padding:2px 0;';
    var VALUE_BASE = 'white-space:nowrap;padding:2px 0;';
    var VALUE_LEFT_STYLE = VALUE_BASE + 'text-align:left;';
    var VALUE_RIGHT_STYLE = VALUE_BASE + 'text-align:right;font-variant-numeric:tabular-nums;';

    function escapeHtml(s) {
        if (s == null) return '';
        return String(s)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    function formatLabel(label) {
        var s = String(label == null ? '' : label).trim();
        if (!s) return '';
        return s.endsWith(':') ? s : s + ':';
    }

    function containsHtml(s) {
        return /<[a-z][\s\S]*>/i.test(String(s || ''));
    }

    function safeHtml(value) {
        return containsHtml(value) ? String(value) : escapeHtml(value);
    }

    function isNumericValue(value) {
        if (value == null || value === '') return false;
        var plain = String(value).replace(/<[^>]*>/g, '').trim();
        if (plain.endsWith('%')) return false;
        if (/^NN:\s*[\d,]+(?:\.\d+)?(?:\s*,\s*CC:\s*[\d,]+(?:\.\d+)?)?$/i.test(plain)) return true;
        return /^[₱\s]*[\d,]+(\.\d+)?$/.test(plain);
    }

    function resolveValueAlign(value, align) {
        if (align === 'right' || align === 'left') return align;
        return isNumericValue(value) ? 'right' : 'left';
    }

    function buildSpacerRow() {
        return '<span style="grid-column:1 / -1;height:10px;line-height:0;font-size:0;">&nbsp;</span>';
    }

    function isSpacerRow(row) {
        return row === null || row === 'spacer' || (Array.isArray(row) && row[0] === '__spacer__');
    }

    function buildRow(label, value, align) {
        var displayValue = value == null || value === '' ? '-' : value;
        var valueStyle = resolveValueAlign(displayValue, align) === 'right' ? VALUE_RIGHT_STYLE : VALUE_LEFT_STYLE;
        return '<span style="' + LABEL_STYLE + '">' + safeHtml(formatLabel(label)) + '</span>' +
            '<span style="' + valueStyle + '">' + safeHtml(displayValue) + '</span>';
    }

    function buildTableHtml(rows, options) {
        options = options || {};
        if (!rows || !rows.length) return '';
        var body = rows.map(function (row) {
            if (isSpacerRow(row)) return buildSpacerRow();
            return buildRow(row[0], row[1], row[2]);
        }).join('');
        var subtitle = options.subtitle
            ? '<div style="font-weight:600;margin-bottom:8px;text-align:center;">' + safeHtml(options.subtitle) + '</div>'
            : '';
        return '<div style="max-width:420px;margin:0 auto;">' + subtitle +
            '<div style="' + GRID_STYLE + '">' + body + '</div></div>';
    }

    function fire(options) {
        options = options || {};
        if (!window.Swal) return Promise.resolve({ isConfirmed: false });

        var hasRows = !!(options.rows && options.rows.length);
        var html = hasRows ? buildTableHtml(options.rows, { subtitle: options.subtitle }) : '';
        if (options.html) html += options.html;
        if (options.message) {
            html += '<div style="margin-top:12px;text-align:center;">' + safeHtml(options.message) + '</div>';
        }

        return Swal.fire({
            icon: options.icon != null ? options.icon : 'question',
            title: options.title || '',
            html: html || undefined,
            text: !html ? (options.text || options.message || '') : undefined,
            showCancelButton: options.showCancelButton !== false,
            confirmButtonText: options.confirmButtonText || 'Yes, Confirm',
            cancelButtonText: options.cancelButtonText || 'Cancel',
            confirmButtonColor: options.confirmButtonColor || '#3085d6',
            cancelButtonColor: options.cancelButtonColor || '#d33',
            allowOutsideClick: options.allowOutsideClick === true,
            allowEscapeKey: options.allowEscapeKey === true,
            width: options.width || (hasRows ? '500px' : undefined),
            reverseButtons: !!options.reverseButtons
        });
    }

    window.SwalConfirm = {
        fire: fire,
        buildTableHtml: buildTableHtml
    };
})(window);
