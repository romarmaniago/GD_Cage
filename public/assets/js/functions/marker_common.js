/**
 * Shared marker (credits) logic for modal and marker history page.
 * Usage: MarkerCommon.init({ tableSelector: '#marker-tbl', ... });
 */
(function (window) {
    'use strict';

    var $ = window.jQuery;
    if (!$) return;

    var skipMarkerModalReload = false;

    var headerCreditState = {
        overallTotalIssue: null,
        overallCash: 0,
        overallGame: 0,
        ready: false,
        breakdown: [],
        creditStatusBreakdown: []
    };

    function cacheOverallHeaderTotals(cashCredit, gameCredit, breakdownList, totalIssue) {
        headerCreditState.overallCash = Number(cashCredit) || 0;
        headerCreditState.overallGame = Number(gameCredit) || 0;
        headerCreditState.breakdown = Array.isArray(breakdownList) ? breakdownList : [];
        if (totalIssue != null && totalIssue !== '') {
            headerCreditState.overallTotalIssue = Number(String(totalIssue).replace(/,/g, '')) || 0;
        } else if (headerCreditState.overallTotalIssue == null) {
            var fromInput = $('#txtTotalMarkerIssue').val();
            headerCreditState.overallTotalIssue = Number(String(fromInput || '0').replace(/,/g, '')) || 0;
        }
        headerCreditState.ready = true;
    }

    function applyHeaderCreditTotals(accountId) {
        var $totalIssue = $('#txtTotalMarkerIssue');
        var $cash = $('#txtTotalJunketCredit');
        var $game = $('#txtTotalGameCredit');
        if (!$totalIssue.length && !$cash.length && !$game.length) return;

        if (!accountId) {
            if (!headerCreditState.ready) return;
            if ($totalIssue.length) $totalIssue.val(formatMarkerHistoryAmount(headerCreditState.overallTotalIssue));
            if ($cash.length) $cash.val(formatMarkerHistoryAmount(headerCreditState.overallCash));
            if ($game.length) $game.val(formatMarkerHistoryAmount(headerCreditState.overallGame));
            renderCreditStatusBreakdownShortcut(null);
            return;
        }

        var row = (headerCreditState.breakdown || []).filter(function (a) {
            return String(a.ACCOUNT_ID) === String(accountId);
        })[0];
        var cash = row && row.BALANCE_CREDIT != null ? Number(row.BALANCE_CREDIT) : 0;
        var game = row && row.BALANCE_BUYIN != null ? Number(row.BALANCE_BUYIN) : 0;
        var total = row && row.TOTAL_AMOUNT != null ? Number(row.TOTAL_AMOUNT) : (cash + game);
        if ($totalIssue.length) $totalIssue.val(formatMarkerHistoryAmount(total));
        if ($cash.length) $cash.val(formatMarkerHistoryAmount(cash));
        if ($game.length) $game.val(formatMarkerHistoryAmount(game));
        renderCreditStatusBreakdownShortcut(accountId);
    }

    /** Credit Status List panel (sortable DataTable). */
    function formatCreditStatusShortcutAmount(value) {
        var n = Math.abs(Number(value) || 0);
        if (!n) return '0';
        if (window.fmtOut) return window.fmtOut(n);
        return '<span style="color:#dc3545 !important;">(' + formatMarkerHistoryAmount(n) + ')</span>';
    }

    function creditStatusTextOrDash(value) {
        return value != null && String(value).trim() !== '' ? String(value).trim() : '—';
    }

    function creditStatusTextColumn(data, type) {
        var v = creditStatusTextOrDash(data);
        return (type === 'sort' || type === 'type') ? v : escapeHtml(v);
    }

    function getMarkerUserPermissions() {
        var el = document.getElementById('user-role');
        if (!el) return 99;
        return parseInt(el.getAttribute('data-permissions') || el.dataset.permissions || '99', 10);
    }

    function isMarkerSuperAdmin() {
        var perms = getMarkerUserPermissions();
        return perms === 0;
    }

    function canEditMarkerRecords() {
        return getMarkerUserPermissions() !== 2;
    }

    function ensureCreditStatusDataTable() {
        var selector = '#marker-credit-status-breakdown-tbl';
        var $table = $(selector);
        if (!$table.length || typeof $.fn.DataTable === 'undefined') return null;
        if ($.fn.DataTable.isDataTable(selector)) return $table.DataTable();

        var translations = window.markerTranslations || {};
        return $table.DataTable({
            order: [[0, 'asc']],
            searching: true,
            paging: true,
            info: true,
            pageLength: 10,
            lengthMenu: [[10, 25, 50, -1], [10, 25, 50, 'All']],
            autoWidth: false,
            language: {
                info: translations.showing_entries || 'Showing _START_ to _END_ of _TOTAL_ entries',
                infoEmpty: translations.info_empty || 'Showing 0 to 0 of 0 entries',
                infoFiltered: translations.info_filtered || '(filtered from _MAX_ total entries)',
                lengthMenu: translations.length_menu || 'Show _MENU_ entries',
                search: translations.search || 'Search:',
                paginate: {
                    first: translations.first || 'First',
                    last: translations.last || 'Last',
                    previous: translations.previous || 'Previous',
                    next: translations.next || 'Next'
                },
                emptyTable: translations.no_data_available || 'No data available in table',
                zeroRecords: translations.no_data_available || 'No matching records found'
            },
            dom: '<"row g-0 gy-2 mb-2 align-items-center gap-3"<"col-12 col-md-auto"l><"col-12 col-md d-flex justify-content-end align-items-center"f>>rt<"row g-2 mt-2"<"col-12 col-md-6"i><"col-12 col-md-6"p>>',
            createdRow: function (rowEl, rowData) {
                if (!rowData || rowData.accountId == null || rowData.accountId === '') return;
                $(rowEl)
                    .attr('data-account-id', rowData.accountId)
                    .attr('data-agent-code', rowData.code || '')
                    .attr('data-agent-name', rowData.agent || '');
            },
            columns: [
                { data: 'code', defaultContent: '—', render: creditStatusTextColumn },
                { data: 'agent', defaultContent: '—', render: creditStatusTextColumn },
                { data: 'guest', defaultContent: '—', render: creditStatusTextColumn },
                {
                    data: 'amount',
                    defaultContent: 0,
                    className: 'text-end marker-total-col-amount',
                    render: function (data, type, row) {
                        var n = data != null ? Number(data) : 0;
                        if (isNaN(n)) n = 0;
                        if (type === 'sort' || type === 'type') return Math.abs(n);
                        return renderCreditRemainingCell(n, row && row.totalCredit);
                    }
                }
            ]
        });
    }

    /** Remaining-balance cell. On a partial payment (some credit already returned) it also
     *  shows a small "(total credit: …)" note above the larger remaining-balance amount. */
    function renderCreditRemainingCell(remaining, totalCredit) {
        var rem = Math.abs(Number(remaining) || 0);
        var tc = Number(totalCredit);
        var remainingHtml = '<span class="mcs-remaining-amt">' + formatCreditStatusShortcutAmount(rem) + '</span>';
        if (!isNaN(tc) && Math.round(Math.abs(tc)) > Math.round(rem)) {
            var label = (window.markerTranslations && window.markerTranslations.total_credit) || 'Total Credit';
            return '<span class="mcs-credit-note">(' + escapeHtml(label) + ': ' + formatMarkerHistoryAmount(Math.abs(tc)) + ')</span>' + remainingHtml;
        }
        return remainingHtml;
    }

    // Row click on the Credit Status breakdown → open that account's payment record (Agent Portal).
    $(document)
        .off('click.markerCreditStatusRow', '#marker-credit-status-breakdown-tbl tbody tr')
        .on('click.markerCreditStatusRow', '#marker-credit-status-breakdown-tbl tbody tr', function () {
            var $row = $(this);
            var accountId = $row.attr('data-account-id');
            if (!accountId) return;
            if (typeof window.account_details === 'function') {
                window.account_details(accountId, $row.attr('data-agent-code') || '', $row.attr('data-agent-name') || '');
            }
        });

    function renderCreditStatusBreakdownShortcut(filterAccountId) {
        var $table = $('#marker-credit-status-breakdown-tbl');
        var $grand = $('#marker-status-grand-display');
        if (!$table.length) return;

        var accountId = filterAccountId != null
            ? String(filterAccountId)
            : String($('#txtAccountMarker').val() || '').trim();
        var rows = headerCreditState.creditStatusBreakdown || [];
        if (accountId) {
            rows = rows.filter(function (row) {
                return String(row.ACCOUNT_ID) === accountId;
            });
        }

        var sum = 0;
        var data = (rows || []).map(function (row) {
            var amount = row.AMOUNT != null ? Number(row.AMOUNT) : 0;
            if (isNaN(amount)) amount = 0;
            var totalCredit = row.TOTAL_CREDIT != null ? Number(row.TOTAL_CREDIT) : amount;
            if (isNaN(totalCredit)) totalCredit = amount;
            sum += amount;
            return {
                accountId: row.ACCOUNT_ID != null ? String(row.ACCOUNT_ID) : '',
                code: creditStatusTextOrDash(row.AGENT_CODE),
                agent: creditStatusTextOrDash(row.AGENT_NAME),
                guest: creditStatusTextOrDash(row.GUEST_NAME),
                totalCredit: totalCredit,
                amount: amount
            };
        });

        if ($grand.length) $grand.html(formatCreditStatusShortcutAmount(sum));

        if (typeof $.fn.DataTable === 'undefined') {
            var html = data.map(function (r) {
                var attrs = r.accountId
                    ? ' data-account-id="' + escapeHtml(r.accountId) + '" data-agent-code="' + escapeHtml(r.code) + '" data-agent-name="' + escapeHtml(r.agent) + '"'
                    : '';
                return (
                    '<tr' + attrs + '>' +
                    '<td>' + escapeHtml(r.code) + '</td>' +
                    '<td>' + escapeHtml(r.agent) + '</td>' +
                    '<td>' + escapeHtml(r.guest) + '</td>' +
                    '<td class="text-end marker-total-col-amount">' + renderCreditRemainingCell(r.amount, r.totalCredit) + '</td>' +
                    '</tr>'
                );
            }).join('');
            $('#marker-credit-status-body').html(html);
            return;
        }

        var dt = ensureCreditStatusDataTable();
        if (!dt) return;
        dt.clear();
        if (data.length) dt.rows.add(data);
        dt.draw(false);
    }

    function formatWithCommas(value) {
        if (value === '' || value === null || value === undefined) return value;
        var num = Number(value);
        if (isNaN(num)) return value;
        return num.toLocaleString('en-US', { maximumFractionDigits: 2, minimumFractionDigits: 0 });
    }

    /** Strip letters/symbols from amount input; keep digits and one decimal (max 2 places). */
    function sanitizeAmountInput(raw) {
        var s = String(raw == null ? '' : raw).replace(/,/g, '').replace(/[^\d.]/g, '');
        var parts = s.split('.');
        if (parts.length > 1) {
            s = parts[0] + '.' + parts.slice(1).join('').slice(0, 2);
        }
        return s;
    }

    /** Marker history table: no trailing .00 for whole amounts */
    function formatMarkerHistoryAmount(value) {
        var n = value != null ? Number(value) : 0;
        if (isNaN(n)) return '0';
        var rounded = Math.round(n * 100) / 100;
        if (Math.abs(rounded - Math.round(rounded)) < 1e-9) {
            return Math.round(rounded).toLocaleString('en-US');
        }
        return rounded.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
    }

    /** Junket Credit + Buy-in thru Credit display as (x,xxx) red — same as buy-in/cash-out */
    function isMarkerCreditOutTransaction(row) {
        if (!row || row.TRANSACTION_INFO == null) return false;
        var transactionId = parseInt(String(row.TRANSACTION_INFO).split('-')[0], 10);
        return transactionId === 3 || transactionId === 10;
    }

    function formatMarkerHistoryAmountCell(value, row, type) {
        if (type === 'sort' || type === 'type') {
            var n = value != null ? Number(value) : 0;
            return isNaN(n) ? 0 : n;
        }
        if (isMarkerCreditOutTransaction(row)) {
            if (window.fmtOut) return window.fmtOut(value);
            var formatted = formatMarkerHistoryAmount(Math.abs(Number(value) || 0));
            if (formatted === '0') return '0';
            return '<span style="color:#dc3545 !important;">(' + formatted + ')</span>';
        }
        return formatMarkerHistoryAmount(value);
    }

    function sumTotalCreditTabAmount(rows) {
        var total = 0;
        if (!rows || !rows.length) return total;
        for (var i = 0; i < rows.length; i++) {
            var row = rows[i];
            var n = row && row.AMOUNT != null ? Number(row.AMOUNT) : 0;
            if (isNaN(n)) continue;
            total += isMarkerCreditOutTransaction(row) ? Math.abs(n) : n;
        }
        return total;
    }

    function formatTotalCreditTabSumHtml(total) {
        var n = Number(total) || 0;
        if (!n) return '0';
        var formatted = formatMarkerHistoryAmount(Math.abs(n));
        if (window.fmtOut) return window.fmtOut(Math.abs(n));
        return '<span style="color:#dc3545 !important;">(' + formatted + ')</span>';
    }

    function getOutstandingCreditTotal(accountId) {
        if (!headerCreditState.ready) return null;
        if (accountId) {
            var row = (headerCreditState.breakdown || []).filter(function (a) {
                return String(a.ACCOUNT_ID) === String(accountId);
            })[0];
            if (!row) return 0;
            if (row.TOTAL_AMOUNT != null) return Number(row.TOTAL_AMOUNT) || 0;
            var cash = row.BALANCE_CREDIT != null ? Number(row.BALANCE_CREDIT) : 0;
            var game = row.BALANCE_BUYIN != null ? Number(row.BALANCE_BUYIN) : 0;
            return cash + game;
        }
        if (headerCreditState.overallTotalIssue != null) {
            return Number(headerCreditState.overallTotalIssue) || 0;
        }
        return null;
    }

    function updateTotalCreditTableFooter(api) {
        if (!api || !api.table) return;
        var $footer = $(api.table().footer());
        if (!$footer.length) return;
        var rows = [];
        api.rows({ search: 'applied' }).every(function () {
            rows.push(this.data());
        });
        var totalLabel = (window.markerTranslations || {}).total_amount || 'Total Amount';
        if (!rows.length) {
            $footer.hide();
            return;
        }
        $footer.show();
        $footer.find('th').first().text(totalLabel);
        var accountId = String($('#txtAccountMarker').val() || '').trim() || null;
        var outstanding = getOutstandingCreditTotal(accountId);
        var footerTotal = outstanding != null ? outstanding : sumTotalCreditTabAmount(rows);
        $footer.find('th.marker-total-col-amount').html(formatTotalCreditTabSumHtml(footerTotal));
    }

    var MARKER_HISTORY_DATE_PARSE_FORMATS = [
        'YYYY-MM-DD HH:mm',
        'YYYY-MM-DD HH:mm:ss',
        'MMMM DD, YYYY HH:mm:ss',
        'MMMM DD, YYYY HH:mm',
        'DD MMM, YYYY HH:mm:ss',
        'DD MMM, YYYY HH:mm'
    ];

    function parseMarkerHistoryDateString(value) {
        if (!value || !window.moment) return null;
        var m = moment(value, MARKER_HISTORY_DATE_PARSE_FORMATS, true);
        if (m.isValid()) return m;
        m = moment(value);
        return m.isValid() ? m : null;
    }

    function escapeHtml(s) {
        if (s == null || s === '') return '';
        return String(s)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    function getTransactionLabel(transactionId) {
        switch (parseInt(transactionId, 10)) {
            case 11: return 'Marker Returned Cash';
            case 12: return 'Marker Returned Deposit';
            case 10: return 'Buy-in thru Marker';
            case 3: return 'Junket Credit';
            default: return 'Chips Return thru Credit';
        }
    }

    function getReturnSourceLabel(desc) {
        var normalized = String(desc || '').trim().toUpperCase();
        if (normalized === 'RETURN_SOURCE:CREDIT') return 'Junket';
        if (normalized === 'RETURN_SOURCE:BUYIN') return 'Game';
        return '';
    }

    function renderTransactionType(data, type, row) {
        // Prefer credit_transaction.CREDIT_ACTION (Transfer / Buy-in / Cash-in / Cash-out)
        var creditAction = row && row.CREDIT_ACTION != null ? String(row.CREDIT_ACTION).trim() : '';
        if (creditAction) return creditAction;

        if (!data) return '';
        var parts = String(data).split('-');
        var transactionId = parseInt(parts[0], 10);
        var transactionType = parseInt(parts[1], 10);
        var sourceLabel = getReturnSourceLabel(row && row.TRANSACTION_DESC);
        switch (transactionId) {
            case 3: return 'Cash-out';
            case 11: return 'Cash-in';
            case 12: return 'Transfer';
            case 10: return 'Buy-in';
            default:
                return transactionType === 4 ? 'Chips Return' : 'Unknown Transaction';
        }
    }

    function initHistoryTable(selector, options) {
        options = options || {};
        var $table = $(selector);
        if (!$table.length) return null;

        if ($.fn.DataTable.isDataTable(selector)) {
            $(selector).DataTable().destroy();
            $table.find('tbody').empty();
        }

        // Default sort by Date (ENCODED_DT) — col 1 after Program Date
        var orderCol = options.orderCol != null ? options.orderCol : 1;
        var orderDir = options.orderDir || 'desc';

        var isSuperAdmin = isMarkerSuperAdmin();
        var canEditMarker = canEditMarkerRecords();

        // Get translations from window object
        var translations = window.markerTranslations || {};

        var table = $table.DataTable({
            order: [[orderCol, orderDir]],
            language: {
                info: translations.showing_entries || "Showing _START_ to _END_ of _TOTAL_ entries",
                infoEmpty: translations.info_empty || "Showing 0 to 0 of 0 entries",
                infoFiltered: translations.info_filtered || "(filtered from _MAX_ total entries)",
                lengthMenu: translations.length_menu || "Show _MENU_ entries",
                search: translations.search || "Search:",
                paginate: {
                    first: translations.first || "First",
                    last: translations.last || "Last",
                    previous: translations.previous || "Previous",
                    next: translations.next || "Next"
                },
                emptyTable: translations.no_data_available || "No data available in table",
                zeroRecords: translations.no_data_available || "No matching records found"
            },
            dom: '<"row g-0 gy-2 mb-2 align-items-center gap-3"<"col-12 col-md-auto"l><"col-12 col-md d-flex justify-content-end align-items-center"f>>rt<"row g-2 mt-2"<"col-12 col-md-6"i><"col-12 col-md-6"p>>',
            autoWidth: false,
            ajax: {
                url: options.ajaxUrl || '/marker_history',
                dataSrc: function (json) {
                    var data = Array.isArray(json) ? json : (json && json.data && Array.isArray(json.data) ? json.data : []);
                    if (!data.length) return data;
                    if (window.moment) {
                        try {
                            return data.map(function (row) {
                                if (row.ENCODED_DT) {
                                    row.ENCODED_DT = moment.utc(row.ENCODED_DT).utcOffset(8).format('YYYY-MM-DD HH:mm');
                                }
                                return row;
                            });
                        } catch (e) {
                            return data;
                        }
                    }
                    return data;
                },
                error: function (xhr, err, msg) {
                    console.error('Marker history AJAX error:', xhr.status, msg, xhr.responseText);
                }
            },
            columns: [
                {
                    data: 'PROGRAM_DATE',
                    defaultContent: '',
                    render: function (data, type) {
                        return formatProgramDateCell(data, type);
                    }
                },
                {
                    data: 'ENCODED_DT',
                    defaultContent: '',
                    className: 'text-center',
                    render: function (data, type) {
                        if (type === 'sort') {
                            if (!window.moment) return data || '';
                            var mSort = parseMarkerHistoryDateString(data);
                            return mSort ? mSort.format('YYYY-MM-DD HH:mm:ss') : (data || '');
                        }
                        if (!window.moment) return data || '';
                        var dateMoment = parseMarkerHistoryDateString(data);
                        return dateMoment ? dateMoment.local().format('YYYY-MM-DD HH:mm') : (data || '');
                    }
                },
                {
                    data: null,
                    render: function (row) {
                        return (row.AGENT_CODE || '') + ' (' + (row.AGENT_NAME || '') + ')';
                    }
                },
                {
                    data: 'GUEST_NAME',
                    defaultContent: '',
                    render: function (data) {
                        return data != null && String(data).trim() !== '' ? escapeHtml(data) : '—';
                    }
                },
                {
                    data: 'AMOUNT',
                    className: 'text-end marker-history-col-amount',
                    render: function (data, type, row) {
                        return formatMarkerHistoryAmountCell(data, row, type);
                    }
                },
                {
                    data: 'CREDIT_ACTION',
                    defaultContent: '',
                    className: 'text-center',
                    render: function (data, type, row) {
                        return renderTransactionType(row && row.TRANSACTION_INFO, type, row);
                    }
                },
                {
                    data: 'GUARANTOR',
                    defaultContent: '',
                    render: function (data) {
                        return data != null && String(data).trim() !== '' ? escapeHtml(data) : '—';
                    }
                },
                {
                    data: 'REMARKS',
                    defaultContent: '',
                    className: 'marker-history-col-remarks',
                    render: function (data, type, row) {
                        var raw = data != null ? String(data) : '';
                        if (type === 'sort' || type === 'filter') {
                            return raw;
                        }
                        if (type !== 'display') {
                            return raw;
                        }
                        var safe = escapeHtml(raw);
                        var textHtml = safe ? safe : '<span class="text-muted">—</span>';
                        if (!canEditMarker) {
                            return textHtml;
                        }
                        var id = row.IDNo != null ? String(row.IDNo) : '';
                        var enc = encodeURIComponent(raw);
                        var t = translations;
                        var editTitle = (t.edit_remarks || 'Edit remarks').replace(/"/g, '&quot;');
                        return (
                            '<span class="marker-history-remarks-text marker-history-remarks-clickable cursor-pointer text-break btn-edit-marker-remarks"' +
                            ' role="button" tabindex="0" data-id="' + id + '" data-remarks="' + enc + '" title="' + editTitle + '">' + textHtml + '</span>'
                        );
                    }
                },
                {
                    data: null,
                    orderable: false,
                    searchable: false,
                    className: 'text-center',
                    render: function (_data, type, row) {
                        if (type !== 'display') return '';
                        var id = row.IDNo != null ? String(row.IDNo) : '';
                        if (!id) return '—';
                        var editTitle = (translations.edit || 'Edit').replace(/"/g, '&quot;');
                        var delTitle = (translations.delete || 'Delete').replace(/"/g, '&quot;');
                        var receiptTitle = (translations.receipt || 'Receipt').replace(/"/g, '&quot;');
                        var programYmd = row.PROGRAM_DATE != null
                            ? (formatProgramDateCell(row.PROGRAM_DATE, 'sort') || '')
                            : '';
                        var guarantorEnc = encodeURIComponent(row.GUARANTOR != null ? String(row.GUARANTOR) : '');
                        var remarksEnc = encodeURIComponent(row.REMARKS != null ? String(row.REMARKS) : '');
                        var amountVal = row.AMOUNT != null ? String(Math.abs(Number(row.AMOUNT) || 0)) : '';
                        var guestIdVal = row.GUEST_ID != null ? String(row.GUEST_ID) : '';
                        var agentIdVal = row.AGENT_ID != null ? String(row.AGENT_ID) : '';
                        var html =
                            '<div class="d-inline-flex align-items-center gap-1 marker-row-actions">' +
                            '<button type="button" class="btn btn-sm btn-icon-plain btn-marker-receipt" ' +
                            'data-id="' + id + '" title="' + receiptTitle + '"><i class="fa fa-receipt"></i></button>';
                        if (canEditMarker) {
                            html +=
                                '<button type="button" class="btn btn-sm btn-icon-plain btn-edit-marker-history" ' +
                                'data-id="' + id + '" ' +
                                'data-program-date="' + programYmd + '" ' +
                                'data-amount="' + escapeHtml(amountVal) + '" ' +
                                'data-guest-id="' + escapeHtml(guestIdVal) + '" ' +
                                'data-agent-id="' + escapeHtml(agentIdVal) + '" ' +
                                'data-guarantor="' + guarantorEnc + '" ' +
                                'data-remarks="' + remarksEnc + '" ' +
                                'title="' + editTitle + '"><i class="fa fa-edit"></i></button>';
                        }
                        if (isSuperAdmin) {
                            html +=
                                '<button type="button" class="btn btn-sm btn-icon-plain btn-icon-plain-danger btn-delete-marker" ' +
                                'data-id="' + id + '" title="' + delTitle + '"><i class="fa fa-trash-alt"></i></button>';
                        }
                        html += '</div>';
                        return html;
                    }
                }
            ]
        });

        // Edit remarks (Super Admin)
        $table.off('click.markerEditRemarks').on('click.markerEditRemarks', '.btn-edit-marker-remarks', function (e) {
            e.preventDefault();
            e.stopPropagation();
            var btn = $(this);
            if (btn.hasClass('marker-history-remarks-busy')) return;
            var id = btn.data('id');
            if (!id) return;
            if (window.RemarksEditor && !window.RemarksEditor.canEdit()) return;

            var rawRemarks = '';
            try {
                rawRemarks = decodeURIComponent(String(btn.attr('data-remarks') || ''));
            } catch (err) {
                rawRemarks = '';
            }

            var t = window.markerTranslations || {};
            var title = t.edit_remarks || 'Edit remarks';
            var saveLabel = t.save || 'Save';
            var okMsg = t.remarks_updated || 'Remarks updated.';
            var errMsg = t.error_update_remarks || 'Could not update remarks.';

            function doPatch(newVal) {
                btn.addClass('marker-history-remarks-busy').attr('aria-disabled', 'true').css('pointer-events', 'none');
                $.ajax({
                    url: '/marker_record/' + id + '/remarks',
                    method: 'PATCH',
                    contentType: 'application/json',
                    data: JSON.stringify({ remarks: newVal != null ? String(newVal) : '' }),
                    success: function (res) {
                        if (res.success) {
                            if (table && table.ajax) table.ajax.reload();
                            if (window.RemarksEditor && window.RemarksEditor.showSuccessToast) {
                                window.RemarksEditor.showSuccessToast();
                            } else if (window.Swal) {
                                window.Swal.fire({ icon: 'success', title: 'Saved', showConfirmButton: false, timer: 1200 });
                            }
                        } else {
                            if (window.Swal) window.Swal.fire({ icon: 'error', title: 'Error', text: res.message || errMsg });
                        }
                    },
                    error: function (xhr) {
                        var msg = (xhr.responseJSON && xhr.responseJSON.message) || errMsg;
                        if (window.Swal) window.Swal.fire({ icon: 'error', title: 'Error', text: msg });
                    },
                    complete: function () {
                        btn.removeClass('marker-history-remarks-busy').removeAttr('aria-disabled').css('pointer-events', '');
                    }
                });
            }

            if (window.Swal) {
                // Bootstrap modal focus trap steals focus from SweetAlert2 inputs; allow focus inside Swal
                function allowSwalFocus(e) {
                    if (e.target && e.target.closest && e.target.closest('.swal2-container')) {
                        e.stopImmediatePropagation();
                    }
                }
                window.addEventListener('focusin', allowSwalFocus, true);
                window.Swal.fire({
                    title: title,
                    input: 'textarea',
                    inputValue: rawRemarks,
                    inputAttributes: { maxlength: 500, 'aria-label': title },
                    showCancelButton: true,
                    confirmButtonText: saveLabel,
                    cancelButtonColor: '#6c757d',
                    focusConfirm: false,
                    heightAuto: false,
                    didOpen: function () {
                        var inp = window.Swal.getInput();
                        if (inp) {
                            inp.removeAttribute('readonly');
                            inp.removeAttribute('disabled');
                            setTimeout(function () {
                                inp.focus();
                            }, 50);
                        }
                    },
                    willClose: function () {
                        window.removeEventListener('focusin', allowSwalFocus, true);
                    }
                }).then(function (result) {
                    window.removeEventListener('focusin', allowSwalFocus, true);
                    if (result.isConfirmed) {
                        doPatch(result.value);
                    }
                });
            } else {
                var p = window.prompt(title, rawRemarks);
                if (p !== null) doPatch(p);
            }
        });

        $table.off('keydown.markerEditRemarks').on('keydown.markerEditRemarks', '.btn-edit-marker-remarks', function (e) {
            if (e.key !== 'Enter' && e.key !== ' ') return;
            e.preventDefault();
            e.stopPropagation();
            $(this).trigger('click');
        });

        // Delete button click (delegated)
        $table.off('click.markerDelete').on('click.markerDelete', '.btn-delete-marker', function (e) {
            e.preventDefault();
            e.stopPropagation();
            var btn = $(this);
            var id = btn.data('id');
            if (!id) return;
            if (!isMarkerSuperAdmin()) return; // Super Admin only

            var confirmMsg = (window.markerTranslations && window.markerTranslations.confirm_delete) || 'Are you sure you want to delete this record?';
            var confirmTitle = (window.markerTranslations && window.markerTranslations.delete) || 'Delete';

            if (window.Swal) {
                window.SwalConfirm.fire({
                    title: confirmTitle,
                    message: confirmMsg,
                    confirmButtonColor: '#d33',
                    cancelButtonColor: '#6c757d',
                    confirmButtonText: (window.markerTranslations && window.markerTranslations.yes_delete) || 'Yes, delete'
                }).then(function (result) {
                    if (result.isConfirmed) {
                        btn.prop('disabled', true);
                        $.ajax({
                            url: '/marker_record/' + id,
                            method: 'DELETE',
                            success: function (res) {
                                if (res.success) {
                                    if (table && table.ajax) table.ajax.reload();
                                    if (window._markerTotalCreditTable && window._markerTotalCreditTable.ajax) {
                                        try { window._markerTotalCreditTable.ajax.reload(null, false); } catch (err) { /* noop */ }
                                    }
                                    $.getJSON('/marker_total_credits_issue', function (data) {
                                        var total = (data && data.total != null) ? data.total : 0;
                                        var numStr = Number(total).toLocaleString('en-US');
                                        $('#txtTotalMarkerIssue').val(numStr);
                                        $('#dashboard-credit-value').html('₱ ' + numStr);
                                    });
                                    var formApi = $table.data('markerFormApi');
                                    if (formApi && formApi.populateAccounts) formApi.populateAccounts();
                                    if (typeof window._markerReloadBalanceTables === 'function') {
                                        window._markerReloadBalanceTables();
                                    }
                                }
                                if (window.Swal) window.Swal.fire({ icon: 'success', title: 'Success', text: res.message || 'Record deleted.' });
                                if (typeof window.reloadData === 'function') window.reloadData();
                            },
                            error: function (xhr) {
                                var msg = (xhr.responseJSON && xhr.responseJSON.message) || 'Error deleting record.';
                                if (window.Swal) window.Swal.fire({ icon: 'error', title: 'Error', text: msg });
                            },
                            complete: function () { btn.prop('disabled', false); }
                        });
                    }
                });
            } else {
                if (confirm(confirmMsg)) {
                    btn.prop('disabled', true);
                    $.ajax({
                        url: '/marker_record/' + id,
                        method: 'DELETE',
                        success: function (res) {
                            if (res.success) {
                                if (table && table.ajax) table.ajax.reload();
                                if (window._markerTotalCreditTable && window._markerTotalCreditTable.ajax) {
                                    try { window._markerTotalCreditTable.ajax.reload(null, false); } catch (err) { /* noop */ }
                                }
                                $.getJSON('/marker_total_credits_issue', function (data) {
                                    var total = (data && data.total != null) ? data.total : 0;
                                    var numStr = Number(total).toLocaleString('en-US');
                                    $('#txtTotalMarkerIssue').val(numStr);
                                    $('#dashboard-credit-value').html('₱ ' + numStr);
                                });
                                var formApi = $table.data('markerFormApi');
                                if (formApi && formApi.populateAccounts) formApi.populateAccounts();
                                if (typeof window._markerReloadBalanceTables === 'function') {
                                    window._markerReloadBalanceTables();
                                }
                            }
                            if (typeof window.reloadData === 'function') window.reloadData();
                        },
                        complete: function () { btn.prop('disabled', false); }
                    });
                }
            }
        });

        // Edit button (moved here from the Credit / Total Credit tab)
        $table.off('click.markerHistoryEdit').on('click.markerHistoryEdit', '.btn-edit-marker-history', function (e) {
            e.preventDefault();
            e.stopPropagation();
            var btn = $(this);
            if (btn.hasClass('marker-history-edit-busy')) return;
            var id = btn.data('id');
            if (!id) return;
            if (window.RemarksEditor && !window.RemarksEditor.canEdit()) return;

            var programDate = String(btn.attr('data-program-date') || '').trim();
            var amountVal = String(btn.attr('data-amount') || '').trim();
            var guestIdVal = String(btn.attr('data-guest-id') || '').trim();
            var agentIdVal = String(btn.attr('data-agent-id') || '').trim();
            var guarantorVal = '';
            var remarksVal = '';
            try { guarantorVal = decodeURIComponent(String(btn.attr('data-guarantor') || '')); } catch (err) { guarantorVal = ''; }
            try { remarksVal = decodeURIComponent(String(btn.attr('data-remarks') || '')); } catch (err) { remarksVal = ''; }

            openEditCreditTransactionModal({
                id: id,
                programDate: programDate,
                amount: amountVal,
                guestId: guestIdVal,
                agentId: agentIdVal,
                guarantor: guarantorVal,
                remarks: remarksVal,
                onSaved: function () {
                    if (table && table.ajax) table.ajax.reload(null, false);
                    if (window._markerTotalCreditTable && window._markerTotalCreditTable.ajax) {
                        try { window._markerTotalCreditTable.ajax.reload(null, false); } catch (err) { /* noop */ }
                    }
                    if (typeof window._markerReloadBalanceTables === 'function') {
                        window._markerReloadBalanceTables();
                    }
                    $.getJSON('/marker_total_credits_issue', function (data) {
                        var total = (data && data.total != null) ? data.total : 0;
                        var numStr = Number(total).toLocaleString('en-US');
                        $('#txtTotalMarkerIssue').val(numStr);
                        $('#dashboard-credit-value').html('₱ ' + numStr);
                    });
                }
            });
        });

        // Receipt button
        bindMarkerReceiptEventsOnce();
        $table.off('click.markerHistoryReceipt').on('click.markerHistoryReceipt', '.btn-marker-receipt', function (e) {
            e.preventDefault();
            e.stopPropagation();
            var id = $(this).data('id');
            if (id) showMarkerReceipt(id);
        });

        return table;
    }

    /* ---------- Credit receipt slip (History tab) ---------- */
    function markerReceiptEscape(value) {
        return String(value == null ? '' : value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function markerReceiptHasValue(value) {
        if (value == null) return false;
        if (typeof value === 'number') return Number.isFinite(value) && value !== 0;
        var s = String(value).trim();
        return s !== '' && s !== '-' && s !== '—';
    }

    function markerReceiptTextRow(label, value) {
        if (!markerReceiptHasValue(value)) return '';
        return (
            '<tr><td class="mrr-label">' + markerReceiptEscape(label) +
            '</td><td class="mrr-value">' + markerReceiptEscape(String(value)) + '</td></tr>'
        );
    }

    function markerReceiptFormatAmount(value) {
        return Math.abs(Number(value) || 0).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
    }

    function markerReceiptInOutRow(label, value, isOut) {
        var num = Math.abs(Number(value) || 0);
        var formatted = markerReceiptFormatAmount(num);
        var display = num && isOut ? '(' + formatted + ')' : formatted;
        var cls = isOut ? 'mrr-value mrr-amount-out' : 'mrr-value mrr-amount-in';
        return (
            '<tr class="mrr-total-row"><td class="mrr-label mrr-total-label">' + markerReceiptEscape(label) +
            '</td><td class="' + cls + '">' + display + '</td></tr>'
        );
    }

    function markerReceiptBalanceRow(label, value) {
        if (value == null || value === '') return '';
        var num = Number(value);
        if (!Number.isFinite(num)) return '';
        var formatted = markerReceiptFormatAmount(num);
        var display = num < 0 ? '(' + formatted + ')' : formatted;
        return (
            '<tr><td class="mrr-label">' + markerReceiptEscape(label) +
            '</td><td class="mrr-value">' + display + '</td></tr>'
        );
    }

    function markerReceiptDateTime(value) {
        if (!value) return '';
        var m = window.moment ? parseMarkerHistoryDateString(value) : null;
        return m && m.isValid() ? m.format('YYYY-MM-DD HH:mm') : String(value);
    }

    function markerReceiptDateOnly(value) {
        if (!value) return '';
        var m = window.moment ? parseMarkerHistoryDateString(value) : null;
        return m && m.isValid() ? m.format('YYYY-MM-DD') : String(value).slice(0, 10);
    }

    function buildMarkerReceiptHtml(row) {
        row = row || {};
        var t = window.markerTranslations || {};
        var isOut = isMarkerCreditOutTransaction(row);
        var titleClass = isOut ? 'mrr-title mrr-title-out' : 'mrr-title';
        var rowsHtml =
            markerReceiptTextRow('DATE', formatProgramDateCell(row.PROGRAM_DATE, 'sort') || markerReceiptDateOnly(row.ENCODED_DT)) +
            markerReceiptTextRow('ACCOUNT', row.AGENT_CODE) +
            markerReceiptTextRow('NAME', row.AGENT_NAME) +
            markerReceiptInOutRow('IN AND OUT', row.AMOUNT, isOut) +
            markerReceiptBalanceRow('BALANCE', row.BALANCE_AFTER) +
            markerReceiptTextRow('CONFIRMER', row.GUARANTOR) +
            markerReceiptTextRow('REMARKS', row.REMARKS);

        return (
            '<div class="marker-receipt-slip">' +
            '<div class="marker-receipt-slip-body">' +
            '<p class="mrr-brand">GOLDEN DRAGON</p>' +
            '<p class="' + titleClass + '">* Credit *</p>' +
            '<p class="mrr-datetime">' + markerReceiptEscape(markerReceiptDateTime(row.ENCODED_DT)) + '</p>' +
            '<table class="mrr-table"><tbody>' + rowsHtml + '</tbody></table>' +
            '</div>' +
            '<div class="marker-receipt-slip-actions">' +
            '<button type="button" class="btn marker-receipt-copy-btn js-copy-marker-receipt-image">' + markerReceiptEscape(t.copy_image || 'Copy image') + '</button>' +
            '<button type="button" class="btn marker-receipt-copy-btn js-copy-marker-receipt-text">' + markerReceiptEscape(t.copy_text || 'Copy text') + '</button>' +
            '</div>' +
            '</div>'
        );
    }

    function findMarkerReceiptRowById(id) {
        var found = null;
        [window._markerHistoryTable, window._markerTotalCreditTable].forEach(function (dt) {
            if (found || !dt || !dt.rows) return;
            dt.rows().data().toArray().forEach(function (r) {
                if (!found && r && String(r.IDNo) === String(id)) found = r;
            });
        });
        return found;
    }

    function showMarkerReceipt(id) {
        var row = findMarkerReceiptRowById(id);
        if (!row) {
            if (window.Swal) window.Swal.fire('Error', 'Record not found.', 'error');
            return;
        }
        var modalEl = document.getElementById('modal-marker-receipt');
        var container = document.getElementById('marker-receipt-container');
        if (!modalEl || !container) return;
        container.innerHTML = buildMarkerReceiptHtml(row);
        $(modalEl).appendTo('body');

        var openModals = $('.modal.show').not('#modal-marker-receipt');
        if (openModals.length) {
            var z = 1060;
            openModals.each(function () {
                var mz = parseInt($(this).css('z-index'), 10) || 1050;
                if (mz >= z) z = mz + 10;
            });
            modalEl.style.zIndex = z;
            $(modalEl).one('shown.bs.modal', function () {
                var $backs = $('.modal-backdrop');
                if ($backs.length > 1) {
                    $backs.slice(1).addClass('d-none');
                }
            });
        } else {
            modalEl.style.zIndex = '';
        }

        if (window.bootstrap && window.bootstrap.Modal) {
            window.bootstrap.Modal.getOrCreateInstance(modalEl).show();
        } else {
            $(modalEl).modal('show');
        }
    }
    window.showMarkerReceipt = showMarkerReceipt;

    var markerReceiptHtml2CanvasPromise = null;
    function loadMarkerReceiptHtml2Canvas() {
        if (typeof html2canvas !== 'undefined') return Promise.resolve();
        if (markerReceiptHtml2CanvasPromise) return markerReceiptHtml2CanvasPromise;
        markerReceiptHtml2CanvasPromise = new Promise(function (resolve, reject) {
            var script = document.createElement('script');
            script.src = 'https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.min.js';
            script.onload = function () { resolve(); };
            script.onerror = function () {
                markerReceiptHtml2CanvasPromise = null;
                reject(new Error('Failed to load image copy library.'));
            };
            document.body.appendChild(script);
        });
        return markerReceiptHtml2CanvasPromise;
    }

    function markerReceiptCopyUi(btn) {
        var originalHtml = btn.innerHTML;
        btn.disabled = true;
        btn.innerHTML = '<span class="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span>';
        return {
            success: function (message) {
                if (window.Swal) window.Swal.fire({ icon: 'success', title: 'Copied!', text: message, timer: 1800, showConfirmButton: false });
            },
            error: function (message) {
                if (window.Swal) window.Swal.fire({ icon: 'error', title: 'Copy failed', text: message });
            },
            restore: function () {
                btn.disabled = false;
                btn.innerHTML = originalHtml;
            }
        };
    }

    function copyMarkerReceiptImage(btn) {
        var slip = btn.closest('.marker-receipt-slip');
        var slipBody = slip ? slip.querySelector('.marker-receipt-slip-body') : null;
        if (!slipBody) return;
        var ui = markerReceiptCopyUi(btn);
        var blobPromise = loadMarkerReceiptHtml2Canvas()
            .then(function () {
                return html2canvas(slipBody, { backgroundColor: '#ffffff', scale: 2, useCORS: true, logging: false });
            })
            .then(function (canvas) {
                return new Promise(function (resolve, reject) {
                    canvas.toBlob(function (blob) {
                        if (blob) resolve(blob);
                        else reject(new Error('Failed to create receipt image.'));
                    }, 'image/png');
                });
            });

        if (navigator.clipboard && typeof ClipboardItem !== 'undefined') {
            navigator.clipboard
                .write([new ClipboardItem({ 'image/png': blobPromise })])
                .then(function () { ui.success('Receipt image copied. You can paste it anywhere.'); })
                .catch(function (err) { ui.error((err && err.message) || 'Unable to copy receipt image.'); })
                .finally(function () { ui.restore(); });
        } else {
            blobPromise
                .then(function (blob) {
                    var link = document.createElement('a');
                    link.href = URL.createObjectURL(blob);
                    link.download = 'credit-receipt.png';
                    document.body.appendChild(link);
                    link.click();
                    document.body.removeChild(link);
                    ui.success('Receipt image downloaded.');
                })
                .catch(function (err) { ui.error((err && err.message) || 'Unable to copy receipt image.'); })
                .finally(function () { ui.restore(); });
        }
    }

    function copyMarkerReceiptText(btn) {
        var slip = btn.closest('.marker-receipt-slip');
        var slipBody = slip ? slip.querySelector('.marker-receipt-slip-body') : null;
        var text = slipBody && slipBody.innerText ? slipBody.innerText.trim() : '';
        var ui = markerReceiptCopyUi(btn);
        if (!text || !navigator.clipboard || typeof navigator.clipboard.writeText !== 'function') {
            ui.error('Clipboard is not supported in this browser.');
            ui.restore();
            return;
        }
        navigator.clipboard
            .writeText(text)
            .then(function () { ui.success('Receipt text copied. You can paste it anywhere.'); })
            .catch(function (err) { ui.error((err && err.message) || 'Unable to copy receipt text.'); })
            .finally(function () { ui.restore(); });
    }

    function bindMarkerReceiptEventsOnce() {
        if (window.__markerReceiptBound) return;
        window.__markerReceiptBound = true;
        $(document).on('click', '.js-copy-marker-receipt-image', function () { copyMarkerReceiptImage(this); });
        $(document).on('click', '.js-copy-marker-receipt-text', function () { copyMarkerReceiptText(this); });
        var modalEl = document.getElementById('modal-marker-receipt');
        if (modalEl) {
            modalEl.addEventListener('shown.bs.modal', function () {
                document.body.classList.add('marker-receipt-open');
                loadMarkerReceiptHtml2Canvas().catch(function () {});
            });
            modalEl.addEventListener('hidden.bs.modal', function () {
                document.body.classList.remove('marker-receipt-open');
                $('.modal-backdrop.d-none').removeClass('d-none');
                if ($('.modal.show').length) {
                    document.body.classList.add('modal-open');
                }
            });
        }
    }

    function formatProgramDateCell(value, type) {
        if (value == null || value === '') return type === 'display' ? '—' : '';

        function pad2(n) {
            return String(n).padStart(2, '0');
        }
        function ymdFromParts(y, m, d) {
            return y + '-' + pad2(m) + '-' + pad2(d);
        }

        var ymd = '';
        // mysql2 may return DATE as JS Date at UTC midnight → local TZ shifts day back.
        if (Object.prototype.toString.call(value) === '[object Date]' && !isNaN(value.getTime())) {
            ymd = ymdFromParts(value.getUTCFullYear(), value.getUTCMonth() + 1, value.getUTCDate());
        } else {
            var raw = String(value).trim();
            if (/^\d{4}-\d{2}-\d{2}/.test(raw)) {
                ymd = raw.slice(0, 10);
            } else if (window.moment) {
                var mUtc = moment.utc(raw);
                if (mUtc.isValid()) {
                    ymd = mUtc.format('YYYY-MM-DD');
                }
            }
        }

        if (type === 'sort' || type === 'type') return ymd;
        if (!ymd) return type === 'display' ? '—' : '';
        if (!window.moment) {
            var parts = ymd.split('-');
            if (parts.length === 3) {
                return String(parseInt(parts[1], 10)) + '/' + String(parseInt(parts[2], 10)) + '/' + parts[0];
            }
            return ymd;
        }
        return moment(ymd, 'YYYY-MM-DD').format('M/D/YYYY');
    }

    var editCreditTxnBound = false;
    var editCreditTxnOnSaved = null;
    var editCreditProgramDatePicker = null;

    function getEditCreditProgramDateYmd() {
        var el = document.getElementById('edit-credit-program-date');
        if (!el) return '';
        if (el._flatpickr && el._flatpickr.selectedDates && el._flatpickr.selectedDates.length) {
            try {
                return el._flatpickr.formatDate(el._flatpickr.selectedDates[0], 'Y-m-d');
            } catch (e) { /* fall through */ }
        }
        return String(el.value || '').trim();
    }

    function ensureEditCreditProgramDatePicker(defaultYmd) {
        var el = document.getElementById('edit-credit-program-date');
        if (!el || typeof flatpickr === 'undefined') return null;
        if (el._flatpickr) {
            try { el._flatpickr.destroy(); } catch (e) {}
        }
        var ymd = String(defaultYmd || '').trim();
        var defaultDate = /^\d{4}-\d{2}-\d{2}$/.test(ymd) ? ymd : new Date();
        editCreditProgramDatePicker = flatpickr(el, {
            enableTime: false,
            dateFormat: 'Y-m-d',
            altInput: true,
            altFormat: 'm/d/Y',
            defaultDate: defaultDate,
            allowInput: true,
            disableMobile: true,
            closeOnSelect: true,
            appendTo: document.body,
            onReady: function (_selectedDates, _dateStr, instance) {
                if (instance && instance.altInput) {
                    instance.altInput.classList.add('form-control');
                    instance.altInput.style.width = '100%';
                    instance.altInput.required = true;
                }
                if (instance && instance.calendarContainer) {
                    instance.calendarContainer.classList.add('edit-credit-date-calendar');
                    instance.calendarContainer.style.zIndex = '2000';
                }
            },
            onOpen: function (_selectedDates, _dateStr, instance) {
                if (instance && instance.calendarContainer) {
                    instance.calendarContainer.classList.add('edit-credit-date-calendar');
                    instance.calendarContainer.style.zIndex = '2000';
                }
            }
        });
        return editCreditProgramDatePicker;
    }

    function setEditCreditProgramDate(ymd) {
        var val = String(ymd || '').trim();
        if (!/^\d{4}-\d{2}-\d{2}$/.test(val)) val = '';
        var el = document.getElementById('edit-credit-program-date');
        if (el && el._flatpickr) {
            if (val) el._flatpickr.setDate(val, true, 'Y-m-d');
            else el._flatpickr.clear();
            return;
        }
        if (el) el.value = val;
        ensureEditCreditProgramDatePicker(val || undefined);
    }

    function bindEditCreditTransactionModalOnce() {
        if (editCreditTxnBound) return;
        var $modal = $('#modal-edit-credit-transaction');
        if (!$modal.length) return;
        editCreditTxnBound = true;

        var $form = $('#edit_credit_transaction_form');
        var $amount = $('#edit-credit-amount');
        var $guest = $('#edit-credit-guest');
        var $saveBtn = $('#edit-credit-save-btn');

        $amount.off('input.editCreditTxn').on('input.editCreditTxn', function () {
            var raw = sanitizeAmountInput($(this).val());
            $(this).val(raw === '' || raw === '.' ? raw : formatWithCommas(raw));
        }).off('focusout.editCreditTxn').on('focusout.editCreditTxn', function () {
            var raw = sanitizeAmountInput($(this).val());
            if (raw === '' || raw === '.') {
                $(this).val('');
            } else {
                $(this).val(formatWithCommas(raw));
            }
        });

        $form.off('submit.editCreditTxn').on('submit.editCreditTxn', function (e) {
            e.preventDefault();
            var id = String($('#edit-credit-txn-id').val() || '').trim();
            if (!id) return;

            var t = window.markerTranslations || {};
            var programDate = getEditCreditProgramDateYmd();
            var amountRaw = sanitizeAmountInput($amount.val());
            var amountNum = parseFloat(amountRaw) || 0;
            var guestId = String($guest.val() || '').trim();
            var guarantor = String($('#edit-credit-guarantor').val() || '').trim();
            var remarks = String($('#edit-credit-remarks').val() || '');

            if (!/^\d{4}-\d{2}-\d{2}$/.test(programDate)) {
                if (window.Swal) {
                    window.Swal.fire({
                        icon: 'error',
                        title: 'Missing Information',
                        text: (t.program_date || 'Program Date') + ' is required.'
                    });
                }
                return;
            }
            if (amountNum <= 0) {
                if (window.Swal) {
                    window.Swal.fire({
                        icon: 'error',
                        title: 'Invalid Amount',
                        text: (t.amount || 'Amount') + ' must be greater than zero.'
                    });
                }
                return;
            }
            if (!guarantor) {
                if (window.Swal) {
                    window.Swal.fire({
                        icon: 'error',
                        title: 'Missing Information',
                        text: (t.guarantor || 'Guarantor') + ' is required.'
                    });
                }
                return;
            }

            var saveLabel = $saveBtn.data('label') || $saveBtn.text() || (t.save || 'Save');
            $saveBtn.data('label', saveLabel);
            $saveBtn.prop('disabled', true).html(
                '<span class="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span> Loading...'
            );

            $.ajax({
                url: '/marker_record/' + id,
                method: 'PATCH',
                contentType: 'application/json',
                data: JSON.stringify({
                    programDate: programDate,
                    amount: amountNum,
                    guestId: guestId || null,
                    guarantor: guarantor,
                    remarks: remarks
                }),
                success: function (res) {
                    if (res && res.success) {
                        $modal.modal('hide');
                        if (typeof editCreditTxnOnSaved === 'function') editCreditTxnOnSaved(res);
                        if (window.RemarksEditor && window.RemarksEditor.showSuccessToast) {
                            window.RemarksEditor.showSuccessToast();
                        } else if (window.Swal) {
                            window.Swal.fire({
                                icon: 'success',
                                title: 'Saved',
                                text: t.credit_updated || 'Record updated.',
                                showConfirmButton: false,
                                timer: 1200
                            });
                        }
                    } else if (window.Swal) {
                        window.Swal.fire({
                            icon: 'error',
                            title: 'Error',
                            text: (res && res.message) || (t.error_update_credit || 'Could not update record.')
                        });
                    }
                },
                error: function (xhr) {
                    var msg = (xhr.responseJSON && xhr.responseJSON.message) || (t.error_update_credit || 'Could not update record.');
                    if (window.Swal) window.Swal.fire({ icon: 'error', title: 'Error', text: msg });
                },
                complete: function () {
                    $saveBtn.prop('disabled', false).text(saveLabel);
                }
            });
        });
    }

    function loadEditCreditGuests(agentId, selectedGuestId) {
        var $guest = $('#edit-credit-guest');
        if (!$guest.length) return;
        var t = window.markerTranslations || {};
        var placeholder = t.select_guest_optional || 'Select Guest (Optional)';
        $guest.empty().append($('<option></option>').val('').text(placeholder));

        if (!agentId) return;

        $.ajax({
            url: '/guest_data?agentId=' + encodeURIComponent(agentId),
            method: 'GET',
            success: function (rows) {
                var guests = Array.isArray(rows) ? rows : [];
                guests.forEach(function (guest) {
                    var gid = guest.guest_id != null ? String(guest.guest_id) : '';
                    if (!gid) return;
                    var gname = String(guest.guest_name || '').trim() || ('Guest #' + gid);
                    $guest.append($('<option></option>').val(gid).text(gname));
                });
                if (selectedGuestId && $guest.find('option[value="' + String(selectedGuestId) + '"]').length) {
                    $guest.val(String(selectedGuestId));
                } else {
                    $guest.val('');
                }
            }
        });
    }

    function openEditCreditTransactionModal(opts) {
        opts = opts || {};
        bindEditCreditTransactionModalOnce();
        var $modal = $('#modal-edit-credit-transaction');
        if (!$modal.length) {
            if (window.Swal) {
                window.Swal.fire({
                    icon: 'error',
                    title: 'Unavailable',
                    text: 'Edit Credit modal is not available on this page.'
                });
            }
            return;
        }

        // Keep modal under body so it can stack above dashboard Credits modal.
        if ($modal.parent().length && !$modal.parent().is('body')) {
            $modal.appendTo('body');
        }

        editCreditTxnOnSaved = typeof opts.onSaved === 'function' ? opts.onSaved : null;
        $('#edit-credit-txn-id').val(opts.id != null ? String(opts.id) : '');
        $('#edit-credit-agent-id').val(opts.agentId != null ? String(opts.agentId) : '');
        var amountNum = parseFloat(String(opts.amount || '').replace(/,/g, '')) || 0;
        $('#edit-credit-amount').val(amountNum > 0 ? formatWithCommas(amountNum) : '');
        $('#edit-credit-guarantor').val(opts.guarantor || '');
        $('#edit-credit-remarks').val(opts.remarks || '');
        loadEditCreditGuests(opts.agentId || '', opts.guestId || '');

        var programYmd = String(opts.programDate || '').trim();
        if (!/^\d{4}-\d{2}-\d{2}$/.test(programYmd)) programYmd = '';

        function applyProgramDatePicker() {
            ensureEditCreditProgramDatePicker(programYmd || undefined);
            if (programYmd) setEditCreditProgramDate(programYmd);
        }

        // Nested under Credits modal: no second backdrop; raise z-index so Edit is visible.
        var nestedUnderModal = $('.modal.show').not('#modal-edit-credit-transaction').length > 0;
        $modal.off('shown.bs.modal.editCreditStack shown.bs.modal.editCreditDate');
        if (nestedUnderModal) {
            $modal.attr('data-bs-backdrop', 'false');
            var z = 1060;
            $('.modal.show').each(function () {
                var mz = parseInt($(this).css('z-index'), 10) || 1050;
                if (mz >= z) z = mz + 10;
            });
            $modal.css('z-index', z);
            $modal.one('shown.bs.modal.editCreditStack', function () {
                $modal.css('z-index', z);
                var $backs = $('.modal-backdrop');
                if ($backs.length > 1) {
                    $backs.slice(1).addClass('d-none').css({ opacity: 0, 'pointer-events': 'none' });
                }
                applyProgramDatePicker();
            });
        } else {
            $modal.attr('data-bs-backdrop', 'static');
            $modal.css('z-index', '');
            $modal.one('shown.bs.modal.editCreditDate', applyProgramDatePicker);
        }

        $modal.modal('show');
        if ($modal.hasClass('show')) applyProgramDatePicker();
    }
    window.openEditCreditTransactionModal = openEditCreditTransactionModal;

    function initTotalCreditTable(selector) {
        var $table = $(selector);
        if (!$table.length || typeof $.fn.DataTable === 'undefined') return null;

        if ($.fn.DataTable.isDataTable(selector)) {
            try {
                $table.DataTable().destroy();
            } catch (e) { /* noop */ }
            $table.find('tbody').empty();
        }

        var translations = window.markerTranslations || {};

        var table = $table.DataTable({
            order: [[1, 'desc']],
            pageLength: 10,
            lengthMenu: [[10, 25, 50, -1], [10, 25, 50, 'All']],
            searching: true,
            paging: true,
            info: true,
            autoWidth: false,
            language: {
                info: translations.showing_entries || 'Showing _START_ to _END_ of _TOTAL_ entries',
                infoEmpty: translations.info_empty || 'Showing 0 to 0 of 0 entries',
                infoFiltered: translations.info_filtered || '(filtered from _MAX_ total entries)',
                lengthMenu: translations.length_menu || 'Show _MENU_ entries',
                search: translations.search || 'Search:',
                paginate: {
                    first: translations.first || 'First',
                    last: translations.last || 'Last',
                    previous: translations.previous || 'Previous',
                    next: translations.next || 'Next'
                },
                emptyTable: translations.no_data_available || 'No data available in table',
                zeroRecords: translations.no_data_available || 'No matching records found'
            },
            dom: '<"row g-0 gy-2 mb-2 align-items-center gap-3"<"col-12 col-md-auto"l><"col-12 col-md d-flex justify-content-end align-items-center"f>>rt<"row g-2 mt-2"<"col-12 col-md-6"i><"col-12 col-md-6"p>>',
            footerCallback: function () {
                updateTotalCreditTableFooter(this.api());
            },
            ajax: {
                url: '/marker_total_credit',
                dataSrc: function (json) {
                    var data = Array.isArray(json) ? json : (json && json.data && Array.isArray(json.data) ? json.data : []);
                    if (!data.length || !window.moment) return data;
                    try {
                        return data.map(function (row) {
                            if (row.ENCODED_DT) {
                                row.ENCODED_DT = moment.utc(row.ENCODED_DT).utcOffset(8).format('YYYY-MM-DD HH:mm');
                            }
                            return row;
                        });
                    } catch (e) {
                        return data;
                    }
                },
                error: function (xhr, err, msg) {
                    console.error('Total credit AJAX error:', xhr.status, msg, xhr.responseText);
                }
            },
            columns: [
                {
                    data: 'PROGRAM_DATE',
                    defaultContent: '',
                    render: function (data, type) {
                        return formatProgramDateCell(data, type);
                    }
                },
                {
                    data: 'ENCODED_DT',
                    defaultContent: '',
                    className: 'text-center',
                    render: function (data, type) {
                        if (type === 'sort') {
                            if (!window.moment) return data || '';
                            var mSort = parseMarkerHistoryDateString(data);
                            return mSort ? mSort.format('YYYY-MM-DD HH:mm:ss') : (data || '');
                        }
                        if (!window.moment) return data || '—';
                        var dateMoment = parseMarkerHistoryDateString(data);
                        if (!dateMoment) return data || '—';
                        // Credit History page only — display M/D/YY HH:mm (storage/API unchanged)
                        var displayFmt = document.querySelector('.marker-history-page')
                            ? 'M/D/YY HH:mm'
                            : 'YYYY-MM-DD HH:mm';
                        return dateMoment.local().format(displayFmt);
                    }
                },
                {
                    data: 'AGENT_CODE',
                    defaultContent: '',
                    render: function (data) {
                        return data != null && String(data).trim() !== '' ? escapeHtml(data) : '—';
                    }
                },
                {
                    data: 'AGENT_NAME',
                    defaultContent: '',
                    render: function (data) {
                        return data != null && String(data).trim() !== '' ? escapeHtml(data) : '—';
                    }
                },
                {
                    data: 'GUEST_NAME',
                    defaultContent: '',
                    render: function (data) {
                        return data != null && String(data).trim() !== '' ? escapeHtml(data) : '—';
                    }
                },
                {
                    data: 'AMOUNT',
                    className: 'text-end',
                    render: function (data, type, row) {
                        return formatMarkerHistoryAmountCell(data, row, type);
                    }
                },
                {
                    data: 'CREDIT_ACTION',
                    defaultContent: '',
                    className: 'text-center',
                    render: function (data, type, row) {
                        return renderTransactionType(row && row.TRANSACTION_INFO, type, row) || '—';
                    }
                },
                {
                    data: 'GUARANTOR',
                    defaultContent: '',
                    render: function (data) {
                        return data != null && String(data).trim() !== '' ? escapeHtml(data) : '—';
                    }
                },
                {
                    data: 'REMARKS',
                    defaultContent: '',
                    className: 'marker-total-col-remarks',
                    render: function (data) {
                        var raw = data != null ? String(data).trim() : '';
                        return raw ? escapeHtml(raw) : '—';
                    }
                }
            ]
        });

        return table;
    }

    function getMarkerExportDefaultFilename() {
        var d = new Date();
        var y = d.getFullYear();
        var m = String(d.getMonth() + 1).padStart(2, '0');
        var day = String(d.getDate()).padStart(2, '0');
        return 'CreditHistory_' + y + '-' + m + '-' + day + '.xlsx';
    }

    function getCreditBalanceExportFilename(kind) {
        var d = new Date();
        var y = d.getFullYear();
        var mo = String(d.getMonth() + 1).padStart(2, '0');
        var day = String(d.getDate()).padStart(2, '0');
        var suffix = kind === 'buyin' ? 'GameCredit' : 'JunketCredit';
        return suffix + '_' + y + '-' + mo + '-' + day + '.xlsx';
    }

    function parseBalanceCellToNumber(text) {
        if (text == null || text === '') return NaN;
        var s = String(text).replace(/,/g, '').trim();
        if (s === '' || s === '—' || s === '-') return NaN;
        var n = Number(s);
        return Number.isFinite(n) ? n : NaN;
    }

    /**
     * Export Junket Credit / Game Credit balance tables (2 columns) via server XLSX.
     */
    function initBalanceTableExport(tableSelector, exportBtnSelector, exportOptions) {
        exportOptions = exportOptions || {};
        var kind = exportOptions.kind === 'buyin' ? 'buyin' : 'credit';
        var $btn = $(exportBtnSelector);
        if (!$btn.length) return;

        $btn.off('click.markerBalanceExport').on('click.markerBalanceExport', function () {
            var t = window.markerTranslations || {};
            if (!$.fn.DataTable.isDataTable(tableSelector)) {
                if (window.Swal) {
                    window.Swal.fire({
                        icon: 'info',
                        title: t.export || 'Export',
                        text: t.no_data_export || 'No data to export for the current filter.',
                        confirmButtonColor: '#0d6efd'
                    });
                }
                return;
            }
            var dt = $(tableSelector).DataTable();
            var headers = [
                t.account_name || 'Account Name',
                t.balance || 'Balance'
            ];
            var rows = [];
            var sum = 0;
            dt.rows({ search: 'applied' }).every(function () {
                var $tds = $(this.node()).find('td');
                if ($tds.length < 2) return;
                var name = $tds.eq(0).text().trim();
                var balText = $tds.eq(1).text().trim();
                if (!name && !balText) return;
                if (/error\s+loading/i.test(name)) return;
                var balNum = parseBalanceCellToNumber(balText);
                if (Number.isFinite(balNum)) sum += balNum;
                rows.push([name, Number.isFinite(balNum) ? balNum : balText]);
            });
            if (rows.length === 0) {
                if (window.Swal) {
                    window.Swal.fire({
                        icon: 'info',
                        title: t.export || 'Export',
                        text: t.no_data_export || 'No data to export for the current filter.',
                        confirmButtonColor: '#0d6efd'
                    });
                }
                return;
            }
            var outName = exportOptions.fileName || getCreditBalanceExportFilename(kind);
            var sheetLabel =
                exportOptions.sheetName ||
                (kind === 'buyin'
                    ? t.export_sheet_game_credit || 'Game Credit'
                    : t.export_sheet_junket_credit || 'Junket Credit');
            var $b = $(this);
            $b.prop('disabled', true);
            fetch('/marker_history/export_xlsx', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'same-origin',
                body: JSON.stringify({
                    headers: headers,
                    rows: rows,
                    filename: outName,
                    sheetName: sheetLabel,
                    profileKey: 'markerBalance'
                })
            })
                .then(function (res) {
                    if (!res.ok) {
                        return res.json().catch(function () { return {}; }).then(function (j) {
                            throw new Error((j && j.error) ? j.error : (t.export_error || 'Export failed'));
                        });
                    }
                    return res.blob();
                })
                .then(function (blob) {
                    var link = document.createElement('a');
                    link.href = URL.createObjectURL(blob);
                    link.download = outName;
                    document.body.appendChild(link);
                    link.click();
                    document.body.removeChild(link);
                    URL.revokeObjectURL(link.href);
                })
                .catch(function (err) {
                    if (window.Swal) {
                        window.Swal.fire({
                            icon: 'error',
                            title: 'Error',
                            text: (err && err.message) ? err.message : (t.export_error || 'Export failed'),
                            confirmButtonColor: '#0d6efd'
                        });
                    }
                })
                .finally(function () {
                    $b.prop('disabled', false);
                });
        });
    }

    function buildMarkerExportRow(row) {
        var programDateCell = formatProgramDateCell(row.PROGRAM_DATE, 'display');
        if (programDateCell === '—') programDateCell = '';
        var dateCell = row.ENCODED_DT || '';
        if (dateCell && window.moment) {
            var md = parseMarkerHistoryDateString(dateCell);
            if (md) dateCell = md.format('YYYY-MM-DD HH:mm');
        }
        var amt = row.AMOUNT != null ? Number(row.AMOUNT) : 0;
        if (isNaN(amt)) amt = 0;
        var debtor = row.GUEST_NAME != null ? String(row.GUEST_NAME).trim() : '';
        var guarantor = row.GUARANTOR != null ? String(row.GUARANTOR).trim() : '';
        return [
            programDateCell,
            dateCell,
            (row.AGENT_CODE || '') + ' (' + (row.AGENT_NAME || '') + ')',
            debtor,
            amt,
            renderTransactionType(row.TRANSACTION_INFO, 'export', row),
            guarantor,
            row.REMARKS != null ? String(row.REMARKS) : ''
        ];
    }

    function initExport(table, exportBtnSelector, options) {
        options = options || {};
        if (!table || !exportBtnSelector) return;
        var $btn = $(exportBtnSelector);
        if (!$btn.length) return;

        $btn.off('click.markerExport').on('click.markerExport', function () {
            var t = window.markerTranslations || {};
            var headers = [
                t.program_date || 'Program Date',
                t.date || 'Date',
                t.account_name || 'Account Name',
                t.debtor || 'Debtor',
                t.amount || 'Amount',
                t.type || 'Type',
                t.guarantor || 'Guarantor',
                t.remarks || 'Remarks'
            ];
            var data = table.rows({ search: 'applied' }).data().toArray();
            var rows = data.map(function (row) {
                return buildMarkerExportRow(row);
            });
            if (rows.length === 0) {
                if (window.Swal) {
                    window.Swal.fire({
                        icon: 'info',
                        title: t.export || 'Export',
                        text: t.no_data_export || 'No data to export for the current filter.',
                        confirmButtonColor: '#0d6efd'
                    });
                }
                return;
            }
            var outName = options.fileName || getMarkerExportDefaultFilename();
            var $b = $(this);
            $b.prop('disabled', true);
            fetch('/marker_history/export_xlsx', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'same-origin',
                body: JSON.stringify({
                    headers: headers,
                    rows: rows,
                    filename: outName,
                    sheetName: options.sheetName || 'Credit History',
                    profileKey: 'markerHistory'
                })
            })
                .then(function (res) {
                    if (!res.ok) {
                        return res.json().catch(function () { return {}; }).then(function (j) {
                            throw new Error((j && j.error) ? j.error : (t.export_error || 'Export failed'));
                        });
                    }
                    return res.blob();
                })
                .then(function (blob) {
                    var link = document.createElement('a');
                    link.href = URL.createObjectURL(blob);
                    link.download = outName;
                    document.body.appendChild(link);
                    link.click();
                    document.body.removeChild(link);
                    URL.revokeObjectURL(link.href);
                })
                .catch(function (err) {
                    if (window.Swal) {
                        window.Swal.fire({
                            icon: 'error',
                            title: 'Error',
                            text: (err && err.message) ? err.message : (t.export_error || 'Export failed'),
                            confirmButtonColor: '#0d6efd'
                        });
                    }
                })
                .finally(function () {
                    $b.prop('disabled', false);
                });
        });
    }

    function loadGameListScriptOnce() {
        return new Promise(function (resolve, reject) {
            if (typeof window.addGameList === 'function') {
                resolve();
                return;
            }
            var src = '/assets/js/functions/game_list.js';
            var existing = document.querySelector('script[src="' + src + '"]');
            var waitForAddGameList = function (attempt) {
                var tryNo = attempt || 0;
                if (typeof window.addGameList === 'function') {
                    resolve();
                    return;
                }
                if (tryNo >= 100) {
                    reject(new Error('addGameList not available'));
                    return;
                }
                setTimeout(function () { waitForAddGameList(tryNo + 1); }, 50);
            };
            if (existing) {
                waitForAddGameList(0);
                return;
            }
            var script = document.createElement('script');
            script.src = src;
            script.onload = function () { waitForAddGameList(0); };
            script.onerror = function () { reject(new Error('Failed to load game_list.js')); };
            document.body.appendChild(script);
        });
    }

    function initForm(table, opts) {
        opts = opts || {};
        var formSelector = opts.formSelector || '#add_marker_settlement';
        var accountSelectSelector = opts.accountSelectSelector || '#txtAccountMarker';
        var guestSelectSelector = opts.guestSelectSelector || '#txtGuestMarker';
        var guestPlaceholder = opts.guestPlaceholder || ((window.markerTranslations && window.markerTranslations.select_guest_optional) || 'Select Guest (Optional)');
        var markerIssueSelector = opts.markerIssueSelector || '#txtMarkerIssue';
        var markerReturnSelector = opts.markerReturnSelector || '#txtMarkerReturn';
        var markerBalanceSelector = opts.markerBalanceSelector || '#txtMarkerBalance';
        var remarksSelector = opts.remarksSelector || '#txtRemarks';
        var programDateSelector = opts.programDateSelector || '#txtCreditProgramDate';
        var guarantorSelector = opts.guarantorSelector || '#txtGuarantor';
        var submitBtnSelector = opts.submitBtnSelector || '#submit_marker_settlement';
        var agentBalanceSelector = opts.agentBalanceSelector || '#AgentBalance';
        var gameStartBtnSelector = opts.gameStartBtnSelector || '#btn-credits-game-start';
        var hideModalOnGameStartSelector = opts.hideModalOnGameStartSelector || '#modal-new-marker';
        var optTransTypeName = opts.optTransTypeName || 'optTransType';
        var optReturnSourceName = opts.optReturnSourceName || 'optReturnSource';
        var supportAddCredit = opts.supportAddCredit === true;
        var useCreditActionRadios = opts.useCreditActionRadios === true;
        var optCreditActionName = opts.optCreditActionName || 'optCreditAction';
        var formModeHiddenSelector = opts.formModeHiddenSelector || '#optFormModeHidden';
        var transTypeHiddenSelector = opts.transTypeHiddenSelector || '#optTransTypeHidden';
        var optFormModeName = opts.optFormModeName || 'optFormMode';
        var returnTransTypeWrapSelector = opts.returnTransTypeWrapSelector || '#marker-return-trans-type-wrap';
        var amountLabelSelector = opts.amountLabelSelector || '#lbl-marker-amount';
        var issueFieldWrapSelector = opts.issueFieldWrapSelector || '#marker-issue-field-wrap';
        var balanceFieldWrapSelector = opts.balanceFieldWrapSelector || '#marker-balance-field-wrap';
        var issueBalanceRowSelector = opts.issueBalanceRowSelector || '#marker-issue-balance-row';
        var balanceLabelSelector = opts.balanceLabelSelector || '#lbl-marker-balance';
        var returnSourceWrapSelector = opts.returnSourceWrapSelector || '#marker-return-source-wrap';
        var formFieldsWrapSelector = opts.formFieldsWrapSelector || '#marker-form-fields-wrap';
        var totalBalanceGuestSelector = opts.totalBalanceGuestSelector || '#txtTotalBalanceGuest';
        var unifiedReturn = opts.unifiedReturn !== false;
        var selectPlaceholder = opts.selectPlaceholder || 'Select account';
        var dropdownParent = opts.dropdownParent || 'body';
        var isSubmitting = false;
        var markerData = [];
        var markerBreakdownData = [];
        var allAccountsData = [];

        var $form = $(formSelector);
        var $accountSelect = $(accountSelectSelector);
        var $guestSelect = $(guestSelectSelector);
        var $programDate = $(programDateSelector);
        var $guarantor = $(guarantorSelector);
        var $submitBtn = $(submitBtnSelector);
        if (!$form.length || !$accountSelect.length) return;

        function todayProgramDateValue() {
            var d = new Date();
            var yyyy = d.getFullYear();
            var mm = String(d.getMonth() + 1).padStart(2, '0');
            var dd = String(d.getDate()).padStart(2, '0');
            return yyyy + '-' + mm + '-' + dd;
        }

        var programDatePicker = null;

        function getProgramDateValue() {
            if (!$programDate.length) return '';
            if (programDatePicker) {
                if (programDatePicker.selectedDates && programDatePicker.selectedDates.length) {
                    try {
                        return programDatePicker.formatDate(programDatePicker.selectedDates[0], 'Y-m-d');
                    } catch (e) { /* fall through */ }
                }
                if (programDatePicker.input) {
                    return String(programDatePicker.input.value || '').trim();
                }
            }
            return String($programDate.val() || '').trim();
        }

        function setProgramDateValue(ymd) {
            var val = ymd || todayProgramDateValue();
            if (programDatePicker) {
                programDatePicker.setDate(val, true, 'Y-m-d');
                return;
            }
            if ($programDate.length) $programDate.val(val);
        }

        function initProgramDatePicker() {
            if (!$programDate.length || typeof flatpickr === 'undefined') {
                if ($programDate.length && !getProgramDateValue()) {
                    $programDate.val(todayProgramDateValue());
                }
                return;
            }
            var el = $programDate[0];
            if (el._flatpickr) {
                try { el._flatpickr.destroy(); } catch (e) {}
            }
            programDatePicker = flatpickr(el, {
                enableTime: false,
                dateFormat: 'Y-m-d',
                altInput: true,
                altFormat: 'm/d/Y',
                defaultDate: getProgramDateValue() || todayProgramDateValue(),
                allowInput: true,
                disableMobile: true,
                closeOnSelect: true
            });
            if (programDatePicker && programDatePicker.altInput) {
                programDatePicker.altInput.classList.add('form-control');
                programDatePicker.altInput.classList.remove('form-control-sm');
                programDatePicker.altInput.style.width = '100%';
                programDatePicker.altInput.required = true;
            }
        }

        initProgramDatePicker();

        function getGuestLabelsForGuarantor() {
            var labels = [];
            if (!$guestSelect.length) return labels;
            $guestSelect.find('option').each(function () {
                var val = String($(this).val() || '').trim();
                var text = String($(this).text() || '').trim();
                if (!val || !text || text === guestPlaceholder) return;
                labels.push(text);
            });
            return labels;
        }

        function getGuarantorValue() {
            if (!$guarantor.length) return '';
            return String($guarantor.val() || '').trim();
        }

        function clearGuarantorField() {
            if (!$guarantor.length) return;
            if ($guarantor.is('select')) {
                $guarantor.val(null).trigger('change');
            } else {
                $guarantor.val('');
            }
        }

        function getGuarantorHistoryRows() {
            try {
                if (window._markerTotalCreditTable && window._markerTotalCreditTable.rows) {
                    return window._markerTotalCreditTable.rows().data().toArray();
                }
            } catch (e) { /* noop */ }
            try {
                if (table && table.rows) return table.rows().data().toArray();
            } catch (e2) { /* noop */ }
            return [];
        }

        function getGuarantorAccountSource() {
            if (Array.isArray(window._accountOptionsCache) && window._accountOptionsCache.length) {
                return window._accountOptionsCache;
            }
            return allAccountsData || [];
        }

        function initGuarantorSelect2() {
            if (!$guarantor.length || typeof $guarantor.select2 !== 'function') return;
            if (!$guarantor.is('select')) return;
            if ($guarantor.data('select2')) {
                try { $guarantor.select2('destroy'); } catch (e) { /* noop */ }
            }
            var $parent = typeof dropdownParent === 'string' ? $(dropdownParent) : dropdownParent;
            var t = window.markerTranslations || {};
            $guarantor.select2({
                placeholder: t.guarantor || 'Guarantor',
                allowClear: true,
                tags: true,
                width: '100%',
                dropdownParent: $parent.length ? $parent : $('body')
            });
        }

        function rebuildGuarantorSelectOptions(keepValue) {
            if (!$guarantor.length || !$guarantor.is('select')) return;
            var current = keepValue !== undefined ? String(keepValue || '').trim() : getGuarantorValue();
            var labels = [];
            if (window.CreditGuarantorAutocomplete && typeof window.CreditGuarantorAutocomplete.buildSuggestionList === 'function') {
                labels = window.CreditGuarantorAutocomplete.buildSuggestionList({
                    accounts: getGuarantorAccountSource(),
                    historyRows: getGuarantorHistoryRows(),
                    guests: getGuestLabelsForGuarantor()
                });
            }
            if ($guarantor.data('select2')) {
                try { $guarantor.select2('destroy'); } catch (e) { /* noop */ }
            }
            $guarantor.empty().append($('<option></option>').val(''));
            (labels || []).forEach(function (label) {
                var text = String(label || '').trim();
                if (!text) return;
                $guarantor.append($('<option></option>').val(text).text(text));
            });
            if (current) {
                var has = false;
                $guarantor.find('option').each(function () {
                    if (String($(this).val()) === current) has = true;
                });
                if (!has) {
                    $guarantor.append($('<option></option>').val(current).text(current));
                }
            }
            initGuarantorSelect2();
            if (current) {
                $guarantor.val(current).trigger('change');
            } else {
                $guarantor.val(null).trigger('change');
            }
        }

        var creditGuarantorAutocomplete = null;
        function initCreditGuarantorAutocomplete() {
            if (!$guarantor.length || !window.CreditGuarantorAutocomplete) return;
            if ($guarantor.is('select')) return;
            try {
                creditGuarantorAutocomplete = window.CreditGuarantorAutocomplete.initCreditGuarantorField($guarantor[0], {
                    getHistoryRows: function () {
                        return getGuarantorHistoryRows();
                    },
                    getGuestLabels: function () {
                        return getGuestLabelsForGuarantor();
                    }
                });
            } catch (e) {
                creditGuarantorAutocomplete = null;
            }
        }

        function refreshGuarantorSuggestions(keepValue) {
            if ($guarantor.is('select')) {
                rebuildGuarantorSelectOptions(keepValue);
                return;
            }
            if (creditGuarantorAutocomplete && typeof creditGuarantorAutocomplete.refresh === 'function') {
                creditGuarantorAutocomplete.refresh();
            }
        }

        function syncGuarantorFromSelectedGuest() {
            if (!$guarantor.length || $guarantor.is('select')) return;
            var guestLabel = getSelectedGuestLabel();
            if (!guestLabel) return;
            if (!getGuarantorValue()) {
                $guarantor.val(guestLabel);
            }
        }

        function bootstrapGuarantorField() {
            if ($guarantor.is('select')) {
                rebuildGuarantorSelectOptions('');
                if (typeof window.preloadAccounts === 'function') {
                    window.preloadAccounts().then(function () {
                        rebuildGuarantorSelectOptions(getGuarantorValue());
                    }).catch(function () { /* noop */ });
                }
                $(document)
                    .off('draw.dt.markerGuarantor', '#marker-accounts-total-tbl')
                    .on('draw.dt.markerGuarantor', '#marker-accounts-total-tbl', function () {
                        rebuildGuarantorSelectOptions(getGuarantorValue());
                    });
                return;
            }
            initCreditGuarantorAutocomplete();
        }
        bootstrapGuarantorField();

        // select2 4.0.13 re-opens the dropdown right after the "x" clear (it fires
        // an internal 'toggle'). Inside a modal that reads as a broken clear. Swallow
        // the single 'opening' that immediately follows a clear so the value just clears.
        function suppressSelect2ReopenOnClear($sel) {
            $sel.off('select2:clearing.markerClear select2:opening.markerClear');
            $sel.on('select2:clearing.markerClear', function () {
                $sel.data('markerJustCleared', true);
                // self-heal: the reopen is synchronous, so drop the flag right after
                setTimeout(function () { $sel.removeData('markerJustCleared'); }, 0);
            });
            $sel.on('select2:opening.markerClear', function (e) {
                if ($sel.data('markerJustCleared')) {
                    $sel.removeData('markerJustCleared');
                    if (e && typeof e.preventDefault === 'function') e.preventDefault();
                }
            });
        }

        function initAccountSelect2() {
            if (typeof $accountSelect.select2 !== 'function') return;
            if ($accountSelect.data('select2')) {
                try { $accountSelect.select2('destroy'); } catch (e) {}
            }
            var $parent = typeof dropdownParent === 'string' ? $(dropdownParent) : dropdownParent;
            $accountSelect.select2({
                placeholder: selectPlaceholder,
                allowClear: true,
                dropdownParent: $parent.length ? $parent : $('body')
            });
            suppressSelect2ReopenOnClear($accountSelect);
        }

        function initGuestSelect2() {
            if (!$guestSelect.length || typeof $guestSelect.select2 !== 'function') return;
            if ($guestSelect.data('select2')) {
                try { $guestSelect.select2('destroy'); } catch (e) {}
            }
            var $parent = typeof dropdownParent === 'string' ? $(dropdownParent) : dropdownParent;
            $guestSelect.select2({
                placeholder: guestPlaceholder,
                allowClear: true,
                dropdownParent: $parent.length ? $parent : $('body')
            });
            suppressSelect2ReopenOnClear($guestSelect);
        }

        function clearGuestOptions() {
            if (!$guestSelect.length) return;
            if ($guestSelect.data('select2')) {
                try { $guestSelect.select2('destroy'); } catch (e) {}
            }
            $guestSelect.empty().append($('<option></option>').val('').text(guestPlaceholder));
            $guestSelect.val('').prop('disabled', true);
            initGuestSelect2();
        }

        function resolveAgentIdForAccount(accountId) {
            if (!accountId) return '';
            var fromOption = $accountSelect.find('option:selected').attr('data-agent-id');
            if (fromOption) return String(fromOption);
            var issueAcc = (allAccountsData || []).filter(function (a) {
                return String(a.account_id) === String(accountId);
            })[0];
            if (issueAcc && (issueAcc.agent_id || issueAcc.AGENT_ID)) {
                return String(issueAcc.agent_id || issueAcc.AGENT_ID);
            }
            var breakdownAcc = findBreakdownAccount(accountId);
            if (breakdownAcc && breakdownAcc.AGENT_ID) return String(breakdownAcc.AGENT_ID);
            var markerAcc = (markerData || []).filter(function (a) {
                return String(a.ACCOUNT_ID) === String(accountId);
            })[0];
            if (markerAcc && markerAcc.AGENT_ID) return String(markerAcc.AGENT_ID);
            return '';
        }

        function loadGuestsForSelectedAccount(preselectGuestId) {
            if (!$guestSelect.length) return;
            var accountId = $accountSelect.val();
            var agentId = resolveAgentIdForAccount(accountId);
            clearGuestOptions();
            if (!accountId || !agentId) return;

            $.ajax({
                url: '/guest_data?agentId=' + encodeURIComponent(agentId),
                method: 'GET',
                success: function (rows) {
                    var guests = Array.isArray(rows) ? rows : [];
                    if ($guestSelect.data('select2')) {
                        try { $guestSelect.select2('destroy'); } catch (e) {}
                    }
                    $guestSelect.empty().append($('<option></option>').val('').text(guestPlaceholder));
                    guests.forEach(function (guest) {
                        var guestId = guest.guest_id;
                        if (guestId == null) return;
                        $guestSelect.append(
                            $('<option></option>').val(String(guestId)).text(String(guest.guest_name || '').trim() || ('Guest #' + guestId))
                        );
                    });
                    $guestSelect.prop('disabled', false);
                    initGuestSelect2();
                    if (preselectGuestId && $guestSelect.find('option[value="' + String(preselectGuestId) + '"]').length) {
                        $guestSelect.val(String(preselectGuestId)).trigger('change');
                    } else {
                        $guestSelect.val('').trigger('change');
                    }
                },
                error: function () {
                    clearGuestOptions();
                }
            });
        }

        function getSelectedGuestId() {
            if (!$guestSelect.length) return '';
            return String($guestSelect.val() || '').trim();
        }

        function getSelectedGuestLabel() {
            if (!$guestSelect.length) return '';
            var val = $guestSelect.val();
            if (!val) return '';
            return String($guestSelect.find('option:selected').text() || '').trim();
        }

        function getSelectedCreditAction() {
            if (!useCreditActionRadios) return null;
            return $('input[name="' + optCreditActionName + '"]:checked').val() || null;
        }

        function syncCreditActionHiddenFields() {
            if (!useCreditActionRadios) return;
            var action = getSelectedCreditAction();
            var mode = '';
            var transType = '';
            if (action === 'return_deposit') {
                mode = 'return';
                transType = '12';
            } else if (action === 'return_cash') {
                mode = 'return';
                transType = '11';
            } else if (action === 'cash_credit' || action === 'game_credit') {
                mode = 'issue';
            }
            var $modeHidden = $(formModeHiddenSelector);
            var $transHidden = $(transTypeHiddenSelector);
            if ($modeHidden.length) $modeHidden.val(mode);
            if ($transHidden.length) $transHidden.val(transType);
        }

        function getSelectedReturnSource() {
            return $('input[name="' + optReturnSourceName + '"]:checked').val();
        }

        function getFormMode() {
            if (useCreditActionRadios) {
                var action = getSelectedCreditAction();
                if (action === 'return_deposit' || action === 'return_cash') return 'return';
                if (action === 'cash_credit' || action === 'game_credit') return 'issue';
                return null;
            }
            if (!supportAddCredit) return 'return';
            return $('input[name="' + optFormModeName + '"]:checked').val() || null;
        }

        function hasFormModeSelected() {
            return !!getFormMode();
        }

        function usesUnifiedReturn() {
            return unifiedReturn && getFormMode() === 'return';
        }

        function buildMarkerSettlementData() {
            var payload = $form.serializeArray().filter(function (item) {
                if (item.name === optCreditActionName) return false;
                return !(usesUnifiedReturn() && item.name === optReturnSourceName);
            });
            if (usesUnifiedReturn()) {
                payload.push({ name: optReturnSourceName, value: 'auto' });
            }
            if (useCreditActionRadios) {
                syncCreditActionHiddenFields();
                var mode = getFormMode();
                var transType = $(transTypeHiddenSelector).val();
                var hasMode = false;
                var hasTrans = false;
                payload = payload.map(function (item) {
                    if (item.name === optFormModeName) {
                        hasMode = true;
                        return { name: item.name, value: mode || '' };
                    }
                    if (item.name === optTransTypeName) {
                        hasTrans = true;
                        return { name: item.name, value: transType || '' };
                    }
                    return item;
                });
                if (!hasMode) payload.push({ name: optFormModeName, value: mode || '' });
                if (!hasTrans) payload.push({ name: optTransTypeName, value: transType || '' });
            }
            return $.param(payload);
        }

        function updateFormModeUI() {
            var mode = getFormMode();
            var hasMode = !!mode;
            var isIssue = mode === 'issue';
            var unified = usesUnifiedReturn();
            var t = window.markerTranslations || {};
            var $returnWrap = $(returnTransTypeWrapSelector);
            var $amountLabel = $(amountLabelSelector);
            var $balanceLabel = $(balanceLabelSelector);
            var $issueWrap = $(issueFieldWrapSelector);
            var $balanceWrap = $(balanceFieldWrapSelector);
            var $issueBalanceRow = $(issueBalanceRowSelector);
            var $sourceWrap = $(returnSourceWrapSelector);
            var $formFieldsWrap = $(formFieldsWrapSelector);
            var creditAction = getSelectedCreditAction();
            var isGameCredit = creditAction === 'game_credit';

            if (useCreditActionRadios) {
                syncCreditActionHiddenFields();
                if ($formFieldsWrap.length) $formFieldsWrap.show();
                // Credits Issue / Balance / Current Balance stay hidden on this form.
                if ($issueBalanceRow.length) $issueBalanceRow.hide();
                if ($issueWrap.length) $issueWrap.hide();
                if ($balanceWrap.length) $balanceWrap.hide();
            } else if ($formFieldsWrap.length) {
                $formFieldsWrap.toggle(hasMode);
            }
            var perms = $('#user-role').length ? parseInt($('#user-role').data('permissions'), 10) : null;
            var viewOnly = perms === 2;
            if (useCreditActionRadios) {
                $submitBtn.prop('disabled', viewOnly || !hasMode || isGameCredit);
            } else {
                $submitBtn.prop('disabled', !hasMode || viewOnly);
            }
            if (!hasMode && !useCreditActionRadios) {
                $accountSelect.val('').trigger('change');
                $(markerReturnSelector).val('');
                $(markerIssueSelector).val('');
                $(markerBalanceSelector).val('');
                $('input[name="' + optTransTypeName + '"]').prop('checked', false);
                return;
            }
            if (!hasMode && useCreditActionRadios) {
                // Keep Account / Guest / Amount — user selects those before the credit radio.
                updateCreditActionRadiosEnabled();
                updateCreditsGameStartButton();
                return;
            }

            if ($sourceWrap.length) {
                if (useCreditActionRadios) $sourceWrap.hide();
                else $sourceWrap.toggle(!unified && !isIssue);
            }
            if ($returnWrap.length) {
                if (useCreditActionRadios) $returnWrap.hide();
                else $returnWrap.toggle(!isIssue);
            }
            if ($amountLabel.length) {
                $amountLabel.text(t.amount || 'Amount');
            }
            if (!useCreditActionRadios) {
                if ($balanceLabel.length) {
                    $balanceLabel.text(isIssue ? (t.current_balance || 'Current Balance') : (t.balance || 'Balance'));
                }
                if ($issueWrap.length) $issueWrap.toggle(!isIssue);
            }
            if ((unified || isIssue) && !useCreditActionRadios) {
                $('input[name="' + optReturnSourceName + '"]').prop('checked', false);
            }
            updateCreditActionRadiosEnabled();
            updateCreditsGameStartButton();
        }

        function applyFormModeUI() {
            updateFormModeUI();
        }

        function findBreakdownAccount(accountId) {
            return (markerBreakdownData || []).filter(function (a) { return String(a.ACCOUNT_ID) === String(accountId); })[0];
        }

        function getSourceAmountByRow(row, source) {
            if (!row) return 0;
            if (source === 'credit') return row.BALANCE_CREDIT != null ? Number(row.BALANCE_CREDIT) : 0;
            if (source === 'buyin') return row.BALANCE_BUYIN != null ? Number(row.BALANCE_BUYIN) : 0;
            return row.TOTAL_AMOUNT != null ? Number(row.TOTAL_AMOUNT) : 0;
        }

        function refreshAccountOptionsBySource() {
            var selectedSource = getSelectedReturnSource();
            if ($accountSelect.data('select2')) {
                try { $accountSelect.select2('destroy'); } catch (e) {}
            }
            $accountSelect.empty().append('<option value="">' + selectPlaceholder + '</option>');

            var sourceList = [];
            // Credit History radios: always keep the full account list so Account/Guest/Amount
            // stay intact when the user picks a transaction last.
            if (useCreditActionRadios) {
                sourceList = (allAccountsData || []).map(function (acc) {
                    return {
                        ACCOUNT_ID: acc.account_id,
                        AGENT_ID: acc.agent_id || acc.AGENT_ID,
                        AGENT_CODE: acc.agent_code,
                        AGENT_NAME: acc.agent_name
                    };
                });
            } else if (getFormMode() === 'issue') {
                sourceList = (allAccountsData || []).map(function (acc) {
                    return {
                        ACCOUNT_ID: acc.account_id,
                        AGENT_ID: acc.agent_id || acc.AGENT_ID,
                        AGENT_CODE: acc.agent_code,
                        AGENT_NAME: acc.agent_name
                    };
                });
            } else if (usesUnifiedReturn()) {
                sourceList = (markerBreakdownData || []).filter(function (row) {
                    return getSourceAmountByRow(row, null) > 0;
                }).map(function (row) {
                    return {
                        ACCOUNT_ID: row.ACCOUNT_ID,
                        AGENT_ID: row.AGENT_ID,
                        AGENT_CODE: row.AGENT_CODE,
                        AGENT_NAME: row.AGENT_NAME
                    };
                });
            } else if (selectedSource) {
                sourceList = (markerBreakdownData || []).filter(function (row) {
                    return getSourceAmountByRow(row, selectedSource) > 0;
                }).map(function (row) {
                    return {
                        ACCOUNT_ID: row.ACCOUNT_ID,
                        AGENT_ID: row.AGENT_ID,
                        AGENT_CODE: row.AGENT_CODE,
                        AGENT_NAME: row.AGENT_NAME
                    };
                });
            }

            sourceList.forEach(function (account) {
                var $opt = $('<option></option>')
                    .val(account.ACCOUNT_ID)
                    .text((account.AGENT_CODE || '') + ' - ' + (account.AGENT_NAME || ''));
                if (account.AGENT_ID) $opt.attr('data-agent-id', account.AGENT_ID);
                $accountSelect.append($opt);
            });
            initAccountSelect2();
        }

        function ensureMarkerBreakdownLoaded(done) {
            if ((markerBreakdownData || []).length) {
                if (typeof done === 'function') done();
                return;
            }
            $.ajax({
                url: '/marker_data_breakdown',
                method: 'GET'
            }).done(function (rows) {
                markerBreakdownData = Array.isArray(rows) ? rows : [];
                if (markerBreakdownData.length) headerCreditState.breakdown = markerBreakdownData;
                if (typeof done === 'function') done();
            }).fail(function () {
                markerBreakdownData = markerBreakdownData || [];
                if (typeof done === 'function') done();
            });
        }

        function resetCreditFormAfterSave() {
            try { $form[0].reset(); } catch (e) {}
            $('input[name="' + optCreditActionName + '"]').prop('checked', false);
            $(formModeHiddenSelector).val('').data('prevMode', null);
            $(transTypeHiddenSelector).val('');
            $(markerReturnSelector).val('');
            $(markerIssueSelector).val('');
            $(markerBalanceSelector).val('');
            $(remarksSelector).val('');
            setProgramDateValue(todayProgramDateValue());
            clearGuarantorField();
            $(totalBalanceGuestSelector).val('');
            if ($accountSelect.data('select2')) {
                $accountSelect.val(null).trigger('change');
            } else {
                $accountSelect.val('').trigger('change');
            }
            clearGuestOptions();
            applyHeaderCreditTotals(null);
            applyFormModeUI();
        }

        function updateCreditActionRadiosEnabled() {
            if (!useCreditActionRadios) return;
            var hasAccount = !!String($accountSelect.val() || '').trim();
            var amountVal = parseFloat(String($(markerReturnSelector).val() || '').replace(/,/g, '')) || 0;
            var hasAmount = amountVal > 0;
            var canSelect = hasAccount && hasAmount;
            var $radios = $('input[name="' + optCreditActionName + '"]');
            $radios.prop('disabled', !canSelect);
            if (!canSelect) {
                $radios.prop('checked', false);
                syncCreditActionHiddenFields();
                $(formModeHiddenSelector).data('prevMode', null);
                updateCreditsGameStartButton();
            }
        }

        function updateCreditsGameStartButton() {
            var $btn = $(gameStartBtnSelector);
            if ($btn.length) $btn.addClass('d-none');
            var creditAction = getSelectedCreditAction();
            // Game credit opens New Game immediately — hide Save while that action is selected.
            if (useCreditActionRadios && creditAction === 'game_credit') {
                $submitBtn.addClass('d-none');
            } else {
                $submitBtn.removeClass('d-none');
            }
        }

        function openCreditsGameStart() {
            var accountId = String($accountSelect.val() || '').trim();
            if (!accountId) {
                if (window.Swal) {
                    window.Swal.fire({ icon: 'warning', title: 'No account', text: 'Please select an account first.', confirmButtonText: 'OK' });
                }
                return;
            }
            if (!$('#modal-new-game-list').length) {
                if (window.Swal) {
                    window.Swal.fire({
                        icon: 'error',
                        title: 'Unavailable',
                        text: 'New Game modal is not available on this page.',
                        confirmButtonText: 'OK'
                    });
                }
                return;
            }
            var creditNnAmount = parseFloat(String($(markerReturnSelector).val() || '').replace(/,/g, '')) || 0;
            var programDateForGame = getProgramDateValue() || null;
            loadGameListScriptOnce().then(function () {
                var openingBalance = parseFloat($(agentBalanceSelector).val()) || 0;
                if (!openingBalance) {
                    openingBalance = parseFloat(String($(markerBalanceSelector).val() || '').replace(/,/g, '')) || 0;
                }
                var $hideModal = $(hideModalOnGameStartSelector);
                if ($hideModal.length) {
                    skipMarkerModalReload = true;
                    $hideModal.modal('hide');
                }
                window.addGameList(accountId, {
                    openingBalance: openingBalance,
                    lockAccount: true,
                    preselectGuestId: getSelectedGuestId() || null,
                    prefillCreditNN: creditNnAmount > 0 ? creditNnAmount : null,
                    prefillCreditGuarantor: getGuarantorValue() || null,
                    prefillProgramDate: programDateForGame,
                    redirectToGamebook: true
                });
            }).catch(function () {
                if (window.Swal) {
                    window.Swal.fire({
                        icon: 'error',
                        title: 'Unavailable',
                        text: 'Unable to open New Game modal right now.',
                        confirmButtonText: 'OK'
                    });
                }
            });
        }

        function updateIssueAndBalanceBySelectedAccount() {
            var selectedAccountId = $accountSelect.val();
            applyHeaderCreditTotals(selectedAccountId || null);
            if (!selectedAccountId) {
                $(markerIssueSelector).val('');
                $(markerBalanceSelector).val('');
                $(totalBalanceGuestSelector).val('');
                updateCreditsGameStartButton();
                return;
            }
            var selectedSource = getSelectedReturnSource();
            if (getFormMode() === 'issue' || (useCreditActionRadios && !getFormMode())) {
                var breakdownAccIssue = findBreakdownAccount(selectedAccountId);
                var issueAcc = (allAccountsData || []).filter(function (a) {
                    return String(a.account_id) === String(selectedAccountId);
                })[0];
                var totalCreditBalance = breakdownAccIssue
                    ? getSourceAmountByRow(breakdownAccIssue, null)
                    : (issueAcc ? (parseFloat(issueAcc.credit_balance) || 0) : 0);
                $(markerBalanceSelector).val(formatWithCommas(totalCreditBalance));
                $(totalBalanceGuestSelector).val(String(totalCreditBalance));
                updateCreditsGameStartButton();
                return;
            }
            var breakdownAcc = findBreakdownAccount(selectedAccountId);
            if (usesUnifiedReturn()) {
                var totalIssue = breakdownAcc ? getSourceAmountByRow(breakdownAcc, null) : 0;
                if (!totalIssue) {
                    var selectedAccount = (markerData || []).filter(function (a) { return String(a.ACCOUNT_ID) === String(selectedAccountId); })[0];
                    totalIssue = selectedAccount ? (selectedAccount.TOTAL_AMOUNT || 0) : 0;
                }
                $(markerIssueSelector).val(formatWithCommas(totalIssue));
                var currentReturn = parseFloat(String($(markerReturnSelector).val() || '').replace(/,/g, '')) || 0;
                $(markerBalanceSelector).val(formatWithCommas(Math.max(0, totalIssue - currentReturn)));
                updateCreditsGameStartButton();
                return;
            }
            if (selectedSource) {
                var sourceAmount = getSourceAmountByRow(breakdownAcc, selectedSource);
                $(markerIssueSelector).val(formatWithCommas(sourceAmount));
                $(markerBalanceSelector).val(formatWithCommas(sourceAmount));
                updateCreditsGameStartButton();
                return;
            }
            var selectedAccount = (markerData || []).filter(function (a) { return String(a.ACCOUNT_ID) === String(selectedAccountId); })[0];
            var totalIssueFallback = selectedAccount ? (selectedAccount.TOTAL_AMOUNT || 0) : 0;
            $(markerIssueSelector).val(formatWithCommas(totalIssueFallback));
            $(markerBalanceSelector).val(formatWithCommas(totalIssueFallback));
            updateCreditsGameStartButton();
        }

        // Populate accounts (call this on modal show or page load). Optional callback(accounts) runs after data is loaded.
        function populateAccounts(callback) {
            if (useCreditActionRadios || getFormMode() === 'issue') {
                $.when(
                    $.ajax({ url: '/account_data', method: 'GET' }),
                    $.ajax({ url: '/marker_data_breakdown', method: 'GET' })
                ).done(function (accountRes, breakdownRes) {
                    var selectedAccountId = $accountSelect.val();
                    var selectedGuestId = getSelectedGuestId();
                    var selectedAmount = $(markerReturnSelector).val();
                    allAccountsData = accountRes && accountRes[0] ? accountRes[0] : [];
                    markerBreakdownData = breakdownRes && breakdownRes[0] ? breakdownRes[0] : [];
                    if (Array.isArray(markerBreakdownData) && markerBreakdownData.length) {
                        headerCreditState.breakdown = markerBreakdownData;
                    }
                    refreshAccountOptionsBySource();
                    if (useCreditActionRadios && selectedAccountId && $accountSelect.find('option[value="' + selectedAccountId + '"]').length) {
                        $accountSelect.val(String(selectedAccountId));
                        if ($accountSelect.data('select2')) $accountSelect.trigger('change.select2');
                        if (selectedAmount) $(markerReturnSelector).val(selectedAmount);
                        updateIssueAndBalanceBySelectedAccount();
                        loadGuestsForSelectedAccount(selectedGuestId || null);
                    } else {
                        updateIssueAndBalanceBySelectedAccount();
                    }
                    rebuildGuarantorSelectOptions(getGuarantorValue());
                    if (typeof callback === 'function') callback(allAccountsData);
                }).fail(function (err) {
                    console.error('Error fetching account data:', err);
                    allAccountsData = [];
                    markerBreakdownData = [];
                    refreshAccountOptionsBySource();
                    rebuildGuarantorSelectOptions(getGuarantorValue());
                    if (typeof callback === 'function') callback([]);
                });
                return;
            }
            $.when(
                $.ajax({ url: '/marker_data', method: 'GET' }),
                $.ajax({ url: '/marker_data_breakdown', method: 'GET' })
            ).done(function (markerRes, breakdownRes) {
                markerData = markerRes && markerRes[0] ? markerRes[0] : [];
                markerBreakdownData = breakdownRes && breakdownRes[0] ? breakdownRes[0] : [];
                refreshAccountOptionsBySource();
                updateIssueAndBalanceBySelectedAccount();
                if (typeof callback === 'function') callback(markerData);
            }).fail(function (err) {
                console.error('Error fetching marker data:', err);
                markerData = [];
                markerBreakdownData = [];
                refreshAccountOptionsBySource();
                if (typeof callback === 'function') callback([]);
            });
        }

        if (opts.populateAccountsOnInit) {
            populateAccounts();
        }

        updateFormModeUI();
        clearGuestOptions();
        updateCreditActionRadiosEnabled();

        $accountSelect.off('change.markerForm').on('change.markerForm', function () {
            updateIssueAndBalanceBySelectedAccount();
            loadGuestsForSelectedAccount();
            updateCreditActionRadiosEnabled();
            applyFormModeUI();
        });

        $(document).off('change.markerReturnSource', 'input[name="' + optReturnSourceName + '"]').on('change.markerReturnSource', 'input[name="' + optReturnSourceName + '"]', function () {
            var currentAccount = $accountSelect.val();
            refreshAccountOptionsBySource();
            if (currentAccount && $accountSelect.find('option[value="' + currentAccount + '"]').length) {
                $accountSelect.val(currentAccount).trigger('change');
            } else {
                $accountSelect.val('').trigger('change');
                $(markerIssueSelector).val('');
                $(markerBalanceSelector).val('');
            }
            updateCreditsGameStartButton();
        });

        $(document).off('change.markerFormMode', 'input[name="' + optFormModeName + '"]').on('change.markerFormMode', 'input[name="' + optFormModeName + '"]', function () {
            if (useCreditActionRadios) return;
            $accountSelect.val('').trigger('change');
            $(markerReturnSelector).val('');
            $('input[name="' + optTransTypeName + '"]').prop('checked', false);
            populateAccounts();
            applyFormModeUI();
        });

        if (useCreditActionRadios) {
            $(document).off('change.markerCreditAction', 'input[name="' + optCreditActionName + '"]').on('change.markerCreditAction', 'input[name="' + optCreditActionName + '"]', function () {
                var savedAmount = $(markerReturnSelector).val();
                var selectedAction = $(this).val();
                syncCreditActionHiddenFields();
                $(formModeHiddenSelector).data('prevMode', getFormMode());
                // Do not rebuild account list / clear fields — Account, Guest, Amount stay as entered.
                ensureMarkerBreakdownLoaded(function () {
                    applyFormModeUI();
                    updateIssueAndBalanceBySelectedAccount();
                    if (savedAmount) {
                        $(markerReturnSelector).val(savedAmount);
                        if (getFormMode() === 'return') {
                            $(markerReturnSelector).trigger('input.markerForm');
                        }
                    }
                    if (selectedAction === 'game_credit') {
                        openCreditsGameStart();
                    }
                });
            });
        }

        $(document).off('click.markerGameStart', gameStartBtnSelector).on('click.markerGameStart', gameStartBtnSelector, function (e) {
            e.preventDefault();
            e.stopPropagation();
            openCreditsGameStart();
        });

        // Agent balance for deposit check (account_details_data_deposit)
        $accountSelect.off('change.markerBalance').on('change.markerBalance', function () {
            var accountId = $(this).val();
            if (!accountId) return;
            $.ajax({
                url: '/account_details_data_deposit/' + accountId,
                method: 'GET',
                success: function (data) {
                    var deposit_amount = 0, withdraw_amount = 0, marker_deposit_amount = 0, marker_return = 0;
                    (data || []).forEach(function (row) {
                        var amount = parseFloat(row.AMOUNT) || 0;
                        if (row.TRANSACTION === 'DEPOSIT') deposit_amount += amount;
                        else if (row.TRANSACTION === 'WITHDRAW') withdraw_amount += amount;
                        else if (row.TRANSACTION === 'MARKER REDEEM') marker_deposit_amount += amount;
                        else if (row.TRANSACTION === 'IOU RETURN DEPOSIT') marker_return += amount;
                    });
                    var totalBalance = deposit_amount + marker_deposit_amount - withdraw_amount - marker_return;
                    $(agentBalanceSelector).val(totalBalance);
                }
            });
        });

        // Format marker return/add input and balance (numbers only)
        $(markerReturnSelector).off('input.markerForm focusout.markerForm').on('input.markerForm', function () {
            var raw = sanitizeAmountInput($(this).val());
            var markerReturn = parseFloat(raw) || 0;
            if (getFormMode() === 'return') {
                var markerIssue = parseFloat($(markerIssueSelector).val().replace(/,/g, '')) || 0;
                if (markerIssue > 0 && markerReturn > markerIssue) {
                    $(this).val(formatWithCommas(markerIssue));
                    $(markerBalanceSelector).val(formatWithCommas(0));
                } else if (markerIssue > 0) {
                    $(markerBalanceSelector).val(formatWithCommas(markerIssue - markerReturn));
                }
            }
            $(this).val(raw === '' || raw === '.' ? raw : formatWithCommas(raw));
            updateCreditActionRadiosEnabled();
        }).on('focusout.markerForm', function () {
            var raw = sanitizeAmountInput($(this).val());
            if (raw === '' || raw === '.') {
                $(this).val('');
            } else {
                $(this).val(formatWithCommas(raw));
            }
            updateCreditActionRadiosEnabled();
        });

        $form.off('submit.markerForm').on('submit.markerForm', function (e) {
            e.preventDefault();
            if (isSubmitting) return;

            var selectedAccount = $(accountSelectSelector).val();
            var markerReturnRaw = $(markerReturnSelector).val().replace(/,/g, '');
            var markerReturn = parseFloat(markerReturnRaw) || 0;
            var selectedReturnSource = $('input[name="' + optReturnSourceName + '"]:checked').val();
            var formMode = getFormMode();
            var t = window.markerTranslations || {};

            if (!formMode) {
                if (window.Swal) {
                    Swal.fire({
                        icon: 'error',
                        title: 'Missing Information',
                        text: useCreditActionRadios
                            ? (t.select_credit_action || 'Please select a credit action.')
                            : (t.select_form_mode || 'Please select Add Credit or Return Credit.')
                    });
                }
                return;
            }

            if (useCreditActionRadios && getSelectedCreditAction() === 'game_credit') {
                openCreditsGameStart();
                return;
            }

            if (!selectedAccount) {
                if (window.Swal) Swal.fire({ icon: 'error', title: 'Missing Information', text: 'Please select an account.' });
                return;
            }
            if (!markerReturnRaw || markerReturn <= 0) {
                var amountLabel = formMode === 'issue' ? 'Credit amount' : 'Credit Return';
                if (window.Swal) Swal.fire({ icon: 'error', title: 'Invalid Amount', text: amountLabel + ' must be greater than zero.' });
                return;
            }
            var programDateVal = getProgramDateValue();
            if ($programDate.length && !programDateVal) {
                if (window.Swal) Swal.fire({ icon: 'error', title: 'Missing Information', text: (t.program_date || 'Program Date') + ' is required.' });
                return;
            }
            var guarantorVal = getGuarantorValue();
            if ($guarantor.length && !guarantorVal) {
                if (window.Swal) Swal.fire({ icon: 'error', title: 'Missing Information', text: (t.guarantor || 'Guarantor') + ' is required.' });
                return;
            }

            if (formMode === 'issue') {
                var accountMarkerIssue = $accountSelect.find('option:selected').text();
                var markerAddFormatted = $(markerReturnSelector).val();
                var currentCreditBalance = parseFloat(String($(totalBalanceGuestSelector).val() || '0').replace(/,/g, '')) || 0;
                var cashCreditLabel = (t.export_sheet_junket_credit || t.tab_credit || 'Cash Credit');
                var guestLabel = getSelectedGuestLabel();
                var confirmIssueRows = [
                    ['Account', accountMarkerIssue || 'N/A'],
                    ['Guest', guestLabel || '—'],
                    ['Amount', markerAddFormatted || '0'],
                    ['Credit Type', cashCreditLabel],
                    [t.program_date || 'Program Date', programDateVal || '—'],
                    [t.guarantor || 'Guarantor', guarantorVal || '—']
                ];

                var submitAddCredit = function () {
                    isSubmitting = true;
                    var origHtml = $submitBtn.html();
                    $submitBtn.prop('disabled', true).html('<span class="spinner-border spinner-border-sm" role="status"></span> Loading...');
                    var addPayload = {
                        txtAccountId: selectedAccount,
                        txtTrans: '3',
                        txtAmount: markerAddFormatted,
                        txtRemarks: $(remarksSelector).val() || '',
                        totalBalanceGuest: currentCreditBalance
                    };
                    if (programDateVal) addPayload.txtProgramDate = programDateVal;
                    addPayload.txtGuarantor = guarantorVal;
                    var guestId = getSelectedGuestId();
                    if (guestId) addPayload.txtGuestId = guestId;
                    $.ajax({
                        url: '/add_account_details',
                        method: 'POST',
                        data: addPayload,
                        success: function (response) {
                            var hasTelegramWarning = typeof response === 'object' && response.success && response.error;
                            resetCreditFormAfterSave();
                            if (table && table.ajax) table.ajax.reload();
                            $.getJSON('/marker_total_credits_issue', function (data) {
                                var total = (data && data.total != null) ? data.total : 0;
                                var numStr = Number(total).toLocaleString('en-US');
                                $('#txtTotalMarkerIssue').val(numStr);
                                $('#dashboard-credit-value').html('₱ ' + numStr);
                                if (headerCreditState.ready) {
                                    headerCreditState.overallTotalIssue = Number(total) || 0;
                                }
                                applyHeaderCreditTotals(null);
                            });
                            populateAccounts();
                            if (opts.onSuccess) opts.onSuccess();
                            if (window.Swal) {
                                if (hasTelegramWarning) {
                                    Swal.fire({
                                        icon: 'warning',
                                        title: 'Saved',
                                        html: '<strong>' + (response.message || 'Credit added.') + '</strong><br><br>' + response.error
                                    });
                                } else {
                                    Swal.fire({
                                        icon: 'success',
                                        title: 'Success',
                                        text: t.credit_added_success || 'Credit added successfully!'
                                    });
                                }
                            }
                        },
                        error: function (xhr) {
                            var msg = (xhr.responseJSON && (xhr.responseJSON.error || xhr.responseJSON.message)) || xhr.responseText || 'Error processing your request.';
                            if (window.Swal) Swal.fire({ icon: 'error', title: 'Error', text: msg });
                        },
                        complete: function () {
                            isSubmitting = false;
                            $submitBtn.prop('disabled', false).html(origHtml);
                            if (supportAddCredit) applyFormModeUI();
                        }
                    });
                };

                if (window.Swal && window.SwalConfirm) {
                    SwalConfirm.fire({
                        title: t.confirm_add_credit || 'Confirm Add Credit',
                        rows: confirmIssueRows,
                        message: t.confirm_add_credit_msg || 'Are you sure you want to add this credit?',
                        confirmButtonText: 'Yes, Save'
                    }).then(function (result) {
                        if (result.isConfirmed) submitAddCredit();
                    });
                } else {
                    submitAddCredit();
                }
                return;
            }

            var selectedTransType = useCreditActionRadios
                ? ($(transTypeHiddenSelector).val() || null)
                : $('input[name="' + optTransTypeName + '"]:checked').val();
            var markerIssue = parseFloat(String($(markerIssueSelector).val() || '').replace(/,/g, '')) || 0;
            if (!markerIssue && selectedAccount) {
                var breakdownForReturn = findBreakdownAccount(selectedAccount);
                markerIssue = breakdownForReturn ? getSourceAmountByRow(breakdownForReturn, null) : 0;
                if (markerIssue) {
                    $(markerIssueSelector).val(formatWithCommas(markerIssue));
                    $(markerBalanceSelector).val(formatWithCommas(Math.max(0, markerIssue - markerReturn)));
                }
            }
            var totalCreditFormatted = formatWithCommas(markerIssue);

            if (!selectedTransType) {
                if (window.Swal) Swal.fire({ icon: 'error', title: 'Missing Information', text: 'Please select a transaction type (Cash or Deposit).' });
                return;
            }
            if (markerReturn > markerIssue) {
                if (window.Swal) {
                    Swal.fire({
                        icon: 'error',
                        title: 'Invalid Return',
                        html: 'Credit Return cannot be greater than Total Credit.<br><br>' +
                            '<div style="display:inline-block;text-align:left;min-width:220px;">' +
                            '<div style="display:flex;justify-content:space-between;gap:24px;"><span><strong>Total Credit:</strong></span><span style="text-align:right;min-width:80px;">' + totalCreditFormatted + '</span></div>' +
                            '<div style="display:flex;justify-content:space-between;gap:24px;"><span><strong>Return Amount:</strong></span><span style="text-align:right;min-width:80px;">' + formatWithCommas(markerReturn) + '</span></div>' +
                            '</div>'
                    });
                }
                return;
            }

            var accountMarker = $accountSelect.find('option:selected').text();
            var markerReturnFormatted = $(markerReturnSelector).val();
            var transTypeLabel = useCreditActionRadios
                ? ($('input[name="' + optCreditActionName + '"]:checked').next('label').text() || selectedTransType)
                : $('input[name="' + optTransTypeName + '"]:checked').next('label').text();
            var proceedSubmitFlow = function () {
                var showConfirmAndSubmit = function () {
                    isSubmitting = true;
                    var origHtml = $submitBtn.html();
                    $submitBtn.prop('disabled', true).html('<span class="spinner-border spinner-border-sm" role="status"></span> Loading...');
                    $.ajax({
                        url: '/add_marker_settlement',
                        method: 'POST',
                        data: buildMarkerSettlementData(),
                        success: function (response) {
                            if (response.success) {
                                resetCreditFormAfterSave();
                                if (table && table.ajax) table.ajax.reload();
                                $.getJSON('/marker_total_credits_issue', function (data) {
                                    var total = (data && data.total != null) ? data.total : 0;
                                    var numStr = Number(total).toLocaleString('en-US');
                                    $('#txtTotalMarkerIssue').val(numStr);
                                    $('#dashboard-credit-value').html('₱ ' + numStr);
                                    if (headerCreditState.ready) {
                                        headerCreditState.overallTotalIssue = Number(total) || 0;
                                    }
                                    applyHeaderCreditTotals(null);
                                });
                                populateAccounts();
                                if (opts.onSuccess) opts.onSuccess();
                                if (window.Swal) {
                                    Swal.fire({ icon: 'success', title: 'Success', text: 'Marker Return Successfully!' });
                                }
                            } else if (response.error === 'Insufficient balance for this deposit transaction.') {
                                if (window.Swal) Swal.fire({ icon: 'error', title: 'Insufficient Balance', text: response.error });
                            } else {
                                if (window.Swal) Swal.fire({ icon: 'error', title: 'Error', text: response.message || 'Error processing your request.' });
                            }
                        },
                        error: function () {
                            if (window.Swal) Swal.fire({ icon: 'error', title: 'Insufficient Balance', text: 'Insufficient balance for this deposit transaction.' });
                        },
                        complete: function () {
                            isSubmitting = false;
                            $submitBtn.prop('disabled', false).html(origHtml);
                            if (supportAddCredit) applyFormModeUI();
                        }
                    });
                };

                var confirmReturnRows = [
                    ['Account', accountMarker || 'N/A'],
                    ['Guest', getSelectedGuestLabel() || '—'],
                    ['Total Credit', totalCreditFormatted || '0'],
                    ['Amount', markerReturnFormatted || '0'],
                    ['Transaction', transTypeLabel || 'N/A'],
                    [t.program_date || 'Program Date', programDateVal || '—'],
                    [t.guarantor || 'Guarantor', guarantorVal || '—']
                ];

                var showReturnConfirmSwal = function (title, message) {
                    if (window.Swal) {
                        SwalConfirm.fire({
                            title: title,
                            rows: confirmReturnRows,
                            message: message,
                            confirmButtonText: 'Yes, Save'
                        }).then(function (result) {
                            if (result.isConfirmed) showConfirmAndSubmit();
                        });
                    } else {
                        showConfirmAndSubmit();
                    }
                };

                // Deposit (12): check balance BEFORE showing confirm; insufficient = show error immediately
                if (selectedTransType === '12') {
                    $.ajax({
                        url: '/account_details_data_deposit/' + selectedAccount,
                        method: 'GET',
                        success: function (data) {
                            var deposit_amount = 0, withdraw_amount = 0, marker_deposit_amount = 0, marker_return = 0;
                            (data || []).forEach(function (row) {
                                var amount = parseFloat(row.AMOUNT) || 0;
                                if (row.TRANSACTION === 'DEPOSIT') deposit_amount += amount;
                                else if (row.TRANSACTION === 'WITHDRAW') withdraw_amount += amount;
                                else if (row.TRANSACTION === 'MARKER REDEEM') marker_deposit_amount += amount;
                                else if (row.TRANSACTION === 'IOU RETURN DEPOSIT') marker_return += amount;
                            });
                            var totalBalance = deposit_amount + marker_deposit_amount - withdraw_amount - marker_return;
                            if (totalBalance < markerReturn) {
                                if (window.Swal) Swal.fire({ icon: 'error', title: 'Insufficient Balance', text: 'Insufficient balance for this deposit transaction.' });
                                return;
                            }
                            showReturnConfirmSwal('Confirm Marker Return', 'Are you sure you want to proceed with this marker return?');
                        },
                        error: function () {
                            if (window.Swal) Swal.fire({ icon: 'error', title: 'Error', text: 'Failed to check balance.' });
                        }
                    });
                } else {
                    showReturnConfirmSwal('Confirm Credit Return', 'Are you sure you want to proceed with this credit return?');
                }
            };

            $.ajax({
                url: '/marker_data_breakdown',
                method: 'GET',
                success: function (rows) {
                    var list = Array.isArray(rows) ? rows : [];
                    var sourceRow = list.filter(function (r) { return String(r.ACCOUNT_ID) === String(selectedAccount); })[0];
                    var sourceBalance = 0;
                    if (sourceRow) {
                        if (usesUnifiedReturn()) {
                            sourceBalance = sourceRow.TOTAL_AMOUNT != null
                                ? Number(sourceRow.TOTAL_AMOUNT)
                                : getSourceAmountByRow(sourceRow, null);
                        } else {
                            sourceBalance = selectedReturnSource === 'credit'
                                ? (sourceRow.BALANCE_CREDIT != null ? Number(sourceRow.BALANCE_CREDIT) : 0)
                                : (sourceRow.BALANCE_BUYIN != null ? Number(sourceRow.BALANCE_BUYIN) : 0);
                        }
                    }
                    if (markerReturn > sourceBalance) {
                        var sourceBalanceMsg = usesUnifiedReturn()
                            ? 'Return amount exceeded the total credit balance.'
                            : ('Return amount exceeded the ' + (selectedReturnSource === 'credit' ? 'Junket Credit Balance' : 'Game Credit Balance') + '.');
                        if (window.Swal) Swal.fire({ icon: 'error', title: 'Invalid Amount', text: sourceBalanceMsg });
                        else alert(sourceBalanceMsg);
                        return;
                    }
                    proceedSubmitFlow();
                },
                error: function () {
                    if (window.Swal) Swal.fire({ icon: 'error', title: 'Error', text: 'Unable to validate source balance.' });
                }
            });
        });

        return {
            populateAccounts: populateAccounts
        };
    }

    function applyPermissions(disableSaveExport, submitBtnSelector, exportBtnSelector) {
        if (!disableSaveExport) return;
        var perms = parseInt($('#user-role').data('permissions'), 10);
        if (perms === 2) {
            $(submitBtnSelector || '#submit_marker_settlement').prop('disabled', true);
            $(exportBtnSelector || '#export-excel').prop('disabled', true);
            $('#export-excel-credit, #export-excel-buyin').prop('disabled', true);
        }
    }

    /**
     * Full init for marker UI.
     * @param {Object} options
     * @param {string} [options.tableSelector] - e.g. '#marker-tbl' or '#marker-history-tbl'
     * @param {string} [options.exportBtnSelector] - e.g. '#export-excel'
     * @param {boolean} [options.withForm] - whether to init form (account, return, save)
     * @param {Object} [options.formOptions] - passed to initForm (formSelector, populateAccountsOnInit, onSuccess, etc.)
     * @param {boolean} [options.disableSaveExportByPermission] - if true, disable save/export when permissions === 2
     * @param {string} [options.modalSelector] - if set, populate accounts on modal show and optional reload on modal hidden
     */
    function init(options) {
        options = options || {};
        var tableSelector = options.tableSelector || '#marker-tbl';
        var exportBtnSelector = options.exportBtnSelector || '#export-excel';
        var table = initHistoryTable(tableSelector, options.tableOptions || {});
        if (!table) return null;
        window._markerHistoryTable = table;

        var totalCreditTable = initTotalCreditTable('#marker-accounts-total-tbl');
        window._markerTotalCreditTable = totalCreditTable;
        window._markerReloadBalanceTables = function () {
            updateAccountsBalanceTable();
        };
        if (totalCreditTable && typeof totalCreditTable.on === 'function') {
            totalCreditTable.on('draw.dt', function () {
                updateTotalCreditTableFooter(totalCreditTable);
            });
        }

        function adjustHistoryTableLayout() {
            if (!table || typeof table.columns !== 'function') return;
            try {
                table.columns.adjust();
            } catch (e) { /* noop */ }
        }

        var markerResizeTimer;
        $(window).off('resize.markerHistoryDt').on('resize.markerHistoryDt', function () {
            clearTimeout(markerResizeTimer);
            markerResizeTimer = setTimeout(function () {
                if ($.fn.DataTable.isDataTable(tableSelector)) adjustHistoryTableLayout();
            }, 150);
        });

        if (options.modalSelector) {
            $(options.modalSelector)
                .off('shown.bs.modal.markerDtCols')
                .on('shown.bs.modal.markerDtCols', function () {
                    adjustHistoryTableLayout();
                });
        }

        function destroyBalanceDataTable(selector) {
            if (!$.fn.DataTable.isDataTable(selector)) return;
            $(selector).DataTable().destroy();
            var $tbl = $(selector);
            $tbl.find('tbody').empty();
            $tbl.find('tfoot th').each(function () { $(this).text(''); });
        }

        function updateDashboardUtangTotal(amount) {
            var el = document.getElementById('dash-utang-total');
            if (!el) return;
            var v = Math.round(Number(amount) || 0);
            if (!v) {
                el.textContent = '0';
                return;
            }
            el.innerHTML = '<span class="text-dash-neg">(' + Math.abs(v).toLocaleString('en-US') + ')</span>';
        }

        function updateAccountsBalanceTable() {
            var $creditTbl = $('#marker-accounts-credit-tbl');
            var $buyinTbl = $('#marker-accounts-buyin-tbl');
            if (!$creditTbl.length || !$buyinTbl.length) return;
            destroyBalanceDataTable('#marker-accounts-credit-tbl');
            destroyBalanceDataTable('#marker-accounts-buyin-tbl');
            var $creditTbody = $creditTbl.find('tbody');
            var $buyinTbody = $buyinTbl.find('tbody');
            $creditTbody.empty();
            $buyinTbody.empty();
            $.when(
                $.ajax({ url: '/marker_data_breakdown', method: 'GET' }),
                $.ajax({ url: '/marker_credit_status_breakdown', method: 'GET' })
            ).done(function (breakdownResp, statusResp) {
                var list = Array.isArray(breakdownResp[0]) ? breakdownResp[0] : [];
                headerCreditState.creditStatusBreakdown = Array.isArray(statusResp[0]) ? statusResp[0] : [];
                    var creditRows = [];
                    var buyinRows = [];
                    var totalCredit = 0;
                    var totalBuyin = 0;
                    var grandTotal = 0;
                    list.forEach(function (row) {
                        var name = (row.AGENT_CODE || '') + ' (' + (row.AGENT_NAME || '') + ')';
                        var credit = row.BALANCE_CREDIT != null ? Number(row.BALANCE_CREDIT) : 0;
                        var buyin = row.BALANCE_BUYIN != null ? Number(row.BALANCE_BUYIN) : 0;
                        var accountTotal = row.TOTAL_AMOUNT != null ? Number(row.TOTAL_AMOUNT) : (credit + buyin);
                        if (credit !== 0) { creditRows.push({ name: name, amount: credit }); totalCredit += credit; }
                        if (buyin !== 0) { buyinRows.push({ name: name, amount: buyin }); totalBuyin += buyin; }
                        if (accountTotal !== 0) {
                            grandTotal += accountTotal;
                        }
                    });
                    var t = window.markerTranslations || {};
                    var totalLabel = t.total || 'Total';
                    creditRows.forEach(function (r) {
                        $creditTbody.append('<tr><td>' + r.name + '</td><td class="text-end marker-balance-col-amount">' + formatMarkerHistoryAmount(r.amount) + '</td></tr>');
                    });
                    if (creditRows.length > 0) {
                        $creditTbl.find('tfoot th').first().addClass('fw-semibold').text(totalLabel);
                        $creditTbl.find('tfoot th').last().addClass('fw-semibold text-end marker-balance-col-amount').text(formatMarkerHistoryAmount(totalCredit));
                        $creditTbl.find('tfoot').show();
                    } else {
                        $creditTbl.find('tfoot').hide();
                    }
                    buyinRows.forEach(function (r) {
                        $buyinTbody.append('<tr><td>' + r.name + '</td><td class="text-end marker-balance-col-amount">' + formatMarkerHistoryAmount(r.amount) + '</td></tr>');
                    });
                    if (buyinRows.length > 0) {
                        $buyinTbl.find('tfoot th').first().addClass('fw-semibold').text(totalLabel);
                        $buyinTbl.find('tfoot th').last().addClass('fw-semibold text-end marker-balance-col-amount').text(formatMarkerHistoryAmount(totalBuyin));
                        $buyinTbl.find('tfoot').show();
                    } else {
                        $buyinTbl.find('tfoot').hide();
                    }
                    $('#txtTotalJunketCredit').val(formatMarkerHistoryAmount(totalCredit));
                    $('#txtTotalGameCredit').val(formatMarkerHistoryAmount(totalBuyin));
                    cacheOverallHeaderTotals(totalCredit, totalBuyin, list, grandTotal);
                    applyHeaderCreditTotals($('#txtAccountMarker').val() || null);
                    updateDashboardUtangTotal(grandTotal);
                    if (totalCreditTable) {
                        try { updateTotalCreditTableFooter(totalCreditTable); } catch (e) { /* noop */ }
                    }
                    if (typeof $.fn.DataTable !== 'undefined') initBalanceDataTables();
                }).fail(function () {
                    headerCreditState.creditStatusBreakdown = [];
                    $creditTbody.append('<tr><td class="text-danger text-center">Error loading data</td><td class="text-center">—</td></tr>');
                    $buyinTbody.append('<tr><td class="text-danger text-center">Error loading data</td><td class="text-center">—</td></tr>');
                    $('#txtTotalJunketCredit').val('0');
                    $('#txtTotalGameCredit').val('0');
                    cacheOverallHeaderTotals(0, 0, [], 0);
                    applyHeaderCreditTotals($('#txtAccountMarker').val() || null);
                    updateDashboardUtangTotal(0);
                    if (totalCreditTable) {
                        try { updateTotalCreditTableFooter(totalCreditTable); } catch (e) { /* noop */ }
                    }
                    if (typeof $.fn.DataTable !== 'undefined') initBalanceDataTables();
                });
        }

        function initBalanceDataTables() {
            if (typeof $.fn.DataTable === 'undefined') return;
            var t = window.markerTranslations || {};
            var baseLang = {
                info: t.showing_entries || 'Showing _START_ to _END_ of _TOTAL_ entries',
                infoEmpty: t.info_empty || 'Showing 0 to 0 of 0 entries',
                infoFiltered: t.info_filtered || '(filtered from _MAX_ total entries)',
                lengthMenu: t.length_menu || 'Show _MENU_ entries',
                search: t.search || 'Search:',
                paginate: { first: t.first || 'First', last: t.last || 'Last', previous: t.previous || 'Previous', next: t.next || 'Next' },
                zeroRecords: t.no_data_available || 'No matching records found'
            };
            var creditLang = Object.assign({}, baseLang, { emptyTable: 'No accounts with credit.' });
            var buyinLang = Object.assign({}, baseLang, { emptyTable: 'No accounts with credit.' });
            var dtOpts = {
                pageLength: 10,
                lengthMenu: [[10, 25, 50, -1], [10, 25, 50, 'All']],
                order: [[1, 'desc']],
                searching: true,
                paging: true,
                info: true,
                autoWidth: false,
                dom: '<"row g-0 gy-2 mb-2 align-items-center gap-3"<"col-12 col-md-auto"l><"col-12 col-md d-flex justify-content-end align-items-center"f>>rt<"row g-2 mt-2"<"col-12 col-md-6"i><"col-12 col-md-6"p>>',
                columnDefs: [
                    { targets: 1, className: 'text-end marker-balance-col-amount' }
                ]
            };
            $('#marker-accounts-credit-tbl').DataTable(Object.assign({}, dtOpts, { language: creditLang }));
            $('#marker-accounts-buyin-tbl').DataTable(Object.assign({}, dtOpts, { language: buyinLang }));
        }

        function getMarkerTabPanelSelector(tab) {
            if (tab === 'marker-history') return '#marker-history-wrapper';
            if (tab === 'total') return '#marker-accounts-total-wrapper';
            if (tab === 'credit-status') return '#marker-credit-status-wrapper';
            return '#marker-accounts-' + tab + '-wrapper';
        }

        $(document).off('click.markerBalanceTabs', '#marker-balance-tabs .nav-link').on('click.markerBalanceTabs', '#marker-balance-tabs .nav-link', function () {
            var tab = $(this).data('tab');
            if (!tab) return;
            $('#marker-balance-tabs .nav-link').removeClass('active');
            $(this).addClass('active');
            $('.marker-tab-panel').hide();
            var $target = $(getMarkerTabPanelSelector(tab));
            if ($target.length) {
                $target.show();
                if (tab === 'marker-history' && table && typeof table.columns === 'function') {
                    try { table.columns.adjust(); } catch (e) { /* noop */ }
                }
                if (tab === 'total' && totalCreditTable && typeof totalCreditTable.columns === 'function') {
                    try { totalCreditTable.columns.adjust(); } catch (e) { /* noop */ }
                }
                if (tab === 'credit-status') {
                    var creditStatusTable = ensureCreditStatusDataTable();
                    if (creditStatusTable && typeof creditStatusTable.columns === 'function') {
                        try { creditStatusTable.columns.adjust(); } catch (e) { /* noop */ }
                    }
                }
            }
        });

        updateAccountsBalanceTable();

        initExport(table, exportBtnSelector, options.exportOptions || {});
        initBalanceTableExport('#marker-accounts-credit-tbl', '#export-excel-credit', {
            kind: 'credit',
            sheetName: (options.balanceExport || {}).junketSheetName,
            fileName: (options.balanceExport || {}).junketFileName
        });
        initBalanceTableExport('#marker-accounts-buyin-tbl', '#export-excel-buyin', {
            kind: 'buyin',
            sheetName: (options.balanceExport || {}).gameSheetName,
            fileName: (options.balanceExport || {}).gameFileName
        });

        var formApi = null;
        if (options.withForm !== false) {
            var formOpts = options.formOptions || {};
            formOpts.populateAccountsOnInit = !options.modalSelector;
            var origOnSuccess = formOpts.onSuccess;
            formOpts.onSuccess = function () {
                if (typeof origOnSuccess === 'function') origOnSuccess();
                updateAccountsBalanceTable();
                if (totalCreditTable && totalCreditTable.ajax) {
                    try { totalCreditTable.ajax.reload(null, false); } catch (e) { /* noop */ }
                }
            };
            formApi = initForm(table, formOpts);
            $(tableSelector).data('markerFormApi', formApi);
        }

        function refreshCreditHistoryPage() {
            // Clear Buy-in form state first so header shows overall totals after refresh.
            try {
                $('input[name="optCreditAction"]').prop('checked', false);
                $('#optFormModeHidden').val('').data('prevMode', null);
                $('#optTransTypeHidden').val('');
                $('#txtMarkerReturn').val('');
                $('#txtRemarks').val('');
                if ($('#txtGuarantor').length) {
                    if ($('#txtGuarantor').is('select')) {
                        $('#txtGuarantor').val(null).trigger('change');
                    } else {
                        $('#txtGuarantor').val('');
                    }
                }
                if ($('#txtAccountMarker').data('select2')) {
                    $('#txtAccountMarker').val(null).trigger('change');
                } else {
                    $('#txtAccountMarker').val('').trigger('change');
                }
            } catch (e) { /* noop */ }

            if (table && table.ajax) {
                try { table.ajax.reload(null, false); } catch (e) { /* noop */ }
            }
            if (totalCreditTable && totalCreditTable.ajax) {
                try { totalCreditTable.ajax.reload(null, false); } catch (e) { /* noop */ }
            }
            updateAccountsBalanceTable();
            $.getJSON('/marker_total_credits_issue').done(function (data) {
                var total = (data && data.total != null) ? data.total : 0;
                var numStr = Number(total).toLocaleString('en-US');
                $('#txtTotalMarkerIssue').val(numStr);
                $('#dashboard-credit-value').html('₱ ' + numStr);
                if (headerCreditState.ready) {
                    headerCreditState.overallTotalIssue = Number(total) || 0;
                }
                applyHeaderCreditTotals(null);
            }).fail(function () {
                applyHeaderCreditTotals(null);
            });
            if (formApi && typeof formApi.populateAccounts === 'function') {
                try { formApi.populateAccounts(); } catch (e) { /* noop */ }
            }
        }

        window.refreshMarkerCreditHistory = refreshCreditHistoryPage;

        if (options.disableSaveExportByPermission) {
            applyPermissions(true, (options.formOptions || {}).submitBtnSelector || '#submit_marker_settlement', exportBtnSelector);
        }

        if (options.modalSelector && formApi && formApi.populateAccounts) {
            $(options.modalSelector).off('show.bs.modal.markerCommon').on('show.bs.modal.markerCommon', function () {
                formApi.populateAccounts();
                updateAccountsBalanceTable();
            });
        }

        if (options.modalSelector && options.reloadOnModalHidden) {
            $(options.modalSelector).off('hidden.bs.modal.markerCommon').on('hidden.bs.modal.markerCommon', function () {
                if (skipMarkerModalReload) {
                    skipMarkerModalReload = false;
                    return;
                }
                if (typeof window.reloadData === 'function') window.reloadData();
                window.location.reload();
            });
        }

        return {
            table: table,
            totalCreditTable: totalCreditTable,
            formApi: formApi
        };
    }

    window.MarkerCommon = {
        init: init,
        initHistoryTable: initHistoryTable,
        initTotalCreditTable: initTotalCreditTable,
        initExport: initExport,
        initBalanceTableExport: initBalanceTableExport,
        initForm: initForm,
        formatWithCommas: formatWithCommas,
        getTransactionLabel: getTransactionLabel
    };
})(window);
