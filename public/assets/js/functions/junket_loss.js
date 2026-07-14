let junketLossTable;
let junketLossFromDate = null;
let junketLossToDate = null;
let junketLossDatePicker = null;
let junketLossProgramDatePicker = null;
let junketLossAccountGuestResetting = false;
let junketLossTypeFilter = 'all';
let junketLossTypeFilterRegistered = false;
/** When Start/End split has both dates, this overrides junket-loss-daterange for fetches. */
let junketLossSplitOverrideRange = null;

function registerJunketLossTypeFilter() {
    if (junketLossTypeFilterRegistered || !$.fn.dataTable || !$.fn.dataTable.ext) return;
    junketLossTypeFilterRegistered = true;
    $.fn.dataTable.ext.search.push(function (settings, _data, dataIndex) {
        if (!settings.nTable || settings.nTable.id !== 'junket-loss-tbl') return true;
        if (junketLossTypeFilter === 'all') return true;
        const api = new $.fn.dataTable.Api(settings);
        const row = api.row(dataIndex).data();
        if (!row) return true;
        const paymentType = Number(row.PAYMENT_TYPE);
        if (junketLossTypeFilter === 'chip') return paymentType === 1;
        if (junketLossTypeFilter === 'cash') return paymentType === 2;
        return true;
    });
}

function getJunketLossTypeFilter() {
    const $active = $('#junket-loss-type-tabs .nav-link.active');
    return ($active.data('filter') || 'all').toString();
}

function applyJunketLossTypeFilter(filter) {
    junketLossTypeFilter = filter || 'all';
    if (junketLossTable) {
        junketLossTable.draw();
    }
}

function junketLossApiEndDate(endYmd) {
    if (!endYmd || !/^\d{4}-\d{2}-\d{2}$/.test(String(endYmd))) return endYmd;
    const parts = String(endYmd).slice(0, 10).split('-').map(Number);
    const lastDayOfMonth = new Date(parts[0], parts[1], 0).getDate();
    if (parts[2] === lastDayOfMonth - 1 && window.MonthEndCutoffRange) {
        return window.MonthEndCutoffRange.expandApiEndDateToMonthEnd(endYmd);
    }
    return endYmd;
}

function resolveJunketLossDateRange(fpInstance) {
    if (junketLossSplitOverrideRange && junketLossSplitOverrideRange.fromDate && junketLossSplitOverrideRange.toDate) {
        return {
            fromDate: junketLossSplitOverrideRange.fromDate,
            toDate: junketLossSplitOverrideRange.toDate
        };
    }

    const formatYmdLocal = function (d) {
        const y = d.getFullYear();
        const m = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        return y + '-' + m + '-' + day;
    };

    let selectedDates = null;
    if (fpInstance && fpInstance.selectedDates && fpInstance.selectedDates.length) {
        selectedDates = fpInstance.selectedDates;
    } else {
        const el = document.getElementById('junket-loss-daterange');
        if (el && el._flatpickr && el._flatpickr.selectedDates && el._flatpickr.selectedDates.length) {
            selectedDates = el._flatpickr.selectedDates;
        }
    }

    if (selectedDates && selectedDates.length >= 2) {
        let fromDate = formatYmdLocal(selectedDates[0]);
        let toDate = junketLossApiEndDate(formatYmdLocal(selectedDates[1]));
        if (fromDate > toDate) {
            const swap = fromDate;
            fromDate = toDate;
            toDate = swap;
        }
        return { fromDate: fromDate, toDate: toDate };
    }

    if (selectedDates && selectedDates.length === 1) {
        const single = junketLossApiEndDate(formatYmdLocal(selectedDates[0]));
        return { fromDate: single, toDate: single };
    }

    const label = getJunketLossDateRangeLabel();
    if (label && window.MonthEndCutoffRange) {
        const parsed = window.MonthEndCutoffRange.parseRangeString(label);
        const fromDate = window.MonthEndCutoffRange.toApiDate(parsed.start);
        const toDate = junketLossApiEndDate(window.MonthEndCutoffRange.toApiDate(parsed.end));
        if (fromDate && toDate) {
            return fromDate <= toDate
                ? { fromDate: fromDate, toDate: toDate }
                : { fromDate: toDate, toDate: fromDate };
        }
    }

    if (window.MonthEndCutoffRange) {
        const fallback = window.MonthEndCutoffRange.getMonthEndCutoffRange();
        return {
            fromDate: fallback.startDate,
            toDate: fallback.endDateApi || junketLossApiEndDate(fallback.endDate),
        };
    }

    const monthRange = getFirstAndLastOfMonth();
    return {
        fromDate: formatYmd(monthRange.first),
        toDate: junketLossApiEndDate(formatYmd(monthRange.last)),
    };
}

