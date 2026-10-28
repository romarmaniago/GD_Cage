$(document).ready(function () {
    function formatNumber(v) {
        return (Number(v) || 0).toLocaleString('en-US', { maximumFractionDigits: 0 });
    }

    function formatRate(v) {
        var n = Number(v) || 0;
        return n.toFixed(8).replace(/\.?0+$/, '') + '%';
    }

    function stripHtml(value) {
        return $('<div>').html(value == null ? '' : String(value)).text().trim();
    }

    function escapeHtml(value) {
        return String(value == null ? '' : value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function signedColorStyle(v) {
        var n = Number(v) || 0;
        if (n > 0) return 'color:#16a34a;font-weight:600;';
        if (n < 0) return 'color:#dc2626;font-weight:600;';
        return '';
    }

    // On-screen amount: a negative shows in red with parentheses, e.g. (143,500).
    // signed: also bold, and positives in green (NGR, Win/Loss total).
    function formatAmountHtml(v, signed) {
        var n = Number(v) || 0;
        if (n < 0) {
            return '<span style="color:#dc2626;' + (signed ? 'font-weight:600;' : '') + '">(' + formatNumber(Math.abs(n)) + ')</span>';
        }
        if (signed && n > 0) return '<span style="' + signedColorStyle(n) + '">' + formatNumber(n) + '</span>';
        return formatNumber(n);
    }

    function parseSortDate(v) {
        var m = moment(v, ['MMMM DD, YYYY HH:mm:ss', moment.ISO_8601], true);
        return m.isValid() ? m.valueOf() : 0;
    }

    function computeGameTotals(records) {
        var totalBuyIn = 0;
        var totalCashOut = 0;
        var totalRollingAmount = 0;
        var initialBuyIn = 0;
        var totalNNInit = 0;
        var totalCCInit = 0;
        var totalNN = 0;
        var totalCC = 0;
        var totalCashOutNN = 0;
        var totalCashOutCC = 0;
        var totalRollingNN = 0;
        var totalRollingCC = 0;
        var totalRollingReal = 0;
        var totalRollingNNReal = 0;
        var totalRollingCCReal = 0;
        var totalRollerReturnCC = 0;

        (records || []).forEach(function (res) {
            if (res.CAGE_TYPE == 1 && (totalNNInit !== 0 || totalCCInit !== 0)) {
                totalBuyIn += Number(res.AMOUNT) || 0;
                totalNN += Number(res.NN_CHIPS) || 0;
                totalCC += Number(res.CC_CHIPS) || 0;
            }
            if (totalNNInit === 0 && totalCCInit === 0 && res.CAGE_TYPE == 1) {
                initialBuyIn = Number(res.AMOUNT) || 0;
                totalNNInit += Number(res.NN_CHIPS) || 0;
                totalCCInit += Number(res.CC_CHIPS) || 0;
            }
            if (res.CAGE_TYPE == 2) {
                totalCashOut += Number(res.AMOUNT) || 0;
                totalCashOutNN += Number(res.NN_CHIPS) || 0;
                totalCashOutCC += Number(res.CC_CHIPS) || 0;
            }
            if (res.CAGE_TYPE == 3) {
                totalRollingAmount += Number(res.AMOUNT) || 0;
                totalRollingNN += Number(res.NN_CHIPS) || 0;
                totalRollingCC += Number(res.CC_CHIPS) || 0;
            }
            if (res.CAGE_TYPE == 4) {
                totalRollingReal += Number(res.AMOUNT) || 0;
                totalRollingNNReal += Number(res.NN_CHIPS) || 0;
                totalRollingCCReal += Number(res.CC_CHIPS) || 0;
            }
            if (res.CAGE_TYPE == 5) {
                var rollerTransaction = parseInt(res.ROLLER_TRANSACTION, 10) || 1;
                if (rollerTransaction === 2) {
                    totalRollerReturnCC += Number(res.ROLLER_CC_CHIPS) || 0;
                }
            }
        });

        var totalInitial = totalNNInit + totalCCInit;
        var totalBuyInChips = totalNN + totalCC;
        var totalCashOutChips = totalCashOutNN + totalCashOutCC;
        var totalRollingChips = totalRollingNN + totalRollerReturnCC + totalRollingAmount + totalRollingReal + totalRollingNNReal + totalRollingCCReal - totalCashOutNN;
        var totalAmount = totalBuyInChips + totalInitial;
        var winLoss = totalAmount - totalCashOutChips;

        return {
            totalAmount: totalAmount,
            chipsReturn: totalCashOutChips,
            winLoss: winLoss,
            totalRolling: totalRollingChips
        };
    }

    function createSettlement(commissionType, rollingRate, totals, game) {
        return window.computeGameCommission({
            COMMISSION_TYPE: commissionType,
            COMMISSION_PERCENTAGE: rollingRate,
            SHARE_PERCENTAGE: game ? game.SHARE_PERCENTAGE : undefined,
            ROLLING_PERCENTAGE: game ? game.ROLLING_PERCENTAGE : undefined
        }, Number(totals.winLoss) || 0, Number(totals.totalRolling) || 0, { absRolling: false });
    }

    function layoutCommissionAnalyticsControls() {
        var $wrapper = $('#commission-panel-tbl_wrapper');
        var $length = $('#commission-panel-tbl_length');
        var $filter = $('#commission-panel-tbl_filter');
        var $table = $('#commission-panel-tbl');
        var $shell;
        var $controls;
        var $filterHighlight;
        var $filterLabel;
        var $searchInput;

        if (!$wrapper.length || !$length.length || !$filter.length || !$table.length) return;

        $shell = $wrapper.children('.commission-analytics-panel-shell');
        if (!$shell.length) {
            $shell = $('<div class="commission-analytics-panel-shell"></div>');
            $wrapper.prepend($shell);
        }

        $controls = $shell.children('.commission-analytics-controls-highlight');
        if (!$controls.length) {
            $controls = $('<div class="commission-analytics-controls-highlight"></div>');
            $shell.prepend($controls);
        }

        if ($table.parent()[0] !== $shell[0]) {
            $shell.append($table);
        }
        if ($length.parent()[0] !== $controls[0]) {
            $controls.append($length);
        }
        if ($filter.parent()[0] !== $controls[0]) {
            $controls.append($filter);
        }

        placeCommissionPanelDateFilter();

        $filterHighlight = $filter.children('.commission-analytics-filter-highlight');
        if (!$filterHighlight.length) {
            $filterHighlight = $('<div class="commission-analytics-filter-highlight"></div>');
            $filter.append($filterHighlight);
        }

        $filterLabel = $filter.children('label');
        if (!$filterLabel.length) {
            $filterLabel = $filterHighlight.children('label');
        }
        if ($filterLabel.length && $filterLabel.parent()[0] !== $filterHighlight[0]) {
            $filterHighlight.append($filterLabel);
        }

        $searchInput = $filterLabel.find('input');
        if ($searchInput.length) {
            $searchInput.attr('placeholder', 'Search...');
            $filterLabel.contents().filter(function () {
                return this.nodeType === 3;
            }).remove();
        }

        /* Only hide emptied top controls row — never .dt-row (holds the table) */
        $wrapper.children('.row').each(function () {
            var $row = $(this);
            if ($row.hasClass('dt-row') || $row.find('table').length) return;
            if (!$row.find('.dataTables_length, .dataTables_filter, .dataTables_info, .dataTables_paginate').length) {
                $row.addClass('commission-analytics-dt-top-row-empty').hide();
            }
        });

        $table.css({ marginTop: 0, marginBottom: 0, width: '100%', maxWidth: '100%' }).show();
        /* Table lives in shell now — hide leftover empty dt-row wrapper */
        $wrapper.children('.row.dt-row').each(function () {
            var $row = $(this);
            if (!$row.find('table').length) {
                $row.hide();
            }
        });
    }

    // Categorize Group panel ends at the ranking table's last row (not the info/pagination row)
    function syncGroupsPanelHeight() {
        var $panel = $('.ca-groups-panel');
        var $shell = $('#commission-panel-tbl_wrapper .commission-analytics-panel-shell');
        if (!$panel.length || !$shell.length) return;
        var $title = $panel.find('.ca-groups-title');
        var $groupHead = $('#ca-groups-tbl thead th');
        if (window.matchMedia('(max-width: 1199.98px)').matches) {
            $panel.css('height', '');
            $title.css('height', '');
            $groupHead.css('height', '');
            return;
        }
        // Title lines up with the Show/Search bar, column headers with the ranking headers
        var $controls = $shell.children('.commission-analytics-controls-highlight');
        var $rankHead = $('#commission-panel-tbl thead tr').first();
        if ($controls.length) $title.css('height', Math.round($controls.outerHeight()) + 'px');
        if ($rankHead.length) $groupHead.css('height', Math.round($rankHead.outerHeight()) + 'px');
        // Never shorter than the screen space below it, so a short/empty table doesn't squeeze the groups
        var screenRoom = Math.round($(window).height() - $panel.offset().top - 40);
        $panel.css('height', Math.max(420, screenRoom, Math.round($shell.outerHeight())) + 'px');
    }

    $(window).on('resize', syncGroupsPanelHeight);

    function placeCommissionPanelDateFilter() {
        var $mount = $('#commission-panel-daterange-mount');
        var $length = $('#commission-panel-tbl_length');
        var $controls = $('#commission-panel-tbl_wrapper').find('.commission-analytics-controls-highlight').first();
        if (!$mount.length || !$length.length || !$controls.length) return;
        if ($mount.parent()[0] !== $controls[0] || $mount.prev()[0] !== $length[0]) {
            $mount.detach().insertAfter($length).addClass('is-placed').data('placed', true);
        } else {
            $mount.addClass('is-placed').data('placed', true);
        }
        if (window.MonthEndCutoffRange && typeof window.MonthEndCutoffRange.fitRangePickerInstance === 'function') {
            var el = document.getElementById('commission-panel-daterange');
            if (el && el._flatpickr) {
                window.MonthEndCutoffRange.fitRangePickerInstance(el._flatpickr);
            }
        }
        if (commissionPanelSplitDateRange && typeof commissionPanelSplitDateRange.fitWidths === 'function') {
            commissionPanelSplitDateRange.fitWidths();
        }
    }

    function commissionPanelApiEndDate(endYmd) {
        if (!endYmd || !/^\d{4}-\d{2}-\d{2}$/.test(String(endYmd))) return endYmd;
        var parts = String(endYmd).slice(0, 10).split('-').map(Number);
        var lastDayOfMonth = new Date(parts[0], parts[1], 0).getDate();
        if (parts[2] === lastDayOfMonth - 1 && window.MonthEndCutoffRange) {
            return window.MonthEndCutoffRange.expandApiEndDateToMonthEnd(endYmd);
        }
        return endYmd;
    }

    var commissionPanelSplitOverrideRange = null;
    var commissionPanelSplitDateRange = (window.SplitDateRange && SplitDateRange.attach({
        rangePickerId: 'commission-panel-daterange',
        startId: 'commission-panel-start-date',
        endId: 'commission-panel-end-date',
        splitWrapperId: 'commission-panel-split-daterange-wrapper',
        independent: true,
        invalidDateMessage: 'Invalid date range.',
        onRangeApplied: function (range) {
            if (!range || !range.start || !range.end) return;
            var fromDate = range.start;
            var toDate = commissionPanelApiEndDate(range.end);
            if (fromDate > toDate) {
                var swap = fromDate;
                fromDate = toDate;
                toDate = swap;
            }
            commissionPanelSplitOverrideRange = { start: fromDate, end: toDate };
            clearCaQuickFilter();
            loadRankingData();
        }
    })) || { syncFromRange: function () {}, fitWidths: function () {}, isSyncing: function () { return false; } };

    function getCommissionPanelDateRangeValue() {
        var el = document.getElementById('commission-panel-daterange');
        if (el && el._flatpickr) {
            var fp = el._flatpickr;
            if (fp.selectedDates && fp.selectedDates.length === 2) {
                return moment(fp.selectedDates[0]).format('YYYY-MM-DD') + ' to ' +
                    moment(fp.selectedDates[1]).format('YYYY-MM-DD');
            }
            return (fp.input.value || '').trim();
        }
        return ($('#commission-panel-daterange').val() || '').trim();
    }

    // ── All / Month / Today / Yesterday — same behaviour as Game Information ──
    var caQuickFilter = 'month';
    var caDayFilter = { today: false, yesterday: false };
    var caGroupedOnly = false; // "Categorize Group" tab: only agents that belong to any group
    var CA_ALL_RANGE = { start: '2000-01-01', end: '2099-12-31' };

    function caLocalYmd(d) {
        return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    }

    function syncCaQuickFilterTabs() {
        $('#ca-quick-filter-wrapper .gi-quick-filter-tab').each(function () {
            var range = $(this).data('range');
            var on = range === 'grouped' ? caGroupedOnly
                : (range === 'today' || range === 'yesterday' ? !!caDayFilter[range] : range === caQuickFilter);
            $(this).toggleClass('active', on);
        });
    }

    function clearCaQuickFilter() {
        if (!caQuickFilter) return;
        caQuickFilter = null;
        caDayFilter = { today: false, yesterday: false };
        syncCaQuickFilterTabs();
    }

    /** Tab click: All / Month pick one; Today and Yesterday toggle and can be on together. */
    function onCaQuickFilterTab(range) {
        if (range === 'grouped') {
            caGroupedOnly = !caGroupedOnly;
            syncCaQuickFilterTabs();
            applyGroupFilter();
            return;
        }
        if (range === 'today' || range === 'yesterday') {
            caDayFilter[range] = !caDayFilter[range];
            applyCaQuickFilter(caDayFilter.today || caDayFilter.yesterday ? 'days' : 'month');
            return;
        }
        applyCaQuickFilter(range);
    }

    function applyCaQuickFilter(range) {
        var pickerEl = document.getElementById('commission-panel-daterange');
        var fp = pickerEl && pickerEl._flatpickr;
        var from = null;
        var to = null;
        var apiTo = null;

        if (range === 'days') {
            var today = new Date();
            var yesterday = new Date();
            yesterday.setDate(yesterday.getDate() - 1);
            from = caLocalYmd(caDayFilter.yesterday ? yesterday : today);
            to = caLocalYmd(caDayFilter.today ? today : yesterday);
            apiTo = to;
        } else {
            caDayFilter = { today: false, yesterday: false };
            if (range === 'month' && window.MonthEndCutoffRange) {
                var cutoff = window.MonthEndCutoffRange.getMonthEndCutoffRange();
                from = cutoff.startDate;
                to = cutoff.endDate;
                apiTo = cutoff.endDateApi || cutoff.endDate;
            } else if (range === 'month') {
                var now = new Date();
                from = caLocalYmd(new Date(now.getFullYear(), now.getMonth(), 1));
                to = caLocalYmd(new Date(now.getFullYear(), now.getMonth() + 1, 0));
                apiTo = to;
            } else {
                range = 'all';
            }
        }

        caQuickFilter = range;
        syncCaQuickFilterTabs();
        $('#commission-panel-start-date, #commission-panel-end-date').val('');

        commissionPanelSkipMonthRange = true;
        if (fp) {
            if (from) fp.setDate([from, to], false);
            else fp.clear(false);
        }
        commissionPanelSkipMonthRange = false;
        if (commissionPanelSplitDateRange && typeof commissionPanelSplitDateRange.syncFromRange === 'function') {
            commissionPanelSplitDateRange.syncFromRange();
        }

        commissionPanelSplitOverrideRange = from ? { start: from, end: apiTo } : { start: CA_ALL_RANGE.start, end: CA_ALL_RANGE.end };
        loadRankingData();
    }

    $(document).on('click', '#ca-quick-filter-wrapper .gi-quick-filter-tab', function () {
        onCaQuickFilterTab(String($(this).data('range')));
    });

    function getCommissionPanelDateRangeLabel() {
        if (caQuickFilter === 'all') return 'All';
        var el = document.getElementById('commission-panel-daterange');
        if (el && el._flatpickr && el._flatpickr.altInput && el._flatpickr.altInput.value) {
            return el._flatpickr.altInput.value.trim();
        }
        return getCommissionPanelDateRangeValue();
    }

    // Columns 0–7 are data; the last one holds the receipt button and is left out of totals/print/export
    var RANK_ACTION_COL = 8;

    var rankTable = $('#commission-panel-tbl').DataTable({
        ordering: false,
        pageLength: -1,
        lengthMenu: [[10, 25, 50, 100, -1], [10, 25, 50, 100, 'All']],
        columnDefs: [
            { targets: 0, className: 'text-center' },
            { targets: [2, 3, 4, 5, 6, 7], className: 'text-end' },
            { targets: RANK_ACTION_COL, className: 'text-center ca-rank-action-cell', searchable: false }
        ],
        drawCallback: function () {
            layoutCommissionAnalyticsControls();
            $('#commission-panel-tbl').css({ width: '100%', maxWidth: '100%' });
            renderRankTotals(this.api());
            syncGroupsPanelHeight();
        },
        language: {
            search: '',
            searchPlaceholder: 'Search...',
            info: 'Showing _START_ to _END_ of _TOTAL_ entries',
            paginate: { previous: 'Previous', next: 'Next' },
            emptyTable: 'No data available in table'
        }
    });

    layoutCommissionAnalyticsControls();

    var urlParams = new URLSearchParams(window.location.search);
    var compareFilterFromUrl = (urlParams.get('compare') || '')
        .split(',')
        .map(function (s) { return s.trim().toUpperCase(); })
        .filter(Boolean);
    var compareStartFromUrl = urlParams.get('start') || '';
    var compareEndFromUrl = urlParams.get('end') || '';

    var drilldownState = {
        agents: {},
        rankingSortKey: 'ngr',
        rankingSortDir: 'desc',
        panelTxnSortKey: 'dateTime',
        panelTxnSortDir: 'desc',
        panelModalAgentKey: null,
        compareFilter: compareFilterFromUrl.length ? compareFilterFromUrl : null
    };

    var RANKING_METRIC_KEYS = ['totalBuyIn', 'totalChipsReturn', 'winLoss', 'totalRolling', 'commission', 'ngr'];
    var RANKING_METRIC_LABELS = {
        totalBuyIn: 'Buy In',
        totalChipsReturn: 'Cash Out',
        winLoss: 'Win/Loss',
        totalRolling: 'Rolling',
        commission: 'Settlement',
        ngr: 'NGR'
    };

    function getRankingMetricColumnOrder() {
        return RANKING_METRIC_KEYS.slice();
    }

    function getCommissionAnalyticsExportFilename() {
        if (caQuickFilter === 'all') return 'CommissionAnalytics_All.xlsx';
        if (commissionPanelSplitOverrideRange && commissionPanelSplitOverrideRange.start && commissionPanelSplitOverrideRange.end) {
            return 'CommissionAnalytics_' + commissionPanelSplitOverrideRange.start + '_to_' + commissionPanelSplitOverrideRange.end + '.xlsx';
        }
        var dr = document.getElementById('commission-panel-daterange');
        if (dr && dr._flatpickr && dr._flatpickr.selectedDates && dr._flatpickr.selectedDates.length === 2) {
            var pad = function (n) {
                return String(n).padStart(2, '0');
            };
            var fmt = function (dt) {
                return dt.getFullYear() + '-' + pad(dt.getMonth() + 1) + '-' + pad(dt.getDate());
            };
            return 'CommissionAnalytics_' + fmt(dr._flatpickr.selectedDates[0]) + '_to_' + fmt(dr._flatpickr.selectedDates[1]) + '.xlsx';
        }
        return 'CommissionAnalytics-export.xlsx';
    }

    function getCommissionPanelModalExportFilename() {
        var agentName = ($('#commission-panel-modal-subtitle').text() || 'Guest').trim();
        return 'CommissionTransactions-' + agentName + '.xlsx';
    }

    function downloadCommissionXlsx(headers, rows, filename, $btn, profileKey) {
        $btn.prop('disabled', true);
        fetch('/commission/export_xlsx', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'same-origin',
            body: JSON.stringify({ headers: headers, rows: rows, filename: filename, profileKey: profileKey })
        })
            .then(function (res) {
                if (!res.ok) {
                    return res.json().catch(function () { return {}; }).then(function (j) {
                        throw new Error((j && j.error) ? j.error : 'Export failed');
                    });
                }
                return res.blob();
            })
            .then(function (blob) {
                var link = document.createElement('a');
                link.href = URL.createObjectURL(blob);
                link.download = filename;
                document.body.appendChild(link);
                link.click();
                document.body.removeChild(link);
                URL.revokeObjectURL(link.href);
            })
            .catch(function (err) {
                if (window.Swal) {
                    Swal.fire({
                        icon: 'error',
                        title: 'Error',
                        text: err.message || 'Export failed',
                        confirmButtonColor: '#0d6efd'
                    });
                } else {
                    alert(err.message || 'Export failed');
                }
            })
            .finally(function () {
                $btn.prop('disabled', false);
            });
    }

    // "(1,234)" → -1234, "1,234" → 1234
    function parseShownAmount(text) {
        var s = String(text == null ? '' : text).trim();
        var neg = /^\(.*\)$/.test(s) || /^-/.test(s);
        var n = Number(s.replace(/[^0-9.]/g, '')) || 0;
        return neg ? -n : n;
    }

    function formatShownAmount(n) {
        return n < 0 ? '(' + formatNumber(Math.abs(n)) + ')' : formatNumber(n);
    }

    // Total of the visible (filtered) rows for the amount columns (index 2+)
    function buildRankTotalRow(rows) {
        var sums = [];
        (rows || []).forEach(function (row) {
            for (var i = 2; i < row.length; i++) sums[i] = (sums[i] || 0) + parseShownAmount(row[i]);
        });
        var out = ['', 'Total'];
        for (var i = 2; i < sums.length; i++) out.push(formatShownAmount(sums[i] || 0));
        return out;
    }

    // api: the DataTable API — passed from drawCallback, where rankTable is not assigned yet on the first draw
    function renderRankTotals(api) {
        api = api || rankTable;
        if (!api) return;
        var rows = [];
        api.rows({ search: 'applied' }).every(function () {
            rows.push((this.data() || []).slice(0, RANK_ACTION_COL).map(stripHtml));
        });
        var total = buildRankTotalRow(rows);
        $('#commission-panel-tbl tfoot th').each(function (i) {
            if (i < 2 || i >= RANK_ACTION_COL) return;
            var text = total[i] != null ? total[i] : formatShownAmount(0);
            $(this).html(/^\(/.test(text) ? '<span style="color:#dc2626;">' + escapeHtml(text) + '</span>' : escapeHtml(text));
        });
    }

    function getCommissionAnalyticsTablePayload() {
        var headers = [];
        $('#commission-panel-tbl thead tr:first th').slice(0, RANK_ACTION_COL).each(function () {
            headers.push($(this).clone().children().remove().end().text().trim());
        });

        var rows = [];
        rankTable.rows({ search: 'applied' }).every(function () {
            var data = (this.data() || []).slice(0, RANK_ACTION_COL);
            var cells = data.map(stripHtml);
            if (cells.length) rows.push(cells);
        });

        return { headers: headers, rows: rows, totalRow: rows.length ? buildRankTotalRow(rows) : null };
    }

    function getSortedPanelTransactions(agent) {
        if (!agent) return [];
        var sortKey = drilldownState.panelTxnSortKey || 'dateTime';
        var sortDir = drilldownState.panelTxnSortDir === 'asc' ? 'asc' : 'desc';
        return (agent.transactions || []).slice().sort(function (a, b) {
            var av = getPanelTxnSortValue(a, sortKey);
            var bv = getPanelTxnSortValue(b, sortKey);
            if (av < bv) return sortDir === 'asc' ? -1 : 1;
            if (av > bv) return sortDir === 'asc' ? 1 : -1;
            return 0;
        });
    }

    function getCommissionPanelModalPayload() {
        var agentKey = drilldownState.panelModalAgentKey;
        var agent = agentKey ? findRankRow(agentKey) : null;
        var txns = getSortedPanelTransactions(agent);
        var headers = [];
        $('#commission-panel-modal-head-table thead tr:first th').each(function () {
            headers.push($(this).clone().children().remove().end().text().trim());
        });

        var totals = {
            buyIn: 0,
            chipsReturn: 0,
            winLoss: 0,
            rolling: 0,
            settlement: 0,
            fnb: 0,
            payment: 0
        };
        var rows = txns.map(function (t) {
            totals.buyIn += Number(t.totalBuyIn) || 0;
            totals.chipsReturn += Number(t.chipsReturn) || 0;
            totals.winLoss += Number(t.winLoss) || 0;
            totals.rolling += Number(t.totalRolling) || 0;
            totals.settlement += Number(t.settlement) || 0;
            totals.fnb += Number(t.fnb) || 0;
            totals.payment += Number(t.payment) || 0;
            return [
                t.gameNo,
                formatNumber(t.totalBuyIn),
                formatNumber(t.chipsReturn),
                formatNumber(t.winLoss),
                formatNumber(t.totalRolling),
                formatRate(t.rollingRate),
                formatNumber(t.settlement),
                formatNumber(t.fnb),
                formatNumber(t.payment),
                t.dateTime
            ];
        });

        if (rows.length) {
            rows.push([
                'Grand Total',
                formatNumber(totals.buyIn),
                formatNumber(totals.chipsReturn),
                formatNumber(totals.winLoss),
                formatNumber(totals.rolling),
                '',
                formatNumber(totals.settlement),
                formatNumber(totals.fnb),
                formatNumber(totals.payment),
                ''
            ]);
        }

        return {
            agentName: agent ? agent.name : '',
            headers: headers,
            rows: rows
        };
    }

    function getCommissionPanelModalExportPayload() {
        var payload = getCommissionPanelModalPayload();
        if (payload.rows.length && String(payload.rows[payload.rows.length - 1][0] || '').toLowerCase().indexOf('grand total') !== -1) {
            payload.rows = payload.rows.slice(0, -1);
        }
        return payload;
    }

    function notifyNoCommissionAnalyticsRows(title) {
        if (window.Swal) {
            Swal.fire({
                icon: 'info',
                title: title || 'Export',
                text: 'No rows to export for the current filter.',
                confirmButtonColor: '#0d6efd'
            });
        } else {
            alert('No rows to export.');
        }
    }

    function notifyNoCommissionPanelModalRows(title) {
        if (window.Swal) {
            Swal.fire({
                icon: 'info',
                title: title || 'Export',
                text: 'No transactions to export.',
                confirmButtonColor: '#0d6efd'
            });
        } else {
            alert('No transactions to export.');
        }
    }

    function getCommissionAnalyticsPrintStyles() {
        return [
            '@page{size:landscape;margin:10mm;}',
            'body{font-family:Arial,sans-serif;color:#111;margin:0;}',
            '.print-wrap{width:100%;}',
            'h2{text-align:center;margin:0 0 4px;font-size:18px;}',
            '.subtitle{text-align:center;margin:0 0 12px;font-size:12px;color:#444;}',
            'table{width:100%;border-collapse:collapse;font-size:11px;}',
            'th,td{border:1px solid #777;padding:6px 8px;vertical-align:middle;}',
            'th{background:#d9e1f2;text-align:right;font-weight:700;}',
            'th:nth-child(1){text-align:center;}',
            'th:nth-child(2){text-align:left;}',
            'td{text-align:right;}',
            'td:nth-child(1){text-align:center;}',
            'td:nth-child(2){text-align:left;}'
        ].join('');
    }

    function printCommissionAnalyticsTable() {
        var payload = getCommissionAnalyticsTablePayload();
        if (payload.rows.length === 0) {
            notifyNoCommissionAnalyticsRows('Print');
            return;
        }

        var dateRange = getCommissionPanelDateRangeLabel();
        var headerHtml = payload.headers.map(function (h) {
            return '<th>' + escapeHtml(h) + '</th>';
        }).join('');
        var rowsHtml = payload.rows.concat(payload.totalRow ? [payload.totalRow] : []).map(function (row, r) {
            var isTotal = payload.totalRow && r === payload.rows.length;
            return '<tr' + (isTotal ? ' style="font-weight:700;background:#f4f6fa;"' : '') + '>' + row.map(function (cell) {
                return '<td>' + escapeHtml(cell) + '</td>';
            }).join('') + '</tr>';
        }).join('');

        var iframe = document.createElement('iframe');
        iframe.style.position = 'fixed';
        iframe.style.right = '0';
        iframe.style.bottom = '0';
        iframe.style.width = '0';
        iframe.style.height = '0';
        iframe.style.border = '0';
        document.body.appendChild(iframe);

        var frameWindow = iframe.contentWindow;
        var frameDoc = frameWindow.document;
        frameDoc.open();
        frameDoc.write([
            '<!doctype html><html><head><title>Commission Analytics</title><style>',
            getCommissionAnalyticsPrintStyles(),
            '</style></head><body><div class="print-wrap">',
            '<h2>Commission Analytics</h2>',
            '<div class="subtitle">', escapeHtml(dateRange), getSelectedGroup() ? ' — ' + escapeHtml(getSelectedGroup().group_name) : '', '</div>',
            '<table><thead><tr>', headerHtml, '</tr></thead><tbody>', rowsHtml, '</tbody></table>',
            '</div></body></html>'
        ].join(''));
        frameDoc.close();

        var cleanup = function () {
            setTimeout(function () {
                if (iframe && iframe.parentNode) iframe.parentNode.removeChild(iframe);
            }, 300);
        };
        frameWindow.onafterprint = cleanup;
        setTimeout(function () {
            frameWindow.focus();
            frameWindow.print();
            cleanup();
        }, 250);
    }

    function getCommissionPanelModalPrintStyles() {
        return [
            '@page{size:landscape;margin:8mm;}',
            'body{font-family:Arial,sans-serif;color:#111;margin:0;}',
            '.print-wrap{width:100%;}',
            'h2{text-align:center;margin:0 0 4px;font-size:18px;}',
            '.subtitle{text-align:center;margin:0 0 12px;font-size:12px;color:#444;}',
            'table{width:100%;border-collapse:collapse;font-size:10px;}',
            'th,td{border:1px solid #777;padding:5px 7px;vertical-align:middle;}',
            'th{background:#d9e1f2;text-align:right;font-weight:700;}',
            'th:nth-child(1){text-align:center;}',
            'th:nth-child(10){text-align:left;}',
            'td{text-align:right;}',
            'td:nth-child(1){text-align:center;}',
            'td:nth-child(10){text-align:left;}',
            'tbody tr:last-child td{font-weight:700;background:#f4f6fa;}'
        ].join('');
    }

    function printCommissionPanelModalTable() {
        var payload = getCommissionPanelModalPayload();
        if (payload.rows.length === 0) {
            notifyNoCommissionPanelModalRows('Print');
            return;
        }

        var headerHtml = payload.headers.map(function (h) {
            return '<th>' + escapeHtml(h) + '</th>';
        }).join('');
        var rowsHtml = payload.rows.map(function (row) {
            return '<tr>' + row.map(function (cell) {
                return '<td>' + escapeHtml(cell) + '</td>';
            }).join('') + '</tr>';
        }).join('');

        var iframe = document.createElement('iframe');
        iframe.style.position = 'fixed';
        iframe.style.right = '0';
        iframe.style.bottom = '0';
        iframe.style.width = '0';
        iframe.style.height = '0';
        iframe.style.border = '0';
        document.body.appendChild(iframe);

        var frameWindow = iframe.contentWindow;
        var frameDoc = frameWindow.document;
        frameDoc.open();
        frameDoc.write([
            '<!doctype html><html><head><title>Guest Commission Transactions</title><style>',
            getCommissionPanelModalPrintStyles(),
            '</style></head><body><div class="print-wrap">',
            '<h2>Guest Commission Transactions</h2>',
            '<div class="subtitle">', escapeHtml(payload.agentName), '</div>',
            '<table><thead><tr>', headerHtml, '</tr></thead><tbody>', rowsHtml, '</tbody></table>',
            '</div></body></html>'
        ].join(''));
        frameDoc.close();

        var cleanup = function () {
            setTimeout(function () {
                if (iframe && iframe.parentNode) iframe.parentNode.removeChild(iframe);
            }, 300);
        };
        frameWindow.onafterprint = cleanup;
        setTimeout(function () {
            frameWindow.focus();
            frameWindow.print();
            cleanup();
        }, 250);
    }

    // Settlement column = Total Settlement, same as Game Information: −commission + Add Charge
    function getAgentTotalSettlement(row) {
        return -(Number(row.commission) || 0) + (Number(row.fnb) || 0);
    }

    function getAgentRankingSortValue(row, key) {
        if (!row) return 0;
        if (key === 'totalBuyIn') return Number(row.totalBuyIn) || 0;
        if (key === 'totalChipsReturn') return Number(row.totalChipsReturn) || 0;
        if (key === 'winLoss') return Number(row.winLoss) || 0;
        if (key === 'totalRolling') return Number(row.totalRolling) || 0;
        if (key === 'commission') return getAgentTotalSettlement(row);
        if (key === 'ngr') return Number(row.ngr) || 0;
        return Number(row.commission) || 0;
    }

    function sortAgentRowsForRanking(rows) {
        var key = drilldownState.rankingSortKey || 'commission';
        var dir = drilldownState.rankingSortDir === 'asc' ? 'asc' : 'desc';
        return (rows || []).slice().sort(function (a, b) {
            // Rows with no games (all 0) always go last, whatever the sort
            var aEmpty = !(a.transactions || []).length;
            var bEmpty = !(b.transactions || []).length;
            if (aEmpty !== bEmpty) return aEmpty ? 1 : -1;
            var av = getAgentRankingSortValue(a, key);
            var bv = getAgentRankingSortValue(b, key);
            if (av < bv) return dir === 'asc' ? -1 : 1;
            if (av > bv) return dir === 'asc' ? 1 : -1;
            return String(a.name || '').localeCompare(String(b.name || ''));
        });
    }

    function renderRankingSortIndicators() {
        var key = drilldownState.rankingSortKey || 'commission';
        var dir = drilldownState.rankingSortDir === 'asc' ? 'asc' : 'desc';
        var colOrder = getRankingMetricColumnOrder();
        $('#commission-panel-tbl thead th.commission-rank-sortable').each(function (idx) {
            var $th = $(this);
            var thKey = colOrder[idx];
            $th.attr('data-rank-key', thKey);
            $th.text(RANKING_METRIC_LABELS[thKey] || thKey);
            $th.removeClass('sorting sorting_asc sorting_desc')
                .addClass(thKey === key ? (dir === 'asc' ? 'sorting_asc' : 'sorting_desc') : 'sorting');
            $th.toggleClass('is-active', thKey === key);
        });
    }

    function applyRankingMetricCellClasses() {
        var colOrder = getRankingMetricColumnOrder();
        $('#commission-panel-tbl tbody tr').each(function () {
            var $cells = $(this).find('td');
            for (var i = 0; i < colOrder.length; i++) {
                var $cell = $cells.eq(2 + i);
                if (!$cell.length) continue;
                var dropClasses = ($cell.attr('class') || '')
                    .split(/\s+/)
                    .filter(function (c) { return c.indexOf('commission-rank-col-') === 0; })
                    .join(' ');
                if (dropClasses) $cell.removeClass(dropClasses);
                $cell.addClass('commission-rank-metric-cell commission-rank-col-' + colOrder[i]);
            }
        });
    }

    function applyRankingColumnHighlight() {
        var key = drilldownState.rankingSortKey || 'commission';
        $('#commission-panel-tbl tbody td.commission-rank-metric-cell').removeClass('is-active');
        $('#commission-panel-tbl tbody td.commission-rank-col-' + key).addClass('is-active');
    }

    function agentMatchesCompareFilter(item) {
        if (!drilldownState.compareFilter || !drilldownState.compareFilter.length) {
            return true;
        }
        var code = String(item.agentCode || '').trim().toUpperCase();
        if (!code && item.name) {
            var idx = String(item.name).indexOf(' - ');
            code = (idx >= 0 ? String(item.name).slice(0, idx) : String(item.name)).trim().toUpperCase();
        }
        return drilldownState.compareFilter.indexOf(code) >= 0;
    }

    // ── Agent groups (filter) — stored in gi_agent_group / gi_agent_group_member ──
    var caGroups = [];
    var caSelectedGroupId = '';
    var caAgentOptions = null;
    var caSelectedAgents = [];
    var caEditingGroupId = null;
    var caCheckedByGroup = {}; // groupId -> { agentId: true } — when any are checked, only those show in the table
    var caExpandedGroups = {}; // groupId -> true when its agent list is shown

    function isViewOnly() {
        var roleEl = document.getElementById('user-role');
        return !!roleEl && String(roleEl.getAttribute('data-permissions') || '') === '2';
    }

    function getSelectedGroup() {
        if (!caSelectedGroupId) return null;
        return caGroups.find(function (g) { return String(g.group_id) === String(caSelectedGroupId); }) || null;
    }

    function isAgentChecked(groupId, agentId) {
        var map = caCheckedByGroup[String(groupId)];
        return !!(map && map[String(agentId)]);
    }

    function hasCheckedAgents(groupId) {
        var map = caCheckedByGroup[String(groupId)];
        return !!map && Object.keys(map).length > 0;
    }

    // Selected group → its agents; if some are checked in its list, only those
    function agentMatchesGroupFilter(item) {
        var group = getSelectedGroup();
        if (!group) {
            if (!caGroupedOnly) return true;
            return caGroups.some(function (g) {
                return (g.agents || []).some(function (a) { return String(a.agent_id) === String(item.key); });
            });
        }
        var onlyChecked = hasCheckedAgents(group.group_id);
        return (group.agents || []).some(function (a) {
            if (String(a.agent_id) !== String(item.key)) return false;
            return !onlyChecked || isAgentChecked(group.group_id, a.agent_id);
        });
    }

    function renderGroupFilterOptions() {
        var $tbody = $('#ca-groups-tbl tbody');
        if (!getSelectedGroup()) caSelectedGroupId = '';
        $('#btn-ca-group-edit, #btn-ca-group-delete').toggleClass('d-none', !caSelectedGroupId);
        $('#ca-groups-total').text('(' + caGroups.length + ')');
        if (!caGroups.length) {
            $tbody.html('<tr class="ca-groups-empty"><td colspan="4">No groups yet. Click <b>+ Group</b> to add one.</td></tr>');
            return;
        }
        $tbody.html(caGroups.map(function (g) {
            var gid = String(g.group_id);
            var agents = g.agents || [];
            var expanded = !!caExpandedGroups[gid];
            var list = !expanded ? '' : agents.map(function (a) {
                var on = isAgentChecked(gid, a.agent_id);
                return '<label class="ca-group-agent-item' + (on ? ' is-checked' : '') + '">' +
                    '<input type="checkbox" class="ca-group-agent-check" data-group-id="' + escapeHtml(gid) + '" data-agent-id="' + escapeHtml(a.agent_id) + '"' + (on ? ' checked' : '') + '>' +
                    '<span>' + escapeHtml(a.label || a.agent_id) + '</span>' +
                    '</label>';
            }).join('');
            if (expanded && agents.length > 1) {
                var checkedCount = agents.filter(function (a) { return isAgentChecked(gid, a.agent_id); }).length;
                list = '<label class="ca-group-agent-item ca-group-select-all">' +
                    '<input type="checkbox" class="ca-group-agent-check-all" data-group-id="' + escapeHtml(gid) + '"' +
                        (checkedCount === agents.length ? ' checked' : '') +
                        (checkedCount > 0 && checkedCount < agents.length ? ' data-indeterminate="1"' : '') + '>' +
                    '<span>Select all</span>' +
                    '</label>' + list;
            }
            return '<tr class="ca-group-row' + (gid === caSelectedGroupId ? ' is-selected' : '') + '" data-group-id="' + escapeHtml(gid) + '">' +
                '<td class="ca-group-name">' + escapeHtml(g.group_name) + '</td>' +
                '<td class="text-center"><button type="button" class="ca-group-count' + (expanded ? ' is-open' : '') + '" data-group-id="' + escapeHtml(gid) + '" title="' + (expanded ? 'Hide list' : 'Show list') + '">' +
                    agents.length + '</button></td>' +
                '<td>' + list + '</td>' +
                '<td class="ca-group-remarks' + (isViewOnly() ? '' : ' is-editable') + '" data-group-id="' + escapeHtml(gid) + '" title="' + (isViewOnly() ? '' : 'Click to add/edit remarks') + '">' +
                    (g.remarks ? escapeHtml(g.remarks) : '-') +
                '</td>' +
                '</tr>';
        }).join(''));
        $tbody.find('.ca-group-agent-check-all[data-indeterminate]').prop('indeterminate', true);
    }

    function selectGroup(groupId) {
        caSelectedGroupId = String(groupId || '');
        renderGroupFilterOptions();
        applyGroupFilter();
    }

    function loadAgentGroups() {
        return $.ajax({ url: '/categorize_group_groups', method: 'GET' }).then(function (rows) {
            caGroups = Array.isArray(rows) ? rows : [];
            renderGroupFilterOptions();
        }, function () {
            caGroups = [];
            renderGroupFilterOptions();
        });
    }

    function applyGroupFilter() {
        renderRankTable(buildSortedAgentRowsFromState());
    }

    function loadGroupAgentOptions() {
        if (caAgentOptions) return $.Deferred().resolve().promise();
        return $.ajax({ url: '/agent_data', method: 'GET' }).then(function (rows) {
            caAgentOptions = (rows || []).map(function (row) {
                var id = row.agent_id || row.IDNo;
                var code = String(row.agent_code || row.AGENT_CODE || '').trim();
                var name = String(row.NAME || row.agent_name || '').trim();
                return {
                    id: id,
                    label: code && name ? code + ' - ' + name : (code || name || String(id)),
                    lineId: String(row.agency_id || row.AGENCY || ''),
                    lineName: String(row.agency_name || '').trim()
                };
            });
        });
    }

    // Line = the agent's agency; picking one limits the Agents list to that line
    function renderGroupLineOptions(selectedLineId) {
        var $line = $('#gi-agent-group-line');
        if (!$line.length) return;
        var seen = {};
        var lines = [];
        (caAgentOptions || []).forEach(function (opt) {
            if (!opt.lineId || seen[opt.lineId]) return;
            seen[opt.lineId] = true;
            lines.push({ id: opt.lineId, name: opt.lineName || opt.lineId });
        });
        lines.sort(function (a, b) {
            return a.name.replace(/^[\s*]+/, '').localeCompare(b.name.replace(/^[\s*]+/, ''));
        });
        if ($.fn.select2 && $line.hasClass('select2-hidden-accessible')) {
            try { $line.select2('destroy'); } catch (e) { /* ignore */ }
        }
        $line.empty().append(new Option('All Lines', '', false, false));
        lines.forEach(function (l) {
            $line.append(new Option(l.name, l.id, false, false));
        });
        $line.val(selectedLineId || '');
        if ($.fn.select2) {
            $line.select2({
                width: '100%',
                dropdownParent: $('#modal-gi-agent-group'),
                minimumResultsForSearch: 0
            });
        }
    }

    // When editing, start on the members' line if they all share one
    function getGroupMembersLineId(agents) {
        var lineId = '';
        for (var i = 0; i < agents.length; i++) {
            var opt = (caAgentOptions || []).find(function (o) { return String(o.id) === String(agents[i].agent_id); });
            if (!opt || !opt.lineId) return '';
            if (lineId && lineId !== opt.lineId) return '';
            lineId = opt.lineId;
        }
        return lineId;
    }

    function destroyGroupAgentPicker() {
        var $picker = $('#gi-agent-group-agent-picker');
        if ($picker.length && $.fn.select2 && $picker.hasClass('select2-hidden-accessible')) {
            try { $picker.select2('destroy'); } catch (e) { /* ignore */ }
        }
    }

    function refreshGroupAgentPicker() {
        var $picker = $('#gi-agent-group-agent-picker');
        if (!$picker.length) return;
        var selectedIds = caSelectedAgents.map(function (a) { return String(a.agent_id); });
        var lineId = String($('#gi-agent-group-line').val() || '');
        destroyGroupAgentPicker();
        $picker.empty().append(new Option('', '', false, false));
        (caAgentOptions || []).forEach(function (opt) {
            if (lineId && opt.lineId !== lineId) return;
            if (selectedIds.indexOf(String(opt.id)) === -1) {
                $picker.append(new Option(opt.label, opt.id, false, false));
            }
        });
        if ($.fn.select2) {
            $picker.select2({
                width: '100%',
                placeholder: $picker.data('placeholder') || 'Search agent...',
                allowClear: true,
                dropdownParent: $('#modal-gi-agent-group'),
                minimumResultsForSearch: 0
            });
        }
        $picker.val(null).trigger('change.select2');
    }

    function renderGroupSelectedAgents() {
        $('#gi-agent-group-selected').html(caSelectedAgents.map(function (agent) {
            return '<span class="gi-agent-chip" data-id="' + escapeHtml(agent.agent_id) + '">' +
                escapeHtml(agent.label) +
                '<button type="button" class="gi-agent-chip-remove" data-id="' + escapeHtml(agent.agent_id) + '" aria-label="Remove">&times;</button>' +
                '</span>';
        }).join(''));
    }

    function openGroupModal(group) {
        caEditingGroupId = group ? group.group_id : null;
        $('#modal-gi-agent-group-title').text(group ? 'Edit Group' : 'New Group');
        $('#gi-agent-group-id').val(caEditingGroupId || '');
        $('#gi-agent-group-name').val(group ? group.group_name || '' : '');
        $('#gi-agent-group-remarks').val(group ? group.remarks || '' : '');
        caSelectedAgents = ((group && group.agents) || []).map(function (a) {
            return { agent_id: a.agent_id, label: a.label || String(a.agent_id) };
        });
        loadGroupAgentOptions().then(function () {
            var $modal = $('#modal-gi-agent-group').appendTo('body');
            $modal.off('shown.bs.modal.caGroups').on('shown.bs.modal.caGroups', function () {
                renderGroupLineOptions(getGroupMembersLineId(caSelectedAgents));
                refreshGroupAgentPicker();
                renderGroupSelectedAgents();
            });
            $modal.off('hidden.bs.modal.caGroups').on('hidden.bs.modal.caGroups', destroyGroupAgentPicker);
            bootstrap.Modal.getOrCreateInstance($modal[0]).show();
        });
    }

    function closeGroupModal() {
        var inst = bootstrap.Modal.getInstance($('#modal-gi-agent-group')[0]);
        if (inst) inst.hide();
        $('#form-gi-agent-group')[0].reset();
        caSelectedAgents = [];
        renderGroupSelectedAgents();
        caEditingGroupId = null;
    }

    function saveGroup() {
        var groupName = String($('#gi-agent-group-name').val() || '').trim();
        var agentIds = caSelectedAgents.map(function (a) { return a.agent_id; });
        if (!groupName) return;
        if (!agentIds.length) {
            Swal.fire({ icon: 'warning', title: 'Select at least one agent.' });
            return;
        }
        var editing = caEditingGroupId;
        $.ajax({
            url: editing ? '/categorize_group_groups/' + editing : '/categorize_group_groups',
            method: editing ? 'PUT' : 'POST',
            data: { groupName: groupName, agentIds: agentIds, remarks: String($('#gi-agent-group-remarks').val() || '').trim() }
        }).done(function (res) {
            closeGroupModal();
            caSelectedGroupId = String(editing || (res && res.group_id) || '');
            loadAgentGroups().then(applyGroupFilter);
            Swal.fire({ icon: 'success', title: editing ? 'Updated' : 'Saved', timer: 1500, showConfirmButton: false });
        }).fail(function (xhr) {
            var msg = (xhr.responseJSON && xhr.responseJSON.error) || 'Failed to save';
            Swal.fire({ icon: 'error', title: 'Error', text: msg });
        });
    }

    function deleteSelectedGroup() {
        var group = getSelectedGroup();
        if (!group) return;
        Swal.fire({
            title: 'Delete group "' + group.group_name + '"?',
            icon: 'warning',
            showCancelButton: true,
            confirmButtonColor: '#3085d6',
            cancelButtonColor: '#d33',
            confirmButtonText: 'Yes'
        }).then(function (result) {
            if (!result.isConfirmed) return;
            $.ajax({ url: '/categorize_group_groups/remove/' + group.group_id, method: 'PUT' }).done(function () {
                caSelectedGroupId = '';
                loadAgentGroups().then(applyGroupFilter);
                Swal.fire({ icon: 'success', title: 'Deleted', timer: 1500, showConfirmButton: false });
            }).fail(function (xhr) {
                var msg = (xhr.responseJSON && xhr.responseJSON.error) || 'Failed to delete';
                Swal.fire({ icon: 'error', title: 'Error', text: msg });
            });
        });
    }

    // Remarks: click the cell to open the shared remarks modal (remarks_editor.js)
    $(document).on('click', '#ca-groups-tbl td.ca-group-remarks.is-editable', function (e) {
        e.stopPropagation();
        if (!window.RemarksEditor) return;
        var gid = String($(this).data('group-id'));
        var group = caGroups.find(function (g) { return String(g.group_id) === gid; });
        if (!group) return;
        window.RemarksEditor.openEditor(group.remarks || '', function (value) {
            window.RemarksEditor.patchRemarks('gi_agent_group', gid, value, {
                onSuccess: function (res) {
                    group.remarks = (res && res.remarks != null) ? String(res.remarks) : value;
                    renderGroupFilterOptions();
                },
                onError: function (err) {
                    Swal.fire({ icon: 'error', title: 'Error', text: (err && err.message) || 'Could not update remarks.' });
                }
            });
        });
    });

    // Click a group to filter the table; click it again to show all agents
    $(document).on('click', '#ca-groups-tbl tr.ca-group-row', function (e) {
        if ($(e.target).closest('.ca-group-agent-item, .ca-group-count, td.ca-group-remarks.is-editable').length) return;
        var gid = String($(this).data('group-id'));
        selectGroup(gid === caSelectedGroupId ? '' : gid);
    });

    // Click the agent count to show/hide that group's agent list
    $(document).on('click', '#ca-groups-tbl .ca-group-count', function (e) {
        e.stopPropagation();
        var gid = String($(this).data('group-id'));
        if (caExpandedGroups[gid]) delete caExpandedGroups[gid];
        else caExpandedGroups[gid] = true;
        renderGroupFilterOptions();
    });

    // Select all / clear all agents in that group's list
    $(document).on('change', '#ca-groups-tbl .ca-group-agent-check-all', function () {
        var gid = String($(this).data('group-id'));
        var group = caGroups.find(function (g) { return String(g.group_id) === gid; });
        if (!group) return;
        caCheckedByGroup[gid] = {};
        if (this.checked) {
            (group.agents || []).forEach(function (a) { caCheckedByGroup[gid][String(a.agent_id)] = true; });
        }
        selectGroup(gid);
    });

    // Check agents to show only them; none checked = the whole group
    $(document).on('change', '#ca-groups-tbl .ca-group-agent-check', function () {
        var gid = String($(this).data('group-id'));
        var aid = String($(this).data('agent-id'));
        if (!caCheckedByGroup[gid]) caCheckedByGroup[gid] = {};
        if (this.checked) caCheckedByGroup[gid][aid] = true;
        else delete caCheckedByGroup[gid][aid];
        selectGroup(gid);
    });

    $('#btn-ca-group-new').on('click', function () {
        if (isViewOnly()) return;
        openGroupModal(null);
    });

    $('#btn-ca-group-edit').on('click', function () {
        if (isViewOnly()) return;
        var group = getSelectedGroup();
        if (group) openGroupModal(group);
    });

    $('#btn-ca-group-delete').on('click', function () {
        if (isViewOnly()) return;
        deleteSelectedGroup();
    });

    $('#form-gi-agent-group').on('submit', function (e) {
        e.preventDefault();
        if (isViewOnly()) return;
        saveGroup();
    });

    $('#gi-agent-group-line').on('change', function () {
        refreshGroupAgentPicker();
    });

    $('#gi-agent-group-agent-picker').on('change', function () {
        var val = $(this).val();
        if (!val) return;
        var opt = (caAgentOptions || []).find(function (o) { return String(o.id) === String(val); });
        if (!opt) return;
        caSelectedAgents.push({ agent_id: opt.id, label: opt.label });
        refreshGroupAgentPicker();
        renderGroupSelectedAgents();
    });

    $(document).on('click', '#gi-agent-group-selected .gi-agent-chip-remove', function () {
        var id = String($(this).data('id'));
        caSelectedAgents = caSelectedAgents.filter(function (a) { return String(a.agent_id) !== id; });
        refreshGroupAgentPicker();
        renderGroupSelectedAgents();
    });

    var NGR_WINLOSS_SHARE = 0.65;

    function buildSortedAgentRowsFromState() {
        var rows = Object.keys(drilldownState.agents || {}).map(function (k) {
            var item = drilldownState.agents[k];
            // NGR = Win/Loss × 65% + Total Settlement (−commission + Add Charge)
            item.ngr = Math.round((Number(item.winLoss) || 0) * NGR_WINLOSS_SHARE + getAgentTotalSettlement(item));
            return item;
        }).filter(agentMatchesCompareFilter).filter(agentMatchesGroupFilter);
        drilldownState.groupRows = {};
        if (caGroupedOnly && !getSelectedGroup()) rows = buildGroupTotalRows(rows);
        return sortAgentRowsForRanking(rows);
    }

    // "Categorize Group" tab with no group picked: one row per group, summed over its agents
    function buildGroupTotalRows(agentRows) {
        var byId = {};
        agentRows.forEach(function (a) { byId[String(a.key)] = a; });
        var out = [];
        caGroups.forEach(function (g) {
            var members = (g.agents || []).map(function (m) { return byId[String(m.agent_id)]; }).filter(Boolean);
            var row = {
                key: 'group:' + g.group_id,
                groupId: String(g.group_id),
                name: g.group_name,
                totalBuyIn: 0,
                totalChipsReturn: 0,
                winLoss: 0,
                totalRolling: 0,
                commission: 0,
                fnb: 0,
                ngr: 0,
                transactions: []
            };
            members.forEach(function (a) {
                row.totalBuyIn += Number(a.totalBuyIn) || 0;
                row.totalChipsReturn += Number(a.totalChipsReturn) || 0;
                row.winLoss += Number(a.winLoss) || 0;
                row.totalRolling += Number(a.totalRolling) || 0;
                row.commission += Number(a.commission) || 0;
                row.fnb += Number(a.fnb) || 0;
                row.ngr += Number(a.ngr) || 0;
                row.transactions = row.transactions.concat(a.transactions || []);
            });
            drilldownState.groupRows[row.key] = row;
            out.push(row);
        });
        return out;
    }

    function findRankRow(key) {
        return (drilldownState.groupRows || {})[key] || drilldownState.agents[key];
    }

    function updateCompareModeBanner() {
        var $banner = $('#commission-analytics-compare-banner');
        if (!$banner.length) return;
        if (!drilldownState.compareFilter || !drilldownState.compareFilter.length) {
            $banner.addClass('d-none').empty();
            return;
        }
        $banner
            .removeClass('d-none')
            .html(
                '<span class="me-2"><i class="fa fa-check-square-o" aria-hidden="true"></i> Comparing:</span>' +
                drilldownState.compareFilter.map(function (code) {
                    return '<span class="badge bg-primary me-1">' + escapeHtml(code) + '</span>';
                }).join('') +
                ' <a href="/commission" class="ms-2 small">Change selection</a>'
            );
    }

    function getPanelTxnSortValue(row, key) {
        if (!row) return '';
        if (key === 'gameNo') return Number(row.gameNo) || 0;
        if (key === 'totalBuyIn') return Number(row.totalBuyIn) || 0;
        if (key === 'chipsReturn') return Number(row.chipsReturn) || 0;
        if (key === 'winLoss') return Number(row.winLoss) || 0;
        if (key === 'totalRolling') return Number(row.totalRolling) || 0;
        if (key === 'rollingRate') return Number(row.rollingRate) || 0;
        if (key === 'settlement') return Number(row.settlement) || 0;
        if (key === 'fnb') return Number(row.fnb) || 0;
        if (key === 'payment') return Number(row.payment) || 0;
        if (key === 'dateTime') return parseSortDate(row.dateTime);
        return '';
    }

    function renderPanelTxnSortIndicators() {
        var key = drilldownState.panelTxnSortKey || 'dateTime';
        var dir = drilldownState.panelTxnSortDir === 'asc' ? 'asc' : 'desc';
        $('#commission-panel-modal-head-table thead th.commission-sortable-col').each(function () {
            var $th = $(this);
            var thKey = $th.attr('data-sort-key');
            $th.removeClass('sorting sorting_asc sorting_desc')
                .addClass(thKey === key ? (dir === 'asc' ? 'sorting_asc' : 'sorting_desc') : 'sorting');
        });
    }

    function applyPanelTxnColumnHighlight() {
        var key = drilldownState.panelTxnSortKey || 'dateTime';
        var colByKey = {
            gameNo: 1,
            totalBuyIn: 2,
            chipsReturn: 3,
            winLoss: 4,
            totalRolling: 5,
            rollingRate: 6,
            settlement: 7,
            fnb: 8,
            payment: 9,
            dateTime: 10
        };
        var col = colByKey[key] || 10;
        $('#commission-panel-modal-head-table th, #commission-panel-modal-body-table td, #commission-panel-modal-foot-table th')
            .removeClass('commission-panel-modal-col-active commission-panel-modal-col-active-header');
        $('#commission-panel-modal-head-table th:nth-child(' + col + ')')
            .addClass('commission-panel-modal-col-active commission-panel-modal-col-active-header');
        $('#commission-panel-modal-body-table td:nth-child(' + col + '), #commission-panel-modal-foot-table th:nth-child(' + col + ')')
            .addClass('commission-panel-modal-col-active');
    }

    function syncPanelModalTableGutter() {
        var $wrap = $('#modal-commission-panel-transactions .commission-guest-table-wrap');
        if (!$wrap.length) return;
        var el = $wrap.get(0);
        var gutter = Math.max(0, el.offsetWidth - el.clientWidth);
        $('#commission-panel-modal-head-table, #commission-panel-modal-foot-table').css('margin-right', gutter + 'px');
    }

    function renderRankTable(agentRows) {
        var metricOrder = getRankingMetricColumnOrder();
        var groupMode = caGroupedOnly && !getSelectedGroup();
        $('#commission-panel-tbl thead th').eq(1).html(groupMode ? 'Group Name' : 'Acc &amp; Name');
        rankTable.clear();
        (agentRows || []).forEach(function (row, idx) {
            var key = encodeURIComponent(row.key);
            var nameLink = '<a href="#" class="js-open-agent-modal" data-agent-key="' + key + '">' + escapeHtml(row.name) + '</a>';
            var rowData = [
                idx + 1,
                nameLink
            ];
            metricOrder.forEach(function (metricKey) {
                var value = getAgentRankingSortValue(row, metricKey);
                rowData.push(formatAmountHtml(value));
            });
            rowData.push('<div class="gi-manual-actions">' +
                '<button type="button" class="btn btn-sm btn-alt-secondary js-ca-receipt" data-agent-key="' + key + '" title="Receipt" aria-label="Receipt">' +
                '<i class="fa fa-receipt"></i></button></div>');
            rankTable.row.add(rowData);
        });
        rankTable.draw();
        renderRankingSortIndicators();
        applyRankingMetricCellClasses();
        applyRankingColumnHighlight();
    }

    function renderModal(agent) {
        drilldownState.panelModalAgentKey = agent && agent.key != null ? String(agent.key) : null;
        var sortKey = drilldownState.panelTxnSortKey || 'dateTime';
        var sortDir = drilldownState.panelTxnSortDir === 'asc' ? 'asc' : 'desc';
        var txns = (agent.transactions || []).slice().sort(function (a, b) {
            var av = getPanelTxnSortValue(a, sortKey);
            var bv = getPanelTxnSortValue(b, sortKey);
            if (av < bv) return sortDir === 'asc' ? -1 : 1;
            if (av > bv) return sortDir === 'asc' ? 1 : -1;
            return 0;
        });
        var totals = {
            buyIn: 0,
            chipsReturn: 0,
            winLoss: 0,
            rolling: 0,
            settlement: 0,
            fnb: 0,
            payment: 0
        };

        var body = txns.length === 0
            ? '<tr><td colspan="10" class="text-center text-muted">No transactions found.</td></tr>'
            : txns.map(function (t) {
                totals.buyIn += Number(t.totalBuyIn) || 0;
                totals.chipsReturn += Number(t.chipsReturn) || 0;
                totals.winLoss += Number(t.winLoss) || 0;
                totals.rolling += Number(t.totalRolling) || 0;
                totals.settlement += Number(t.settlement) || 0;
                totals.fnb += Number(t.fnb) || 0;
                totals.payment += Number(t.payment) || 0;
                return [
                    '<tr>',
                    '<td>' + t.gameNo + '</td>',
                    '<td class="text-end">' + formatAmountHtml(t.totalBuyIn) + '</td>',
                    '<td class="text-end">' + formatAmountHtml(t.chipsReturn) + '</td>',
                    '<td class="text-end">' + formatAmountHtml(t.winLoss) + '</td>',
                    '<td class="text-end">' + formatAmountHtml(t.totalRolling) + '</td>',
                    '<td class="text-end">' + formatRate(t.rollingRate) + '</td>',
                    '<td class="text-end">' + formatAmountHtml(t.settlement) + '</td>',
                    '<td class="text-end">' + formatAmountHtml(t.fnb) + '</td>',
                    '<td class="text-end">' + formatAmountHtml(t.payment) + '</td>',
                    '<td>' + t.dateTime + '</td>',
                    '</tr>'
                ].join('');
            }).join('');

        $('#commission-panel-modal-body').html(body);
        $('#commission-panel-modal-subtitle').text(agent.name);
        $('#commission-panel-modal-count').text(txns.length + ' transaction(s)');
        $('#commission-panel-total-buyin').html(formatAmountHtml(totals.buyIn));
        $('#commission-panel-total-return').html(formatAmountHtml(totals.chipsReturn));
        $('#commission-panel-total-winloss')
            .html(formatAmountHtml(totals.winLoss, true))
            .attr('style', '');
        $('#commission-panel-total-rolling').html(formatAmountHtml(totals.rolling));
        $('#commission-panel-total-settlement').html(formatAmountHtml(totals.settlement));
        $('#commission-panel-total-fnb').html(formatAmountHtml(totals.fnb));
        $('#commission-panel-total-payment').html(formatAmountHtml(totals.payment));
        syncPanelModalTableGutter();
        renderPanelTxnSortIndicators();
        applyPanelTxnColumnHighlight();
        $('#modal-commission-panel-transactions').modal('show');
    }

    $('#modal-commission-panel-transactions').on('shown.bs.modal', function () {
        syncPanelModalTableGutter();
        applyPanelTxnColumnHighlight();
    });

    $(window).on('resize', function () {
        if ($('#modal-commission-panel-transactions').hasClass('show')) {
            syncPanelModalTableGutter();
            applyPanelTxnColumnHighlight();
        }
    });

    function loadRankingData() {
        var start;
        var end;

        if (commissionPanelSplitOverrideRange && commissionPanelSplitOverrideRange.start && commissionPanelSplitOverrideRange.end) {
            start = commissionPanelSplitOverrideRange.start;
            end = commissionPanelSplitOverrideRange.end;
        } else {
            var dateRange = getCommissionPanelDateRangeValue();
            if (!dateRange) return;

            if (window.MonthEndCutoffRange && typeof window.MonthEndCutoffRange.parseRangeToApiDates === 'function') {
                var apiRange = window.MonthEndCutoffRange.parseRangeToApiDates(dateRange);
                start = apiRange.start;
                end = apiRange.end;
            } else if (dateRange.includes(' to ')) {
                var parts = dateRange.split(' to ');
                start = parts[0];
                end = parts[1];
            } else {
                start = dateRange;
                end = dateRange;
            }
        }

        $.ajax({
            url: '/commission_data',
            method: 'GET',
            data: { start: start, end: end }
        }).done(function (games) {
            var settledGames = (games || []).filter(function (g) { return Number(g.SETTLED) === 1; });
            if (settledGames.length === 0) {
                drilldownState.agents = {};
                renderRankTable([]);
                return;
            }

            var requests = settledGames.map(function (game) {
                return $.ajax({
                    url: '/game_list/' + game.game_list_id + '/record',
                    method: 'GET'
                }).then(function (records) {
                    var totals = computeGameTotals(records);
                    var rollingRate = Number(game.COMMISSION_PERCENTAGE) || 0;
                    var settlement = createSettlement(Number(game.COMMISSION_TYPE), rollingRate, totals, game);
                    var fnb = Number(game.fnb) || 0;
                    var payment = Math.round(settlement - fnb);
                    var agentCode = game.agent_code || '-';
                    var agentName = game.agent_name || '-';
                    return {
                        key: String(game.agent_id || game.ACCOUNT_ID || agentCode + '-' + agentName),
                        agentCode: agentCode,
                        name: agentCode + ' - ' + agentName,
                        txn: {
                            gameNo: game.game_list_id,
                            totalBuyIn: totals.totalAmount,
                            chipsReturn: totals.chipsReturn,
                            winLoss: totals.winLoss,
                            totalRolling: totals.totalRolling,
                            rollingRate: rollingRate,
                            settlement: settlement,
                            fnb: fnb,
                            payment: payment,
                            dateTime: moment.utc(game.GAME_ENDED).utcOffset(8).format('YYYY-MM-DD HH:mm')
                        }
                    };
                });
            });

            Promise.all(requests).then(function (rows) {
                var agentMap = {};
                rows.forEach(function (r) {
                    if (!agentMap[r.key]) {
                        agentMap[r.key] = {
                            key: r.key,
                            agentCode: r.agentCode,
                            name: r.name,
                            totalBuyIn: 0,
                            totalChipsReturn: 0,
                            winLoss: 0,
                            totalRolling: 0,
                            commission: 0,
                            fnb: 0,
                            ngr: 0,
                            transactions: []
                        };
                    }
                    var a = agentMap[r.key];
                    a.totalBuyIn += Number(r.txn.totalBuyIn) || 0;
                    a.totalChipsReturn += Number(r.txn.chipsReturn) || 0;
                    a.winLoss += Number(r.txn.winLoss) || 0;
                    a.totalRolling += Number(r.txn.totalRolling) || 0;
                    a.commission += Number(r.txn.settlement) || 0;
                    a.fnb += Number(r.txn.fnb) || 0;
                    a.transactions.push(r.txn);
                });

                drilldownState.agents = agentMap;
                updateCompareModeBanner();
                renderRankTable(buildSortedAgentRowsFromState());
            });
        }).fail(function () {
            drilldownState.agents = {};
            updateCompareModeBanner();
            renderRankTable([]);
        });
    }

    $(document).on('click', '#commission-panel-tbl thead th.commission-rank-sortable', function () {
        var key = $(this).attr('data-rank-key') || 'commission';
        if (drilldownState.rankingSortKey === key) {
            drilldownState.rankingSortDir = drilldownState.rankingSortDir === 'asc' ? 'desc' : 'asc';
        } else {
            drilldownState.rankingSortKey = key;
            drilldownState.rankingSortDir = 'desc';
        }
        renderRankTable(buildSortedAgentRowsFromState());
    });

    $('#btn-commission-analytics-export').on('click', function (e) {
        e.preventDefault();
        if (!$.fn.DataTable.isDataTable('#commission-panel-tbl')) return;

        var payload = getCommissionAnalyticsTablePayload();
        var headers = payload.headers;
        var rows = payload.rows;

        if (rows.length === 0) {
            notifyNoCommissionAnalyticsRows('Export');
            return;
        }

        if (payload.totalRow) rows = rows.concat([payload.totalRow]);

        var outName = getCommissionAnalyticsExportFilename();
        var $btn = $(this);
        downloadCommissionXlsx(headers, rows, outName, $btn, 'commissionAnalytics');
    });

    // ── Copy Image: the full ranking table (all filtered rows) as a PNG on the clipboard ──
    var CA_HTML2CANVAS_SRC = 'https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.min.js';
    var caHtml2CanvasPromise = null;

    function loadCaHtml2Canvas() {
        if (typeof html2canvas !== 'undefined') return Promise.resolve();
        if (caHtml2CanvasPromise) return caHtml2CanvasPromise;
        caHtml2CanvasPromise = new Promise(function (resolve, reject) {
            var script = document.createElement('script');
            script.src = CA_HTML2CANVAS_SRC;
            script.onload = function () { resolve(); };
            script.onerror = function () {
                caHtml2CanvasPromise = null;
                reject(new Error('Failed to load the image library.'));
            };
            document.head.appendChild(script);
        });
        return caHtml2CanvasPromise;
    }

    function buildCommissionAnalyticsImageNode(payload) {
        var group = getSelectedGroup();
        var cell = 'padding:8px 14px;border-bottom:1px solid #eee;white-space:nowrap;';
        var head = payload.headers.map(function (h, i) {
            var align = i === 0 ? 'center' : (i === 1 ? 'left' : 'right');
            return '<th style="' + cell + 'text-align:' + align + ';background:#f5f5f5;color:#555;font-weight:600;border-bottom:1px solid #e0e0e0;">' + escapeHtml(h) + '</th>';
        }).join('');
        var body = payload.rows.map(function (row, r) {
            var bg = r % 2 ? '#f4f1ea' : '#ffffff';
            return '<tr style="background:' + bg + ';">' + row.map(function (v, i) {
                var align = i === 0 ? 'center' : (i === 1 ? 'left' : 'right');
                var color = i === 1 ? '#8a6d1f;font-weight:600' : (/^\(/.test(String(v)) ? '#dc2626' : '#495057');
                return '<td style="' + cell + 'text-align:' + align + ';color:' + color + ';">' + escapeHtml(v) + '</td>';
            }).join('') + '</tr>';
        }).join('');
        if (payload.totalRow) {
            body += '<tr style="background:#f5f5f5;">' + payload.totalRow.map(function (v, i) {
                var align = i === 0 ? 'center' : (i === 1 ? 'left' : 'right');
                var color = /^\(/.test(String(v)) ? '#dc2626' : '#3a2e12';
                return '<td style="' + cell + 'text-align:' + align + ';color:' + color + ';font-weight:700;border-top:1px solid #e0e0e0;">' + escapeHtml(v) + '</td>';
            }).join('') + '</tr>';
        }

        var node = document.createElement('div');
        node.style.cssText = 'position:fixed;left:-10000px;top:0;background:#ffffff;padding:18px 20px;' +
            'font-family:' + window.getComputedStyle(document.body).fontFamily + ';font-size:14px;';
        node.innerHTML =
            '<div style="font-size:18px;font-weight:700;color:#3a2e12;text-align:center;">Analytics</div>' +
            ((group || caGroupedOnly) ? '<div style="font-size:15px;font-weight:700;color:#3a2e12;text-align:center;margin-top:2px;">' + escapeHtml(group ? group.group_name : 'Categorize Group') + '</div>' : '') +
            '<div style="font-size:13px;color:#666;text-align:center;margin:2px 0 12px;">' + escapeHtml(getCommissionPanelDateRangeLabel()) + '</div>' +
            '<table style="border-collapse:collapse;border:1px solid #e0e0e0;"><thead><tr>' + head + '</tr></thead><tbody>' + body + '</tbody></table>';
        return node;
    }

    function renderCommissionAnalyticsImageBlob(payload) {
        return loadCaHtml2Canvas().then(function () {
            var node = buildCommissionAnalyticsImageNode(payload);
            document.body.appendChild(node);
            return html2canvas(node, { backgroundColor: '#ffffff', scale: 2, useCORS: true, logging: false })
                .then(function (canvas) {
                    node.parentNode.removeChild(node);
                    return new Promise(function (resolve, reject) {
                        canvas.toBlob(function (blob) {
                            if (blob) resolve(blob);
                            else reject(new Error('Could not build the image.'));
                        }, 'image/png');
                    });
                }, function (err) {
                    if (node.parentNode) node.parentNode.removeChild(node);
                    throw err;
                });
        });
    }

    $('#btn-commission-analytics-copy-image').on('click', function (e) {
        e.preventDefault();
        var btn = this;
        if (btn.disabled) return;
        var payload = getCommissionAnalyticsTablePayload();
        if (!payload.rows.length) {
            notifyNoCommissionAnalyticsRows('Copy Image');
            return;
        }
        var originalHtml = btn.innerHTML;
        btn.disabled = true;
        btn.innerHTML = '<i class="fa fa-spinner fa-spin" aria-hidden="true"></i> Copying...';
        var restore = function () { btn.disabled = false; btn.innerHTML = originalHtml; };
        var ok = function (text) { Swal.fire({ icon: 'success', title: 'Copied', text: text, timer: 1800, showConfirmButton: false }); };
        var fail = function (err) { Swal.fire({ icon: 'error', title: 'Copy failed', text: (err && err.message) || 'Unable to copy the image.' }); };

        if (navigator.clipboard && typeof ClipboardItem !== 'undefined') {
            navigator.clipboard.write([new ClipboardItem({ 'image/png': renderCommissionAnalyticsImageBlob(payload) })])
                .then(function () { ok('Table image copied to clipboard.'); })
                .catch(fail)
                .finally(restore);
        } else {
            renderCommissionAnalyticsImageBlob(payload)
                .then(function (blob) {
                    var link = document.createElement('a');
                    link.href = URL.createObjectURL(blob);
                    link.download = getCommissionAnalyticsExportFilename().replace(/\.xlsx$/, '.png');
                    document.body.appendChild(link);
                    link.click();
                    document.body.removeChild(link);
                    URL.revokeObjectURL(link.href);
                    ok('Image downloaded.');
                })
                .catch(fail)
                .finally(restore);
        }
    });

    $('#btn-commission-analytics-print').on('click', function (e) {
        e.preventDefault();
        printCommissionAnalyticsTable();
    });

    $('#btn-commission-panel-modal-export').on('click', function (e) {
        e.preventDefault();
        var payload = getCommissionPanelModalExportPayload();
        if (payload.rows.length === 0) {
            notifyNoCommissionPanelModalRows('Export');
            return;
        }
        downloadCommissionXlsx(payload.headers, payload.rows, getCommissionPanelModalExportFilename(), $(this), 'commissionPanelModal');
    });

    $('#btn-commission-panel-modal-print').on('click', function (e) {
        e.preventDefault();
        printCommissionPanelModalTable();
    });

    // Receipt: same card as Game Information, with the account's totals for the selected range
    $(document).on('click', '#commission-panel-tbl .js-ca-receipt', function (e) {
        e.preventDefault();
        if (!window.GameInfoReceipt) return;
        var agent = findRankRow(decodeURIComponent($(this).attr('data-agent-key') || ''));
        if (!agent) return;
        var row = window.GameInfoReceipt.row;
        var games = (agent.transactions || []).length;
        window.GameInfoReceipt.open({
            header: '* Analytics *',
            date_label: caLocalYmd(new Date()).replace(/-/g, '/'), // date the receipt was opened (same format as Game Information)
            agent_code: agent.name,
            game_line: games + (games === 1 ? ' GAME' : ' GAMES'),
            sections: [
                { cls: 'gsr-section-buyin', rows: [row('* BUY IN', agent.totalBuyIn)] },
                { cls: 'gsr-section-cashout', rows: [row('* CASH OUT', -Math.abs(Number(agent.totalChipsReturn) || 0))] },
                { cls: 'gsr-section-summary', rows: [
                    row('* WIN/LOSS', agent.winLoss, '', '* WIN / LOSS'),
                    row('* ROLLING', agent.totalRolling)
                ] },
                { cls: 'gsr-section-settlement', rows: [
                    row('* SETTLEMENT', -(Number(agent.commission) || 0), 'gsr-settle-row'),
                    row('* ADD CHARGE', agent.fnb, 'gsr-charge-row'),
                    row('* PAYMENT', getAgentTotalSettlement(agent), 'gsr-act-row')
                ] }
            ]
        });
    });

    $(document).on('click', '.js-open-agent-modal', function (e) {
        e.preventDefault();
        var key = decodeURIComponent($(this).attr('data-agent-key') || '');
        var agent = findRankRow(key);
        if (!agent) return;
        drilldownState.panelTxnSortKey = 'dateTime';
        drilldownState.panelTxnSortDir = 'desc';
        renderModal(agent);
    });

    $(document).on('click', '#commission-panel-modal-head-table thead th.commission-sortable-col', function () {
        var key = $(this).attr('data-sort-key') || 'dateTime';
        if (drilldownState.panelTxnSortKey === key) {
            drilldownState.panelTxnSortDir = drilldownState.panelTxnSortDir === 'asc' ? 'desc' : 'asc';
        } else {
            drilldownState.panelTxnSortKey = key;
            drilldownState.panelTxnSortDir = key === 'dateTime' ? 'desc' : 'asc';
        }
        var agentKey = drilldownState.panelModalAgentKey;
        if (!agentKey) {
            renderPanelTxnSortIndicators();
            return;
        }
        var agent = findRankRow(agentKey);
        if (!agent) return;
        renderModal(agent);
    });

    var commissionPanelSkipMonthRange = false;

    function applyFullMonthRangeForVisibleLeft(instance) {
        if (!instance || instance.config.mode !== 'range') return;
        var y = instance.currentYear;
        var m = instance.currentMonth;
        var dim = instance.utils.getDaysInMonth(m, y);
        var start = new Date(y, m, 1);
        var end = new Date(y, m, dim);
        commissionPanelSplitOverrideRange = null;
        instance.setDate([start, end], false);
        loadRankingData();
    }

    var commissionPanelRangeConfig = {
        mode: 'range',
        showMonths: 3,
        onReady: function (selectedDates, dateStr, instance) {
            if (typeof window.setupFlatpickrMonthNameRangeSelect === 'function') {
                window.setupFlatpickrMonthNameRangeSelect(instance);
            }
        },
        onOpen: function (selectedDates, dateStr, instance) {
            if (typeof window.setupFlatpickrMonthNameRangeSelect === 'function') {
                window.setupFlatpickrMonthNameRangeSelect(instance);
            }
        },
        onMonthChange: function (selectedDates, dateStr, instance) {
            if (typeof window.styleFlatpickrMonthNameClickable === 'function') {
                window.styleFlatpickrMonthNameClickable(instance);
            }
            if (commissionPanelSkipMonthRange) return;
            clearCaQuickFilter();
            applyFullMonthRangeForVisibleLeft(instance);
        },
        onClose: function (selectedDates) {
            if (selectedDates.length === 2) {
                commissionPanelSplitOverrideRange = null;
                clearCaQuickFilter();
                loadRankingData();
            }
        }
    };
    if (compareStartFromUrl && compareEndFromUrl) {
        commissionPanelRangeConfig.defaultDate = [compareStartFromUrl, compareEndFromUrl];
        caQuickFilter = null;
    }
    syncCaQuickFilterTabs();
    flatpickr('#commission-panel-daterange', commissionPanelRangeConfig);
    if (window.MonthEndCutoffRange && typeof window.MonthEndCutoffRange.fitRangePickerInstance === 'function') {
        var panelDr = document.getElementById('commission-panel-daterange');
        if (panelDr && panelDr._flatpickr) {
            setTimeout(function () {
                window.MonthEndCutoffRange.fitRangePickerInstance(panelDr._flatpickr);
            }, 0);
        }
    }

    updateCompareModeBanner();
    loadAgentGroups();
    loadRankingData();

    // Amount digits line up right-to-left; the ")" of a negative hangs right (num_paren_align.js)
    if (window.gdAlignParenNumbers) {
        window.gdAlignParenNumbers('.commission-analytics-page', ['#commission-panel-tbl tbody td:nth-child(n+3)', '#commission-panel-tbl tfoot th:nth-child(n+3)']);
        window.gdAlignParenNumbers('#modal-commission-panel-transactions', ['td.text-end', 'tfoot th.text-end']);
    }
});

