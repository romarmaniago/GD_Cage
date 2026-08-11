var account_id;
var totalAmountBalance = 0;
var totalAmountAll = 0;

function guestBalanceCellData(totalAmount) {
    const numeric = Number(totalAmount) || 0;
    let display;
    if (window.AmountFormat) {
        display = numeric < 0
            ? '₱' + window.AmountFormat.formatAmountNegativeHtml(Math.abs(numeric))
            : '₱' + window.AmountFormat.formatCommas(numeric);
    } else {
        display = `₱${numeric.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
    }
    return {
        display: display,
        sort: numeric
    };
}

function guestBalanceFromRow(row, balanceIndex) {
    const cell = row[balanceIndex];
    if (cell != null && typeof cell === 'object' && cell.sort != null) {
        return Number(cell.sort) || 0;
    }
    if (window.AmountFormat) return window.AmountFormat.toNumber(cell);
    return parseFloat(String(cell).replace(/[₱,()]/g, '')) || 0;
}

const guestBalanceColumnDef = {
    targets: [5],
    render: function (data, type) {
        if (type === 'sort' || type === 'type') {
            if (data != null && typeof data === 'object' && data.sort != null) {
                return data.sort;
            }
            if (window.AmountFormat) return window.AmountFormat.toNumber(data);
            return parseFloat(String(data).replace(/[₱,()]/g, '')) || 0;
        }
        if (typeof data === 'object' && data && data.display !== undefined) {
            return data.display;
        }
        return data;
    }
};

$(document).ready(function () {
    // Initialize both DataTables
    if ($.fn.DataTable.isDataTable('#guestAccount-tbl-with-balance')) {
        $('#guestAccount-tbl-with-balance').DataTable().destroy();
    }
    if ($.fn.DataTable.isDataTable('#guestAccount-tbl-all')) {
        $('#guestAccount-tbl-all').DataTable().destroy();
    }

    var guestTableBalance = $('#guestAccount-tbl-with-balance').DataTable({
        paging: true,
        searching: true,
        ordering: true,
        order: [[5, 'desc']],
        info: true,
        deferRender: true,
        processing: true,
        pageLength: 100,
        columnDefs: [guestBalanceColumnDef],
        drawCallback: function () {
            const table = this.api();
            const pageRows = table.rows({ page: 'current' }).data();
            let pageTotal = 0;
        
            pageRows.each(function (row) {
                pageTotal += guestBalanceFromRow(row, 5);
            });
        
            if (table.page.info().pages > 1) {
                $('#SUB_TOTAL_VALUE_BALANCE').closest('tr').show();
                $('#SUB_TOTAL_VALUE_BALANCE').text('₱' + pageTotal.toLocaleString('en-US'));
            } else {
                $('#SUB_TOTAL_VALUE_BALANCE').closest('tr').hide();
            }
        }
    });

    var guestTableAll = $('#guestAccount-tbl-all').DataTable({
        paging: true,
        searching: true,
        ordering: true,
        order: [[5, 'desc']],
        info: true,
        deferRender: true,
        processing: true,
        pageLength: 100,
        columnDefs: [guestBalanceColumnDef],
        drawCallback: function () {
            const table = this.api();
            const pageRows = table.rows({ page: 'current' }).data();
            let pageTotal = 0;
        
            pageRows.each(function (row) {
                pageTotal += guestBalanceFromRow(row, 5);
            });
        
            if (table.page.info().pages > 1) {
                $('#SUB_TOTAL_SUM_VALUE_ALL').closest('tr').show();
                $('#SUB_TOTAL_SUM_VALUE_ALL').text('₱' + pageTotal.toLocaleString(undefined, {
                    minimumFractionDigits: 0,
                    maximumFractionDigits: 0
                }));
            } else {
                $('#SUB_TOTAL_SUM_VALUE_ALL').closest('tr').hide();
            }
        }
    });

    function loadGuestAccounts() {
        guestTableBalance.clear();
        guestTableAll.clear();
        totalAmountBalance = 0;
        totalAmountAll = 0;
    
        $.ajax({
            url: '/account_data',
            method: 'GET',
            success: function (accounts) {
                const balanceRows = [];
                const allRows = [];
                const permissions = parseInt($('#user-role').data('permissions'));

                (accounts || []).forEach(row => {
                    const totalAmount = Number(row.total_balance ?? row.total_ledger_amount ?? 0);
                    totalAmountAll += totalAmount;

                    const account_no = permissions !== 2
                        ? `<a href="#" onclick="account_details(${row.account_id}, '${row.agent_code}', '${row.agent_name}')">${row.agent_code}</a>`
                        : `<span>${row.agent_code}</span>`;

                    const balanceCell = guestBalanceCellData(totalAmount);

                    if (totalAmount > 0) {
                        balanceRows.push([
                            row.agent_name,
                            account_no,
                            row.agency_name,
                            row.agent_telegram,
                            row.agent_contact,
                            balanceCell
                        ]);
                        totalAmountBalance += totalAmount;
                    }

                    allRows.push([
                        row.agent_name,
                        account_no,
                        row.agency_name || '—',
                        row.agent_telegram || '—',
                        row.agent_contact || '—',
                        balanceCell
                    ]);
                });

                // Add all rows at once and draw
                guestTableBalance.rows.add(balanceRows).draw();
                guestTableAll.rows.add(allRows).draw();

                const formattedGrand = `₱${Number(totalAmountAll).toLocaleString('en-US', { minimumFractionDigits: 0 })}`;
                $('#TOTAL_SUM_VALUE_BALANCE').text(formattedGrand);
                $('#TOTAL_SUM_VALUE_ALL').text(formattedGrand);
            },
            error: function (xhr, status, err) {
                console.error('Error loading guest data:', err);
            }
        });
    }
    

    $('#modal-guestAccount').off('shown.bs.modal').on('shown.bs.modal', function () {
        loadGuestAccounts();
    });

    $('#modal-guestAccount').on('hidden.bs.modal', function () {
        guestTableBalance.clear().draw();
        guestTableAll.clear().draw();
        $('#TOTAL_SUM_VALUE_BALANCE').text('₱0');
        $('#TOTAL_SUM_VALUE_ALL').text('₱0');
    });

    let openedFromGuestAccount = false;

    function isGuestAccountModalOpen() {
        return $('#modal-guestAccount').hasClass('show');
    }

    function bumpGuestAccountPortalStack() {
        var $guestAccount = $('#modal-guestAccount');
        var $portal = $('#modal-account-details');
        requestAnimationFrame(function () {
            $guestAccount.css('z-index', 1055);
            $portal.css('z-index', 1065);
            var backs = document.querySelectorAll('.modal-backdrop');
            if (backs.length > 1) {
                backs[backs.length - 1].remove();
            }
            backs = document.querySelectorAll('.modal-backdrop');
            if (backs.length) {
                backs[0].style.zIndex = 1050;
            }
        });
    }

    function resetGuestAccountPortalStack() {
        $('#modal-guestAccount').css('z-index', '');
        $('#modal-account-details').css('z-index', '');
        document.querySelectorAll('.modal-backdrop').forEach(function (el) {
            el.style.zIndex = '';
        });
        if (!isGuestAccountModalOpen()) {
            if (typeof window.resetOrphanedModalBackdrops === 'function') {
                window.resetOrphanedModalBackdrops();
            }
            return;
        }
        var backs = document.querySelectorAll('.modal-backdrop');
        while (backs.length > 1) {
            backs[backs.length - 1].remove();
            backs = document.querySelectorAll('.modal-backdrop');
        }
        document.body.classList.add('modal-open');
    }

    // When account details modal opens from Guest Accounts list
    $('#modal-account-details').on('show.bs.modal', function () {
        if (isGuestAccountModalOpen()) {
            openedFromGuestAccount = true;
        }
    });

    $('#modal-account-details').on('shown.bs.modal', function () {
        if (openedFromGuestAccount) {
            bumpGuestAccountPortalStack();
        }
    });

    // When account details modal closes — do not re-show Guest Accounts (still open); only fix backdrop stack
    $('#modal-account-details').on('hidden.bs.modal', function () {
        if (!$('#modal-transfer_account').is(':visible') && openedFromGuestAccount) {
            resetGuestAccountPortalStack();
            openedFromGuestAccount = false;
        }
    });

// When transfer account modal opens
$('#modal-transfer_account').on('show.bs.modal', function () {
    openedFromGuestAccount = false;
    // Prevent closing guestAccount modal
    if ($('#modal-guestAccount').is(':visible')) {
        $('#modal-guestAccount').css('z-index', 1050); // Keep guestAccount in background
    }
    $('#modal-account-details').modal('hide');
    $('#modal-guestAccount').modal('hide');
});

// When transfer account modal closes
$('#modal-transfer_account').on('hidden.bs.modal', function () {
    $('#modal-account-details').modal('show');
});

});