let junketLossSplitDateRange = null;

function getJunketLossDateRangeLabel() {
    const el = document.getElementById('junket-loss-daterange');
    if (el && el._flatpickr && el._flatpickr.altInput && el._flatpickr.altInput.value) {
        return el._flatpickr.altInput.value.trim();
    }
    return ($('#junket-loss-daterange').val() || '').trim();
}

function syncJunketLossSplitFromFlatpickr() {
    // Start/End are independent from the combined range picker.
}

function applyJunketLossSplitDateRange(range) {
    if (!range || !range.start || !range.end) return;
    let fromDate = range.start;
    let toDate = junketLossApiEndDate(range.end);
    if (fromDate > toDate) {
        const swap = fromDate;
        fromDate = toDate;
        toDate = swap;
    }
    junketLossSplitOverrideRange = { fromDate: fromDate, toDate: toDate };
    fetchJunketLossData();
}

function applyJunketLossDateFilter(fpInstance) {
    const range = resolveJunketLossDateRange(fpInstance);
    if (!range.fromDate || !range.toDate) return;
    junketLossFromDate = range.fromDate;
    junketLossToDate = range.toDate;
    fetchJunketLossData();
}

function sanitizeAmountInput(value) {
    return String(value || '').replace(/[^\d.]/g, '');
}

function formatAmountInput(value) {
    const cleaned = sanitizeAmountInput(value);
    if (!cleaned) return '';
    const parts = cleaned.split('.');
    const integerPart = parts[0] || '0';
    const decimalPart = parts.length > 1 ? parts[1].slice(0, 2) : '';
    const formattedInteger = Number(integerPart).toLocaleString('en-US');
    return decimalPart !== '' ? formattedInteger + '.' + decimalPart : formattedInteger;
}

function getJunketLossFormModalEl() {
    return document.getElementById('modal-junket-loss');
}

function showJunketLossFormModal() {
    const el = getJunketLossFormModalEl();
    if (!el) return;
    if (window.bootstrap && bootstrap.Modal) {
        bootstrap.Modal.getOrCreateInstance(el).show();
        return;
    }
    $('#modal-junket-loss').modal('show');
}

function hideJunketLossFormModal() {
    const el = getJunketLossFormModalEl();
    if (!el) return;
    if (window.bootstrap && bootstrap.Modal) {
        const instance = bootstrap.Modal.getInstance(el);
        if (instance) {
            instance.hide();
            return;
        }
    }
    $('#modal-junket-loss').modal('hide');
}

function formatYmd(dateObj) {
    const y = dateObj.getFullYear();
    const m = String(dateObj.getMonth() + 1).padStart(2, '0');
    const d = String(dateObj.getDate()).padStart(2, '0');
    return y + '-' + m + '-' + d;
}

function todayProgramDateValue() {
    return formatYmd(new Date());
}

function getJunketLossProgramDateValue() {
    const el = document.getElementById('junket-loss-program-date');
    if (!el) return '';
    if (el._flatpickr && el._flatpickr.selectedDates && el._flatpickr.selectedDates[0]) {
        return formatYmd(el._flatpickr.selectedDates[0]);
    }
    return String(el.value || '').trim().slice(0, 10);
}

