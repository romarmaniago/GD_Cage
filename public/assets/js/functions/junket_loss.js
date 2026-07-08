let junketLossTable;
let junketLossFromDate = null;
let junketLossToDate = null;
let junketLossDatePicker = null;
let junketLossManualDateLastApplied = '';

function parseJunketLossIsoDateLocal(value) {
    const m = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m) return null;
    return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

function getJunketLossManualDateInput() {
    return document.getElementById('junket-loss-manual-daterange');
}

function getJunketLossDateRangeLabel() {
    const el = document.getElementById('junket-loss-daterange');
    if (el && el._flatpickr && el._flatpickr.altInput && el._flatpickr.altInput.value) {
        return el._flatpickr.altInput.value.trim();
    }
    return ($('#junket-loss-daterange').val() || '').trim();
}

function fitJunketLossManualInputWidth() {
    const el = getJunketLossManualDateInput();
    if (!el) return;

    let widthPx = 160;
    if (window.MonthEndCutoffRange && typeof window.MonthEndCutoffRange.fitRangeInputWidth === 'function') {
        window.MonthEndCutoffRange.fitRangeInputWidth(el);
        widthPx = parseInt(el.style.width, 10) || widthPx;
    }

    const wrap = el.closest('.junket-loss-manual-daterange-wrap');
    if (wrap) {
        wrap.style.width = widthPx + 'px';
        wrap.style.minWidth = widthPx + 'px';
    }
}

function syncJunketLossManualFromFlatpickr() {
    const label = getJunketLossDateRangeLabel();
    if (!label) return;
    $('#junket-loss-manual-daterange').val(label);
    junketLossManualDateLastApplied = label;
    fitJunketLossManualInputWidth();
}

function applyJunketLossDateFilter(selectedDates) {
    if (!selectedDates || selectedDates.length !== 2) return;
    junketLossFromDate = formatYmd(selectedDates[0]);
    junketLossToDate = formatYmd(selectedDates[1]);
    fetchJunketLossData();
}

