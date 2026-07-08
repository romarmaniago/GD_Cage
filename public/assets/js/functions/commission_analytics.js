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

    function createSettlement(commissionType, rollingRate, totals) {
        if (commissionType == 1 || commissionType == 3) {
            return Math.round((Number(totals.totalRolling) || 0) * (rollingRate / 100));
        }
        if (commissionType == 2) {
            return Math.round((Number(totals.winLoss) || 0) * (rollingRate / 100));
        }
        return 0;
    }

    function placeCommissionPanelDateFilter() {
        var $mount = $('#commission-panel-daterange-mount');
        var $length = $('#commission-panel-tbl').closest('.dataTables_wrapper').find('.dataTables_length').first();
        if (!$mount.length || !$length.length) return;
        if ($mount.data('placed')) return;
        $mount.detach().insertAfter($length).addClass('is-placed').data('placed', true);
        if (window.MonthEndCutoffRange && typeof window.MonthEndCutoffRange.fitRangePickerInstance === 'function') {
            var el = document.getElementById('commission-panel-daterange');
            if (el && el._flatpickr) {
                window.MonthEndCutoffRange.fitRangePickerInstance(el._flatpickr);
            }
        }
    }

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

    function getCommissionPanelDateRangeLabel() {
        var el = document.getElementById('commission-panel-daterange');
        if (el && el._flatpickr && el._flatpickr.altInput && el._flatpickr.altInput.value) {
            return el._flatpickr.altInput.value.trim();
        }
        return getCommissionPanelDateRangeValue();
    }

    var rankTable = $('#commission-panel-tbl').DataTable({
        ordering: false,
        pageLength: 25,
        columnDefs: [
            { targets: 0, className: 'text-center' },
            { targets: [2, 3, 4, 5, 6, 7], className: 'text-end' }
        ],
        drawCallback: function () {
            placeCommissionPanelDateFilter();
        },
        language: {
            search: 'Search:',
            info: 'Showing _START_ to _END_ of _TOTAL_ entries',
            paginate: { previous: 'Previous', next: 'Next' },
            emptyTable: 'No data available in table'
        }
    });

    placeCommissionPanelDateFilter();

    var urlParams = new URLSearchParams(window.location.search);
    var compareFilterFromUrl = (urlParams.get('compare') || '')
        .split(',')
        .map(function (s) { return s.trim().toUpperCase(); })
        .filter(Boolean);
    var compareStartFromUrl = urlParams.get('start') || '';
    var compareEndFromUrl = urlParams.get('end') || '';

    var drilldownState = {
        agents: {},
        rankingSortKey: 'commission',
        rankingSortDir: 'desc',
        panelTxnSortKey: 'dateTime',
        panelTxnSortDir: 'desc',
        panelModalAgentKey: null,
        compareFilter: compareFilterFromUrl.length ? compareFilterFromUrl : null
    };

    var RANKING_METRIC_KEYS = ['totalBuyIn', 'totalChipsReturn', 'winLoss', 'totalRolling', 'commission', 'ngr'];
    var RANKING_METRIC_LABELS = {
        totalBuyIn: 'Total Buy-In',
        totalChipsReturn: 'Total Chips Return',
        winLoss: 'Win/Loss',
        totalRolling: 'Total Rolling',
        commission: 'Commission',
        ngr: 'NGR'
    };

    function getRankingMetricColumnOrder() {
        var active = drilldownState.rankingSortKey || 'commission';
        return [active].concat(RANKING_METRIC_KEYS.filter(function (k) { return k !== active; }));
    }

    function getCommissionAnalyticsExportFilename() {
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

    function getCommissionAnalyticsTablePayload() {
        var headers = [];
        $('#commission-panel-tbl thead tr:first th').each(function () {
            headers.push($(this).clone().children().remove().end().text().trim());
        });

        var rows = [];
        rankTable.rows({ search: 'applied' }).every(function () {
            var data = this.data() || [];
            var cells = data.map(stripHtml);
            if (cells.length) rows.push(cells);
        });

        return { headers: headers, rows: rows };
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
        var agent = agentKey ? drilldownState.agents[agentKey] : null;
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
            '<!doctype html><html><head><title>Commission Analytics</title><style>',
            getCommissionAnalyticsPrintStyles(),
            '</style></head><body><div class="print-wrap">',
            '<h2>Commission Analytics</h2>',
            '<div class="subtitle">', escapeHtml(dateRange), '</div>',
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

    function getAgentRankingSortValue(row, key) {
        if (!row) return 0;
        if (key === 'totalBuyIn') return Number(row.totalBuyIn) || 0;
        if (key === 'totalChipsReturn') return Number(row.totalChipsReturn) || 0;
        if (key === 'winLoss') return Number(row.winLoss) || 0;
        if (key === 'totalRolling') return Number(row.totalRolling) || 0;
        if (key === 'commission') return Number(row.commission) || 0;
        if (key === 'ngr') return Number(row.ngr) || 0;
        return Number(row.commission) || 0;
    }

    function sortAgentRowsForRanking(rows) {
        var key = drilldownState.rankingSortKey || 'commission';
        var dir = drilldownState.rankingSortDir === 'asc' ? 'asc' : 'desc';
        return (rows || []).slice().sort(function (a, b) {
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
            var indicator = '-';
            if (thKey === key) indicator = dir === 'asc' ? '▲' : '▼';
            $th.attr('data-rank-key', thKey);
            $th.html((RANKING_METRIC_LABELS[thKey] || thKey) + ' <span class="commission-rank-sort-indicator">' + indicator + '</span>');
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

    function buildSortedAgentRowsFromState() {
        var rows = Object.keys(drilldownState.agents || {}).map(function (k) {
            var item = drilldownState.agents[k];
            item.ngr = (Number(item.winLoss) || 0) - (Number(item.commission) || 0);
            return item;
        }).filter(agentMatchesCompareFilter);
        return sortAgentRowsForRanking(rows);
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
            var indicator = '-';
            if (thKey === key) indicator = dir === 'asc' ? '▲' : '▼';
            $th.find('.commission-sort-indicator').text(indicator);
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
        rankTable.clear();
        (agentRows || []).forEach(function (row, idx) {
            var key = encodeURIComponent(row.key);
            var nameLink = '<a href="#" class="js-open-agent-modal" data-agent-key="' + key + '">' + row.name + '</a>';
            var rowData = [
                idx + 1,
                nameLink
            ];
            metricOrder.forEach(function (metricKey) {
                var value = getAgentRankingSortValue(row, metricKey);
                if (metricKey === 'ngr') {
                    rowData.push('<span style="' + signedColorStyle(value) + '">' + formatNumber(value) + '</span>');
                } else {
                    rowData.push(formatNumber(value));
                }
            });
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
                    '<td class="text-end">' + formatNumber(t.totalBuyIn) + '</td>',
                    '<td class="text-end">' + formatNumber(t.chipsReturn) + '</td>',
                    '<td class="text-end">' + formatNumber(t.winLoss) + '</td>',
                    '<td class="text-end">' + formatNumber(t.totalRolling) + '</td>',
                    '<td class="text-end">' + formatRate(t.rollingRate) + '</td>',
                    '<td class="text-end">' + formatNumber(t.settlement) + '</td>',
                    '<td class="text-end">' + formatNumber(t.fnb) + '</td>',
                    '<td class="text-end">' + formatNumber(t.payment) + '</td>',
                    '<td>' + t.dateTime + '</td>',
                    '</tr>'
                ].join('');
            }).join('');

        $('#commission-panel-modal-body').html(body);
        $('#commission-panel-modal-subtitle').text(agent.name);
        $('#commission-panel-modal-count').text(txns.length + ' transaction(s)');
        $('#commission-panel-total-buyin').text(formatNumber(totals.buyIn));
        $('#commission-panel-total-return').text(formatNumber(totals.chipsReturn));
        $('#commission-panel-total-winloss')
            .text(formatNumber(totals.winLoss))
            .attr('style', signedColorStyle(totals.winLoss));
        $('#commission-panel-total-rolling').text(formatNumber(totals.rolling));
        $('#commission-panel-total-settlement').text(formatNumber(totals.settlement));
        $('#commission-panel-total-fnb').text(formatNumber(totals.fnb));
        $('#commission-panel-total-payment').text(formatNumber(totals.payment));
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
        var dateRange = getCommissionPanelDateRangeValue();
        if (!dateRange) return;

        var start;
        var end;
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
                    var settlement = createSettlement(Number(game.COMMISSION_TYPE), rollingRate, totals);
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

        var outName = getCommissionAnalyticsExportFilename();
        var $btn = $(this);
        downloadCommissionXlsx(headers, rows, outName, $btn, 'commissionAnalytics');
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

    $(document).on('click', '.js-open-agent-modal', function (e) {
        e.preventDefault();
        var key = decodeURIComponent($(this).attr('data-agent-key') || '');
        var agent = drilldownState.agents[key];
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
        var agent = drilldownState.agents[agentKey];
        if (!agent) return;
        renderModal(agent);
    });

    var commissionPanelSkipMonthRange = false;

    function jumpCommissionPanelRangeToCurrentThreeMonths(instance) {
        if (!instance) return;
        var current = new Date();
        instance.jumpToDate(new Date(current.getFullYear(), current.getMonth() - 2, 1), false);
    }

    function applyFullMonthRangeForVisibleLeft(instance) {
        if (!instance || instance.config.mode !== 'range') return;
        var y = instance.currentYear;
        var m = instance.currentMonth;
        var dim = instance.utils.getDaysInMonth(m, y);
        var start = new Date(y, m, 1);
        var end = new Date(y, m, dim);
        instance.setDate([start, end], false);
        loadRankingData();
    }

    var commissionPanelRangeConfig = {
        mode: 'range',
        showMonths: 3,
        onReady: function (selectedDates, dateStr, instance) {
            commissionPanelSkipMonthRange = true;
            jumpCommissionPanelRangeToCurrentThreeMonths(instance);
            commissionPanelSkipMonthRange = false;
            if (typeof window.setupFlatpickrMonthNameRangeSelect === 'function') {
                window.setupFlatpickrMonthNameRangeSelect(instance);
            }
        },
        onOpen: function (selectedDates, dateStr, instance) {
            commissionPanelSkipMonthRange = true;
            jumpCommissionPanelRangeToCurrentThreeMonths(instance);
            commissionPanelSkipMonthRange = false;
            if (typeof window.setupFlatpickrMonthNameRangeSelect === 'function') {
                window.setupFlatpickrMonthNameRangeSelect(instance);
            }
        },
        onMonthChange: function (selectedDates, dateStr, instance) {
            if (typeof window.styleFlatpickrMonthNameClickable === 'function') {
                window.styleFlatpickrMonthNameClickable(instance);
            }
            if (commissionPanelSkipMonthRange) return;
            applyFullMonthRangeForVisibleLeft(instance);
        },
        onClose: function (selectedDates) {
            if (selectedDates.length === 2) loadRankingData();
        }
    };
    if (compareStartFromUrl && compareEndFromUrl) {
        commissionPanelRangeConfig.defaultDate = [compareStartFromUrl, compareEndFromUrl];
    }
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
    loadRankingData();
});