function ensureJunketLossProgramDatePicker(defaultDate) {
    const el = document.getElementById('junket-loss-program-date');
    if (!el) return;
    const dateVal = defaultDate || getJunketLossProgramDateValue() || todayProgramDateValue();
    if (typeof flatpickr === 'undefined') {
        el.value = dateVal;
        return;
    }
    if (el._flatpickr) {
        try { el._flatpickr.destroy(); } catch (e) {}
    }
    junketLossProgramDatePicker = flatpickr(el, {
        enableTime: false,
        dateFormat: 'Y-m-d',
        altInput: true,
        altFormat: 'M j, Y',
        defaultDate: dateVal,
        allowInput: true,
        disableMobile: true,
        closeOnSelect: true
    });
}

function initJunketLossAccountSelect() {
    const $sel = $('#junket-loss-account');
    if (!$sel.length || typeof $sel.select2 !== 'function') return;
    if ($sel.data('select2')) {
        try { $sel.select2('destroy'); } catch (e) {}
    }
    $sel.select2({
        placeholder: $sel.data('placeholder') || 'Choose account',
        allowClear: true,
        dropdownParent: $('#modal-junket-loss')
    });
}

function initJunketLossGuestSelect() {
    const $sel = $('#junket-loss-guest');
    if (!$sel.length || typeof $sel.select2 !== 'function') return;
    if ($sel.data('select2')) {
        try { $sel.select2('destroy'); } catch (e) {}
    }
    $sel.select2({
        placeholder: $sel.data('placeholder') || 'Choose guest',
        allowClear: true,
        dropdownParent: $('#modal-junket-loss')
    });
}

function clearJunketLossGuestOptions() {
    const $sel = $('#junket-loss-guest');
    if (!$sel.length) return;
    const placeholder = $sel.data('placeholder') || 'Choose guest';
    if ($sel.data('select2')) {
        try { $sel.select2('destroy'); } catch (e) {}
    }
    $sel.empty().append($('<option/>', { value: '', text: placeholder }));
    $sel.val('').prop('disabled', true);
    initJunketLossGuestSelect();
}

function loadJunketLossAccounts(selectedId) {
    const $sel = $('#junket-loss-account');
    const placeholder = $sel.data('placeholder') || 'Choose account';
    return $.getJSON('/account_data').then(function (rows) {
        if ($sel.data('select2')) {
            try { $sel.select2('destroy'); } catch (e) {}
        }
        $sel.empty().append($('<option/>', { value: '', text: placeholder }));
        (rows || []).forEach(function (a) {
            const id = a.account_id;
            if (id == null) return;
            const parts = [a.agent_code, a.agent_name].filter(Boolean);
            const label = parts.length ? parts.join(' - ') : 'Account #' + id;
            $sel.append(
                $('<option/>', {
                    value: String(id),
                    text: label,
                    'data-agent-id': a.agent_id != null ? String(a.agent_id) : ''
                })
            );
        });
        initJunketLossAccountSelect();
        if (selectedId) {
            $sel.val(String(selectedId));
        }
    });
}

function loadJunketLossGuests(agentId, selectedId) {
    const $sel = $('#junket-loss-guest');
    const placeholder = $sel.data('placeholder') || 'Choose guest';

    clearJunketLossGuestOptions();
    if (!agentId) {
        return $.Deferred().resolve().promise();
    }

    return $.getJSON('/guest_data?agentId=' + encodeURIComponent(agentId)).then(function (rows) {
        if ($sel.data('select2')) {
            try { $sel.select2('destroy'); } catch (e) {}
        }
        $sel.empty().append($('<option/>', { value: '', text: placeholder }));
        (rows || []).forEach(function (g) {
            const id = g.guest_id;
            if (id == null) return;
            const name = (g.guest_name || '').toString().trim() || ('Guest #' + id);
            $sel.append($('<option/>', { value: String(id), text: name }));
        });
        $sel.prop('disabled', false);
        initJunketLossGuestSelect();
        if (selectedId) {
            $sel.val(String(selectedId)).trigger('change');
        }
    });
}

