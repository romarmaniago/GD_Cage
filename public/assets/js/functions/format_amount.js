/**
 * Shared amount formatting — comma separators and accounting negative (x,xxx) in red.
 */
(function (window) {
    function toNumber(value) {
        if (value == null || value === '') return 0;
        if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
        const cleaned = String(value)
            .replace(/,/g, '')
            .replace(/[()]/g, '')
            .replace(/[^\d.\-]/g, '')
            .trim();
        if (!cleaned || cleaned === '-' || cleaned === '.') return 0;
        const n = parseFloat(cleaned);
        return Number.isFinite(n) ? n : 0;
    }

    function formatCommas(value, options) {
        const n = Math.abs(toNumber(value));
        const opts = options || {};
        const min = opts.minimumFractionDigits != null ? opts.minimumFractionDigits : 0;
        const max = opts.maximumFractionDigits != null ? opts.maximumFractionDigits : 0;
        return n.toLocaleString('en-US', { minimumFractionDigits: min, maximumFractionDigits: max });
    }

    function formatAmountNegativePlain(value, options) {
        const formatted = formatCommas(value, options);
        return formatted === '0' ? '0' : '(' + formatted + ')';
    }

    function formatAmountNegativeHtml(value, className, options) {
        const formatted = formatCommas(value, options);
        if (formatted === '0') return '0';
        const cls = className ? ' class="' + className + '"' : '';
        return '<span' + cls + ' style="color:#dc3545 !important;">(' + formatted + ')</span>';
    }

    function formatAmountPositiveHtml(value, className, options) {
        const formatted = formatCommas(value, options);
        const cls = className || 'text-success';
        return '<span class="' + cls + '">+' + formatted + '</span>';
    }

    function formatSignedAmount(value, options) {
        options = options || {};
        const n = toNumber(value);
        if (n < 0) {
            if (options.html) return formatAmountNegativeHtml(Math.abs(n), options.negativeClass, options);
            return formatAmountNegativePlain(Math.abs(n), options);
        }
        if (n > 0 && options.showPositiveSign) {
            if (options.html) return formatAmountPositiveHtml(n, options.positiveClass, options);
            return '+' + formatCommas(n, options);
        }
        return formatCommas(n, options);
    }

    function formatDirectionalAmount(value, direction, options) {
        options = options || {};
        const n = Math.abs(toNumber(value));
        if (direction === 'out') {
            if (options.html) return formatAmountNegativeHtml(n, options.negativeClass, options);
            return formatAmountNegativePlain(n, options);
        }
        if (direction === 'in' && options.showPositiveSign) {
            if (options.html) return formatAmountPositiveHtml(n, options.positiveClass, options);
            return '+' + formatCommas(n, options);
        }
        return formatCommas(n, options);
    }

    const AmountFormat = {
        toNumber: toNumber,
        formatCommas: formatCommas,
        formatAmountNegativePlain: formatAmountNegativePlain,
        formatAmountNegativeHtml: formatAmountNegativeHtml,
        formatAmountPositiveHtml: formatAmountPositiveHtml,
        formatSignedAmount: formatSignedAmount,
        formatDirectionalAmount: formatDirectionalAmount
    };

    window.AmountFormat = AmountFormat;
    /** Comma-separated amount (en-US). Use for all displayed amounts. */
    window.fmtAmt = function (value, options) { return formatCommas(value, options); };
    window.commaAmount = window.fmtAmt;
    window.formatWithCommas = window.fmtAmt;
    window.fmtOut = function (value, options) { return formatDirectionalAmount(value, 'out', Object.assign({ html: true }, options || {})); };
    // Positive: plain text (no + / green). Pass showPositiveSign: true to opt into legacy + style.
    window.fmtIn = function (value, options) { return formatDirectionalAmount(value, 'in', Object.assign({ html: true }, options || {})); };
    window.fmtSigned = function (value, options) { return formatSignedAmount(value, Object.assign({ html: true }, options || {})); };

    /**
     * Service / Add Charge / signed list amount.
     * Positive: plain text. Negative: accounting (x,xxx) in red.
     * Legacy positive JUNKET rows are treated as outflow.
     */
    window.formatServiceChargeAmount = function (value, sourceType, options) {
        options = options || {};
        var n = toNumber(value);
        if (n > 0 && String(sourceType || '').toUpperCase() === 'JUNKET') {
            n = -n;
        }
        var abs = Math.abs(n);
        var hasDecimals = abs % 1 !== 0;
        var formatted = abs.toLocaleString('en-US', {
            minimumFractionDigits: hasDecimals ? 2 : (options.minimumFractionDigits || 0),
            maximumFractionDigits: hasDecimals ? 2 : (options.maximumFractionDigits || 0)
        });
        if (n > 0) {
            if (options.showPositiveSign) {
                return '<span class="' + (options.positiveClass || 'text-success') + '">+' + formatted + '</span>';
            }
            return formatted;
        }
        if (n < 0) {
            return '<span class="' + (options.negativeClass || 'text-danger') + '" style="color:#dc3545 !important;">(' + formatted + ')</span>';
        }
        return formatted;
    };
})(window);
