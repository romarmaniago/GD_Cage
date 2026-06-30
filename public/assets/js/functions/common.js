$(document).ready(function () {
    // Initialize Flatpickr (month-end cut-off defaults via month_end_cutoff_range.js)
    flatpickr("#daterange", {
        mode: "range",
        showMonths: 2,
    });

    // Function to parse date range
    window.getDateRange = function () {
        const dateRange = $('#daterange').val();
        if (!dateRange) return null;
        if (window.MonthEndCutoffRange) {
            return window.MonthEndCutoffRange.parseRangeToApiDates(dateRange);
        }
        const [start, end] = dateRange.split(' to ');
        return { start, end: end || start };
    };
});