function onJunketLossAccountChange() {
    if (junketLossAccountGuestResetting) return;
    const $accountSel = $('#junket-loss-account');
    const accountId = ($accountSel.val() || '').toString().trim();
    const agentId = accountId
        ? ($accountSel.find('option:selected').data('agent-id') || '').toString().trim()
        : '';
    loadJunketLossGuests(agentId || null).fail(function () {
        Swal.fire('Error', 'Failed to load guests.', 'error');
    });
}

function resetJunketLossFormFields() {
    junketLossAccountGuestResetting = true;
    const form = document.getElementById('junket-loss-form');
    if (form) form.reset();
    $('#junket-loss-id').val('');
    $('#junket-loss-type-chip, #junket-loss-type-cash').prop('checked', false);
    const $accountSel = $('#junket-loss-account');
    if ($accountSel.data('select2')) $accountSel.val('').trigger('change.select2');
    else $accountSel.val('');
    clearJunketLossGuestOptions();
    junketLossAccountGuestResetting = false;
}

function paymentTypeLabel(value) {
    const n = Number(value);
    if (n === 1) return 'Chip';
    if (n === 2) return 'Cash';
    return '';
}

function formatJunketLossAmountDisplay(value) {
    const amount = Math.abs(Number(value) || 0);
    const formatted = amount.toLocaleString('en-US', {
        minimumFractionDigits: 0,
        maximumFractionDigits: 0
    });
    return '<span class="text-dash-neg">(' + formatted + ')</span>';
}

function updateJunketLossTableTotal(api) {
    if (!api) return;
    const total = api
        .column(4, { search: 'applied' })
        .data()
        .reduce(function (sum, value) {
            return sum + (Number(value) || 0);
        }, 0);
    $('#junket-loss-total-amount').html(formatJunketLossAmountDisplay(total));
}

function openJunketLossModal(data) {
    const id = data && data.IDNo ? data.IDNo : '';
    resetJunketLossFormFields();
    $('#junket-loss-id').val(id);
    $('#junket-loss-description').val(data ? (data.DESCRIPTION || '') : '');
    $('#junket-loss-amount').val(data ? formatAmountInput(data.AMOUNT || '') : '');
    $('#junket-loss-incharge').val(data ? (data.IN_CHARGE || '') : '');
    $('#junket-loss-modal-title').text(id ? 'Edit Loss Amount' : 'Add Loss Amount');

    const programDate = data && (data.PROGRAM_DATE || data.ENCODED_DT)
        ? String(data.PROGRAM_DATE || data.ENCODED_DT).slice(0, 10)
        : todayProgramDateValue();
    ensureJunketLossProgramDatePicker(programDate);

    const paymentType = data && data.PAYMENT_TYPE != null ? Number(data.PAYMENT_TYPE) : null;
    if (paymentType === 1) $('#junket-loss-type-chip').prop('checked', true);
    else if (paymentType === 2) $('#junket-loss-type-cash').prop('checked', true);

    const accountId = data && data.ACCOUNT_ID ? data.ACCOUNT_ID : '';
    const guestId = data && data.GUEST_ID ? data.GUEST_ID : '';

    showJunketLossFormModal();

    junketLossAccountGuestResetting = true;
    clearJunketLossGuestOptions();
    loadJunketLossAccounts(accountId || null)
        .then(function () {
            if (!accountId) return;
            const agentId = ($('#junket-loss-account').find('option:selected').data('agent-id') || '').toString().trim();
            return loadJunketLossGuests(agentId || null, guestId || null);
        })
        .fail(function () {
            Swal.fire('Error', 'Failed to load account or guest list.', 'error');
        })
        .always(function () {
            junketLossAccountGuestResetting = false;
        });
}

function closeJunketLossModal() {
    resetJunketLossFormFields();
    hideJunketLossFormModal();
}

function getMonthEndCutoffRangeLocal() {
    if (window.MonthEndCutoffRange) {
        return window.MonthEndCutoffRange.getMonthEndCutoffRange();
    }
    const now = new Date();
    const y = now.getFullYear();
    const m = now.getMonth();
    const startAt = new Date(y, m, 0);
    const endAt = new Date(y, m + 1, 0);
    endAt.setDate(endAt.getDate() - 1);
    return { startAt: startAt, endAt: endAt, startDate: formatYmd(startAt), endDate: formatYmd(endAt) };
}

