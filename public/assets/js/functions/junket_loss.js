let junketLossTable;
let junketLossFromDate = null;
let junketLossToDate = null;

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

function openJunketLossModal(data) {
    const id = data && data.IDNo ? data.IDNo : '';
    $('#junket-loss-id').val(id);
    $('#junket-loss-description').val(data ? (data.DESCRIPTION || '') : '');
    $('#junket-loss-amount').val(data ? formatAmountInput(data.AMOUNT || '') : '');
    $('#junket-loss-incharge').val(data ? (data.IN_CHARGE || '') : '');
    $('#junket-loss-modal-title').text(id ? 'Edit Junket Expense' : 'Add Junket Expense');
    $('#modal-junket-loss').modal('show');
}

function closeJunketLossModal() {
    $('#junket-loss-form')[0].reset();
    $('#junket-loss-id').val('');
    $('#modal-junket-loss').modal('hide');
}

function formatYmd(dateObj) {
    const y = dateObj.getFullYear();
    const m = String(dateObj.getMonth() + 1).padStart(2, '0');
    const d = String(dateObj.getDate()).padStart(2, '0');
    return y + '-' + m + '-' + d;
}

function getFirstAndLastOfMonth() {
    const now = new Date();
    const first = new Date(now.getFullYear(), now.getMonth(), 1);
    const last = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    return { first, last };
}

function fetchJunketLossData() {
    $.get('/junket_loss_data', {
        fromDate: junketLossFromDate,
        toDate: junketLossToDate
    }, function (rows) {
        junketLossTable.clear().rows.add(rows || []).draw();
    }).fail(function () {
        Swal.fire('Error', 'Failed to load junket expenses.', 'error');
    });
}

function removeJunketLoss(id) {
    Swal.fire({
        title: 'Archive this record?',
        icon: 'warning',
        showCancelButton: true,
        confirmButtonText: 'Yes',
        cancelButtonText: 'No'
    }).then(function (result) {
        if (!result.isConfirmed) return;

        $.ajax({
            url: '/junket_loss/remove/' + id,
            method: 'PUT',
            success: function () {
                fetchJunketLossData();
                Swal.fire('Success', 'Record archived successfully.', 'success');
            },
            error: function () {
                Swal.fire('Error', 'Failed to archive record.', 'error');
            }
        });
    });
}

$(document).ready(function () {
    const monthRange = getFirstAndLastOfMonth();
    junketLossFromDate = formatYmd(monthRange.first);
    junketLossToDate = formatYmd(monthRange.last);

    if (typeof flatpickr === 'function') {
        flatpickr('#junket-loss-daterange', {
            mode: 'range',
            dateFormat: 'Y-m-d',
            altInput: true,
            altFormat: 'M d, Y',
            defaultDate: [monthRange.first, monthRange.last],
            onClose: function (selectedDates) {
                if (!selectedDates || selectedDates.length !== 2) return;
                junketLossFromDate = formatYmd(selectedDates[0]);
                junketLossToDate = formatYmd(selectedDates[1]);
                fetchJunketLossData();
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
            return 'JunketLoss_' + fmt(dr._flatpickr.selectedDates[0]) + '_to_' + fmt(dr._flatpickr.selectedDates[1]) + '.xlsx';
        }
        return 'JunketLoss-export.xlsx';
    }

    junketLossTable = $('#junket-loss-tbl').DataTable({
        pageLength: 25,
        order: [[4, 'desc']],
        columns: [
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
                data: 'ENCODED_DT',
                render: function (data, type) {
                    if (!data) return '';
                    if (type === 'sort') return data;
                    return moment(data).format('DD MMM YYYY HH:mm:ss');
                }
            },
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

    fetchJunketLossData();

    var encodedByColIndex = 3;
    var actionColIndex = 5;

    $('#btn-junket-loss-export').on('click', function (e) {
        e.preventDefault();
        if (!junketLossTable) return;
        var headers = [];
        $('#junket-loss-tbl thead tr:first th').each(function (i) {
            if (i === encodedByColIndex || i === actionColIndex) return;
            headers.push($(this).text().trim());
        });
        var rows = [];
        junketLossTable.rows({ search: 'applied' }).every(function () {
            var cells = [];
            $(this.node())
                .find('td')
                .each(function (i) {
                    if (i === encodedByColIndex || i === actionColIndex) return;
                    cells.push($(this).text().trim());
                });
            if (cells.length) rows.push(cells);
        });
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
                Swal.fire('Success', 'Record saved successfully.', 'success');
            },
            error: function () {
                Swal.fire('Error', 'Failed to save record.', 'error');
            }
        });
    });
});
