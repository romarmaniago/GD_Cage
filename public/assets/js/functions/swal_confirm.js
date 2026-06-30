/**
 * Shared SweetAlert2 confirmation dialog with aligned label/value rows.
 * Labels right-align to the colon; text values left-align; amounts right-align to column end.
 */
(function (window) {
    'use strict';

    var LABEL_STYLE = 'padding:4px 12px 4px 0;font-weight:600;text-align:right;white-space:nowrap;vertical-align:top;';
    var VALUE_LEFT_STYLE = 'padding:4px 0 4px 8px;text-align:left;vertical-align:top;white-space:nowrap;';
    var VALUE_RIGHT_STYLE = 'padding:4px 0 4px 8px;text-align:right;vertical-align:top;white-space:nowrap;font-variant-numeric:tabular-nums;';

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

    function isNumericValue(value) {
        if (value == null || value === '') return false;
        var plain = String(value).replace(/<[^>]*>/g, '').trim();
        if (plain.endsWith('%')) return false;
        return /^[₱\s]*[\d,]+(\.\d+)?$/.test(plain);
    }

    function resolveValueAlign(value, align) {
        if (align === 'right' || align === 'left') return align;
        return isNumericValue(value) ? 'right' : 'left';
    }

    function buildRow(label, value, align) {
        var labelRaw = containsHtml(label);
        var valueRaw = containsHtml(value);
        var labelText = labelRaw ? String(formatLabel(label)) : escapeHtml(formatLabel(label));
        var displayValue = value == null || value === '' ? '-' : value;
        var valueContent = valueRaw ? String(displayValue) : escapeHtml(displayValue);
        var valueStyle = resolveValueAlign(displayValue, align) === 'right' ? VALUE_RIGHT_STYLE : VALUE_LEFT_STYLE;
        return '<tr><td style="' + LABEL_STYLE + '">' + labelText + '</td><td style="' + valueStyle + '">' + valueContent + '</td></tr>';
    }

    function buildTableHtml(rows, options) {
        options = options || {};
        if (!rows || !rows.length) return '';
        var body = rows.map(function (row) {
            return buildRow(row[0], row[1], row[2]);
        }).join('');
        var subtitle = options.subtitle
            ? '<div style="font-weight:600;margin-bottom:8px;text-align:center;">' + (containsHtml(options.subtitle) ? options.subtitle : escapeHtml(options.subtitle)) + '</div>'
            : '';
        return '<div style="max-width:420px;margin:0 auto;">' + subtitle +
            '<table style="margin:0 auto;border-collapse:collapse;">' + body + '</table></div>';
    }

    function fire(options) {
        options = options || {};
        if (!window.Swal) return Promise.resolve({ isConfirmed: false });

        var html = '';
        if (options.rows && options.rows.length) {
            html += buildTableHtml(options.rows, { subtitle: options.subtitle });
        }
        if (options.html) {
            html += options.html;
        }
        if (options.message) {
            html += '<div style="margin-top:12px;text-align:center;">' +
                (containsHtml(options.message) ? options.message : escapeHtml(options.message)) +
                '</div>';
        }

        var hasRows = options.rows && options.rows.length;
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