function getFirstAndLastOfMonth() {
    const range = getMonthEndCutoffRangeLocal();
    return { first: range.startAt, last: range.endAt };
}

function jumpJunketLossRangeToCurrentThreeMonths(instance) {
    if (!instance) return;
    const current = new Date();
    instance.jumpToDate(new Date(current.getFullYear(), current.getMonth() - 2, 1), false);
}

function fetchJunketLossData(fpInstance) {
    const table = ensureJunketLossTable();
    if (!table) return;

    const range = resolveJunketLossDateRange(fpInstance);
    if (!range.fromDate || !range.toDate) return;

    junketLossFromDate = range.fromDate;
    junketLossToDate = range.toDate;

    $.get('/loss_amount_data', {
        fromDate: junketLossFromDate,
        toDate: junketLossToDate
    }, function (rows) {
        table.clear().rows.add(rows || []).draw();
    }).fail(function () {
        Swal.fire('Error', 'Failed to load junket expenses.', 'error');
    });
}

function refreshDashboardJunketLossTotal() {
    if (!document.getElementById('modal-dash-junket-loss')) return;
    $.get('/loss_amount_total', function (data) {
        const total = Number(data && data.total) || 0;
        const formatted = total
            ? '(' + Math.abs(total).toLocaleString('en-US') + ')'
            : '0';
        const html = total
            ? '<span class="text-dash-neg">' + formatted + '</span>'
            : formatted;
        $('#dash-junket-loss-total, #dash-junket-loss-total-anticipated').html(html);
    });
}

function removeJunketLoss(id) {
    SwalConfirm.fire({
        title: 'Archive this record?',
        confirmButtonText: 'Yes',
        cancelButtonText: 'No'
    }).then(function (result) {
        if (!result.isConfirmed) return;

        $.ajax({
            url: '/loss_amount/remove/' + id,
            method: 'PUT',
            success: function () {
                fetchJunketLossData();
                refreshDashboardJunketLossTotal();
                Swal.fire('Success', 'Record archived successfully.', 'success');
            },
            error: function () {
                Swal.fire('Error', 'Failed to archive record.', 'error');
            }
        });
    });
}

function applyJunketLossControlsLayout() {
    var wrapper = document.getElementById('junket-loss-tbl_wrapper');
    var lengthWrap = document.getElementById('junket-loss-tbl_length');
    var filterWrap = document.getElementById('junket-loss-tbl_filter');
    var searchLabel = filterWrap ? filterWrap.querySelector('label') : null;
    var addBtn = document.getElementById('btn-add-junket-loss');
    var controlsHighlight;
    var filterHighlight;

    if (!wrapper || !lengthWrap || !filterWrap || !searchLabel) return;

    controlsHighlight = wrapper.querySelector('.junket-loss-controls-highlight');
    if (!controlsHighlight) {
        controlsHighlight = document.createElement('div');
        controlsHighlight.className = 'junket-loss-controls-highlight';
        wrapper.insertBefore(controlsHighlight, wrapper.firstChild);
    }
    if (lengthWrap.parentElement !== controlsHighlight) {
        controlsHighlight.appendChild(lengthWrap);
    }
    if (filterWrap.parentElement !== controlsHighlight) {
        controlsHighlight.appendChild(filterWrap);
    }

    filterHighlight = filterWrap.querySelector('.junket-loss-filter-highlight');
    if (!filterHighlight) {
        filterHighlight = document.createElement('div');
        filterHighlight.className = 'junket-loss-filter-highlight';
        filterWrap.appendChild(filterHighlight);
    }

    if (addBtn && (addBtn.parentElement !== filterHighlight || filterHighlight.firstElementChild !== addBtn)) {
        filterHighlight.insertBefore(addBtn, filterHighlight.firstChild);
    }
    if (searchLabel.parentElement !== filterHighlight) {
        filterHighlight.appendChild(searchLabel);
    }
    if (addBtn) addBtn.classList.remove('d-none');
}

