/**
 * Shared SweetAlert2 confirmation dialog with two-column CSS Grid layout.
 * Labels right-align. Text values left-align from the value column start. Amounts
 * right-align inside a shared fixed-width box so trailing digits and commas line up evenly.
 */
(function (window) {
    'use strict';

    var COL_WIDTH = '180px';
    var VALUE_PAD = 'white-space:nowrap;padding:2px 0;overflow:visible;';
    var GRID_STYLE = 'display:inline-grid;grid-template-columns:' + COL_WIDTH + ' ' + COL_WIDTH +
        ';column-gap:12px;row-gap:4px;justify-content:center;justify-items:stretch;align-items:baseline;';
    var LABEL_STYLE = 'font-weight:600;text-align:right;' + VALUE_PAD;
    var VALUE_TEXT_STYLE = 'text-align:left;' + VALUE_PAD;
    var VALUE_AMOUNT_BASE = 'display:inline-block;text-align:right;font-variant-numeric:tabular-nums;' + VALUE_PAD;
    var SEPARATOR_WIDTH_CH = 0.45;

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

    function plainValueText(value) {
        return String(value == null ? '' : value).replace(/<[^>]*>/g, '').trim();
    }

    function displayValue(value) {
        return value == null || value === '' ? '-' : value;
    }

    function isNumericValue(value) {
        if (value == null || value === '') return false;
        var plain = plainValueText(value);
        if (plain.endsWith('%')) return false;
        if (/^NN:\s*[\d,]+/i.test(plain)) return false;
        return /^[₱\s]*[\d,]+(\.\d+)?$/.test(plain);
    }

    function isAmountValue(value, align) {
        if (align === 'left') return false;
        return align === 'right' || isNumericValue(value);
    }

    function amountWidthCh(value) {
        var plain = plainValueText(value);
        var digits = plain.replace(/\D/g, '').length;
        return digits + ((plain.length - digits) * SEPARATOR_WIDTH_CH);
    }

    function getMaxAmountWidthCh(rows) {
        var maxWidth = 0;
        rows.forEach(function (row) {
            if (isSpacerRow(row)) return;
            var value = displayValue(row[1]);
            if (!isAmountValue(value, row[2])) return;
            var width = amountWidthCh(value);
            if (width > maxWidth) maxWidth = width;
        });
        return maxWidth;
    }

    function buildValueStyle(value, align, maxAmountWidthCh) {
        if (!isAmountValue(value, align)) return VALUE_TEXT_STYLE;
        return VALUE_AMOUNT_BASE + 'width:' + maxAmountWidthCh.toFixed(2) + 'ch;';
    }

    function isSpacerRow(row) {
        return row === null || row === 'spacer';
    }

    function buildSpacerRow() {
        return '<span style="grid-column:1 / -1;height:10px;line-height:0;font-size:0;">&nbsp;</span>';
    }

    function buildRow(label, value, align, maxAmountWidthCh) {
        var shown = displayValue(value);
        return '<span style="' + LABEL_STYLE + '">' + safeHtml(formatLabel(label)) + '</span>' +
            '<span style="' + buildValueStyle(shown, align, maxAmountWidthCh) + '">' + safeHtml(shown) + '</span>';
    }

    function buildTableHtml(rows, options) {
        options = options || {};
        if (!rows || !rows.length) return '';
        var maxAmountWidthCh = getMaxAmountWidthCh(rows);
        var body = rows.map(function (row) {
            if (isSpacerRow(row)) return buildSpacerRow();
            return buildRow(row[0], row[1], row[2], maxAmountWidthCh);
        }).join('');
        var subtitle = options.subtitle
            ? '<div style="font-weight:600;margin-bottom:8px;text-align:center;">' + safeHtml(options.subtitle) + '</div>'
            : '';
        return '<div style="margin:0 auto;">' + subtitle +
            '<div style="' + GRID_STYLE + '">' + body + '</div></div>';
    }

    function applyModalStack(options) {
        options = options || {};
        var focusTrapHandler = function (e) {
            if (e.target && e.target.closest && e.target.closest('.swal2-container')) {
                e.stopImmediatePropagation();
            }
        };
        var userDidOpen = options.didOpen;
        var userWillClose = options.willClose;
        var merged = Object.assign({}, options, {
            heightAuto: options.heightAuto != null ? options.heightAuto : false,
            didOpen: function () {
                window.addEventListener('focusin', focusTrapHandler, true);
                document.querySelectorAll('.swal2-container').forEach(function (el) {
                    el.style.zIndex = '1080';
                });
                if (typeof userDidOpen === 'function') {
                    userDidOpen.apply(this, arguments);
                }
            },
            willClose: function () {
                window.removeEventListener('focusin', focusTrapHandler, true);
                if (typeof userWillClose === 'function') {
                    userWillClose.apply(this, arguments);
                }
            }
        });
        return merged;
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

        var swalOptions = {
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
        };

        if (options.showDenyButton) {
            swalOptions.showDenyButton = true;
            swalOptions.denyButtonText = options.denyButtonText || 'No';
            if (options.denyButtonColor) swalOptions.denyButtonColor = options.denyButtonColor;
        }
        if (options.heightAuto != null) swalOptions.heightAuto = options.heightAuto;
        if (options.didOpen) swalOptions.didOpen = options.didOpen;
        if (options.willClose) swalOptions.willClose = options.willClose;

        if (options.modalStack) {
            swalOptions = applyModalStack(swalOptions);
        }

        return Swal.fire(swalOptions);
    }

    window.SwalConfirm = {
        fire: fire,
        buildTableHtml: buildTableHtml,
        applyModalStack: applyModalStack
    };
})(window);
