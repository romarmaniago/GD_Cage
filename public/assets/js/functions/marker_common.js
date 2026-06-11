/**
 * Shared marker (credits) logic for modal and marker history page.
 * Usage: MarkerCommon.init({ tableSelector: '#marker-tbl', ... });
 */
(function (window) {
    'use strict';

    var $ = window.jQuery;
    if (!$) return;

    var skipMarkerModalReload = false;

    function formatWithCommas(value) {
        if (value === '' || value === null || value === undefined) return value;
        var num = Number(value);
        if (isNaN(num)) return value;
        return num.toLocaleString('en-US', { maximumFractionDigits: 2, minimumFractionDigits: 0 });
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

    var MARKER_HISTORY_DATE_PARSE_FORMATS = [
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
        if (!data) return '';
        var parts = String(data).split('-');
        var transactionId = parseInt(parts[0], 10);
        var transactionType = parseInt(parts[1], 10);
        var sourceLabel = getReturnSourceLabel(row && row.TRANSACTION_DESC);
        switch (transactionId) {
            case 3: return 'Junket Credit';
            case 11: return sourceLabel ? (sourceLabel + ' Credit Returned thru Cash') : 'Credit Returned thru Cash';
            case 12: return sourceLabel ? (sourceLabel + ' Credit Returned thru Deposit') : 'Credit Returned thru Deposit';
            case 10: return 'Buy-in thru Credit';
            default:
                return transactionType === 4 ? 'Chips Return thru Credit' : 'Unknown Transaction';
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

        var orderCol = options.orderCol != null ? options.orderCol : 3;
        var orderDir = options.orderDir || 'desc';

        var perms = parseInt($('#user-role').data('permissions'), 10);
        var isSuperAdmin = $('#user-role').length && perms === 0;

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
                                    row.ENCODED_DT = moment.utc(row.ENCODED_DT).utcOffset(8).format('MMMM DD, YYYY HH:mm');
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
                    data: null,
                    render: function (row) {
                        return (row.AGENT_CODE || '') + ' (' + (row.AGENT_NAME || '') + ')';
                    }
                },
                {
                    data: 'AMOUNT',
                    className: 'text-center marker-history-col-amount',
                    render: function (data, type, row) {
                        return formatMarkerHistoryAmountCell(data, row, type);
                    }
                },
                { data: 'TRANSACTION_INFO', render: renderTransactionType },
                { data: 'ENCODED_DT' },
                { data: 'REMARKS', defaultContent: '' }
            ],
            columnDefs: [
                {
                    targets: 3,
                    className: 'text-center',
                    render: function (data, type, row) {
                        if (type === 'sort') {
                            if (!window.moment) return data;
                            var mSort = parseMarkerHistoryDateString(data);
                            return mSort ? mSort.format('YYYY-MM-DD HH:mm:ss') : data;
                        }
                        if (!window.moment) return data;
                        var dateMoment = parseMarkerHistoryDateString(data);
                        return dateMoment ? dateMoment.local().format('DD MMM, YYYY HH:mm') : (data || '');
                    }
                },
                {
                    targets: 4,
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
                        if (!(window.RemarksEditor ? window.RemarksEditor.canEdit() : isSuperAdmin)) {
                            return textHtml;
                        }
                        var id = row.IDNo != null ? String(row.IDNo) : '';
                        var enc = encodeURIComponent(raw);
                        var t = translations;
                        var editTitle = (t.edit_remarks || 'Edit remarks').replace(/"/g, '&quot;');
                        var delTitle = (t.delete || 'Delete').replace(/"/g, '&quot;');
                        return (
                            '<div class="marker-history-remarks-cell d-flex align-items-start gap-2 justify-content-between">' +
                            '<span class="marker-history-remarks-text flex-grow-1 text-break">' + textHtml + '</span>' +
                            '<span class="marker-history-remarks-actions flex-shrink-0 d-flex gap-1">' +
                            '<button type="button" class="btn btn-sm btn-light border btn-edit-marker-remarks" data-id="' + id + '" data-remarks="' + enc + '" title="' + editTitle + '"><i class="fa fa-pen"></i></button>' +
                            '<button type="button" class="btn btn-sm btn-danger-subtle btn-delete-marker" data-id="' + id + '" title="' + delTitle + '"><i class="fa fa-trash-alt"></i></button>' +
                            '</span></div>'
                        );
                    }
                }
            ]
        });

        // Edit remarks (Super Admin)
        $table.off('click.markerEditRemarks').on('click.markerEditRemarks', '.btn-edit-marker-remarks', function (e) {
            e.preventDefault();
            e.stopPropagation();
            var btn = $(this);
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
                btn.prop('disabled', true);
                $.ajax({
                    url: '/marker_record/' + id + '/remarks',
                    method: 'PATCH',
                    contentType: 'application/json',
                    data: JSON.stringify({ remarks: newVal != null ? String(newVal) : '' }),
                    success: function (res) {
                        if (res.success) {
                            if (table && table.ajax) table.ajax.reload();
                            if (window.Swal) window.Swal.fire({ icon: 'success', title: 'Success', text: res.message || okMsg });
                        } else {
                            if (window.Swal) window.Swal.fire({ icon: 'error', title: 'Error', text: res.message || errMsg });
                        }
                    },
                    error: function (xhr) {
                        var msg = (xhr.responseJSON && xhr.responseJSON.message) || errMsg;
                        if (window.Swal) window.Swal.fire({ icon: 'error', title: 'Error', text: msg });
                    },
                    complete: function () { btn.prop('disabled', false); }
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

        // Delete button click (delegated)
        $table.off('click.markerDelete').on('click.markerDelete', '.btn-delete-marker', function (e) {
            e.preventDefault();
            e.stopPropagation();
            var btn = $(this);
            var id = btn.data('id');
            if (!id) return;
            var perms = parseInt($('#user-role').data('permissions'), 10);
            if ($('#user-role').length && perms !== 0) return; // Super Admin only

            var confirmMsg = (window.markerTranslations && window.markerTranslations.confirm_delete) || 'Are you sure you want to delete this record?';
            var confirmTitle = (window.markerTranslations && window.markerTranslations.delete) || 'Delete';

            if (window.Swal) {
                window.Swal.fire({
                    icon: 'warning',
                    title: confirmTitle,
                    text: confirmMsg,
                    showCancelButton: true,
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
                                    $.getJSON('/marker_total_credits_issue', function (data) {
                                        var total = (data && data.total != null) ? data.total : 0;
                                        var numStr = Number(total).toLocaleString('en-US');
                                        $('#txtTotalMarkerIssue').val(numStr);
                                        $('#dashboard-credit-value').html('₱ ' + numStr);
                                    });
                                    var formApi = $table.data('markerFormApi');
                                    if (formApi && formApi.populateAccounts) formApi.populateAccounts();
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
                                $.getJSON('/marker_total_credits_issue', function (data) {
                                    var total = (data && data.total != null) ? data.total : 0;
                                    var numStr = Number(total).toLocaleString('en-US');
                                    $('#txtTotalMarkerIssue').val(numStr);
                                    $('#dashboard-credit-value').html('₱ ' + numStr);
                                });
                                var formApi = $table.data('markerFormApi');
                                if (formApi && formApi.populateAccounts) formApi.populateAccounts();
                            }
                            if (typeof window.reloadData === 'function') window.reloadData();
                        },
                        complete: function () { btn.prop('disabled', false); }
                    });
                }
            }
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
            if (rows.length > 0) {
                rows.push([t.total || 'Total', sum]);
            }
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
                    sheetName: sheetLabel
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
        var dateCell = row.ENCODED_DT || '';
        if (dateCell && window.moment) {
            var md = parseMarkerHistoryDateString(dateCell);
            if (md) dateCell = md.format('DD MMM, YYYY HH:mm');
        }
        var amt = row.AMOUNT != null ? Number(row.AMOUNT) : 0;
        if (isNaN(amt)) amt = 0;
        return [
            (row.AGENT_CODE || '') + ' (' + (row.AGENT_NAME || '') + ')',
            amt,
            renderTransactionType(row.TRANSACTION_INFO, 'export', row),
            dateCell,
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
                t.account_name || 'Account Name',
                t.amount || 'Amount',
                t.transaction_type_col || t.transaction_type || 'Transaction Type',
                t.date || 'Date',
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
                    sheetName: options.sheetName || 'Credit History'
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
        var markerIssueSelector = opts.markerIssueSelector || '#txtMarkerIssue';
        var markerReturnSelector = opts.markerReturnSelector || '#txtMarkerReturn';
        var markerBalanceSelector = opts.markerBalanceSelector || '#txtMarkerBalance';
        var remarksSelector = opts.remarksSelector || '#txtRemarks';
        var submitBtnSelector = opts.submitBtnSelector || '#submit_marker_settlement';
        var agentBalanceSelector = opts.agentBalanceSelector || '#AgentBalance';
        var gameStartBtnSelector = opts.gameStartBtnSelector || '#btn-credits-game-start';
        var hideModalOnGameStartSelector = opts.hideModalOnGameStartSelector || '#modal-new-marker';
        var optTransTypeName = opts.optTransTypeName || 'optTransType';
        var optReturnSourceName = opts.optReturnSourceName || 'optReturnSource';
        var selectPlaceholder = opts.selectPlaceholder || 'Select account';
        var dropdownParent = opts.dropdownParent || 'body';
        var isSubmitting = false;
        var markerData = [];
        var markerBreakdownData = [];

        var $form = $(formSelector);
        var $accountSelect = $(accountSelectSelector);
        var $submitBtn = $(submitBtnSelector);
        if (!$form.length || !$accountSelect.length) return;

        function initAccountSelect2() {
            if (typeof $accountSelect.select2 !== 'function') return;
            if ($accountSelect.data('select2')) {
                try { $accountSelect.select2('destroy'); } catch (e) {}
            }
            var $parent = typeof dropdownParent === 'string' ? $(dropdownParent) : dropdownParent;
            $accountSelect.select2({
                placeholder: selectPlaceholder,
                allowClear: false,
                dropdownParent: $parent.length ? $parent : $('body')
            });
        }

        function getSelectedReturnSource() {
            return $('input[name="' + optReturnSourceName + '"]:checked').val();
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
            if (selectedSource) {
                sourceList = (markerBreakdownData || []).filter(function (row) {
                    return getSourceAmountByRow(row, selectedSource) > 0;
                }).map(function (row) {
                    return {
                        ACCOUNT_ID: row.ACCOUNT_ID,
                        AGENT_CODE: row.AGENT_CODE,
                        AGENT_NAME: row.AGENT_NAME
                    };
                });
            } else {
                sourceList = [];
            }

            sourceList.forEach(function (account) {
                $accountSelect.append(
                    $('<option></option>').val(account.ACCOUNT_ID).text((account.AGENT_CODE || '') + ' - ' + (account.AGENT_NAME || ''))
                );
            });
            initAccountSelect2();
        }

        function updateCreditsGameStartButton() {
            var $btn = $(gameStartBtnSelector);
            if (!$btn.length) return;
            var hasAccount = !!String($accountSelect.val() || '').trim();
            var hasSource = !!getSelectedReturnSource();
            $btn.toggleClass('d-none', !(hasAccount && hasSource));
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
                window.addGameList(accountId, { openingBalance: openingBalance, lockAccount: true });
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
            if (!selectedAccountId) {
                $(markerIssueSelector).val('');
                $(markerBalanceSelector).val('');
                updateCreditsGameStartButton();
                return;
            }
            var selectedSource = getSelectedReturnSource();
            if (selectedSource) {
                var breakdownAcc = findBreakdownAccount(selectedAccountId);
                var sourceAmount = getSourceAmountByRow(breakdownAcc, selectedSource);
                $(markerIssueSelector).val(formatWithCommas(sourceAmount));
                $(markerBalanceSelector).val(formatWithCommas(sourceAmount));
                updateCreditsGameStartButton();
                return;
            }
            var selectedAccount = (markerData || []).filter(function (a) { return String(a.ACCOUNT_ID) === String(selectedAccountId); })[0];
            var totalIssue = selectedAccount ? (selectedAccount.TOTAL_AMOUNT || 0) : 0;
            $(markerIssueSelector).val(formatWithCommas(totalIssue));
            $(markerBalanceSelector).val(formatWithCommas(totalIssue));
            updateCreditsGameStartButton();
        }

        // Populate accounts (call this on modal show or page load). Optional callback(accounts) runs after data is loaded.
        function populateAccounts(callback) {
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

        $accountSelect.off('change.markerForm').on('change.markerForm', function () {
            updateIssueAndBalanceBySelectedAccount();
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

        // Format marker return input and balance
        $(markerReturnSelector).off('input.markerForm focusout.markerForm').on('input.markerForm', function () {
            var markerIssue = parseFloat($(markerIssueSelector).val().replace(/,/g, '')) || 0;
            var raw = $(this).val().replace(/,/g, '');
            var markerReturn = parseFloat(raw) || 0;
            if (markerReturn > markerIssue) {
                $(this).val(formatWithCommas(markerIssue));
                $(markerBalanceSelector).val(formatWithCommas(0));
            } else {
                $(markerBalanceSelector).val(formatWithCommas(markerIssue - markerReturn));
            }
            $(this).val(formatWithCommas(raw));
        }).on('focusout.markerForm', function () {
            var raw = $(this).val().replace(/,/g, '');
            $(this).val(formatWithCommas(raw));
        });

        $form.off('submit.markerForm').on('submit.markerForm', function (e) {
            e.preventDefault();
            if (isSubmitting) return;

            var selectedAccount = $(accountSelectSelector).val();
            var selectedTransType = $('input[name="' + optTransTypeName + '"]:checked').val();
            var markerIssue = parseFloat($(markerIssueSelector).val().replace(/,/g, '')) || 0;
            var markerReturnRaw = $(markerReturnSelector).val().replace(/,/g, '');
            var markerReturn = parseFloat(markerReturnRaw) || 0;
            var selectedReturnSource = $('input[name="' + optReturnSourceName + '"]:checked').val();

            if (!selectedAccount) {
                if (window.Swal) Swal.fire({ icon: 'error', title: 'Missing Information', text: 'Please select an account.' });
                return;
            }
            if (!selectedTransType) {
                if (window.Swal) Swal.fire({ icon: 'error', title: 'Missing Information', text: 'Please select a transaction type (Cash or Deposit).' });
                return;
            }
            if (!selectedReturnSource) {
                if (window.Swal) Swal.fire({ icon: 'error', title: 'Missing Information', text: 'Please select where to deduct the return (Junket Credit or Game Credit).' });
                return;
            }
            if (!markerReturnRaw || markerReturn <= 0) {
                if (window.Swal) Swal.fire({ icon: 'error', title: 'Invalid Amount', text: 'Credit Return must be greater than zero.' });
                return;
            }
            if (markerReturn > markerIssue) {
                if (window.Swal) Swal.fire({ icon: 'error', title: 'Invalid Return', text: 'Credit Return cannot be greater than Credit Issue!' });
                return;
            }

            var accountMarker = $accountSelect.find('option:selected').text();
            var markerReturnFormatted = $(markerReturnSelector).val();
            var transTypeLabel = $('input[name="' + optTransTypeName + '"]:checked').next('label').text();
            var returnSourceLabel = $('input[name="' + optReturnSourceName + '"]:checked').next('label').text();

            var proceedSubmitFlow = function () {
                var showConfirmAndSubmit = function () {
                    var savedAccountId = $accountSelect.val();
                    isSubmitting = true;
                    var origHtml = $submitBtn.html();
                    $submitBtn.prop('disabled', true).html('<span class="spinner-border spinner-border-sm" role="status"></span> Loading...');
                    $.ajax({
                        url: '/add_marker_settlement',
                        method: 'POST',
                        data: $form.serialize(),
                        success: function (response) {
                            if (response.success) {
                                $form[0].reset();
                                if (table && table.ajax) table.ajax.reload();
                                $.getJSON('/marker_total_credits_issue', function (data) {
                                    var total = (data && data.total != null) ? data.total : 0;
                                    var numStr = Number(total).toLocaleString('en-US');
                                    $('#txtTotalMarkerIssue').val(numStr);
                                    $('#dashboard-credit-value').html('₱ ' + numStr);
                                });
                                // Reload account list and refresh balance for current account so UI updates without page refresh
                                populateAccounts(function (accounts) {
                                    if (savedAccountId) {
                                        $accountSelect.val(savedAccountId).trigger('change');
                                        var acc = (accounts || []).filter(function (a) { return a.ACCOUNT_ID == savedAccountId; })[0];
                                        if (acc) {
                                            var totalIssue = acc.TOTAL_AMOUNT || 0;
                                            $(markerIssueSelector).val(formatWithCommas(totalIssue));
                                            $(markerBalanceSelector).val(formatWithCommas(totalIssue));
                                        }
                                    }
                                });
                                if (window.Swal) {
                                    Swal.fire({ icon: 'success', title: 'Success', text: 'Marker Return Successfully!' });
                                }
                                if (opts.onSuccess) opts.onSuccess();
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
                        }
                    });
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
                            if (window.Swal) {
                                Swal.fire({
                                    icon: 'question',
                                    title: 'Confirm Marker Return',
                                    html: '<div style="text-align:center;margin-bottom:20px">' +
                                        '<table style="margin:0 auto"><tr><td style="padding:8px 4px 8px 0;font-weight:bold">Account:</td><td style="padding:8px 0 8px 4px">' + (accountMarker || 'N/A') + '</td></tr>' +
                                        '<tr><td style="padding:8px 4px 8px 0;font-weight:bold">Amount:</td><td style="padding:8px 0 8px 4px">' + (markerReturnFormatted || '0') + '</td></tr>' +
                                        '<tr><td style="padding:8px 4px 8px 0;font-weight:bold">Transaction:</td><td style="padding:8px 0 8px 4px">' + (transTypeLabel || 'N/A') + '</td></tr>' +
                                        '<tr><td style="padding:8px 4px 8px 0;font-weight:bold">Deduct From:</td><td style="padding:8px 0 8px 4px">' + (returnSourceLabel || 'N/A') + '</td></tr></table>' +
                                        '<p style="margin-top:15px">Are you sure you want to proceed with this marker return?</p></div>',
                                    showCancelButton: true,
                                    confirmButtonColor: '#3085d6',
                                    cancelButtonColor: '#d33',
                                    confirmButtonText: 'Yes, Save',
                                    cancelButtonText: 'Cancel'
                                }).then(function (result) {
                                    if (result.isConfirmed) showConfirmAndSubmit();
                                });
                            } else {
                                showConfirmAndSubmit();
                            }
                        },
                        error: function () {
                            if (window.Swal) Swal.fire({ icon: 'error', title: 'Error', text: 'Failed to check balance.' });
                        }
                    });
                } else {
                    if (window.Swal) {
                        Swal.fire({
                            icon: 'question',
                            title: 'Confirm Credit Return',
                            html: '<div style="text-align:center;margin-bottom:20px">' +
                                '<table style="margin:0 auto"><tr><td style="padding:8px 4px 8px 0;font-weight:bold">Account:</td><td style="padding:8px 0 8px 4px">' + (accountMarker || 'N/A') + '</td></tr>' +
                                '<tr><td style="padding:8px 4px 8px 0;font-weight:bold">Amount:</td><td style="padding:8px 0 8px 4px">' + (markerReturnFormatted || '0') + '</td></tr>' +
                                '<tr><td style="padding:8px 4px 8px 0;font-weight:bold">Transaction:</td><td style="padding:8px 0 8px 4px">' + (transTypeLabel || 'N/A') + '</td></tr>' +
                                '<tr><td style="padding:8px 4px 8px 0;font-weight:bold">Deduct From:</td><td style="padding:8px 0 8px 4px">' + (returnSourceLabel || 'N/A') + '</td></tr></table>' +
                                '<p style="margin-top:15px">Are you sure you want to proceed with this credit return?</p></div>',
                            showCancelButton: true,
                            confirmButtonColor: '#3085d6',
                            cancelButtonColor: '#d33',
                            confirmButtonText: 'Yes, Save',
                            cancelButtonText: 'Cancel'
                        }).then(function (result) {
                            if (result.isConfirmed) showConfirmAndSubmit();
                        });
                    } else {
                        showConfirmAndSubmit();
                    }
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
                        sourceBalance = selectedReturnSource === 'credit'
                            ? (sourceRow.BALANCE_CREDIT != null ? Number(sourceRow.BALANCE_CREDIT) : 0)
                            : (sourceRow.BALANCE_BUYIN != null ? Number(sourceRow.BALANCE_BUYIN) : 0);
                    }
                    if (markerReturn > sourceBalance) {
                        var sourceBalanceLabel = selectedReturnSource === 'credit' ? 'Junket Credit Balance' : 'Game Credit Balance';
                        var sourceBalanceMsg = 'Return amount exceeded the ' + sourceBalanceLabel + '.';
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

        function updateAccountsBalanceTable() {
            var $creditTbl = $('#marker-accounts-credit-tbl');
            var $buyinTbl = $('#marker-accounts-buyin-tbl');
            var $totalTbl = $('#marker-accounts-total-tbl');
            if (!$creditTbl.length || !$buyinTbl.length) return;
            destroyBalanceDataTable('#marker-accounts-credit-tbl');
            destroyBalanceDataTable('#marker-accounts-buyin-tbl');
            if ($totalTbl.length) destroyBalanceDataTable('#marker-accounts-total-tbl');
            var $creditTbody = $creditTbl.find('tbody');
            var $buyinTbody = $buyinTbl.find('tbody');
            var $totalTbody = $totalTbl.length ? $totalTbl.find('tbody') : $();
            $creditTbody.empty();
            $buyinTbody.empty();
            if ($totalTbody.length) $totalTbody.empty();
            $.ajax({
                url: '/marker_data_breakdown',
                method: 'GET',
                success: function (data) {
                    var list = Array.isArray(data) ? data : [];
                    var creditRows = [];
                    var buyinRows = [];
                    var totalRows = [];
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
                            totalRows.push({ name: name, credit: credit, buyin: buyin, total: accountTotal });
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
                    if ($totalTbl.length) {
                        totalRows.forEach(function (r) {
                            $totalTbody.append(
                                '<tr><td class="marker-total-col-account">' + r.name + '</td>' +
                                '<td class="text-end marker-balance-col-amount marker-total-col-junket">' + formatMarkerHistoryAmount(r.credit) + '</td>' +
                                '<td class="text-end marker-balance-col-amount marker-total-col-game">' + formatMarkerHistoryAmount(r.buyin) + '</td>' +
                                '<td class="text-end marker-balance-col-amount marker-total-col-sum">' + formatMarkerHistoryAmount(r.total) + '</td></tr>'
                            );
                        });
                        if (totalRows.length > 0) {
                            $totalTbl.find('tfoot th').eq(0).addClass('fw-semibold').text(totalLabel);
                            $totalTbl.find('tfoot th').eq(1).addClass('fw-semibold text-end marker-balance-col-amount marker-total-col-junket').text(formatMarkerHistoryAmount(totalCredit));
                            $totalTbl.find('tfoot th').eq(2).addClass('fw-semibold text-end marker-balance-col-amount marker-total-col-game').text(formatMarkerHistoryAmount(totalBuyin));
                            $totalTbl.find('tfoot th').eq(3).addClass('fw-semibold text-end marker-balance-col-amount marker-total-col-sum').text(formatMarkerHistoryAmount(grandTotal));
                            $totalTbl.find('tfoot').show();
                        } else {
                            $totalTbl.find('tfoot').hide();
                        }
                    }
                    $('#txtTotalJunketCredit').val(formatMarkerHistoryAmount(totalCredit));
                    $('#txtTotalGameCredit').val(formatMarkerHistoryAmount(totalBuyin));
                    if (typeof $.fn.DataTable !== 'undefined') initBalanceDataTables();
                },
                error: function () {
                    $creditTbody.append('<tr><td class="text-danger text-center">Error loading data</td><td class="text-center">—</td></tr>');
                    $buyinTbody.append('<tr><td class="text-danger text-center">Error loading data</td><td class="text-center">—</td></tr>');
                    if ($totalTbody.length) {
                        $totalTbody.append('<tr><td class="text-danger text-center" colspan="4">Error loading data</td></tr>');
                    }
                    $('#txtTotalJunketCredit').val('0');
                    $('#txtTotalGameCredit').val('0');
                    if (typeof $.fn.DataTable !== 'undefined') initBalanceDataTables();
                }
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
            if ($('#marker-accounts-total-tbl').length && !$.fn.DataTable.isDataTable('#marker-accounts-total-tbl')) {
                var totalLang = Object.assign({}, baseLang, { emptyTable: 'No accounts with credit.' });
                var totalDtOpts = Object.assign({}, dtOpts, {
                    order: [[3, 'desc']],
                    language: totalLang,
                    columnDefs: [
                        { targets: 0, className: 'marker-total-col-account' },
                        { targets: 1, className: 'text-end marker-balance-col-amount marker-total-col-junket' },
                        { targets: 2, className: 'text-end marker-balance-col-amount marker-total-col-game' },
                        { targets: 3, className: 'text-end marker-balance-col-amount marker-total-col-sum' }
                    ]
                });
                $('#marker-accounts-total-tbl').DataTable(totalDtOpts);
            }
        }

        function getMarkerTabPanelSelector(tab) {
            if (tab === 'marker-history') return '#marker-history-wrapper';
            if (tab === 'total') return '#marker-accounts-total-wrapper';
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
            };
            formApi = initForm(table, formOpts);
            $(tableSelector).data('markerFormApi', formApi);
        }

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
            formApi: formApi
        };
    }

    window.MarkerCommon = {
        init: init,
        initHistoryTable: initHistoryTable,
        initExport: initExport,
        initBalanceTableExport: initBalanceTableExport,
        initForm: initForm,
        formatWithCommas: formatWithCommas,
        getTransactionLabel: getTransactionLabel
    };
})(window);