function ensureJunketLossTable() {
    if (junketLossTable) {
        applyJunketLossControlsLayout();
        return junketLossTable;
    }
    if (!$('#junket-loss-tbl').length || !$.fn.DataTable) return null;

    registerJunketLossTypeFilter();
    junketLossTypeFilter = getJunketLossTypeFilter();

    if ($.fn.DataTable.isDataTable('#junket-loss-tbl')) {
        junketLossTable = $('#junket-loss-tbl').DataTable();
        applyJunketLossControlsLayout();
        return junketLossTable;
    }

    junketLossTable = $('#junket-loss-tbl').DataTable({
        pageLength: 25,
        order: [[0, 'desc']],
        language: {
            search: '',
            searchPlaceholder: 'Search...'
        },
        columns: [
            {
                data: 'PROGRAM_DATE',
                render: function (data, type, row) {
                    const raw = data || row.ENCODED_DT || '';
                    if (!raw) return '';
                    if (type === 'sort') return String(raw).slice(0, 10);
                    return moment(raw).format('YYYY-MM-DD');
                }
            },
            {
                data: 'ENCODED_DT',
                render: function (data, type) {
                    if (!data) return '';
                    if (type === 'sort') return data;
                    return moment(data).format('YYYY-MM-DD HH:mm');
                }
            },
            { data: 'ACCOUNT_NAME', defaultContent: '' },
            { data: 'GUEST_NAME', defaultContent: '' },
            {
                data: 'AMOUNT',
                className: 'text-end',
                render: function (data, type) {
                    if (type === 'sort' || type === 'type') return Number(data) || 0;
                    return formatJunketLossAmountDisplay(data);
                }
            },
            {
                data: 'PAYMENT_TYPE',
                render: function (data) {
                    return paymentTypeLabel(data);
                }
            },
            { data: 'IN_CHARGE', defaultContent: '' },
            { data: 'DESCRIPTION', defaultContent: '' }
            // Encoded By — uncomment to restore
            // , { data: 'ENCODED_BY_NAME', defaultContent: '' }
            // Action column — uncomment to restore edit/remove buttons
            // , {
            //     data: null,
            //     orderable: false,
            //     searchable: false,
            //     render: function (row) {
            //         return '' +
            //             '<button type="button" class="btn btn-sm btn-alt-secondary me-1 btn-junket-loss-edit" data-id="' + row.IDNo + '">' +
            //             '<i class="fa fa-pencil-alt"></i></button>' +
            //             '<button type="button" class="btn btn-sm btn-alt-secondary btn-junket-loss-remove" data-id="' + row.IDNo + '">' +
            //             '<i class="fa fa-trash-alt"></i></button>';
            //     }
            // }
        ],
        footerCallback: function () {
            updateJunketLossTableTotal(this.api());
        },
        initComplete: function () {
            applyJunketLossControlsLayout();
        },
        drawCallback: function () {
            applyJunketLossControlsLayout();
        }
    });

    applyJunketLossControlsLayout();
    return junketLossTable;
}

window.refreshJunketLossTableLayout = function () {
    fetchJunketLossData();
    if (junketLossTable) {
        junketLossTable.columns.adjust().draw(false);
    }
    applyJunketLossControlsLayout();
};

window.ensureDashboardJunketLossReady = function () {
    ensureJunketLossTable();
    fetchJunketLossData();
    applyJunketLossControlsLayout();
};

