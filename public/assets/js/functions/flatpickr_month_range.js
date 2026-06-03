(function (global) {
    function flatpickrToDate(instance, value) {
        if (!value) return null;
        if (value instanceof Date && !isNaN(value.getTime())) {
            return new Date(value.getTime());
        }
        if (typeof instance.parseDate === 'function') {
            var parsed = instance.parseDate(value, instance.config.dateFormat);
            if (parsed instanceof Date && !isNaN(parsed.getTime())) {
                return parsed;
            }
        }
        var fallback = new Date(value);
        return isNaN(fallback.getTime()) ? null : fallback;
    }

    function clampDateRangeToFlatpickrLimits(instance, start, end) {
        var s = new Date(start.getFullYear(), start.getMonth(), start.getDate());
        var e = new Date(end.getFullYear(), end.getMonth(), end.getDate());
        var minD = flatpickrToDate(instance, instance.config.minDate);
        var maxD = flatpickrToDate(instance, instance.config.maxDate);
        if (minD) {
            minD = new Date(minD.getFullYear(), minD.getMonth(), minD.getDate());
            if (s < minD) s = minD;
        }
        if (maxD) {
            maxD = new Date(maxD.getFullYear(), maxD.getMonth(), maxD.getDate());
            if (e > maxD) e = maxD;
        }
        if (s > e) return null;
        return [s, e];
    }

    function selectEntireFlatpickrMonth(instance, panelIndex) {
        if (!instance || panelIndex < 0) return;
        var anchor = new Date(instance.currentYear, instance.currentMonth + panelIndex, 1);
        var monthStart = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
        var monthEnd = new Date(anchor.getFullYear(), anchor.getMonth() + 1, 0);
        var clamped = clampDateRangeToFlatpickrLimits(instance, monthStart, monthEnd);
        if (!clamped) return;
        instance.setDate(clamped, true);
    }

    function bindFlatpickrMonthNameRangeSelect(instance) {
        if (!instance || !instance.calendarContainer) return;
        var container = instance.calendarContainer;
        if (container.dataset.monthRangeSelectBound === '1') return;
        container.dataset.monthRangeSelectBound = '1';
        container.addEventListener('click', function (e) {
            var target = e.target;
            if (!target || !target.classList || !target.classList.contains('cur-month')) return;
            e.preventDefault();
            e.stopPropagation();
            var monthEl = target.closest('.flatpickr-month');
            if (!monthEl) return;
            var panels = container.querySelectorAll('.flatpickr-month');
            var panelIndex = Array.prototype.indexOf.call(panels, monthEl);
            selectEntireFlatpickrMonth(instance, panelIndex);
        });
    }

    function styleFlatpickrMonthNameClickable(instance) {
        if (!instance || !instance.calendarContainer) return;
        instance.calendarContainer.querySelectorAll('.cur-month').forEach(function (el) {
            el.style.cursor = 'pointer';
            if (!el.getAttribute('title')) {
                el.setAttribute('title', 'Select entire month');
            }
        });
    }

    function setupFlatpickrMonthNameRangeSelect(instance) {
        bindFlatpickrMonthNameRangeSelect(instance);
        styleFlatpickrMonthNameClickable(instance);
    }

    global.setupFlatpickrMonthNameRangeSelect = setupFlatpickrMonthNameRangeSelect;
    global.styleFlatpickrMonthNameClickable = styleFlatpickrMonthNameClickable;
})(typeof window !== 'undefined' ? window : this);