function applyJunketLossManualDateRange() {
    const raw = ($('#junket-loss-manual-daterange').val() || '').trim();
    if (!raw) return false;
    if (raw === junketLossManualDateLastApplied) return true;

    let start;
    let end;
    if (window.MonthEndCutoffRange && typeof window.MonthEndCutoffRange.parseRangeToApiDates === 'function') {
        const apiRange = window.MonthEndCutoffRange.parseRangeToApiDates(raw);
        start = apiRange.start;
        end = apiRange.end;
    } else if (raw.includes(' to ')) {
        const parts = raw.split(' to ');
        start = (parts[0] || '').trim();
        end = (parts[1] || '').trim();
    } else {
        start = raw;
        end = raw;
    }

    if (!start || !end) {
        Swal.fire('Error', 'Invalid date.', 'error');
        return false;
    }

    const startDate = parseJunketLossIsoDateLocal(start);
    const endDate = parseJunketLossIsoDateLocal(end);
    if (!startDate || !endDate || endDate < startDate) {
        Swal.fire('Error', 'Invalid date range.', 'error');
        return false;
    }

    junketLossManualDateLastApplied = raw;
    const el = document.getElementById('junket-loss-daterange');
    if (el && el._flatpickr) {
        el._flatpickr.setDate([startDate, endDate], false);
        if (window.MonthEndCutoffRange && typeof window.MonthEndCutoffRange.fitRangePickerInstance === 'function') {
            window.MonthEndCutoffRange.fitRangePickerInstance(el._flatpickr);
        }
    }
    applyJunketLossDateFilter([startDate, endDate]);
    return true;
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

function openJunketLossModal(data) {
    const id = data && data.IDNo ? data.IDNo : '';
    $('#junket-loss-id').val(id);
    $('#junket-loss-description').val(data ? (data.DESCRIPTION || '') : '');
    $('#junket-loss-amount').val(data ? formatAmountInput(data.AMOUNT || '') : '');
    $('#junket-loss-incharge').val(data ? (data.IN_CHARGE || '') : '');
    $('#junket-loss-modal-title').text(id ? 'Edit Junket Expense' : 'Add Junket Expense');
    showJunketLossFormModal();
}

function closeJunketLossModal() {
    const form = document.getElementById('junket-loss-form');
    if (form) form.reset();
    $('#junket-loss-id').val('');
    hideJunketLossFormModal();
}

function formatYmd(dateObj) {
    const y = dateObj.getFullYear();
    const m = String(dateObj.getMonth() + 1).padStart(2, '0');
    const d = String(dateObj.getDate()).padStart(2, '0');
    return y + '-' + m + '-' + d;
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

function fetchJunketLossData() {
    const table = ensureJunketLossTable();
    if (!table) return;

    $.get('/junket_loss_data', {
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
    $.get('/junket_loss_total', function (data) {
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
            url: '/junket_loss/remove/' + id,
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

function ensureJunketLossTable() {
    if (junketLossTable) return junketLossTable;
    if (!$('#junket-loss-tbl').length || !$.fn.DataTable) return null;

    if ($.fn.DataTable.isDataTable('#junket-loss-tbl')) {
        junketLossTable = $('#junket-loss-tbl').DataTable();
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
                data: 'ENCODED_DT',
                render: function (data, type) {
                    if (!data) return '';
                    if (type === 'sort') return data;
                    return moment(data).format('YYYY-MM-DD HH:mm');
                }
            },
            { data: 'DESCRIPTION', defaultContent: '' },
            {
                data: 'AMOUNT',
                render: function (data) {
                    return (Number(data) || 0).toLocaleString('en-US', {
                        minimumFractionDigits: 0,
                        maximumFractionDigits: 0
                    });
                }
            },
            { data: 'IN_CHARGE', defaultContent: '' },
            { data: 'ENCODED_BY_NAME', defaultContent: '' },
            {
                data: null,
                orderable: false,
                searchable: false,
                render: function (row) {
                    return '' +
                        '<button type="button" class="btn btn-sm btn-alt-secondary me-1 btn-junket-loss-edit" data-id="' + row.IDNo + '">' +
                        '<i class="fa fa-pencil-alt"></i></button>' +
                        '<button type="button" class="btn btn-sm btn-alt-secondary btn-junket-loss-remove" data-id="' + row.IDNo + '">' +
                        '<i class="fa fa-trash-alt"></i></button>';
                }
            }
        ]
    });

    return junketLossTable;
}

window.refreshJunketLossTableLayout = function () {
    fetchJunketLossData();
    if (junketLossTable) {
        junketLossTable.columns.adjust().draw(false);
    }
};

window.ensureDashboardJunketLossReady = function () {
    ensureJunketLossTable();
    fetchJunketLossData();
};

$(document).ready(function () {
    if (!$('#junket-loss-tbl').length) return;

    const isDashboard = !!document.getElementById('modal-dash-junket-loss');
    const monthRange = getFirstAndLastOfMonth();
    junketLossFromDate = formatYmd(monthRange.first);
    junketLossToDate = formatYmd(monthRange.last);

    if (typeof flatpickr === 'function') {
        junketLossDatePicker = flatpickr('#junket-loss-daterange', {
            mode: 'range',
            showMonths: 3,
            onReady: function (_selectedDates, _dateStr, instance) {
                jumpJunketLossRangeToCurrentThreeMonths(instance);
                if (typeof window.setupFlatpickrMonthNameRangeSelect === 'function') {
                    window.setupFlatpickrMonthNameRangeSelect(instance);
                }
                setTimeout(syncJunketLossManualFromFlatpickr, 0);
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
            onChange: function (selectedDates) {
                if (selectedDates.length === 2) {
                    syncJunketLossManualFromFlatpickr();
                }
            },
            onClose: function (selectedDates) {
                applyJunketLossDateFilter(selectedDates);
            }
        });
    }

    $(document).on('keydown', '#junket-loss-manual-daterange', function (e) {
        if (e.key === 'Enter') {
            e.preventDefault();
            applyJunketLossManualDateRange();
        }
    });

    $(document).on('input', '#junket-loss-manual-daterange', function () {
        fitJunketLossManualInputWidth();
    });

    function getJunketLossExportFilename() {
        var dr = document.getElementById('junket-loss-daterange');
        if (dr && dr._flatpickr && dr._flatpickr.selectedDates && dr._flatpickr.selectedDates.length === 2) {
            var pad = function (n) {
                return String(n).padStart(2, '0');
            };
            var fmt = function (dt) {
                return dt.getFullYear() + '-' + pad(dt.getMonth() + 1) + '-' + pad(dt.getDate());
            };
            return 'JunketLoss_' + fmt(dr._flatpickr.selectedDates[0]) + '_to_' + fmt(dr._flatpickr.selectedDates[1]) + '.xlsx';
        }
        return 'JunketLoss-export.xlsx';
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
        fetchJunketLossData();
    }

    var actionColIndex = 5;

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
            'th:nth-child(2),td:nth-child(2){text-align:right;}',
            'td{text-align:left;}'
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
            '<!doctype html><html><head><title>Junket Loss</title><style>',
            getJunketLossPrintStyles(),
            '</style></head><body><div class="print-wrap">',
            '<h2>Junket Loss</h2>',
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
        fetch('/junket_loss/export_xlsx', {
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

    $('#btn-add-junket-loss').on('click', function () {
        openJunketLossModal(null);
    });

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
        const payload = {
            txtDescription: $('#junket-loss-description').val().trim(),
            txtAmount: rawAmount,
            txtInCharge: $('#junket-loss-incharge').val().trim()
        };

        if (!payload.txtDescription || !payload.txtAmount || !payload.txtInCharge) {
            Swal.fire('Validation', 'Please fill in all required fields.', 'warning');
            return;
        }

        const method = id ? 'PUT' : 'POST';
        const url = id ? '/junket_loss/' + id : '/add_junket_loss';

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