$(document).ready(function () {
    if (!$('#junket-loss-tbl').length) return;

    const isDashboard = !!document.getElementById('modal-dash-junket-loss');

    if (typeof flatpickr === 'function') {
        junketLossSplitDateRange = window.SplitDateRange && SplitDateRange.attach({
            rangePickerId: 'junket-loss-daterange',
            startId: 'junket-loss-start-date',
            endId: 'junket-loss-end-date',
            splitWrapperId: 'junket-loss-split-daterange-wrapper',
            independent: true,
            invalidDateMessage: 'Invalid date range.',
            onRangeApplied: function (range) {
                applyJunketLossSplitDateRange(range);
            }
        });

        junketLossDatePicker = flatpickr('#junket-loss-daterange', {
            mode: 'range',
            showMonths: 3,
            onReady: function (_selectedDates, _dateStr, instance) {
                jumpJunketLossRangeToCurrentThreeMonths(instance);
                if (typeof window.setupFlatpickrMonthNameRangeSelect === 'function') {
                    window.setupFlatpickrMonthNameRangeSelect(instance);
                }
                setTimeout(function () {
                    fetchJunketLossData(instance);
                }, 0);
            },
            onOpen: function (_selectedDates, _dateStr, instance) {
                jumpJunketLossRangeToCurrentThreeMonths(instance);
                if (typeof window.setupFlatpickrMonthNameRangeSelect === 'function') {
                    window.setupFlatpickrMonthNameRangeSelect(instance);
                }
            },
            onMonthChange: function (_selectedDates, _dateStr, instance) {
                if (typeof window.styleFlatpickrMonthNameClickable === 'function') {
                    window.styleFlatpickrMonthNameClickable(instance);
                }
            },
            onChange: function (selectedDates, _dateStr, instance) {
                if (selectedDates.length === 2) {
                    junketLossSplitOverrideRange = null;
                    fetchJunketLossData(instance);
                }
            }
        });
    }

    function getJunketLossExportFilename() {
        var dr = document.getElementById('junket-loss-daterange');
        if (dr && dr._flatpickr && dr._flatpickr.selectedDates && dr._flatpickr.selectedDates.length === 2) {
            var pad = function (n) {
                return String(n).padStart(2, '0');
            };
            var fmt = function (dt) {
                return dt.getFullYear() + '-' + pad(dt.getMonth() + 1) + '-' + pad(dt.getDate());
            };
            return 'LossAmount_' + fmt(dr._flatpickr.selectedDates[0]) + '_to_' + fmt(dr._flatpickr.selectedDates[1]) + '.xlsx';
        }
        return 'LossAmount-export.xlsx';
    }

    function escapeHtml(value) {
        return String(value == null ? '' : value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    if (!isDashboard) {
        junketLossTable = ensureJunketLossTable();
    }

    // Action is last column when restored (Encoded By + Action); set to 9 and uncomment th + columns above
    var actionColIndex = -1;

    function getJunketLossTablePayload() {
        var headers = [];
        $('#junket-loss-tbl thead tr:first th').each(function (i) {
            if (i === actionColIndex) return;
            headers.push($(this).text().trim());
        });
        var rows = [];
        junketLossTable.rows({ search: 'applied' }).every(function () {
            var cells = [];
            $(this.node())
                .find('td')
                .each(function (i) {
                    if (i === actionColIndex) return;
                    cells.push($(this).text().trim());
                });
            if (cells.length) rows.push(cells);
        });
        return { headers: headers, rows: rows };
    }

    function getJunketLossPrintStyles() {
        return [
            '@page{size:landscape;margin:10mm;}',
            'body{font-family:Arial,sans-serif;color:#111;margin:0;}',
            '.print-wrap{width:100%;}',
            'h2{text-align:center;margin:0 0 4px;font-size:18px;}',
            '.subtitle{text-align:center;margin:0 0 12px;font-size:12px;color:#444;}',
            'table{width:100%;border-collapse:collapse;font-size:11px;}',
            'th,td{border:1px solid #777;padding:6px 8px;vertical-align:middle;}',
            'th{background:#d9e1f2;text-align:left;font-weight:700;}',
            'th:nth-child(5),td:nth-child(5){text-align:right;}',
            'th:nth-child(6),td:nth-child(6){text-align:center;}',
            'td{text-align:left;}',
            '.text-dash-neg{color:#dc3545;}'
        ].join('');
    }

    function printJunketLoss() {
        if (!junketLossTable) return;
        var payload = getJunketLossTablePayload();
        var t = window.junketLossTranslations || {};
        if (payload.rows.length === 0) {
            Swal.fire({
                icon: 'info',
                title: 'Print',
                text: t.no_data || 'No data to print.',
                confirmButtonColor: '#0d6efd'
            });
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
            '<!doctype html><html><head><title>Loss Amount</title><style>',
            getJunketLossPrintStyles(),
            '</style></head><body><div class="print-wrap">',
            '<h2>Loss Amount</h2>',
            '<div class="subtitle">', escapeHtml(junketLossFromDate + ' to ' + junketLossToDate), '</div>',
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

    $('#btn-junket-loss-export').on('click', function (e) {
        e.preventDefault();
        if (!junketLossTable) return;
        var payload = getJunketLossTablePayload();
        var headers = payload.headers;
        var rows = payload.rows;
        var t = window.junketLossTranslations || {};
        if (rows.length === 0) {
            Swal.fire({
                icon: 'info',
                title: t.export_label || 'Export',
                text: t.no_data || 'No data to export.',
                confirmButtonColor: '#0d6efd'
            });
            return;
        }
        var outName = getJunketLossExportFilename();
        var $btn = $(this);
        $btn.prop('disabled', true);
        fetch('/loss_amount/export_xlsx', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'same-origin',
            body: JSON.stringify({ headers: headers, rows: rows, filename: outName })
        })
            .then(function (res) {
                if (!res.ok) {
                    return res.json().catch(function () { return {}; }).then(function (j) {
                        throw new Error((j && j.error) ? j.error : (t.error || 'Export failed'));
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
                    text: err.message || (t.error || 'Export failed'),
                    confirmButtonColor: '#0d6efd'
                });
            })
            .finally(function () {
                $btn.prop('disabled', false);
            });
    });

    $('#btn-junket-loss-print').on('click', function (e) {
        e.preventDefault();
        printJunketLoss();
    });

    $(document).on('click', '#btn-add-junket-loss', function () {
        openJunketLossModal(null);
    });

    $(document).on('click', '#junket-loss-type-tabs .nav-link', function (e) {
        e.preventDefault();
        const $btn = $(this);
        $('#junket-loss-type-tabs .nav-link').removeClass('active');
        $btn.addClass('active');
        applyJunketLossTypeFilter($btn.data('filter'));
    });

    $('#junket-loss-account').on('change', onJunketLossAccountChange);

    $('#junket-loss-tbl').on('click', '.btn-junket-loss-edit', function () {
        const id = $(this).data('id');
        const row = junketLossTable.rows().data().toArray().find(function (r) { return r.IDNo === id; });
        openJunketLossModal(row || null);
    });

    $('#junket-loss-tbl').on('click', '.btn-junket-loss-remove', function () {
        removeJunketLoss($(this).data('id'));
    });

    $('#junket-loss-amount').on('input', function () {
        $(this).val(formatAmountInput($(this).val()));
    });

    $('#junket-loss-form').on('submit', function (e) {
        e.preventDefault();

        const rawAmount = sanitizeAmountInput($('#junket-loss-amount').val());
        const id = $('#junket-loss-id').val();
        const paymentType = $('input[name="junket-loss-payment-type"]:checked').val();
        const payload = {
            txtDescription: $('#junket-loss-description').val().trim(),
            txtAmount: rawAmount,
            txtInCharge: $('#junket-loss-incharge').val().trim(),
            txtProgramDate: getJunketLossProgramDateValue(),
            txtAccountId: ($('#junket-loss-account').val() || '').toString().trim(),
            txtGuestId: ($('#junket-loss-guest').val() || '').toString().trim(),
            txtPaymentType: paymentType || ''
        };

        if (!payload.txtDescription || !payload.txtAmount || !payload.txtInCharge || !payload.txtProgramDate || !payload.txtPaymentType) {
            Swal.fire('Validation', 'Please fill in all required fields.', 'warning');
            return;
        }

        const method = id ? 'PUT' : 'POST';
        const url = id ? '/loss_amount/' + id : '/add_loss_amount';

        $.ajax({
            url: url,
            method: method,
            data: payload,
            success: function () {
                closeJunketLossModal();
                fetchJunketLossData();
                refreshDashboardJunketLossTotal();
                Swal.fire('Success', 'Record saved successfully.', 'success');
            },
            error: function () {
                Swal.fire('Error', 'Failed to save record.', 'error');
            }
        });
    });
});
