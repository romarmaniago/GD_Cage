/**
 * Shared date/time display formatting — YYYY-MM-DD HH:mm (24-hour).
 */
(function (window) {
    var DATETIME_DISPLAY_FORMAT = 'YYYY-MM-DD HH:mm';
    var DATE_DISPLAY_FORMAT = 'YYYY-MM-DD';
    var DATETIME_SORT_FORMAT = 'YYYY-MM-DD HH:mm:ss';
    var DEFAULT_UTC_OFFSET = 8;

    function parseMoment(value) {
        if (value == null || value === '') return null;
        if (typeof moment !== 'undefined' && moment.isMoment(value) && value.isValid()) {
            return value.clone();
        }
        if (typeof moment === 'undefined') return null;
        var m = moment(value);
        return m.isValid() ? m : null;
    }

    function formatDateTime(value, options) {
        options = options || {};
        var fallback = options.fallback != null ? options.fallback : '';
        if (value == null || value === '') return fallback;
        if (typeof moment === 'undefined') return String(value);

        var m;
        if (options.utcOffset != null) {
            m = moment.utc(value);
            if (!m.isValid()) m = moment(value);
            if (!m.isValid()) return fallback;
            m = m.utcOffset(options.utcOffset);
        } else if (options.utc) {
            m = moment.utc(value);
        } else {
            m = moment(value);
        }
        if (!m.isValid()) return fallback;

        var fmt = options.dateOnly ? DATE_DISPLAY_FORMAT : DATETIME_DISPLAY_FORMAT;
        return m.format(fmt);
    }

    function formatDateTimeUtc8(value, fallback) {
        return formatDateTime(value, { utcOffset: DEFAULT_UTC_OFFSET, fallback: fallback });
    }

    function formatDateOnly(value, fallback) {
        return formatDateTime(value, { dateOnly: true, fallback: fallback });
    }

    function formatDateTimeSortValue(value) {
        var m = parseMoment(value);
        return m ? m.format(DATETIME_SORT_FORMAT) : '';
    }

    function dataTableDateTimeRender(data, type, options) {
        options = options || {};
        if (type === 'sort' || type === 'type') {
            var m = options.utcOffset != null ? moment.utc(data) : moment(data);
            if (!m.isValid()) return 0;
            if (options.utcOffset != null) m = m.utcOffset(options.utcOffset);
            return m.valueOf();
        }
        if (options.utcOffset != null) {
            return formatDateTimeUtc8(data, '');
        }
        return formatDateTime(data, { fallback: '' });
    }

    var DateTimeFormat = {
        DATETIME_DISPLAY_FORMAT: DATETIME_DISPLAY_FORMAT,
        DATE_DISPLAY_FORMAT: DATE_DISPLAY_FORMAT,
        DATETIME_SORT_FORMAT: DATETIME_SORT_FORMAT,
        formatDateTime: formatDateTime,
        formatDateTimeUtc8: formatDateTimeUtc8,
        formatDateOnly: formatDateOnly,
        formatDateTimeSortValue: formatDateTimeSortValue,
        dataTableDateTimeRender: dataTableDateTimeRender
    };

    window.DATETIME_DISPLAY_FORMAT = DATETIME_DISPLAY_FORMAT;
    window.DATE_DISPLAY_FORMAT = DATE_DISPLAY_FORMAT;
    window.DATETIME_SORT_FORMAT = DATETIME_SORT_FORMAT;
    window.DateTimeFormat = DateTimeFormat;
    window.fmtDt = formatDateTime;
    window.fmtDtUtc8 = formatDateTimeUtc8;
    window.fmtDate = formatDateOnly;
    window.fmtDtSort = formatDateTimeSortValue;
})(window);
