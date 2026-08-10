function fmtCapitalAmount(value, direction) {
    const n = Math.abs(parseFloat(value) || 0);
    const formatted = (window.AmountFormat && window.AmountFormat.formatCommas)
        ? window.AmountFormat.formatCommas(n)
        : n.toLocaleString('en-US');
    // Negative / bawas: accounting style (1,000) in red
    if (direction === 'out') {
        if (window.AmountFormat && window.AmountFormat.formatAmountNegativeHtml) {
            return window.AmountFormat.formatAmountNegativeHtml(n);
        }
        return '<span class="text-danger" style="color:#dc3545 !important;">(' + formatted + ')</span>';
    }
    // Positive amounts: plain text (no + / green)
    if (direction === 'in') return formatted;
    return formatted;
}

/** Allow digits and a leading + / - (direction) for house-balance amount fields. */
function onlyCapitalSignedAmountKey(evt) {
    var code = evt.which ? evt.which : evt.keyCode;
    if (code <= 31) return true;
    var ch = String.fromCharCode(code);
    if (ch >= '0' && ch <= '9') return true;
    if (ch === '+' || ch === '-') {
        var el = evt.target;
        return !el || el.selectionStart === 0;
    }
    return false;
}

function formatCapitalSignedAmountInput(value) {
    var raw = String(value == null ? '' : value);
    var sign = '';
    if (raw.charAt(0) === '+' || raw.charAt(0) === '-') {
        sign = raw.charAt(0);
        raw = raw.slice(1);
    }
    var digits = raw.replace(/[^\d]/g, '');
    if (!digits) return sign;
    return sign + digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/**
 * Amount sign drives direction: + / unsigned = dagdag (txn 1), - = bawas (txn 2).
 * Backend still stores absolute AMOUNT with TRANSACTION_ID.
 */
function parseCapitalSignedAmount(value) {
    var raw = String(value == null ? '' : value).replace(/,/g, '').trim();
    if (!raw || raw === '+' || raw === '-') {
        return { ok: false };
    }
    var signChar = '';
    if (raw.charAt(0) === '+' || raw.charAt(0) === '-') {
        signChar = raw.charAt(0);
        raw = raw.slice(1);
    }
    var n = parseFloat(raw);
    if (!Number.isFinite(n) || n <= 0) {
        return { ok: false };
    }
    var isOut = signChar === '-';
    return {
        ok: true,
        abs: n,
        isOut: isOut,
        txn: isOut ? '2' : '1',
        display: (isOut ? '-' : '+') + n.toLocaleString('en-US')
    };
}

function houseBalanceDirectionFromTxn(txn) {
    return parseInt(txn, 10) === 1 ? 'in' : 'out';
}

window.onlyCapitalSignedAmountKey = onlyCapitalSignedAmountKey;
window.formatCapitalSignedAmountInput = formatCapitalSignedAmountInput;
window.parseCapitalSignedAmount = parseCapitalSignedAmount;

var capitalTransferAccountsCache = [];

function capitalAccountOptionLabel(account) {
    const parts = [account.agent_code, account.agent_name].filter(Boolean);
    return parts.length ? parts.join(' - ') : ('Account #' + account.account_id);
}

function initCapitalAccountSelect2($sel, modalSelector) {
    if (!$sel.length || typeof $sel.select2 !== 'function') return;
    if ($sel.data('select2')) {
        try { $sel.select2('destroy'); } catch (e) {}
    }
    $sel.select2({
        placeholder: $sel.data('placeholder') || 'Choose account',
        allowClear: true,
        dropdownParent: $(modalSelector)
    });
}

function loadCapitalTransferAccounts($sel, modalSelector, selectedId) {
    const placeholder = $sel.data('placeholder') || 'Choose account';
    return $.getJSON('/account_data').then(function (rows) {
        capitalTransferAccountsCache = rows || [];
        if ($sel.data('select2')) {
            try { $sel.select2('destroy'); } catch (e) {}
        }
        $sel.empty().append($('<option/>', { value: '', text: placeholder }));
        capitalTransferAccountsCache.forEach(function (account) {
            const id = account.account_id;
            if (id == null) return;
            $sel.append($('<option/>', {
                value: String(id),
                text: capitalAccountOptionLabel(account),
                'data-balance': account.total_balance != null ? String(account.total_balance) : '0'
            }));
        });
        initCapitalAccountSelect2($sel, modalSelector);
        if (selectedId) {
            $sel.val(String(selectedId)).trigger('change');
        }
    });
}

function isCapitalTransferTypeSelected(typeCheckSelector) {
    const $checked = $(typeCheckSelector).filter(':checked');
    return $checked.length && String($checked.val()) === 'Transfer';
}

function syncCapitalTransferUi(formSelector, wrapSelector, selectSelector) {
    const $form = $(formSelector);
    const isTransfer = $form.find('.hb-type-check, .edit-hb-type-check').filter(':checked').val() === 'Transfer';
    const $wrap = $(wrapSelector);
    const $sel = $(selectSelector);
    const modalSelector = $wrap.closest('.modal').attr('id');
    const dropdownParent = modalSelector ? ('#' + modalSelector) : document.body;

    if (isTransfer) {
        $wrap.removeClass('d-none');
        if ($sel.find('option').length <= 1) {
            loadCapitalTransferAccounts($sel, dropdownParent);
        }
        $sel.prop('required', true);
    } else {
        $wrap.addClass('d-none');
        $sel.prop('required', false).val('').trigger('change');
    }
}

function getCapitalTransferAccountBalance(selectSelector) {
    const $sel = $(selectSelector);
    const accountId = ($sel.val() || '').trim();
    if (!accountId) return null;
    return parseFloat($sel.find('option:selected').data('balance')) || 0;
}

function validateCapitalTransferAmount(selectSelector, parsedAmount) {
    if (!parsedAmount || !parsedAmount.ok || parsedAmount.isOut) {
        return { ok: true };
    }
    const balance = getCapitalTransferAccountBalance(selectSelector);
    if (balance === null) {
        return { ok: true };
    }
    if (parsedAmount.abs > balance) {
        return {
            ok: false,
            message: 'The amount exceeds the available account balance of ' + balance.toLocaleString('en-US') + '.'
        };
    }
    return { ok: true };
}

function updateCapitalTransferHint(selectSelector, hintSelector, amountValue) {
    const $sel = $(selectSelector);
    const $hint = $(hintSelector);
    if (!$hint.length) return;
    const accountId = ($sel.val() || '').trim();
    if (!accountId) {
        $hint.text('');
        return;
    }
    const balance = parseFloat($sel.find('option:selected').data('balance')) || 0;
    const parsed = parseCapitalSignedAmount(amountValue || '');
    if (parsed.ok && !parsed.isOut) {
        $hint.text('Account balance: ' + balance.toLocaleString('en-US') + ' (used when amount is +)');
    } else if (parsed.ok && parsed.isOut) {
        $hint.text('Amount will be deposited to this account.');
    } else {
        $hint.text('Account balance: ' + balance.toLocaleString('en-US'));
    }
}

function initCapitalTransferAccountUi(options) {
    const opts = options || {};
    const modalSelector = opts.modalSelector || '#modal-new-capital';
    const wrapSelector = opts.wrapSelector || '#capital-transfer-account-wrap';
    const selectSelector = opts.selectSelector || '#capital-transfer-account';
    const hintSelector = opts.hintSelector || '#capital-transfer-account-hint';
    const typeCheckSelector = opts.typeCheckSelector || '#add_junket_capital .hb-type-check';
    const amountSelector = opts.amountSelector || '#txtAmount';

    $(document).off('change.capitalTransferType', typeCheckSelector)
        .on('change.capitalTransferType', typeCheckSelector, function () {
            syncCapitalTransferUi(
                opts.formSelector || '#add_junket_capital',
                wrapSelector,
                selectSelector
            );
        });

    $(document).off('change.capitalTransferAccount', selectSelector)
        .on('change.capitalTransferAccount', selectSelector, function () {
            updateCapitalTransferHint(selectSelector, hintSelector, $(amountSelector).val());
        });

    $(document).off('input.capitalTransferAmount', amountSelector)
        .on('input.capitalTransferAmount', amountSelector, function () {
            if (isCapitalTransferTypeSelected(typeCheckSelector)) {
                updateCapitalTransferHint(selectSelector, hintSelector, $(this).val());
            }
        });

    $(modalSelector).off('shown.bs.modal.capitalTransfer').on('shown.bs.modal.capitalTransfer', function () {
        if (isCapitalTransferTypeSelected(typeCheckSelector)) {
            syncCapitalTransferUi(
                opts.formSelector || '#add_junket_capital',
                wrapSelector,
                selectSelector
            );
        }
    });
}

window.syncCapitalTransferUi = syncCapitalTransferUi;
window.initCapitalTransferAccountUi = initCapitalTransferAccountUi;
window.loadCapitalTransferAccounts = loadCapitalTransferAccounts;
window.validateCapitalTransferAmount = validateCapitalTransferAmount;

function fmtCapitalSigned(value) {
    if (window.fmtSigned) return window.fmtSigned(value);
    const n = parseFloat(value) || 0;
    return n.toLocaleString('en-US');
}

function getHouseBalanceTypeDesc(row) {
    return row.capital_description || row.chips_description || '';
}

function normalizeHouseBalanceTypeLabel(desc) {
    if (!desc) return '';
    const text = String(desc).replace(/<[^>]*>/g, '').trim();
    return text;
}

var HOUSE_BALANCE_TYPE_LABELS = {
    'Cash-in': true,
    'Cash-out': true,
    'Transfer': true,
    'Deposit': true,
    'Withdrawal': true,
    'Loss Amount': true,
    'Settlement': true,
    'F&B': true,
    'Hotel': true,
    'Incidental': true,
    'Expenses': true
};

function isHouseCashInOutRow(row) {
    const label = normalizeHouseBalanceTypeLabel(getHouseBalanceTypeDesc(row));
    return !!HOUSE_BALANCE_TYPE_LABELS[label];
}

function isHouseBalanceCashInType(desc) {
    const label = normalizeHouseBalanceTypeLabel(desc);
    return label === 'Cash-in' || label === 'Deposit';
}

function isHouseBalanceCashOutType(desc) {
    const label = normalizeHouseBalanceTypeLabel(desc);
    return label === 'Cash-out' ||
        label === 'Transfer' ||
        label === 'Withdrawal' ||
        label === 'Loss Amount' ||
        label === 'Settlement' ||
        label === 'F&B' ||
        label === 'Hotel' ||
        label === 'Incidental' ||
        label === 'Expenses';
}

function getDefaultMonthEndRange() {
    if (window.MonthEndCutoffRange) {
        const r = window.MonthEndCutoffRange.getMonthEndCutoffRange();
        return { start: r.startDate, end: r.endDate, startDisplay: r.start, endDisplay: r.end };
    }
    const now = new Date();
    const y = now.getFullYear();
    const m = now.getMonth();
    const startAt = new Date(y, m, 0);
    const endAt = new Date(y, m + 1, 0);
    endAt.setDate(endAt.getDate() - 1);
    return {
        start: moment(startAt).format('YYYY-MM-DD'),
        end: moment(endAt).format('YYYY-MM-DD'),
        startDisplay: moment(startAt).format('MMM D, YYYY'),
        endDisplay: moment(endAt).format('MMM D, YYYY')
    };
}

/** Expand end date to month-end only for month-end-cutoff day (2nd-to-last), same as house expense. */
function capitalApiEndDate(endYmd) {
    if (!endYmd || !/^\d{4}-\d{2}-\d{2}$/.test(String(endYmd))) return endYmd;
    var parts = String(endYmd).slice(0, 10).split('-').map(Number);
    var lastDayOfMonth = new Date(parts[0], parts[1], 0).getDate();
    if (parts[2] === lastDayOfMonth - 1 && window.MonthEndCutoffRange) {
        return window.MonthEndCutoffRange.expandApiEndDateToMonthEnd(endYmd);
    }
    return String(endYmd).slice(0, 10);
}

function formatCapitalYmd(d) {
    var pad = function (n) { return String(n).padStart(2, '0'); };
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
}

/** Client-side PROGRAM DATE filter bounds (same pattern as dashboard F&B / hotel / tip). */
var capitalDateStart = null;
var capitalDateEnd = null;
var capitalDateFilterRegistered = false;
var capitalSplitDateRange = null;

function ymdToLocalDate(ymd) {
    if (!ymd || !/^\d{4}-\d{2}-\d{2}$/.test(String(ymd))) return null;
    var parts = String(ymd).slice(0, 10).split('-').map(Number);
    return new Date(parts[0], parts[1] - 1, parts[2], 12, 0, 0, 0);
}

function setCapitalFilterDates(selectedDates) {
    if (!selectedDates || selectedDates.length === 0) {
        capitalDateStart = null;
        capitalDateEnd = null;
        return;
    }
    if (selectedDates.length === 1) {
        capitalDateStart = selectedDates[0];
        capitalDateEnd = selectedDates[0];
        return;
    }
    var start = selectedDates[0];
    var end = selectedDates[1];
    if (start > end) {
        var tmp = start;
        start = end;
        end = tmp;
    }
    capitalDateStart = start;
    var endYmd = formatCapitalYmd(end);
    var expanded = capitalApiEndDate(endYmd);
    capitalDateEnd = expanded !== endYmd ? ymdToLocalDate(expanded) : end;
}

function setCapitalFilterDatesFromApi(startYmd, endYmd) {
    var startDate = ymdToLocalDate(startYmd);
    var endExpanded = capitalApiEndDate(endYmd);
    var endDate = ymdToLocalDate(endExpanded);
    if (!startDate || !endDate) return;
    if (startDate > endDate) {
        var tmp = startDate;
        startDate = endDate;
        endDate = tmp;
    }
    capitalDateStart = startDate;
    capitalDateEnd = endDate;
}

function registerCapitalDateFilter() {
    if (capitalDateFilterRegistered || !$.fn.dataTable || !$.fn.dataTable.ext) return;
    capitalDateFilterRegistered = true;
    $.fn.dataTable.ext.search.push(function (settings, data) {
        if (!settings || !settings.nTable || settings.nTable.id !== 'capital-tbl') return true;
        if (!capitalDateStart || !capitalDateEnd) return true;
        var ymd = String(data[0] || '').trim().slice(0, 10);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return true;
        var rowDate = ymdToLocalDate(ymd);
        if (!rowDate) return true;
        var start = new Date(
            capitalDateStart.getFullYear(),
            capitalDateStart.getMonth(),
            capitalDateStart.getDate(),
            0, 0, 0, 0
        );
        var end = new Date(
            capitalDateEnd.getFullYear(),
            capitalDateEnd.getMonth(),
            capitalDateEnd.getDate(),
            23, 59, 59, 999
        );
        return rowDate >= start && rowDate <= end;
    });
}

function applyCapitalDateFilterDraw() {
    if ($.fn.DataTable.isDataTable('#capital-tbl')) {
        $('#capital-tbl').DataTable().draw();
    }
}

function getCapitalDateRangeValue() {
    var el = document.getElementById('capital-daterange');
    if (el && el._flatpickr) {
        if (el._flatpickr.altInput && el._flatpickr.altInput.value) {
            return el._flatpickr.altInput.value.trim();
        }
        if (el._flatpickr.selectedDates && el._flatpickr.selectedDates.length === 2 && window.MonthEndCutoffRange) {
            return window.MonthEndCutoffRange.formatDisplayDate(el._flatpickr.selectedDates[0]) +
                ' to ' +
                window.MonthEndCutoffRange.formatDisplayDate(el._flatpickr.selectedDates[1]);
        }
    }
    return ($('#capital-daterange').val() || '').trim();
}

function initCapitalRangePicker() {
    var $el = $('#capital-daterange');
    if (!$el.length || typeof flatpickr === 'undefined') return null;
    if ($el.hasClass('flatpickr-input') && $el[0]._flatpickr) {
        return $el[0]._flatpickr;
    }

    var defaults = getDefaultMonthEndRange();
    registerCapitalDateFilter();

    return flatpickr('#capital-daterange', {
        mode: 'range',
        showMonths: 2,
        defaultDate: [defaults.start, defaults.end],
        altInput: true,
        altFormat: 'M j, Y',
        dateFormat: 'Y-m-d',
        allowInput: false,
        clickOpens: true,
        onReady: function (selectedDates, dateStr, instance) {
            setCapitalFilterDates(selectedDates);
            applyCapitalDateFilterDraw();
            if (window.MonthEndCutoffRange && typeof window.MonthEndCutoffRange.syncRangeDisplay === 'function') {
                window.MonthEndCutoffRange.syncRangeDisplay(instance);
            }
        },
        onChange: function (selectedDates, dateStr, instance) {
            setCapitalFilterDates(selectedDates);
            if (window.MonthEndCutoffRange && typeof window.MonthEndCutoffRange.syncRangeDisplay === 'function') {
                window.MonthEndCutoffRange.syncRangeDisplay(instance);
            }
            if (selectedDates.length === 2) {
                applyCapitalDateFilterDraw();
            }
        }
    });
}

function initCapitalSplitDateRange() {
    if (!window.SplitDateRange || typeof window.SplitDateRange.attach !== 'function') {
        capitalSplitDateRange = { fitWidths: function () {} };
        return;
    }

    registerCapitalDateFilter();
    capitalSplitDateRange = window.SplitDateRange.attach({
        rangePickerId: 'capital-daterange',
        startId: 'capital-start-date',
        endId: 'capital-end-date',
        splitWrapperId: 'capital-split-daterange-wrapper',
        independent: true,
        invalidDateMessage: 'Invalid date range.',
        onRangeApplied: function (range) {
            if (!range || !range.start || !range.end) return;
            var from = range.start;
            var to = capitalApiEndDate(range.end);
            if (from > to) {
                var swap = from;
                from = to;
                to = swap;
            }
            setCapitalFilterDatesFromApi(from, to);
            applyCapitalDateFilterDraw();
        }
    });
}

function parseCapitalDateRange(dateRange, pickerId) {
    var el = pickerId ? document.getElementById(pickerId) : null;
    var fp = el && el._flatpickr;

    // Prefer flatpickr selectedDates (reliable with altInput + DOM moves into DataTable bar)
    if (fp && fp.selectedDates && fp.selectedDates.length >= 2) {
        var start = formatCapitalYmd(fp.selectedDates[0]);
        var endRaw = formatCapitalYmd(fp.selectedDates[1]);
        var end = capitalApiEndDate(endRaw);
        if (start > end) {
            return { rangeStr: dateRange || '', start: end, end: start, endDisplay: start };
        }
        return { rangeStr: dateRange || '', start: start, end: end, endDisplay: endRaw };
    }
    if (fp && fp.selectedDates && fp.selectedDates.length === 1) {
        var single = capitalApiEndDate(formatCapitalYmd(fp.selectedDates[0]));
        return { rangeStr: dateRange || '', start: single, end: single, endDisplay: single };
    }

    // Do not use resolveRangeFromPicker().end — it always expands to month-end and breaks filtering.
    if (window.MonthEndCutoffRange) {
        var rangeStr = (dateRange || '').trim();
        if (!rangeStr || !/\s+to\s+/i.test(rangeStr)) {
            var fallback = window.MonthEndCutoffRange.getMonthEndCutoffRange();
            rangeStr = fallback.startDisplay + ' to ' + fallback.endDisplay;
        }
        var parsed = window.MonthEndCutoffRange.parseRangeString(rangeStr);
        var startApi = window.MonthEndCutoffRange.toApiDate(parsed.start);
        var endSelected = window.MonthEndCutoffRange.toApiDate(parsed.end);
        var endApi = capitalApiEndDate(endSelected);
        if (startApi && endApi) {
            if (startApi > endApi) {
                return { rangeStr: rangeStr, start: endApi, end: startApi, endDisplay: startApi };
            }
            return { rangeStr: rangeStr, start: startApi, end: endApi, endDisplay: endSelected };
        }
    }

    let rangeStrFallback = (dateRange || '').trim();
    if (!rangeStrFallback) {
        const fallbackRange = getDefaultMonthEndRange();
        rangeStrFallback = `${fallbackRange.startDisplay} to ${fallbackRange.endDisplay}`;
    }

    let startDate;
    let endDate;
    if (rangeStrFallback.indexOf(' to ') > -1) {
        [startDate, endDate] = rangeStrFallback.split(' to ');
    } else {
        startDate = rangeStrFallback;
        endDate = rangeStrFallback;
    }

    return {
        rangeStr: rangeStrFallback,
        start: startDate,
        end: endDate,
        endDisplay: endDate,
    };
}

function inferCapitalRemarksSource(row) {
    if (row.REMARKS_SOURCE) return row.REMARKS_SOURCE;
    if (row.CATEGORY_ID > 0 && row.expense_description != null) return 'junket_house_expense';
    if (row.CAGE_TYPE != null || (row.GAME_ID != null && row.GAME_ID !== '')) return 'game_record';
    if (row.ledger_amount != null || row.comms_description) return 'account_ledger';
    if (row.NN_CHIPS != null || row.TOTAL_CHIPS != null) return 'junket_total_chips';
    return 'junket_capital';
}

function mergeCapitalTransferRemarks(userRemarks, accountLabel) {
    const label = String(accountLabel || '').trim();
    const notes = String(userRemarks || '').trim();
    if (!label) return notes;
    if (!notes) return label;
    if (notes.indexOf(label) !== -1) return notes;
    return label + ' — ' + notes;
}

function resolveCapitalRemarksText(row) {
    const typeLabel = normalizeHouseBalanceTypeLabel(getHouseBalanceTypeDesc(row));
    const remarksText = row.REMARKS || '';
    const accountLabel = row.capital_account_label || '';
    if (typeLabel === 'Transfer') {
        return mergeCapitalTransferRemarks(remarksText, accountLabel);
    }
    return remarksText;
}

function renderCapitalRemarksCell(row, displayText, suffixHtml) {
    if (!window.RemarksEditor || !row.IDNo) {
        return (displayText || '') + (suffixHtml || '');
    }
    const source = inferCapitalRemarksSource(row);
    const editText = row.REMARKS_EDIT != null ? row.REMARKS_EDIT : (displayText || '');
    return window.RemarksEditor.renderCell(editText, {
        source: source,
        recordId: row.IDNo,
        displayText: displayText || '',
        suffixHtml: suffixHtml || ''
    });
}

function reloadData() {
    // Ipakita ang loading overlay at simulate progress...
    $('#modal-new-capital .loading-overlay').show();
    $('#modal-new-capital .progress-bar').css('width', '0%');

    let progress = 0;
    const interval = setInterval(() => {
        if (progress < 90) {
            progress += 5;
            $('#modal-new-capital .progress-bar').css('width', `${progress}%`);
        } else {
            clearInterval(interval);
        }
    }, 100); // Adjust interval time for smoother effect (100ms = smoother)
   
    $.ajax({
        url: '/junket_capital_data?_=' + Date.now(),
        method: 'GET',
        success: function (data) {
            if (!Array.isArray(data)) {
                console.error('junket_capital_data: expected array', data);
                return;
            }

            var dataTable = $('#capital-tbl').DataTable(); // Ensure you have the DataTable reference
            dataTable.clear();
            window.__capitalEditRows = {};
            var total_in = 0;
            var total_out = 0;
            var displayedCount = 0;

            data.forEach(function (row) {
                if (!isHouseCashInOutRow(row)) {
                    return;
                }

                const typeDesc = getHouseBalanceTypeDesc(row);
                const cbal = row.capital_amount !== null ? row.capital_amount : 0;
                if (cbal <= 0) {
                    return;
                }

                total_in += row.capital_amount || 0; // Ensure AMOUNT is handled even if null
                var combinedDescription = [];
                var combinedChipsText = ''; // Declare combinedChipsText here

                // Ensure FULLNAME is not null, default to 'N/A' if it is
                var fullName = row.ENCODED_BY_NAME !== null ? row.ENCODED_BY_NAME : 'N/A';

                // Check TRANSACTION_ID to assign the appropriate label with spans
                if (row.TRANSACTION_ID === 5) {
                    combinedDescription.push(`<span class="css-violet">Commission</span> ${row.comms_description || ''}`);
                } else if (row.TRANSACTION_ID === 11) {
                    combinedDescription.push(`<span class="css-violet">IOU Payment</span> ${row.comms_description || ''}`);
                }

                // Add capital description logic (expense rows: use CATEGORY from expense_category; others: legacy numeric mapping)
                if (row.CATEGORY_ID > 0) {
                    const categoryLabel = (row.CATEGORY && String(row.CATEGORY).trim()) ? row.CATEGORY : 'Junket Expense';
                    combinedDescription.push(`<span class="css-blue1">${categoryLabel}</span>`);
                } else if (row.capital_description) {
                    if (row.capital_description == 1) {
                        combinedDescription.push(`<span class="css-blue1">PURCHASE OF BUSINESS SUPPLIES</span>`);
                    } else if (row.capital_description == 2) {
                        combinedDescription.push(`<span class="css-blue1">Hotel</span>`);
                    } else if (row.capital_description == 3) {
                        combinedDescription.push(`<span class="css-blue1">Guest</span>`);
                    } else if (row.capital_description == 4) {
                        combinedDescription.push(`<span class="css-blue1">FnB</span>`);
                    } else if (row.capital_description == 5) {
                        combinedDescription.push(`<span class="css-blue1">Car</span>`);
                    } else if (row.capital_description == 6) {
                        combinedDescription.push(`<span class="css-blue1">Employee</span>`);
                    } else if (row.capital_description == 7) {
                        combinedDescription.push(`<span class="css-blue1">Etc</span>`);
                    } else {
                        combinedDescription.push(row.capital_description);
                    }
                }

                // Check for TRANSACTION_ID to add CASH and DEPOSIT descriptions
                if (row.TRANSACTION_ID == 1 && row.CAGE_TYPE == 1) {
                    combinedDescription.push(`<span class="css-violet">CASH</span>`); // Badge for CASH
                } else if (row.TRANSACTION_ID == 2 && row.CAGE_TYPE == 1) {
                    combinedDescription.push(`<span class="css-violet">DEPOSIT</span>`); // Badge for DEPOSIT
                }

                if (row.chips_description) {
                    combinedDescription.push(row.chips_description);
                }

                // Join the descriptions with a separator
                combinedDescription = combinedDescription.filter(Boolean).join(' | ');

                // Determine if this row represents a Cash Balance entry
                const isCashBalance =
                    cbal > 0 &&
                    (isHouseBalanceCashInType(typeDesc) || isHouseBalanceCashOutType(typeDesc));

                // Show edit/delete for Cash Balance rows (Super Admin only)
                let btn = '';
                const permissions = parseInt($('#user-role').data('permissions'));
                const isSuperAdmin = permissions === 0;
                if (isCashBalance) {
                    window.__capitalEditRows = window.__capitalEditRows || {};
                    window.__capitalEditRows[row.IDNo] = {
                        id: row.IDNo,
                        amount: cbal,
                        remarks: resolveCapitalRemarksText(row),
                        programDate: (row.PROGRAM_DATE ? String(row.PROGRAM_DATE).slice(0, 10) : '') ||
                            (row.ENCODED_DT ? moment.utc(row.ENCODED_DT).utcOffset(8).format('YYYY-MM-DD') : ''),
                        typeLabel: normalizeHouseBalanceTypeLabel(typeDesc),
                        txn: row.TRANSACTION_ID,
                        accountId: row.capital_account_id || null
                    };
                    if (isSuperAdmin) {
                        btn =
                            `<div class="capital-action-btns">` +
                            `<button type="button" onclick="edit_capital(${row.IDNo})" class="btn btn-sm btn-alt-primary js-bs-tooltip-enabled"
                                        data-bs-toggle="tooltip" aria-label="Edit" data-bs-original-title="Edit">
                                        <i class="fa fa-edit"></i>
                                  </button>` +
                            `<button type="button" onclick="archive_capital(${row.IDNo})" class="btn btn-sm btn-alt-danger js-bs-tooltip-enabled"
                                        data-bs-toggle="tooltip" aria-label="Archive" data-bs-original-title="Archive">
                                        <i class="fa fa-trash-alt"></i>
                                  </button>` +
                            `</div>`;
                    }
                }

                var formattedProgramDate = '—';
                if (row.PROGRAM_DATE) {
                    formattedProgramDate = String(row.PROGRAM_DATE).slice(0, 10);
                } else if (row.ENCODED_DT) {
                    formattedProgramDate = moment.utc(row.ENCODED_DT).utcOffset(8).format('YYYY-MM-DD');
                }
                var formattedDate = row.ENCODED_DT
                    ? moment.utc(row.ENCODED_DT).utcOffset(8).format('YYYY-MM-DD HH:mm')
                    : '—';

                 // Prepare REMARKS with GAME_ID if applicable
                 var remarksText = resolveCapitalRemarksText(row);
                 var remarksSuffix = '';
                 if ((row.TRANSACTION_ID == 1 || row.TRANSACTION_ID == 2) && row.GAME_ID) {
                     const gameId = row.GAME_ID;
                     remarksSuffix = ` <a href="/game_list?id=${gameId}"  title="Go to Game" target="_blank">Game-${gameId}</a>`;
                 }
                 var remarks = renderCapitalRemarksCell(row, remarksText, remarksSuffix);

                // Check NN_CHIPS, PAYMENT, IOU, or AMOUNT with labels for combinedChipsText
                var nnChips = row.NN_CHIPS !== null ? row.NN_CHIPS : 0;
                var comms = row.TRANSACTION_ID === 5 ? (row.ledger_amount !== null ? row.ledger_amount : 0) : 0; // Payment for TRANSACTION_ID 5
                var IOU = row.TRANSACTION_ID === 11 ? (row.ledger_amount !== null ? row.ledger_amount : 0) : 0;  // Cash IOU for TRANSACTION_ID 11

                // Determine which value to display in combinedChipsText with labels
                if (nnChips > 0 && row.capital_description == '<span class="css-red">Chips Buy-in</span>') {
                    combinedChipsText = `NN-Chips : ${fmtCapitalAmount(nnChips, 'out')}`;
                }
                else if (nnChips > 0 && row.capital_description == '<span class="css-red">Chips Return</span>') {
                    combinedChipsText = `NN-Chips : ${fmtCapitalAmount(nnChips, 'in')}`;
                } else if (nnChips > 0) {
                    combinedChipsText = `NN-Chips : ${fmtCapitalAmount(nnChips, 'out')}`;
                } else if (comms > 0) {
                    combinedChipsText = `Cash Out : ${fmtCapitalAmount(comms, 'out')}`;
                } else if (IOU > 0) {
                    combinedChipsText = `Credit Cash :\n${window.fmtAmt ? window.fmtAmt(IOU) : IOU.toLocaleString('en-US')}`;
                } else if (row.CATEGORY_ID > 0 && row.capital_amount != null && row.capital_amount !== 0) {
                    combinedChipsText = `Junket Expense : ${fmtCapitalAmount(row.capital_amount, 'out')}`;
                } else if (cbal > 0 && (isHouseBalanceCashInType(typeDesc) || isHouseBalanceCashOutType(typeDesc))) {
                    combinedChipsText = fmtCapitalAmount(cbal, houseBalanceDirectionFromTxn(row.TRANSACTION_ID));
                } else {
                    combinedChipsText = ''; // Empty string if no valid data to display
                }

                // Add row to DataTable only if combinedChipsText is not empty
                if (combinedChipsText) {
                    displayedCount += 1;
                    dataTable.row.add([
                        formattedProgramDate,
                        formattedDate,
                        `${combinedChipsText}`,
                        combinedDescription,
                        remarks,
                        `${fullName}`,
                        btn
                    ]);
                }
            });

            dataTable.draw();
            $('.total_balance').text('P' + (total_in - total_out).toLocaleString('en-US'));
            if ($.fn.DataTable.isDataTable('#capital-tbl')) {
                $('#capital-tbl').DataTable().columns.adjust();
            }
        },
        error: function (xhr, status, error) {
            console.error('Error fetching data:', error, xhr && xhr.responseText);
        },
        complete: function () {
            // Ensure progress reaches 100% before hiding the overlay
            clearInterval(interval); // Clear simulated progress interval
            $('#modal-new-capital .progress-bar').css('width', '100%'); // Jump to 100%
            setTimeout(() => {
                $('#modal-new-capital .loading-overlay').fadeOut();
            }, 300); // Short delay for user to notice 100% before hiding
        }
       
    });
}

$(document).ready(function () {
    function layoutCapitalTableControls() {
        var wrapper = document.getElementById('capital-tbl_wrapper');
        var lengthWrap = document.getElementById('capital-tbl_length');
        var filterWrap = document.getElementById('capital-tbl_filter');
        var rangeSlot = document.getElementById('capital-daterange-slot');
        var printExportSlot = document.getElementById('capital-print-export-slot');
        var controlsHighlight;
        var filterHighlight;
        var searchLabel;
        var searchInput;

        if (!wrapper || !lengthWrap || !filterWrap) return;

        controlsHighlight = wrapper.querySelector('.capital-controls-highlight');
        if (!controlsHighlight) {
            controlsHighlight = document.createElement('div');
            controlsHighlight.className = 'capital-controls-highlight';
            wrapper.insertBefore(controlsHighlight, wrapper.firstChild);
        }

        if (lengthWrap.parentElement !== controlsHighlight) {
            controlsHighlight.appendChild(lengthWrap);
        }
        if (filterWrap.parentElement !== controlsHighlight) {
            controlsHighlight.appendChild(filterWrap);
        }
        if (rangeSlot && rangeSlot.parentElement !== controlsHighlight) {
            controlsHighlight.insertBefore(rangeSlot, filterWrap);
            rangeSlot.classList.add('is-placed');
        }

        searchLabel = filterWrap.querySelector('label');
        searchInput = searchLabel ? searchLabel.querySelector('input') : null;

        filterHighlight = filterWrap.querySelector('.capital-filter-highlight');
        if (!filterHighlight) {
            filterHighlight = document.createElement('div');
            filterHighlight.className = 'capital-filter-highlight';
            filterWrap.appendChild(filterHighlight);
        }
        if (printExportSlot && printExportSlot.parentElement !== filterHighlight) {
            filterHighlight.insertBefore(printExportSlot, filterHighlight.firstChild);
            printExportSlot.classList.add('is-placed');
        }
        if (searchLabel && searchLabel.parentElement !== filterHighlight) {
            filterHighlight.appendChild(searchLabel);
        }

        if (searchInput) {
            searchInput.setAttribute('placeholder', 'Search...');
            Array.prototype.slice.call(searchLabel.childNodes).forEach(function (node) {
                if (node.nodeType === 3) searchLabel.removeChild(node);
            });
        }

        if (window.MonthEndCutoffRange && typeof window.MonthEndCutoffRange.fitRangePickerInstance === 'function') {
            var rangeEl = document.getElementById('capital-daterange');
            if (rangeEl && rangeEl._flatpickr) {
                window.MonthEndCutoffRange.fitRangePickerInstance(rangeEl._flatpickr);
            }
        }
        if (capitalSplitDateRange && typeof capitalSplitDateRange.fitWidths === 'function') {
            capitalSplitDateRange.fitWidths();
        }
    }
    window.layoutCapitalTableControls = layoutCapitalTableControls;

    // Ensure DataTable remains initialized with the required configuration
    if ($.fn.DataTable.isDataTable('#capital-tbl')) {
        $('#capital-tbl').DataTable().destroy();
    }

    initCapitalSplitDateRange();
    initCapitalRangePicker();

    $('#capital-tbl').DataTable({
        "order": [[0, 'desc'], [1, 'desc']], // Program Date, then Date & Time
        "autoWidth": true,
        "scrollX": false,
        "drawCallback": function () {
            layoutCapitalTableControls();
        },
        "initComplete": function () {
            layoutCapitalTableControls();
        },
        "columnDefs": [
            {
                "targets": 0, // PROGRAM DATE
                "className": "text-center",
                "createdCell": function (cell) {
                    $(cell).addClass('text-center');
                }
            },
            {
                "targets": 1, // DATE & TIME
                "className": "text-center",
                "render": function (data, type, row) {
                    if (type === 'sort') {
                        var sortMoment = moment.utc(data);
                        if (!sortMoment.isValid()) sortMoment = moment(data);
                        return sortMoment.isValid() ? sortMoment.format('YYYY-MM-DD HH:mm:ss') : data;
                    }
                    var dateMoment = moment(data);
                    if (!dateMoment.isValid()) {
                        dateMoment = moment(data, ['MMMM DD, YYYY HH:mm:ss', 'YYYY-MM-DD HH:mm:ss', 'YYYY-MM-DD HH:mm', moment.ISO_8601]);
                    }
                    if (dateMoment.isValid()) {
                        return dateMoment.local().format('YYYY-MM-DD HH:mm'); // Display formatted date
                    } else {
                        return data || 'Invalid Date';
                    }
                },
                "createdCell": function (cell) {
                    $(cell).addClass('text-center');
                }
            },
            {
                "targets": 2, // AMOUNT
                "className": "text-end"
            },
            {
                "targets": 3, // TYPE
                "className": "text-center"
            },
            {
                "targets": 5, // ENCODED BY
                "className": "text-center"
            },
            {
                "targets": 6, // ACTION
                "orderable": false,
                "searchable": false,
                "width": "1%",
                "className": "col-action-cell text-center",
                "createdCell": function (cell) {
                    $(cell).addClass('col-action-cell text-center');
                }
            }
        ]
    });

    // Initial data load
    reloadData();

    $(document).off('click.capitalPrint', '#btn-capital-print').on('click.capitalPrint', '#btn-capital-print', function (e) {
        e.preventDefault();
        printAuthorizedMasterAccount();
    });

    $(document).off('click.capitalExport', '#btn-capital-export').on('click.capitalExport', '#btn-capital-export', function (e) {
        e.preventDefault();
        exportAuthorizedMasterAccount($(this));
    });
});


// Archive capital function
function archive_capital(id) {
    const permissions = parseInt($('#user-role').data('permissions'), 10);
    if (permissions !== 0) {
        Swal.fire({ icon: 'warning', title: 'Forbidden', text: 'Only Super Admin can delete.' });
        return;
    }

    console.log(`Attempting to deleted capital and total chips with ID: ${id}`); // Log ID

    SwalConfirm.fire({
        title: 'Are you sure you want to delete this?',
        confirmButtonText: 'Yes'
    }).then((result) => {
        if (result.isConfirmed) {
            $.ajax({
                url: `/junket_capital/remove/${id}`,
                type: 'PUT',
                success: function (response) {
                    console.log('Success response:', response);
                    var inTotalChipsModal = $('#modal-new-total-chips').hasClass('show');
                    if (inTotalChipsModal) {
                        if (typeof window.loadTotalChipsHistory === 'function') window.loadTotalChipsHistory();
                        if (typeof window.refreshTotalChipsRefBalances === 'function') window.refreshTotalChipsRefBalances();
                        if (typeof chipsTransactionComputation === 'function') chipsTransactionComputation();
                        Swal.fire('Deleted Successfully', '', 'success');
                        return;
                    }
                    if ($('#capital-tbl').length && typeof reloadData === 'function') {
                        reloadData();
                        Swal.fire('Deleted Successfully', '', 'success');
                        return;
                    }
                    Swal.fire('Deleted Successfully', '', 'success').then(function () {
                        window.location.href = '/dashboard';
                    });
                },
                error: function (xhr) {
                    console.error('AJAX Error:', xhr.responseText);
                    var msg = (xhr.responseJSON && xhr.responseJSON.error) || xhr.responseText || 'Delete failed.';
                    Swal.fire('Error!', String(msg).trim() || 'There was an error deleting the record.', 'error');
                }
            });
        }
    });
}

function addCapital() {
    $('#modal-new-capital').modal('show');
    $('#txtTrans').val('');
    $('#txtCategory').val('');
    $('#txtDescription').val('');
    $('#txtAmount').val('');
    $('#Remarks').val('');
    transaction_type();
    capital_category();
}

var HOUSE_BALANCE_ACTIVE_TYPES = {
    'Transfer': true,
    'Deposit': true,
    'Withdrawal': true,
    'Loss Amount': true,
    'Settlement': true,
    'F&B': true,
    'Hotel': true,
    'Incidental': true,
    'Expenses': true
};

function isHouseBalanceTypeActive(label) {
    return !!(label && HOUSE_BALANCE_ACTIVE_TYPES[String(label)]);
}

function updateEditCapitalTypeFields() {
    const $checked = $('#edit_junket_capital .edit-hb-type-check:checked');
    if (!$checked.length) {
        $('#edit-capital-txn').val('');
        $('#edit-capital-description').val('');
        return;
    }
    $('#edit-capital-txn').val(String($checked.data('txn') || ''));
    $('#edit-capital-description').val('<span class="css-blue">' + $checked.val() + '</span>');
}

function ensureEditCapitalProgramDatePicker(defaultDate) {
    var el = document.getElementById('edit-capital-program-date');
    if (!el || typeof flatpickr === 'undefined') return;
    if (el._flatpickr) {
        el._flatpickr.destroy();
    }
    flatpickr(el, {
        enableTime: false,
        dateFormat: 'Y-m-d',
        altInput: true,
        altFormat: 'M j, Y',
        defaultDate: defaultDate || new Date(),
        allowInput: true,
        disableMobile: true
    });
}

function edit_capital(capital_id) {
    const permissions = parseInt($('#user-role').data('permissions'), 10);
    if (permissions !== 0) {
        Swal.fire({ icon: 'warning', title: 'Forbidden', text: 'Only Super Admin can edit.' });
        return;
    }

    const row = (window.__capitalEditRows && window.__capitalEditRows[capital_id]) || null;
    if (!row) {
        Swal.fire({ icon: 'error', title: 'Error', text: 'Record not found. Refresh and try again.' });
        return;
    }

    $('#edit-capital-id').val(row.id);
    var editSign = parseInt(row.txn, 10) === 2 ? '-' : '+';
    $('#edit-capital-amount').val(editSign + Number(row.amount || 0).toLocaleString('en-US'));
    $('#edit-capital-remarks').val(row.remarks || '');
    ensureEditCapitalProgramDatePicker(row.programDate || null);

    const typeLabel = row.typeLabel || '';
    $('#edit_junket_capital .edit-hb-type-check').prop('checked', false);
    if (typeLabel === 'Cash-in') {
        $('#editHbTypeDeposit').prop('checked', true);
    } else if (typeLabel === 'Cash-out') {
        $('#editHbTypeWithdrawal').prop('checked', true);
    } else {
        $('#edit_junket_capital .edit-hb-type-check').filter(function () {
            return $(this).val() === typeLabel;
        }).prop('checked', true);
    }
    updateEditCapitalTypeFields();
    syncCapitalTransferUi('#edit_junket_capital', '#edit-capital-transfer-account-wrap', '#edit-capital-transfer-account');

    if (typeLabel === 'Transfer') {
        loadCapitalTransferAccounts($('#edit-capital-transfer-account'), '#modal-edit-capital', row.accountId || null);
    } else {
        $('#edit-capital-transfer-account').val('').trigger('change');
    }

    const $saveBtn = $('#edit-capital-save-btn');
    $saveBtn.prop('disabled', false).html('<i class="fa fa-check-circle me-1"></i>Save');

    $('#modal-edit-capital').modal('show');
}

$(document).off('change.editCapitalType', '#edit_junket_capital .edit-hb-type-check')
    .on('change.editCapitalType', '#edit_junket_capital .edit-hb-type-check', function () {
        if (this.checked) {
            $('#edit_junket_capital .edit-hb-type-check').not(this).prop('checked', false);
        }
        updateEditCapitalTypeFields();
        syncCapitalTransferUi('#edit_junket_capital', '#edit-capital-transfer-account-wrap', '#edit-capital-transfer-account');
        if (isCapitalTransferTypeSelected('#edit_junket_capital .edit-hb-type-check')) {
            loadCapitalTransferAccounts($('#edit-capital-transfer-account'), '#modal-edit-capital');
        }
    });

$(document).off('submit.editCapital', '#edit_junket_capital').on('submit.editCapital', '#edit_junket_capital', function (e) {
    e.preventDefault();

    const permissions = parseInt($('#user-role').data('permissions'), 10);
    if (permissions !== 0) {
        Swal.fire({ icon: 'warning', title: 'Forbidden', text: 'Only Super Admin can edit.' });
        return;
    }

    const id = parseInt($('#edit-capital-id').val(), 10);
    const programDateVal = ($('#edit-capital-program-date').val() || '').trim();
    const parsedAmount = parseCapitalSignedAmount($('#edit-capital-amount').val());
    const remarks = $('#edit-capital-remarks').val() || '';

    if (!id) {
        Swal.fire({ icon: 'error', title: 'Error', text: 'Missing record id.' });
        return;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(programDateVal)) {
        Swal.fire({ icon: 'warning', title: 'Program Date required', text: 'Select a valid Program Date.' });
        return;
    }
    if (!parsedAmount.ok) {
        Swal.fire({
            icon: 'warning',
            title: 'Amount required',
            text: 'Enter a valid amount with + (dagdag) or - (bawas), e.g. +5,000 or -5,000.'
        });
        return;
    }

    updateEditCapitalTypeFields();
    const description = ($('#edit-capital-description').val() || '').trim();
    const selectedTypeLabel = ($('#edit_junket_capital .edit-hb-type-check:checked').val() || '').trim();
    if (!description || !isHouseBalanceTypeActive(selectedTypeLabel)) {
        Swal.fire({ icon: 'warning', title: 'Transaction type', text: 'Select a transaction type.' });
        return;
    }
    if (selectedTypeLabel === 'Transfer') {
        const accountId = ($('#edit-capital-transfer-account').val() || '').trim();
        if (!accountId) {
            Swal.fire({ icon: 'warning', title: 'Account required', text: 'Select an account for transfer.' });
            return;
        }
        const transferCheck = validateCapitalTransferAmount('#edit-capital-transfer-account', parsedAmount);
        if (!transferCheck.ok) {
            Swal.fire({
                icon: 'error',
                title: 'Insufficient Account Balance',
                text: transferCheck.message
            });
            return;
        }
    }
    // Amount +/- drives Capital In (1) / Out (2)
    $('#edit-capital-txn').val(parsedAmount.txn);

    const $btn = $('#edit-capital-save-btn');
    $btn.prop('disabled', true).html(
        '<span class="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span> Saving...'
    );

    $.ajax({
        url: '/junket_capital/' + id,
        type: 'PUT',
        data: {
            txtProgramDate: programDateVal,
            txtAmount: parsedAmount.abs,
            Remarks: remarks,
            optWithdrawDeposit: parsedAmount.txn,
            description: description,
            txtAccountId: ($('#edit-capital-transfer-account').val() || '').trim()
        },
        success: function () {
            $('#modal-edit-capital').modal('hide');
            Swal.fire({ icon: 'success', title: 'Updated', text: 'Record updated successfully.', timer: 1200, showConfirmButton: false });
            if (typeof reloadData === 'function') reloadData();
        },
        error: function (xhr) {
            const msg = (xhr && xhr.responseText) ? String(xhr.responseText).slice(0, 200) : 'Failed to update record.';
            Swal.fire({ icon: 'error', title: 'Error', text: msg });
        },
        complete: function () {
            $btn.prop('disabled', false).html('<i class="fa fa-check-circle me-1"></i>Save');
        }
    });
});

function transaction_type() {
    $.ajax({
        url: '/transaction_type_data',
        method: 'GET',
        success: function (response) {
            var selectOptions = $('#txtTrans');
            selectOptions.empty();
            selectOptions.append($('<option>', {
                value: '',
                text: '--SELECT TRANSACTION TYPE--'
            }));
            response.forEach(function (option) {
                selectOptions.append($('<option>', {
                    value: option.IDNo,
                    text: option.TRANSACTION
                }));
            });
        },
        error: function (xhr, status, error) {
            console.error('Error fetching options:', error);
        }
    });
}

function capital_category() {
    $.ajax({
        url: '/capital_category_data',
        method: 'GET',
        success: function (response) {
            var selectOptions = $('#txtCategory');
            selectOptions.empty();
            selectOptions.append($('<option>', {
                value: '',
                text: '--SELECT CAPITAL CATEGORY--'
            }));
            response.forEach(function (option) {
                selectOptions.append($('<option>', {
                    value: option.IDNo,
                    text: option.CATEGORY
                }));
            });
        },
        error: function (xhr, status, error) {
            console.error('Error fetching options:', error);
        }
    });
}

// Counter para i-track kung ilan na ang naka-load na totals
let loadedTotalsCount = 0;
const totalComputationCount = 3; // Cash-In, Cash-Out, Chips Transaction

function computeTotalCashIn() {
    // Use current month as the default date range
    const rangeDefaults = getDefaultMonthEndRange();
    const startOfMonth = rangeDefaults.start;
    const currentDate = rangeDefaults.end;

    $.ajax({
        url: `/junket_capital_data?start_date=${startOfMonth}&end_date=${currentDate}&` + new Date().getTime(),
        type: "GET",
        success: function (data) {
            let totalCashIn = 0;
            
            data.forEach(row => {
                // Direction comes from TRANSACTION_ID (amount +/-), not type label alone
                const isCashIn = row.TRANSACTION_ID == 1 && isHouseCashInOutRow(row);
                
                if (isCashIn) {
                    totalCashIn += parseFloat(row.capital_amount || 0);
                }
            });
            
            $('#cash-in-total').text(`₱${totalCashIn.toLocaleString('en-US')}`);
            // console.log('Updated total cash-in:', totalCashIn);
            loadedTotalsCount++;
            if (loadedTotalsCount >= totalComputationCount) {
                updateProgressBars(); // Update progress bars only after all totals are loaded
                loadedTotalsCount = 0; // Reset counter for next update cycle
            }
        },
        error: function(xhr, status, error) {
            console.error('Error fetching total cash:', error);
            $('#cash-in-total').text('₱0');
            loadedTotalsCount++;
            if (loadedTotalsCount >= totalComputationCount) {
                updateProgressBars();
                loadedTotalsCount = 0;
            }
        }
    });
}

function computeTotalCashOut() {
    // Use current month as the default date range
    const rangeDefaults = getDefaultMonthEndRange();
    const startOfMonth = rangeDefaults.start;
    const currentDate = rangeDefaults.end;

    $.ajax({
        url: `/junket_capital_data?start_date=${startOfMonth}&end_date=${currentDate}&` + new Date().getTime(),
        type: "GET",
        success: function (data) {
            let totalCashOut = 0;
            
            data.forEach(row => {
                // Direction comes from TRANSACTION_ID (amount +/-), not type label alone
                const isCashOut = row.TRANSACTION_ID == 2 && isHouseCashInOutRow(row);
                
                if (isCashOut) {
                    totalCashOut += parseFloat(row.capital_amount || 0);
                }
            });
            
            $('#cash-out-total').text(`₱${totalCashOut.toLocaleString('en-US')}`);
            // console.log('Updated total cash-out:', totalCashOut);
            loadedTotalsCount++;
            if (loadedTotalsCount >= totalComputationCount) {
                updateProgressBars(); // Update progress bars only after all totals are loaded
                loadedTotalsCount = 0; // Reset counter for next update cycle
            }
        },
        error: function(xhr, status, error) {
            console.error('Error fetching total cash-out:', error);
            $('#cash-out-total').text('₱0');
            loadedTotalsCount++;
            if (loadedTotalsCount >= totalComputationCount) {
                updateProgressBars();
                loadedTotalsCount = 0;
            }
        }
    });
}



/**
 * Function para sa pag-load ng DataTable ng mga cash transactions.
 * Dito lang nakatuon ang pag-filter at pag-display ng mga transaction sa table.
 */
function getCashInFilterValue() {
    return $('#cash-in-filter .filter-link.active').data('filter') || 'all';
}
function getCashOutFilterValue() {
    return $('#cash-out-filter .filter-link.active').data('filter') || 'capital';
}

function loadCashInData() {
    const dateRange = $('#daterange').val();
    console.log('Date Range:', dateRange);

    const resolved = parseCapitalDateRange(dateRange, 'daterange');
    const startDate = resolved.start;
    const endDate = resolved.end;
    if (!startDate || !endDate) {
        alert('Please select a date range.');
        return;
    }
    console.log('Start Date:', startDate, 'End Date:', endDate);

    // I-destroy ang DataTable kung ito ay naka-instantiate na
    if ($.fn.DataTable.isDataTable('#cash-in-tbl')) {
        $('#cash-in-tbl').DataTable().destroy();
    }

    $('#cash-in-tbl').DataTable({
        "processing": false,
        "serverSide": false,
        "lengthMenu": [[10, 25, 50, 100, -1], [10, 25, 50, 100, "All"]],
        "order": [[5, 'desc']],
        "ajax": {
            "url": `/cash_in_details?start_date=${startDate}&end_date=${endDate}&` + new Date().getTime(),
            "type": "GET",
            "dataSrc": function(json) {
                console.log('Raw Cash-In Data (source tables):', json);

                if (!Array.isArray(json)) {
                    console.error('Expected array but got:', json);
                    return [];
                }
                
                const filterValue = getCashInFilterValue();
                const filterConfig = {
                    all: null,
                    capital: { categories: ['Capital In'], lower: false },
                    gamemoney: { categories: ['Game buy-in', 'additional buy-in', 'Game buy-in - Deposit', 'Additional buy-in - Deposit'], lower: false },
                    account: { categories: ['Account Deposit', 'Commission Deposit'], lower: false },
                    services: { categories: ['fnb', 'hotel', 'delivery'], lower: true },
                    cashout: { categories: ['Chips Cash-out to Casino'], lower: false }
                };
                const config = filterConfig[filterValue];

                return json
                    .filter(row => {
                        // All rows in this endpoint are cash-in (TYPE = 1)
                        return parseInt(row.TYPE, 10) === 1;
                    })
                    .filter(row => {
                        if (!config) {
                            return true;
                        }
                        const value = row.CATEGORY || '';
                        if (config.lower) {
                            return config.categories.includes(value.toLowerCase());
                        }
                        return config.categories.includes(value);
                    })
                    .map(row => {
                        const typeText = row.CATEGORY || 'Capital In';
                        const accountName = row.AGENT_NAME || '-';
                        const amount = window.fmtAmt ? window.fmtAmt(row.AMOUNT) : parseFloat(row.AMOUNT || 0).toLocaleString('en-US');
                        const remarksDisplay = row.REMARKS || '';
                        const remarksEdit = row.REMARKS_EDIT != null ? row.REMARKS_EDIT : remarksDisplay;
                        const encodedBy = row.ENCODED_BY_NAME || 'N/A';
                        const formattedDate = moment.utc(row.ENCODED_DT).utcOffset(8).format('YYYY-MM-DD HH:mm');
                        const serviceTransactionId = row.SERVICE_TRANSACTION_ID != null
                            ? parseInt(row.SERVICE_TRANSACTION_ID, 10)
                            : null;

                        return [
                            typeText,
                            accountName,
                            amount,
                            remarksDisplay,
                            encodedBy,
                            formattedDate,
                            serviceTransactionId,
                            row.IDNo,
                            row.REMARKS_SOURCE || '',
                            remarksEdit
                        ];
                    });
            }
        },
        "columns": [
            { "className": "text-center" },
            { "className": "text-start" },
            { "className": "text-end" },
            { "className": "text-start" },
            { "className": "text-center" },
            { "className": "text-center" },
            { "visible": false },
            { "visible": false },
            { "visible": false }
        ],
        "columnDefs": [{
            targets: 3,
            render: function (data, type, row) {
                if (type !== 'display') return data;
                if (!window.RemarksEditor || !row[8]) return data || '';
                return window.RemarksEditor.renderCell(row[9] != null ? row[9] : (data || ''), {
                    source: row[8],
                    recordId: row[7],
                    displayText: data || ''
                });
            }
        }],
        "createdRow": function (row, data) {
            const serviceTransactionId = data && data.length > 6 ? parseInt(data[6], 10) : null;
            if (serviceTransactionId === 3) {
                $('td:eq(0), td:eq(2)', row).addClass('text-primary');
            }
        },
        "responsive": true,
        "language": {
            "emptyTable": "No cash-in transactions found",
            "processing": "Loading cash transactions..."
        }
    });
}

function loadCashOutData() {
    const dateRange = $('#cashout-daterange').val();
    console.log('Cash-Out Date Range:', dateRange);

    const resolved = parseCapitalDateRange(dateRange, 'cashout-daterange');
    const startDate = resolved.start;
    const endDate = resolved.end;
    if (!startDate || !endDate) {
        alert('Please select a date range.');
        return;
    }
    console.log('Cash-Out Start Date:', startDate, 'End Date:', endDate);

    // I-destroy ang DataTable kung ito ay naka-instantiate na
    if ($.fn.DataTable.isDataTable('#cash-out-tbl')) {
        $('#cash-out-tbl').DataTable().destroy();
    }

    $('#cash-out-tbl').DataTable({
        "processing": false,
        "serverSide": false,
        "lengthMenu": [[10, 25, 50, 100, -1], [10, 25, 50, 100, "All"]],
        "order": [[5, 'desc']],
        "ajax": {
            "url": `/cash_out_details?start_date=${startDate}&end_date=${endDate}&` + new Date().getTime(),
            "type": "GET",
            "dataSrc": function(json) {
                console.log('Raw Cash-Out Data (source tables):', json);

                if (!Array.isArray(json)) {
                    console.error('Expected array but got:', json);
                    return [];
                }
            
                const filterValue = getCashOutFilterValue();
                const filterConfig = {
                    all: null,
                    capital: { categories: ['Capital Out'], lower: false },
                    buychips: { categories: ['Chips Buy-in'], lower: false },
                    gamemoney: { categories: ['Game Cash-out'], lower: false },
                    account: { categories: ['Account Withdraw', 'Account Credit'], lower: false },
                    commission: { categories: ['Commission Cash-out', 'Commission'], lower: false },
                    services: { categories: ['fnb', 'hotel', 'delivery'], lower: true },
                    expenses: { categories: ['Expenses'], lower: false }
                };
                const config = filterConfig[filterValue];

                return json
                    .filter(row => parseInt(row.TYPE, 10) === 2)
                    .filter(row => {
                        if (!config) {
                            return true;
                        }
                        const value = row.CATEGORY || '';
                        if (config.lower) {
                            return config.categories.includes(value.toLowerCase());
                        }
                        return config.categories.includes(value);
                    })
                    .map(row => {
                        const typeText = row.CATEGORY || 'Capital Out';
                        const accountName = row.AGENT_NAME || '-';
                        const amount = window.fmtOut ? window.fmtOut(row.AMOUNT) : parseFloat(row.AMOUNT || 0).toLocaleString('en-US');
                        const remarksDisplay = row.REMARKS || '';
                        const remarksEdit = row.REMARKS_EDIT != null ? row.REMARKS_EDIT : remarksDisplay;
                        const encodedBy = row.ENCODED_BY_NAME || 'N/A';
                        const formattedDate = moment.utc(row.ENCODED_DT).utcOffset(8).format('YYYY-MM-DD HH:mm');

                        return [
                            typeText,
                            accountName,
                            amount,
                            remarksDisplay,
                            encodedBy,
                            formattedDate,
                            row.IDNo,
                            row.REMARKS_SOURCE || '',
                            remarksEdit
                        ];
                    });
            }
        },
        "columns": [
            { "className": "text-center" },
            { "className": "text-start" },
            { "className": "text-end" },
            { "className": "text-start" },
            { "className": "text-center" },
            { "className": "text-center" },
            { "visible": false },
            { "visible": false },
            { "visible": false }
        ],
        "columnDefs": [{
            targets: 3,
            render: function (data, type, row) {
                if (type !== 'display') return data;
                if (!window.RemarksEditor || !row[7]) return data || '';
                return window.RemarksEditor.renderCell(row[8] != null ? row[8] : (data || ''), {
                    source: row[7],
                    recordId: row[6],
                    displayText: data || ''
                });
            }
        }],
        "responsive": true,
        "language": {
            "emptyTable": "No cash-out transactions found",
            "processing": "Loading cash-out transactions..."
        }
    });
}

// Filter links for cash-in
$(document).on('click', '#cash-in-filter .filter-link', function(event) {
    event.preventDefault();
    $('#cash-in-filter .filter-link').removeClass('active');
    $(this).addClass('active');
    loadCashInData();
});

// Filter links for cash-out
$(document).on('click', '#cash-out-filter .filter-link', function(event) {
    event.preventDefault();
    $('#cash-out-filter .filter-link').removeClass('active');
    $(this).addClass('active');
    loadCashOutData();
});

$('#cash-in-filter').on('change', function () {
    loadCashInData();
});

function chipsTransactionComputation() {
    // Use current month as the default date range
    const rangeDefaults = getDefaultMonthEndRange();
    const startOfMonth = rangeDefaults.start;
    const currentDate = rangeDefaults.end;

    $.ajax({
        url: `/junket_capital_data?start_date=${startOfMonth}&end_date=${currentDate}&` + new Date().getTime(),
        type: "GET",
        success: function (data) {
            let totalChipsBuyIn   = 0;
            let totalChipsReturn  = 0;
            let totalChipsRolling = 0;
            
            data.forEach(row => {
                // Chips Buy-in: TRANSACTION_ID must equal 1 and capital_description must exactly match "<span class=\"css-red\">Chips Buy-in</span>"
                const isChipsBuyIn = row.TRANSACTION_ID == 1 && row.capital_description === '<span class="css-red">Chips Buy-in</span>';
                // Chips Return: TRANSACTION_ID must equal 2 and capital_description must exactly match "<span class=\"css-red\">Chips Return</span>"
                const isChipsReturn = row.TRANSACTION_ID == 2 && row.capital_description === '<span class="css-red">Chips Return</span>';
                // Chips Rolling: TRANSACTION_ID must equal 3 and capital_description must exactly match "<span class=\"css-red\">Chips Rolling</span>"
                const isChipsRolling = row.TRANSACTION_ID == 3 && row.capital_description === '<span class="css-red">Chips Rolling</span>';
                
                const nnValue = parseFloat(row.NN_CHIPS || 0);
                const totalValue = parseFloat(row.TOTAL_CHIPS || 0);
                // Rolling can now come from CC, so prefer TOTAL_CHIPS for rolling rows.
                const rollingValue = totalValue || nnValue;
                if (!nnValue && !rollingValue) return;

                if (isChipsBuyIn)   totalChipsBuyIn   += nnValue;
                if (isChipsReturn)  totalChipsReturn  += nnValue;
                if (isChipsRolling) totalChipsRolling += rollingValue;
            });
            
            // Net chips = Buy-in + Rolling - Return
            const netChips = totalChipsBuyIn + totalChipsRolling - totalChipsReturn;
            $('#chips-transaction-total').text(`₱${netChips.toLocaleString('en-US')}`);
            // console.log('Updated net chips (Buy-in minus Return):', netChips);
            loadedTotalsCount++;
            if (loadedTotalsCount >= totalComputationCount) {
                updateProgressBars(); // Update progress bars only after all totals are loaded
                loadedTotalsCount = 0; // Reset counter for next update cycle
            }
        },
        error: function(xhr, status, error) {
            console.error('Error fetching chips transaction total:', error);
            $('#chips-transaction-total').text('₱0');
            loadedTotalsCount++;
            if (loadedTotalsCount >= totalComputationCount) {
                updateProgressBars();
                loadedTotalsCount = 0;
            }
        }
    });
}

/**
 * Function para mag-update ng progress bars based sa totals
 * Cash-In and Chips Transaction: Compute percentage based sa maximum value among them
 * Cash-Out: Compute percentage based sa Cash-In total
 */
function updateProgressBars() {
    // Get current totals from the displayed text (remove currency symbol, spaces, newlines, and parse)
    const cashInText = $('#cash-in-total').text().replace(/[₱,\s]/g, '').trim();
    const cashOutText = $('#cash-out-total').text().replace(/[₱,\s]/g, '').trim();
    const chipsText = $('#chips-transaction-total').text().replace(/[₱,\s]/g, '').trim();
    
    const cashIn = parseFloat(cashInText) || 0;
    const cashOut = parseFloat(cashOutText) || 0;
    const chips = parseFloat(chipsText) || 0;
    
    // For Cash-In and Chips Transaction: Calculate maximum value among them for reference (100%)
    const maxValueForCashInChips = Math.max(cashIn, Math.abs(chips), 1); // Use 1 as minimum to avoid division by zero
    
    // Calculate percentages (cap at 100%)
    const cashInPercent = Math.min((cashIn / maxValueForCashInChips) * 100, 100);
    const chipsPercent = Math.min((Math.abs(chips) / maxValueForCashInChips) * 100, 100); // Use absolute value for chips
    
    // For Cash-Out: Calculate percentage based sa Cash-In total
    const cashInMax = Math.abs(cashIn) || 1; // Use Cash-In as max, minimum 1 to avoid division by zero
    const cashOutPercent = Math.min((Math.abs(cashOut) / cashInMax) * 100, 100);
    
    // Update Cash-In progress bar
    const cashInProgressBar = $('#cash-in-total').closest('.pb-3').find('.progress-bar');
    if (cashInProgressBar.length) {
        cashInProgressBar.css('width', cashInPercent + '%');
        cashInProgressBar.attr('aria-valuenow', Math.round(cashInPercent));
    }
    
    // Update Cash-Out progress bar (based on House Balance)
    const cashOutProgressBar = $('#cash-out-total').closest('.pb-3').find('.progress-bar');
    if (cashOutProgressBar.length) {
        cashOutProgressBar.css('width', cashOutPercent + '%');
        cashOutProgressBar.attr('aria-valuenow', Math.round(cashOutPercent));
    }
    
    // Update Chips Transaction progress bar
    const chipsProgressBar = $('#chips-transaction-total').closest('.pb-3').find('.progress-bar');
    if (chipsProgressBar.length) {
        chipsProgressBar.css('width', chipsPercent + '%');
        chipsProgressBar.attr('aria-valuenow', Math.round(chipsPercent));
    }
    
    // console.log('Progress bars updated:', {
    //     cashIn: cashInPercent.toFixed(2) + '%',
    //     cashOut: cashOutPercent.toFixed(2) + '% (based on Cash-In: ' + cashInMax.toLocaleString('en-US') + ')',
    //     chips: chipsPercent.toFixed(2) + '%',
    //     maxValueForCashInChips: maxValueForCashInChips,
    //     cashInMax: cashInMax
    // });
}


// CHIPS TRANSACTION START
function loadChipsTransaction() {
    const dateRange = $('#transaction-daterange').val();
    console.log('Date Range:', dateRange);

    const resolved = parseCapitalDateRange(dateRange, 'transaction-daterange');
    const startDate = resolved.start;
    const endDate = resolved.end;
    if (!startDate || !endDate) {
        alert('Please select a date range.');
        return;
    }
    console.log('Start Date:', startDate, 'End Date:', endDate);

    // Destroy existing DataTable instance if it exists.
    if ($.fn.DataTable.isDataTable('#chips_transaction-tbl')) {
        $('#chips_transaction-tbl').DataTable().destroy();
    }

    // Initialize DataTable on the chips transaction table.
    $('#chips_transaction-tbl').DataTable({
        processing: false, // Disable processing message to prevent flicker
        serverSide: false, // Adjust if server-side processing is needed.
        ajax: {
            url: `/junket_capital_data?start_date=${startDate}&end_date=${endDate}&` + new Date().getTime(),
            type: "GET",
            dataSrc: function(json) {
                console.log('Raw Chips Data:', json);
                
                // Ensure the data is an array.
                if (!Array.isArray(json)) {
                    console.error('Expected array but got:', json);
                    return [];
                }
                
                // Filter for Chips Buy-in, Chips Cashout/Return, or Chips Rolling.
                const filteredData = json.filter(row => {
                    const chipsBuyIn = row.TRANSACTION_ID == 1 &&
                        row.capital_description === '<span class="css-red">Chips Buy-in</span>';
                    const chipsReturn = row.TRANSACTION_ID == 2 &&
                        (
                            row.capital_description === '<span class="css-red">Chips Return</span>' ||
                            row.capital_description === '<span class="css-red">Chips Cashout</span>'
                        );
                    const chipsRolling = row.TRANSACTION_ID == 3 &&
                        row.capital_description === '<span class="css-red">Chips Rolling</span>';

                    // Rolling can be recorded in CC; include row when effective amount is positive.
                    const nnChips = parseFloat(row.NN_CHIPS) || 0;
                    const totalChips = parseFloat(row.TOTAL_CHIPS) || 0;
                    const effectiveAmount = chipsRolling ? (totalChips || nnChips) : nnChips;
                    return (chipsBuyIn || chipsReturn || chipsRolling) && effectiveAmount > 0;
                }).map(function(row) {
                    const isChipsBuyIn = row.TRANSACTION_ID == 1 &&
                        row.capital_description === '<span class="css-red">Chips Buy-in</span>';
                    const isChipsReturn = row.TRANSACTION_ID == 2 &&
                        (
                            row.capital_description === '<span class="css-red">Chips Return</span>' ||
                            row.capital_description === '<span class="css-red">Chips Cashout</span>'
                        );
                    const isChipsRolling = row.TRANSACTION_ID == 3 &&
                        row.capital_description === '<span class="css-red">Chips Rolling</span>';

                    const nnChips = parseFloat(row.NN_CHIPS) || 0;
                    const totalChips = parseFloat(row.TOTAL_CHIPS) || 0;
                    const amountValue = isChipsRolling ? (totalChips || nnChips) : nnChips;
                    const amount = isChipsBuyIn
                        ? (window.fmtOut ? window.fmtOut(amountValue) : amountValue.toLocaleString('en-US'))
                        : (isChipsReturn
                            ? (window.fmtIn ? window.fmtIn(amountValue) : amountValue.toLocaleString('en-US'))
                            : (window.fmtAmt ? window.fmtAmt(amountValue) : amountValue.toLocaleString('en-US')));
                    const type = isChipsBuyIn
                        ? '<span class="css-red">Chips Buy-in</span>'
                        : (isChipsRolling
                            ? '<span class="badge-rolling">Chips Rolling</span>'
                            : (isChipsReturn
                                ? '<span class="css-blue">Chips Cashout</span>'
                                : '<span class="css-blue">Chips Return</span>'));

                    const rowArray = [
                        row.ENCODED_BY_NAME || 'N/A',
                        amount,
                        type,
                        renderCapitalRemarksCell(row, row.REMARKS || '', row.GAME_ID ? ` GAME-${row.GAME_ID}` : ''),
                        moment.utc(row.ENCODED_DT).utcOffset(8).format('YYYY-MM-DD HH:mm'),
                        getActionButton(row.IDNo)
                    ];
                    const sortMoment = moment.utc(row.ENCODED_DT);
                    rowArray._sortDate = sortMoment.isValid() ? sortMoment.valueOf() : 0;
                    return rowArray;
                });

                console.log('Filtered Chips Data:', filteredData);
                return filteredData;
            }
        },
        columns: [
            { title: "Encoded By" },
            { title: "Amount" },
            { title: "Type" },
            { title: "Remarks" },
            { title: "Date" },
            { title: "Action" }
        ]
    });
}


$(document).ready(function() {
    let chipsTransactionPicker = null;
    
    $('#modal-Transaction').on('shown.bs.modal', function () {
        console.log('Modal shown'); // Debug log
        
        // Set default dates using moment.js
        const rangeDefaults = getDefaultMonthEndRange();
        const startOfMonth = rangeDefaults.start;
        const currentDate = rangeDefaults.end;
        
        // Check if the transaction-daterange element exists
        if ($('#transaction-daterange').length > 0) {
            // Initialize Flatpickr only if not already initialized
            if (!chipsTransactionPicker || !$('#transaction-daterange').hasClass('flatpickr-input')) {
                chipsTransactionPicker = flatpickr("#transaction-daterange", {
                    mode: "range",
                    showMonths: 2,
                    onChange: function(selectedDates, dateStr) {
                        console.log('Date changed:', dateStr); // Debug log
                        if (selectedDates.length === 2) {
                            loadChipsTransaction();
                        }
                    }
                });
            }
            
            // Initial load of chips transaction data
            loadChipsTransaction();
        } else {
            console.error('transaction-daterange element not found'); // Debug log
        }
    });
});
// CHIPS TRANSACTION END


// Update the modal initialization
$(document).ready(function() {
    let cashInPicker = null;
    
    $('#modal-Cash-In').on('shown.bs.modal', function () {
        console.log('Modal shown'); // Debug log
        
        // Initialize Flatpickr only if not already initialized
        const rangeDefaults = getDefaultMonthEndRange();
        const startOfMonth = rangeDefaults.start;
        const currentDate = rangeDefaults.end;
        
        if ($('#daterange').length > 0) {
            // Check if Flatpickr is already initialized
            if (!cashInPicker || !$('#daterange').hasClass('flatpickr-input')) {
                cashInPicker = flatpickr("#daterange", {
                    mode: "range",
                    showMonths: 2,
                    onChange: function(selectedDates, dateStr) {
                        console.log('Date changed:', dateStr); // Debug log
                        if (selectedDates.length === 2) {
                            loadCashInData();
                        }
                    }
                });
            }
            
            // Initial load of data
            loadCashInData();
        } else {
            console.error('daterange element not found'); // Debug log
        }
    });
});

// NN / CC CHIPS HISTORY
var nnChipsManualRange = null;
var ccChipsManualRange = null;
var nnChipsSplitDateRange = null;
var ccChipsSplitDateRange = null;

function resolveChipsHistoryDates(pickerId, manualRange) {
    if (manualRange && manualRange.start && manualRange.end) {
        var start = manualRange.start;
        var end = manualRange.end;
        if (start > end) {
            return { start: end, end: start };
        }
        return { start: start, end: end };
    }

    const dateRange = getChipsHistoryDateRangeValue(pickerId);
    const resolved = parseCapitalDateRange(dateRange, pickerId);
    return { start: resolved.start, end: resolved.end };
}

function initNnChipsSplitDateRange() {
    if (!window.SplitDateRange || typeof window.SplitDateRange.attach !== 'function') {
        nnChipsSplitDateRange = { fitWidths: function () {} };
        return;
    }

    nnChipsSplitDateRange = window.SplitDateRange.attach({
        rangePickerId: 'nnchips-daterange',
        startId: 'nnchips-start-date',
        endId: 'nnchips-end-date',
        splitWrapperId: 'nnchips-split-daterange-wrapper',
        independent: true,
        invalidDateMessage: 'Invalid date range.',
        onRangeApplied: function (range) {
            if (!range || !range.start || !range.end) return;
            var from = range.start;
            var to = capitalApiEndDate(range.end);
            if (from > to) {
                var swap = from;
                from = to;
                to = swap;
            }
            nnChipsManualRange = { start: from, end: to };
            loadNNChipsHistory();
        }
    });
}

function initCcChipsSplitDateRange() {
    if (!window.SplitDateRange || typeof window.SplitDateRange.attach !== 'function') {
        ccChipsSplitDateRange = { fitWidths: function () {} };
        return;
    }

    ccChipsSplitDateRange = window.SplitDateRange.attach({
        rangePickerId: 'ccchips-daterange',
        startId: 'ccchips-start-date',
        endId: 'ccchips-end-date',
        splitWrapperId: 'ccchips-split-daterange-wrapper',
        independent: true,
        invalidDateMessage: 'Invalid date range.',
        onRangeApplied: function (range) {
            if (!range || !range.start || !range.end) return;
            var from = range.start;
            var to = capitalApiEndDate(range.end);
            if (from > to) {
                var swap = from;
                from = to;
                to = swap;
            }
            ccChipsManualRange = { start: from, end: to };
            loadCCChipsHistory();
        }
    });
}

function getChipsHistoryDateRangeValue(pickerId) {
    var el = document.getElementById(pickerId);
    if (el && el._flatpickr) {
        if (el._flatpickr.altInput && el._flatpickr.altInput.value) {
            return el._flatpickr.altInput.value.trim();
        }
        if (el._flatpickr.selectedDates && el._flatpickr.selectedDates.length === 2 && window.MonthEndCutoffRange) {
            return window.MonthEndCutoffRange.formatDisplayDate(el._flatpickr.selectedDates[0]) +
                ' to ' +
                window.MonthEndCutoffRange.formatDisplayDate(el._flatpickr.selectedDates[1]);
        }
    }
    return ($('#' + pickerId).val() || '').trim();
}

function bindChipsRangeMonthNameHooks(instance) {
    if (typeof window.setupFlatpickrMonthNameRangeSelect === 'function') {
        window.setupFlatpickrMonthNameRangeSelect(instance);
    }
}

function initChipsHistoryRangePicker(pickerId, onRangeComplete) {
    var $el = $('#' + pickerId);
    if (!$el.length) return null;
    if ($el.hasClass('flatpickr-input') && $el[0]._flatpickr) {
        if (pickerId === 'nnchips-daterange' && !nnChipsSplitDateRange) initNnChipsSplitDateRange();
        if (pickerId === 'ccchips-daterange' && !ccChipsSplitDateRange) initCcChipsSplitDateRange();
        return $el[0]._flatpickr;
    }

    if (pickerId === 'nnchips-daterange') initNnChipsSplitDateRange();
    if (pickerId === 'ccchips-daterange') initCcChipsSplitDateRange();

    return flatpickr('#' + pickerId, {
        mode: 'range',
        showMonths: 3,
        onReady: function (selectedDates, dateStr, instance) {
            bindChipsRangeMonthNameHooks(instance);
        },
        onOpen: function (selectedDates, dateStr, instance) {
            bindChipsRangeMonthNameHooks(instance);
        },
        onMonthChange: function (selectedDates, dateStr, instance) {
            if (typeof window.styleFlatpickrMonthNameClickable === 'function') {
                window.styleFlatpickrMonthNameClickable(instance);
            }
        },
        onChange: function (selectedDates) {
            if (selectedDates.length === 2) {
                if (pickerId === 'nnchips-daterange') nnChipsManualRange = null;
                if (pickerId === 'ccchips-daterange') ccChipsManualRange = null;
                if (typeof onRangeComplete === 'function') {
                    onRangeComplete();
                }
            }
        }
    });
}

function loadNNChipsHistory() {
    var nnT = window.nnChipsHistoryTranslations || {};
    const resolved = resolveChipsHistoryDates('nnchips-daterange', nnChipsManualRange);
    const startDate = resolved.start;
    const endDate = resolved.end;
    if (!startDate || !endDate) {
        alert(nnT.please_select_date_range || 'Please select a date range.');
        return;
    }

    // Destroy existing DataTable instance if it exists
    if ($.fn.DataTable.isDataTable('#nn-chips-tbl')) {
        $('#nn-chips-tbl').DataTable().destroy();
    }

    // Initialize DataTable on the NN chips history table
    $('#nn-chips-tbl').DataTable({
        processing: false, // Disable processing message to prevent flicker
        serverSide: false,
        order: [[4, 'desc']], // Sort by date descending
        ajax: {
            url: `/junket_capital_data?start_date=${startDate}&end_date=${endDate}&` + new Date().getTime(),
            type: "GET",
            dataSrc: function(json) {
                console.log('Raw NN Chips History Data:', json);
                
                // Ensure the data is an array
                if (!Array.isArray(json)) {
                    console.error('Expected array but got:', json);
                    return [];
                }
                
    // Filter for NN Chips Buy-in, Cashout, or Rolling and only those with NN_CHIPS > 0
                const filteredData = json.filter(row => {
                    const chipsBuyIn = row.TRANSACTION_ID == 1 &&
                        row.capital_description === '<span class="css-red">Chips Buy-in</span>';
        const chipsCashout = row.TRANSACTION_ID == 2 &&
            row.capital_description === '<span class="css-red">Chips Cashout</span>';
        const chipsRolling = row.TRANSACTION_ID == 3 &&
            row.capital_description === '<span class="css-red">Chips Rolling</span>';
                    
                    // Use only NN_CHIPS value. Exclude if NN_CHIPS is not greater than 0.
                    const nnChips = parseFloat(row.NN_CHIPS) || 0;
        return (chipsBuyIn || chipsCashout || chipsRolling) && nnChips > 0;
                }).map(function(row) {
        const isChipsBuyIn = row.TRANSACTION_ID == 1 &&
            row.capital_description === '<span class="css-red">Chips Buy-in</span>';
        const isChipsCashout = row.TRANSACTION_ID == 2 &&
            row.capital_description === '<span class="css-red">Chips Cashout</span>';

                    // Use NN_CHIPS exclusively
                    const nnChips = parseFloat(row.NN_CHIPS) || 0;
                    const amount = isChipsBuyIn
                        ? (window.fmtOut ? window.fmtOut(nnChips) : nnChips.toLocaleString('en-US'))
                        : (isChipsCashout
                            ? (window.fmtIn ? window.fmtIn(nnChips) : nnChips.toLocaleString('en-US'))
                            : (window.fmtAmt ? window.fmtAmt(nnChips) : nnChips.toLocaleString('en-US')));
        const type = isChipsBuyIn
            ? '<span class="badge-cashin">NN Chips Buy-in</span>'
            : (isChipsCashout
                ? '<span class="badge-cashout">NN Chips Cashout</span>'
                : '<span class="badge-rolling">Chips Rolling</span>');

                    const rowArray = [
                        row.ENCODED_BY_NAME || 'N/A',
                        amount,
                        type,
                        renderCapitalRemarksCell(row, row.REMARKS || '', row.GAME_ID ? ` GAME-${row.GAME_ID}` : ''),
                        moment.utc(row.ENCODED_DT).utcOffset(8).format('YYYY-MM-DD HH:mm'),
                        getActionButton(row.IDNo)
                    ];
                    const sortMoment = moment.utc(row.ENCODED_DT);
                    rowArray._sortDate = sortMoment.isValid() ? sortMoment.valueOf() : 0;
                    return rowArray;
                });

                console.log('Filtered NN Chips History Data:', filteredData);
                return filteredData;
            }
        },
        columns: [
            { "className": "text-center" },
            { "className": "text-end" },
            { "className": "text-center" },
            { "className": "text-center" },
            {
                "className": "text-center",
                "render": function(data, type, row) {
                    if (type === 'sort' || type === 'type') return row && row._sortDate ? row._sortDate : 0;
                    return data;
                }
            },
            { "className": "text-center", "orderable": false }
        ],
        responsive: true,
        language: (function() {
            var t = window.nnChipsHistoryTranslations || {};
            return {
                emptyTable: t.empty_table || "No NN chips transactions found",
                processing: t.processing || "Loading NN chips transactions...",
                lengthMenu: t.length_menu || "Show _MENU_ entries",
                search: t.search || "Search:",
                info: t.info || "Showing _START_ to _END_ of _TOTAL_ entries",
                infoEmpty: t.info_empty || "Showing 0 to 0 of 0 entries",
                infoFiltered: t.info_filtered || "(filtered from _MAX_ total entries)",
                paginate: {
                    first: t.first || "First",
                    last: t.last || "Last",
                    next: t.next || "Next",
                    previous: t.previous || "Previous"
                }
            };
        })(),
        drawCallback: function(settings) {
            $('[data-bs-toggle="tooltip"]').tooltip();
        }
    });
}

// CC CHIPS HISTORY
function loadCCChipsHistory() {
    var ccT = window.ccChipsHistoryTranslations || {};
    const resolved = resolveChipsHistoryDates('ccchips-daterange', ccChipsManualRange);
    const startDate = resolved.start;
    const endDate = resolved.end;
    if (!startDate || !endDate) {
        alert(ccT.please_select_date_range || 'Please select a date range.');
        return;
    }

    // Destroy existing DataTable instance if it exists
    if ($.fn.DataTable.isDataTable('#cc-chips-tbl')) {
        $('#cc-chips-tbl').DataTable().destroy();
    }

    // Initialize DataTable on the CC chips history table
    $('#cc-chips-tbl').DataTable({
        processing: false, // Disable processing message to prevent flicker
        serverSide: false,
        order: [[4, 'desc']], // Sort by date descending
        ajax: {
            url: `/cc_chips_history?start_date=${startDate}&end_date=${endDate}&` + new Date().getTime(),
            type: "GET",
            dataSrc: function(json) {
                console.log('Raw CC Chips History Data:', json);
                
                // Ensure the data is an array
                if (!Array.isArray(json)) {
                    console.error('Expected array but got:', json);
                    return [];
                }
                
                // Map the data from the new endpoint
                const filteredData = json.map(function(row) {
                    const isChipsBuyIn = row.TRANSACTION_ID == 1;

                    // Use CC_CHIPS exclusively
                    const ccChips = parseFloat(row.CC_CHIPS) || 0;
                    const amount = isChipsBuyIn
                        ? (window.fmtOut ? window.fmtOut(ccChips) : ccChips.toLocaleString('en-US'))
                        : (row.TRANSACTION_ID == 2
                            ? (window.fmtIn ? window.fmtIn(ccChips) : ccChips.toLocaleString('en-US'))
                            : (window.fmtAmt ? window.fmtAmt(ccChips) : ccChips.toLocaleString('en-US')));
            const type = isChipsBuyIn
                ? '<span class="badge-cashin">CC Chips Buy-in</span>'
                : (row.TRANSACTION_ID == 2
                    ? '<span class="badge-cashout">CC Chips Cashout</span>'
                    : '<span class="badge-rolling">Chips Rolling</span>');

                    const rowArray = [
                        row.ENCODED_BY_NAME || 'N/A',
                        amount,
                        type,
                        renderCapitalRemarksCell(
                            Object.assign({}, row, { REMARKS_SOURCE: 'junket_total_chips' }),
                            row.REMARKS || '',
                            row.GAME_ID ? ` GAME-${row.GAME_ID}` : ''
                        ),
                        moment.utc(row.ENCODED_DT).utcOffset(8).format('YYYY-MM-DD HH:mm'),
                        getActionButton(row.IDNo)
                    ];
                    const sortMoment = moment.utc(row.ENCODED_DT);
                    rowArray._sortDate = sortMoment.isValid() ? sortMoment.valueOf() : 0;
                    return rowArray;
                });

                console.log('Filtered CC Chips History Data:', filteredData);
                return filteredData;
            }
        },
        columns: [
            { "className": "text-center" },
            { "className": "text-end" },
            { "className": "text-center" },
            { "className": "text-center" },
            {
                "className": "text-center",
                "render": function(data, type, row) {
                    if (type === 'sort' || type === 'type') return row && row._sortDate ? row._sortDate : 0;
                    return data;
                }
            },
            { "className": "text-center", "orderable": false }
        ],
        responsive: true,
        language: (function() {
            var t = window.ccChipsHistoryTranslations || {};
            return {
                emptyTable: t.empty_table || "No CC chips transactions found",
                processing: t.processing || "Loading CC chips transactions...",
                lengthMenu: t.length_menu || "Show _MENU_ entries",
                search: t.search || "Search:",
                info: t.info || "Showing _START_ to _END_ of _TOTAL_ entries",
                infoEmpty: t.info_empty || "Showing 0 to 0 of 0 entries",
                infoFiltered: t.info_filtered || "(filtered from _MAX_ total entries)",
                paginate: {
                    first: t.first || "First",
                    last: t.last || "Last",
                    next: t.next || "Next",
                    previous: t.previous || "Previous"
                }
            };
        })(),
        drawCallback: function(settings) {
            $('[data-bs-toggle="tooltip"]').tooltip();
        }
    });
}

// Update the modal initialization for Cash-Out
$(document).ready(function() {
    let cashOutPicker = null;
    
    $('#modal-Cash-Out').on('shown.bs.modal', function () {
        console.log('Cash-Out Modal shown'); // Debug log
        
        // Initialize Flatpickr only if not already initialized
        const rangeDefaults = getDefaultMonthEndRange();
        const startOfMonth = rangeDefaults.start;
        const currentDate = rangeDefaults.end;
        
        if ($('#cashout-daterange').length > 0) {
            // Check if Flatpickr is already initialized
            if (!cashOutPicker || !$('#cashout-daterange').hasClass('flatpickr-input')) {
                cashOutPicker = flatpickr("#cashout-daterange", {
                    mode: "range",
                    showMonths: 2,
                    onChange: function(selectedDates, dateStr) {
                        console.log('Cash-Out Date changed:', dateStr); // Debug log
                        if (selectedDates.length === 2) {
                            loadCashOutData();
                        }
                    }
                });
            }
            
            // Initial load of data
            loadCashOutData();
        } else {
            console.error('cashout-daterange element not found'); // Debug log
        }
    });
});


function loadJunketExpenseData() {
    const dateRange = $('#junket-daterange').val();
    // console.log('Junket Expense Date Range:', dateRange);

    const resolved = parseCapitalDateRange(dateRange, 'junket-daterange');
    const startDate = resolved.start;
    const endDate = resolved.end;
    if (!startDate || !endDate) {
        alert('Please select a date range.');
        return;
    }
    // console.log('Junket Expense Start Date:', startDate, 'End Date:', endDate);

    // Show loading state
    if ($.fn.DataTable.isDataTable('#junket-expense-tbl')) {
        $('#junket-expense-tbl').DataTable().destroy();
    }

    $('#junket-expense-tbl').DataTable({
        "processing": true,
        "serverSide": false,
        "order": [[4, 'desc']],
        "ajax": {
            "url": `/junket_capital_data?start_date=${startDate}&end_date=${endDate}&` + new Date().getTime(),
            "type": "GET",
            "dataSrc": function(json) {
                // console.log('Raw Junket Expense Data:', json);

                if (!Array.isArray(json)) {
                    console.error('Expected array but got:', json);
                    return [];
                }
                
                // Filter junket expense transactions
                const filteredData = json.filter(row => {
                    // Filter only junket expense rows (CATEGORY_ID > 0) with non-zero amount (stored as positive or negative)
                    return row.CATEGORY_ID > 0 && row.capital_amount != null && row.capital_amount !== 0;
                }).map(function(row) {
                    const categoryName = (row.CATEGORY && String(row.CATEGORY).trim()) ? row.CATEGORY : 'N/A';
                    const description = `<span class="css-blue1">${categoryName}</span>`;
                    
                    return [
                        row.ENCODED_BY_NAME || 'N/A',
                        fmtCapitalAmount(row.capital_amount, 'out'),
                        description,
                        renderCapitalRemarksCell(row, row.REMARKS || ''),
                        moment.utc(row.ENCODED_DT).utcOffset(8).format('YYYY-MM-DD HH:mm'),
                        getActionButton(row.IDNo)
                    ];
                });

                // console.log('Filtered Junket Expense Data:', filteredData);
                return filteredData;
            }
        },
        "columns": [
            { "className": "text-center" },
            { "className": "text-end" },
            { "className": "text-center" },
            { "className": "text-center" },
            { "className": "text-center" },
            { "className": "text-center", "orderable": false }
        ],
        "responsive": true,
        "language": {
            "emptyTable": "No junket expenses found",
            "processing": "Loading junket expenses..."
        },
        "drawCallback": function(settings) {
            $('[data-bs-toggle="tooltip"]').tooltip();
        }
    });
}

// Initialize Flatpickr and load data when document is ready
$(document).ready(function() {
    // Initialize Flatpickr for Junket Expense
    const rangeDefaults = getDefaultMonthEndRange();
    const startOfMonth = rangeDefaults.start;
    const currentDate = rangeDefaults.end;
    
    if ($('#junket-daterange').length > 0) {
        flatpickr("#junket-daterange", {
            mode: "range",
            showMonths: 2,
            onChange: function(selectedDates, dateStr) {
                console.log('Junket Expense Date changed:', dateStr);
                if (selectedDates.length === 2) {
                    loadJunketExpenseData();
                }
            }
        });
        
        // Initial load of data
        setTimeout(() => {
            loadJunketExpenseData();
        }, 500);
    }

    // Add event listener for modal show on Expenses
    $('#modal-Expenses').on('shown.bs.modal', function () {
        console.log('Expenses Modal shown');
        if (!$('#junket-daterange').val()) {
            const displayRange = getDefaultMonthEndRange();
            $('#junket-daterange').val(`${displayRange.startDisplay} to ${displayRange.endDisplay}`);
        }
        loadJunketExpenseData();
    });

    // Initialize progress bars to 0% width on page load
    $('#cash-in-total').closest('.pb-3').find('.progress-bar').css('width', '0%').attr('aria-valuenow', 0);
    $('#cash-out-total').closest('.pb-3').find('.progress-bar').css('width', '0%').attr('aria-valuenow', 0);
    $('#chips-transaction-total').closest('.pb-3').find('.progress-bar').css('width', '0%').attr('aria-valuenow', 0);
    
    // Reset counter for initial load
    loadedTotalsCount = 0;
    
    // Call computeTotalCashIn initially
    computeTotalCashIn();

    // Add event listener for when the cash-in modal is hidden
    $('#modal-Cash-In').on('hidden.bs.modal', function () {
        computeTotalCashIn(); // Refresh the total when modal is closed
    });

    // Add event listener for when the cash-in modal is shown
    $('#modal-Cash-In').on('shown.bs.modal', function () {
        computeTotalCashIn(); // Refresh the total when modal is opened
    });

    // -----------------------------
    // Cash-Out Computation
    // -----------------------------
    // Add event listener for when the cash-out modal is hidden
    $('#modal-Cash-Out').on('hidden.bs.modal', function () {
        computeTotalCashOut(); // Refresh the total when modal is closed
    });

    // Add event listener for when the cash-out modal is shown
    $('#modal-Cash-Out').on('shown.bs.modal', function () {
        computeTotalCashOut(); // Refresh the total when modal is opened
    });
    // Call computeTotalCashOut initially
    computeTotalCashOut();

    // Add event listener for when the capital modal is hidden (for cash-out)
    $('#modal-new-capital').on('hidden.bs.modal', function () {
        computeTotalCashOut(); // Refresh the total when modal is closed
    });

    // Add event listener for when the capital modal is shown
    $('#modal-new-capital').on('shown.bs.modal', function () {
        initCapitalRangePicker();
        computeTotalCashOut(); // Refresh the total when modal is opened
        if ($.fn.DataTable.isDataTable('#capital-tbl')) {
            setTimeout(function () {
                $('#capital-tbl').DataTable().columns.adjust();
                if (typeof window.layoutCapitalTableControls === 'function') {
                    window.layoutCapitalTableControls();
                }
                applyCapitalDateFilterDraw();
            }, 50);
        }
    });

    // Call fetchTotalJunketExpense initially
    fetchTotalJunketExpense();

    // Add event listener for when the expenses modal is hidden
    $('#modal-Expenses').on('hidden.bs.modal', function () {
        fetchTotalJunketExpense(); // Refresh the total when modal is closed
    });

    // Add event listener for when the expenses modal is shown
    $('#modal-Expenses').on('shown.bs.modal', function () {
        fetchTotalJunketExpense(); // Refresh the total when modal is opened
    });

    // -----------------------------
    // Chips Transaction Computation
    // -----------------------------
    // Call chipsTransactionComputation initially
    chipsTransactionComputation();

    // Add event listener for when the chips transaction modal is hidden
    $('#modal-Transaction').on('hidden.bs.modal', function () {
        chipsTransactionComputation(); // Refresh the chips transaction total when modal is closed
    });

    // Add event listener for when the chips transaction modal is shown
    $('#modal-Transaction').on('shown.bs.modal', function () {
        chipsTransactionComputation(); // Refresh the chips transaction total when modal is opened
    });

    // -----------------------------
    // NN / CC Chips History Modals
    // -----------------------------
    $('#modal-new-nn-chips').on('shown.bs.modal', function () {
        initChipsHistoryRangePicker('nnchips-daterange', loadNNChipsHistory);
        if (nnChipsSplitDateRange && typeof nnChipsSplitDateRange.fitWidths === 'function') {
            nnChipsSplitDateRange.fitWidths();
        }
        loadNNChipsHistory();
    });

    $('#modal-new-cc-chips').on('shown.bs.modal', function () {
        initChipsHistoryRangePicker('ccchips-daterange', loadCCChipsHistory);
        if (ccChipsSplitDateRange && typeof ccChipsSplitDateRange.fitWidths === 'function') {
            ccChipsSplitDateRange.fitWidths();
        }
        loadCCChipsHistory();
    });
});



function fetchTotalJunketExpense() {
    const rangeDefaults = getDefaultMonthEndRange();
    const startOfMonth = rangeDefaults.start;
    const currentDate = rangeDefaults.end;

    $.ajax({
        url: `/junket_capital_data?start_date=${startOfMonth}&end_date=${currentDate}&` + new Date().getTime(),
        type: "GET",
        success: function (data) {
            let totalJunketExpense = 0;

            data.forEach(row => {
                // Check for junket expense transactions (where CATEGORY_ID > 0 and capital_amount > 0)
                if (row.CATEGORY_ID > 0 && row.capital_amount > 0) {
                    totalJunketExpense += parseFloat(row.capital_amount || 0);
                }
            });

            $('#junket-expense-total').text(`₱${totalJunketExpense.toLocaleString('en-US')}`);
            // console.log('Updated total junket expense:', totalJunketExpense);
        },
        error: function(xhr, status, error) {
            console.error('Error fetching total junket expense:', error);
            $('#junket-expense-total').text('₱0');
        }
    });
}


function getActionButton(id) {
    const permissions = parseInt($('#user-role').data('permissions'));
    if (permissions === 0) {
        return `<button type="button" onclick="archive_capital(${id})" 
                class="btn btn-sm btn-alt-danger js-bs-tooltip-enabled"
                data-bs-toggle="tooltip" 
                aria-label="Archive" 
                data-bs-original-title="Archive">
                <i class="fa fa-trash-alt"></i>
                </button>`;
    }
    return '';
}

function escapeCapitalPrintHtml(value) {
    return String(value == null ? '' : value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function getAuthorizedMasterAccountTablePayload() {
    if (!$.fn.DataTable.isDataTable('#capital-tbl')) {
        return { headers: [], rows: [] };
    }
    var actionColIndex = 6;
    var headers = [];
    $('#capital-tbl thead tr:first th').each(function (i) {
        if (i === actionColIndex) return;
        headers.push($(this).text().trim());
    });
    var rows = [];
    $('#capital-tbl').DataTable().rows({ search: 'applied' }).every(function () {
        var cells = [];
        $(this.node())
            .find('td')
            .each(function (i) {
                if (i === actionColIndex) return;
                cells.push($(this).text().replace(/\s+/g, ' ').trim());
            });
        if (cells.length) rows.push(cells);
    });
    return { headers: headers, rows: rows };
}

function getAuthorizedMasterAccountExportFilename() {
    var stamp = moment().format('YYYYMMDD-HHmm');
    return 'Authorized_Master_Account-' + stamp + '.xlsx';
}

function printAuthorizedMasterAccount() {
    var payload = getAuthorizedMasterAccountTablePayload();
    if (!payload.rows.length) {
        Swal.fire({
            icon: 'info',
            title: 'Print',
            text: 'No data to print.',
            confirmButtonColor: '#0d6efd'
        });
        return;
    }

    var headerHtml = payload.headers.map(function (h) {
        return '<th>' + escapeCapitalPrintHtml(h) + '</th>';
    }).join('');
    var rowsHtml = payload.rows.map(function (row) {
        return '<tr>' + row.map(function (cell) {
            return '<td>' + escapeCapitalPrintHtml(cell) + '</td>';
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
        '<!doctype html><html><head><title>Authorized Master Account</title><style>',
        '@page{size:landscape;margin:10mm;}',
        'body{font-family:Arial,sans-serif;color:#111;margin:0;}',
        '.print-wrap{width:100%;}',
        'h2{text-align:center;margin:0 0 4px;font-size:18px;}',
        '.subtitle{text-align:center;margin:0 0 12px;font-size:12px;color:#444;}',
        'table{width:100%;border-collapse:collapse;font-size:11px;}',
        'th,td{border:1px solid #777;padding:6px 8px;vertical-align:middle;}',
        'th{background:#f0dfa8;color:#6b4f14;text-align:left;font-weight:700;}',
        'th:nth-child(1),td:nth-child(1),th:nth-child(2),td:nth-child(2){text-align:center;}',
        'th:nth-child(3),td:nth-child(3){text-align:right;}',
        'td{text-align:left;}',
        '</style></head><body><div class="print-wrap">',
        '<h2>Authorized Master Account</h2>',
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

function exportAuthorizedMasterAccount($btn) {
    var payload = getAuthorizedMasterAccountTablePayload();
    if (!payload.rows.length) {
        Swal.fire({
            icon: 'info',
            title: 'Export',
            text: 'No data to export.',
            confirmButtonColor: '#0d6efd'
        });
        return;
    }

    var outName = getAuthorizedMasterAccountExportFilename();
    $btn.prop('disabled', true);
    fetch('/junket_capital/export_xlsx', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({
            headers: payload.headers,
            rows: payload.rows,
            filename: outName
        })
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
            link.download = outName;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            URL.revokeObjectURL(link.href);
        })
        .catch(function (err) {
            Swal.fire({
                icon: 'error',
                title: 'Error',
                text: (err && err.message) ? err.message : 'Export failed',
                confirmButtonColor: '#0d6efd'
            });
        })
        .finally(function () {
            $btn.prop('disabled', false);
        });
}



