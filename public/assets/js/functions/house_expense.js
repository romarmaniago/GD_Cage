// ============== FRONTEND (house_expense.js) =======================
var expense_id;
var return_money_id;
window.houseExpenseLastRows = [];
window.isDailySettleSelectionMode = false;
window.isOpenPoolSelectionMode = false;
window.selectedSettlementSubView = 'open';
window.houseExpenseBreakdownState = {
    rows: [],
    sortKey: 'date_time',
    sortDir: 'desc',
    showVehicleColumns: false
};

/** Main category / item explorer + graph (date range only for graph race). */
window.houseExpenseExplorerState = {
    mainCategoryId: null,
    mainCategory: null,
    itemCategoryId: null,
    itemCategory: null
};
window.houseExpenseCategoryRows = [];
window.houseExpenseVehicleRows = [];
window.houseExpenseItemSearchQuery = '';
window.houseExpenseAnimateItemTable = false;
window.houseExpenseItemTableSortState = {
    sortKey: 'date_time',
    sortDir: 'desc'
};

function resetHouseExpenseExplorerState() {
    window.houseExpenseExplorerState = {
        mainCategoryId: null,
        mainCategory: null,
        itemCategoryId: null,
        itemCategory: null
    };
}

function houseExpenseIsAllExplorerFilter(st) {
    st = st || window.houseExpenseExplorerState || {};
    return !st.mainCategoryId && !st.mainCategory;
}

function getHouseExpenseFilterMode() {
    return 'daterange';
}

function hasHouseExpenseDateRangeComplete() {
    var el = document.getElementById('daterange-picker');
    return !!(el && el._flatpickr && el._flatpickr.selectedDates && el._flatpickr.selectedDates.length === 2);
}

function getHouseExpenseDateRangeLabel() {
    var el = document.getElementById('daterange-picker');
    if (el && el._flatpickr) {
        if (el._flatpickr.altInput && el._flatpickr.altInput.value) {
            return el._flatpickr.altInput.value;
        }
        if (el._flatpickr.selectedDates && el._flatpickr.selectedDates.length === 2) {
            var a = el._flatpickr.selectedDates[0];
            var b = el._flatpickr.selectedDates[1];
            return moment(a).format('MMM D, YYYY') + ' – ' + moment(b).format('MMM D, YYYY');
        }
    }
    return 'Select date range';
}

function getHouseExpenseGrandDateLabel() {
    return getHouseExpenseDateRangeLabel();
}

function houseExpenseEscapeRegex(s) {
    return String(s || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function houseExpenseSumExpenseRows(rows, predicate) {
    var sum = 0;
    (rows || []).forEach(function (row) {
        if (!row || row.record_type === 'return_money') return;
        if (predicate && !predicate(row)) return;
        sum += Number(row.AMOUNT) || 0;
    });
    return sum;
}

function houseExpenseIsMainCategoryRow(catRow) {
    if (!catRow) return false;
    var parentId = catRow.PARENT_ID;
    return parentId == null || parentId === '' || Number(parentId) === 0;
}

function houseExpenseGetCategoryIdsUnderMain(mainId) {
    var ids = [String(mainId)];
    (window.houseExpenseCategoryRows || []).forEach(function (c) {
        if (c && String(c.PARENT_ID) === String(mainId)) {
            ids.push(String(c.IDNo));
        }
    });
    return ids;
}

function houseExpenseCategoryKindFromId(catId) {
    var row = houseExpenseFindCategoryRow(catId);
    if (!row) return 'sub';
    return houseExpenseIsMainCategoryRow(row) ? 'main' : 'sub';
}

/** Count expense rows in current item table for category (main includes all subs). */
function houseExpenseGetCategoryItemCount(catId, kind) {
    if (!kind || (kind !== 'main' && kind !== 'sub')) {
        kind = houseExpenseCategoryKindFromId(catId);
    }
    var ids = kind === 'main' ? houseExpenseGetCategoryIdsUnderMain(catId) : [String(catId)];
    var stats = houseExpenseBuildCategoryStats(window.houseExpenseLastRows || []);
    var total = 0;
    ids.forEach(function (cid) {
        if (stats[cid]) total += stats[cid].count;
    });
    return total;
}

function houseExpenseRowMatchesExplorer(row) {
    if (!row || row.record_type === 'return_money') return true;
    var st = window.houseExpenseExplorerState || {};
    var catId = row.expense_category_id != null ? String(row.expense_category_id) : '';
    if (st.itemCategoryId) {
        return catId === String(st.itemCategoryId);
    }
    if (st.mainCategoryId) {
        return houseExpenseGetCategoryIdsUnderMain(st.mainCategoryId).indexOf(catId) !== -1;
    }
    if (st.mainCategory) {
        return String(row.expense_category || '').trim() === st.mainCategory;
    }
    return true;
}

function applyHouseExpenseExplorerDataTableFilter() {
    renderHouseExpenseItemEntriesTable(window.houseExpenseLastRows || []);
}

function houseExpenseCategoryTypeLabel(typeValue) {
    var parsed = parseInt(typeValue, 10);
    var t = window.houseExpenseTranslations || {};
    return parsed === 2 ? (t.type_non_goods || 'Non-goods / Services') : (t.type_goods || 'Goods / Consumables');
}

function houseExpenseBuildCategoryStats(expenseRows) {
    var stats = {};
    (expenseRows || []).forEach(function (r) {
        if (!r || r.record_type === 'return_money') return;
        var id = r.expense_category_id != null ? String(r.expense_category_id) : '';
        if (!id) return;
        if (!stats[id]) stats[id] = { count: 0, sum: 0 };
        stats[id].count += 1;
        stats[id].sum += Number(r.AMOUNT) || 0;
    });
    return stats;
}

function getHouseExpenseSubCategoryRows(mainId) {
    if (mainId == null || mainId === '') return [];
    var mainIdStr = String(mainId);
    return (window.houseExpenseCategoryRows || [])
        .filter(function (c) {
            return c && String(c.PARENT_ID) === mainIdStr;
        })
        .sort(function (a, b) {
            return String(a.CATEGORY || '').localeCompare(String(b.CATEGORY || ''), undefined, {
                sensitivity: 'base'
            });
        });
}

function houseExpenseGetExplorerSubtitleText(st) {
    st = st || window.houseExpenseExplorerState || {};
    if (houseExpenseIsAllExplorerFilter(st)) {
        var t = window.houseExpenseTranslations || {};
        return t.filter_all || 'All';
    }
    if (!st.mainCategoryId && !st.mainCategory) return '';

    var mainName = st.mainCategory || '';
    if (!mainName && st.mainCategoryId) {
        var mainRow = (window.houseExpenseCategoryRows || []).find(function (c) {
            return c && String(c.IDNo) === String(st.mainCategoryId);
        });
        mainName = mainRow ? mainRow.CATEGORY || '' : '';
    }

    if (st.itemCategoryId) {
        var subName = st.itemCategory || '';
        if (!subName) {
            var subRow = (window.houseExpenseCategoryRows || []).find(function (c) {
                return c && String(c.IDNo) === String(st.itemCategoryId);
            });
            subName = subRow ? subRow.CATEGORY || '' : '';
        }
        if (subName && mainName) return mainName + ' \u203a ' + subName;
        return subName || mainName;
    }

    return mainName;
}

function getHouseExpenseMainCategoryRows(expenseRows) {
    var catalogMains = (window.houseExpenseCategoryRows || []).filter(houseExpenseIsMainCategoryRow);
    if (catalogMains.length) {
        return catalogMains.slice();
    }
    var byId = {};
    (expenseRows || []).forEach(function (r) {
        if (!r || r.record_type === 'return_money') return;
        var id = r.expense_category_id;
        if (id == null || id === '') return;
        var key = String(id);
        if (byId[key]) return;
        byId[key] = {
            IDNo: id,
            CATEGORY: String(r.expense_category || 'Uncategorized').trim() || 'Uncategorized',
            TYPE: r.expense_type,
            PARENT_ID: null
        };
    });
    return Object.keys(byId)
        .map(function (k) {
            return byId[k];
        })
        .sort(function (a, b) {
            return String(a.CATEGORY || '').localeCompare(String(b.CATEGORY || ''), undefined, {
                sensitivity: 'base'
            });
        });
}

function houseExpenseGetApprovalStatus(row) {
    if (!row || row.record_type === 'return_money') return 1;
    var s = parseInt(row.APPROVAL_STATUS, 10);
    return Number.isNaN(s) ? 1 : s;
}

function houseExpenseIsApprovedForTotals(row) {
    return houseExpenseGetApprovalStatus(row) === 1;
}

/** Pending/rejected first; approved (and return money) last. */
function houseExpenseItemApprovalSortRank(row) {
    if (!row) return 1;
    if (row.record_type === 'return_money') return 1;
    var status = houseExpenseGetApprovalStatus(row);
    if (status === 1) return 1;
    return 0;
}

function getHouseExpenseItemSortValue(row, key) {
    if (!row) return '';
    if (key === 'name') return String(houseExpenseGetExpenseNameLabel(row) || '').toLowerCase();
    if (key === 'in_charge') {
        return row.record_type === 'return_money'
            ? ''
            : String(row.DESCRIPTION || row.OIC || '').toLowerCase();
    }
    if (key === 'receiver') {
        return row.record_type === 'return_money' ? '' : String(row.RECEIVER || '').toLowerCase();
    }
    if (key === 'description') return String(houseExpenseItemDescriptionColumnText(row) || '').toLowerCase();
    if (key === 'amount') return parseFloat(row.AMOUNT) || 0;
    if (key === 'date_time') return new Date(row.ENCODED_DT || 0).getTime();
    return '';
}

function sortHouseExpenseItemRows(rows) {
    var list = (rows || []).slice();
    var sortState = window.houseExpenseItemTableSortState || {};
    var key = sortState.sortKey || 'date_time';
    var dir = sortState.sortDir === 'asc' ? 'asc' : 'desc';

    list.sort(function (a, b) {
        var approvalDiff = houseExpenseItemApprovalSortRank(a) - houseExpenseItemApprovalSortRank(b);
        if (approvalDiff !== 0) return approvalDiff;

        var av = getHouseExpenseItemSortValue(a, key);
        var bv = getHouseExpenseItemSortValue(b, key);
        if (av < bv) return dir === 'asc' ? -1 : 1;
        if (av > bv) return dir === 'asc' ? 1 : -1;

        return new Date(b.ENCODED_DT || 0).getTime() - new Date(a.ENCODED_DT || 0).getTime();
    });

    return list;
}

function syncHouseExpenseItemTableSortHeaders() {
    var sortState = window.houseExpenseItemTableSortState || {};
    var key = sortState.sortKey || 'date_time';
    var dir = sortState.sortDir === 'asc' ? 'asc' : 'desc';

    $('#expense-item-cat-tbl thead th.sortable-col').each(function () {
        var $th = $(this);
        var thKey = $th.attr('data-sort-key');
        var active = thKey === key;
        $th.toggleClass('is-sorted', active);
        $th.attr('aria-sort', active ? (dir === 'asc' ? 'ascending' : 'descending') : 'none');
    });
}

function buildHouseExpenseActionButtons(row, amount) {
    var permissions = parseInt($('#user-role').data('permissions'), 10);
    var approvalStatus = houseExpenseGetApprovalStatus(row);
    var t = window.houseExpenseTranslations || {};

    var isPendingExpense = row.record_type !== 'return_money' && approvalStatus === 0;
    if (isPendingExpense && permissions === 2) {
        return (
            '<div class="house-expense-actions house-expense-approval-actions">' +
            '<span class="house-expense-status-pill house-expense-status-pill--pending">' +
            '<i class="fa fa-clock-o" aria-hidden="true"></i>' +
            houseExpenseHtmlEscape(t.pending_approval || 'Pending') +
            '</span></div>'
        );
    }
    var pendingApprovalBtnsHtml = isPendingExpense
        ? '<button type="button" class="btn btn-sm house-expense-btn-approve" onclick="approveHouseExpense(' +
          row.expense_id +
          ')" data-bs-toggle="tooltip" data-bs-placement="top" title="' +
          houseExpenseHtmlEscape(t.approve || 'Approve') +
          '"><i class="fa fa-check" aria-hidden="true"></i></button>' +
          '<button type="button" class="btn btn-sm house-expense-btn-reject" onclick="rejectHouseExpense(' +
          row.expense_id +
          ')" data-bs-toggle="tooltip" data-bs-placement="top" title="' +
          houseExpenseHtmlEscape(t.reject || 'Reject') +
          '"><i class="fa fa-times" aria-hidden="true"></i></button>'
        : '';

    if (row.record_type !== 'return_money' && approvalStatus === 2) {
        return (
            '<div class="house-expense-actions house-expense-approval-actions">' +
            '<span class="house-expense-status-pill house-expense-status-pill--rejected">' +
            '<i class="fa fa-ban" aria-hidden="true"></i>' +
            houseExpenseHtmlEscape(t.rejected || 'Rejected') +
            '</span></div>'
        );
    }

    var logCount = houseExpenseEditLogCount(row);
    var histTitle =
        (window.houseExpenseTranslations && window.houseExpenseTranslations.edit_history) || 'Edit history';
    var historyBtnHtml =
        logCount > 0
            ? '<button type="button" class="btn btn-sm btn-alt-secondary" onclick="showHouseExpenseEditHistory(' +
              row.expense_id +
              ')" data-bs-toggle="tooltip" data-bs-placement="top" title="' +
              String(histTitle).replace(/"/g, '&quot;') +
              '"><i class="fa fa-history"></i></button>'
            : '';
    var editBtnClass =
        logCount > 0 ? 'btn btn-sm btn-alt-success btn-edit-row' : 'btn btn-sm btn-alt-secondary btn-edit-row';
    var editBtnClassReadonly =
        logCount > 0 ? 'btn btn-sm btn-alt-success' : 'btn btn-sm btn-alt-secondary';
    if (permissions !== 2) {
        return (
            '<div class="house-expense-actions">' +
            pendingApprovalBtnsHtml +
            '<button type="button" class="btn btn-sm btn-alt-secondary" onclick="viewReceipt(\'' +
            houseExpenseJsQuote(row.photoUrl || '') +
            '\')" ' +
            (row.record_type === 'return_money' ? 'disabled' : '') +
            ' data-bs-toggle="tooltip" data-bs-placement="top" title="' +
            (window.houseExpenseTranslations?.view_receipt || 'View Receipt') +
            '"><i class="fa fa-eye"></i></button>' +
            '<button type="button" class="' +
            editBtnClass +
            '" data-record-type="' +
            (row.record_type || 'expense') +
            '" data-expense-id="' +
            row.expense_id +
            '" data-category-id="' +
            attrEncode(row.expense_category_id || '') +
            '" data-receipt-no="' +
            attrEncode(row.RECEIPT_NO || '') +
            '" data-date-time="' +
            attrEncode(row.DATE_TIME || row.ENCODED_DT || '') +
            '" data-description="' +
            attrEncode(row.DESCRIPTION || '') +
            '" data-amount="' +
            amount +
            '" data-km-l="' +
            attrEncode(row.KM_L != null && row.KM_L !== '' ? String(row.KM_L) : '') +
            '" data-vehicle-id="' +
            attrEncode(row.VEHICLE_ID != null && row.VEHICLE_ID !== '' ? String(row.VEHICLE_ID) : '') +
            '" data-oic="' +
            attrEncode(row.OIC || '') +
            '" data-receiver="' +
            attrEncode(row.RECEIVER || '') +
            '" data-bs-toggle="tooltip" data-bs-placement="top" title="' +
            (window.houseExpenseTranslations?.edit_expense || 'Edit Expense') +
            '"><i class="fa fa-pencil-alt"></i></button>' +
            historyBtnHtml +
            '<button type="button" class="btn btn-sm btn-alt-secondary" onclick="downloadReceipt(\'' +
            houseExpenseJsQuote(row.photoUrl || '') +
            '\')" ' +
            (row.record_type === 'return_money' ? 'disabled' : '') +
            ' data-bs-toggle="tooltip" data-bs-placement="top" title="' +
            (window.houseExpenseTranslations?.download_receipt || 'Download Receipt') +
            '"><i class="fa fa-download"></i></button>' +
            '<button type="button" class="btn btn-sm btn-alt-secondary" onclick="' +
            (row.record_type === 'return_money'
                ? 'archive_return_money(' + row.expense_id + ')'
                : 'archive_expense(' + row.expense_id + ')') +
            '" data-bs-toggle="tooltip" data-bs-placement="top" title="' +
            (window.houseExpenseTranslations?.archive_expense || 'Archive Expense') +
            '"><i class="fa fa-trash-alt"></i></button>' +
            '</div>'
        );
    }
    return (
        '<div class="house-expense-actions">' +
        '<button type="button" class="btn btn-sm btn-primary" onclick="viewReceipt(\'' +
        houseExpenseJsQuote(row.photoUrl || '') +
        '\')" ' +
        (row.record_type === 'return_money' ? 'disabled' : '') +
        ' data-bs-toggle="tooltip" data-bs-placement="top" title="' +
        (window.houseExpenseTranslations?.view_receipt || 'View Receipt') +
        '"><i class="fa fa-eye"></i></button>' +
        '<button type="button" class="' +
        editBtnClassReadonly +
        '" disabled data-bs-toggle="tooltip" data-bs-placement="top" title="' +
        (window.houseExpenseTranslations?.edit_expense || 'Edit Expense') +
        '"><i class="fa fa-pencil-alt"></i></button>' +
        historyBtnHtml +
        '<button type="button" class="btn btn-sm btn-secondary" onclick="downloadReceipt(\'' +
        houseExpenseJsQuote(row.photoUrl || '') +
        '\')" ' +
        (row.record_type === 'return_money' ? 'disabled' : '') +
        ' data-bs-toggle="tooltip" data-bs-placement="top" title="' +
        (window.houseExpenseTranslations?.download_receipt || 'Download Receipt') +
        '"><i class="fa fa-download"></i></button>' +
        '<button type="button" class="btn btn-sm btn-alt-secondary" disabled data-bs-toggle="tooltip" data-bs-placement="top" title="' +
        (window.houseExpenseTranslations?.archive_expense || 'Archive Expense') +
        '"><i class="fa fa-trash-alt"></i></button>' +
        '</div>'
    );
}

function houseExpenseRowMatchesSearch(row, query) {
    if (!query) return true;
    var q = query.toLowerCase();
    var parts = [
        row.expense_category,
        row.RECEIPT_NO,
        row.DESCRIPTION,
        row.OIC,
        row.FIRSTNAME,
        row.AMOUNT,
        row.KM_L,
        row.vehicle_plate,
        row.vehicle_model,
        row.VEHICLE_ID
    ];
    return parts.some(function (p) {
        return p != null && String(p).toLowerCase().indexOf(q) !== -1;
    });
}

/** Clickable remarks for return-money rows (DESCRIPTION column). */
function houseExpenseRemarksCellHtml(row, displayText) {
    if (!row || !row.expense_id || !window.RemarksEditor) {
        return houseExpenseHtmlEscape(displayText || '-');
    }
    if (row.record_type !== 'return_money') {
        return houseExpenseHtmlEscape(displayText || '-');
    }
    var raw = row.DESCRIPTION || '';
    return window.RemarksEditor.renderCell(raw, {
        source: 'junket_return_money',
        recordId: row.expense_id,
        displayText: displayText != null ? String(displayText) : raw
    });
}

function houseExpenseFormatKmDisplay(kmL) {
    var n = Number(kmL);
    if (Number.isNaN(n)) return '';
    return (
        n.toLocaleString('en-US', {
            minimumFractionDigits: 0,
            maximumFractionDigits: 2
        }) + 'km'
    );
}

/** Item table DESCRIPTION column: description text + optional KM/L. */
function houseExpenseItemDescriptionColumnText(row) {
    if (!row) return '-';
    if (row.record_type === 'return_money') {
        return row.DESCRIPTION || '-';
    }
    var text =
        row.RECEIPT_NO != null && String(row.RECEIPT_NO).trim() !== ''
            ? String(row.RECEIPT_NO).trim()
            : '';
    var kmL = row.KM_L;
    if (kmL != null && kmL !== '' && !Number.isNaN(Number(kmL))) {
        var kmPart = houseExpenseFormatKmDisplay(kmL);
        text = text ? text + ' - ' + kmPart : kmPart;
    }
    return text || '-';
}

function houseExpenseGetFilteredItemRows(allRows) {
    var st = window.houseExpenseExplorerState || {};
    var rows = (allRows || []).slice();
    var searchQ = String(window.houseExpenseItemSearchQuery || '').trim();

    if (houseExpenseIsAllExplorerFilter(st)) {
        return rows.filter(function (row) {
            if (!row) return false;
            return houseExpenseRowMatchesSearch(row, searchQ);
        });
    }

    if (!st.mainCategoryId && !st.mainCategory) {
        return [];
    }

    return rows.filter(function (row) {
        if (!row) return false;
        if (row.record_type === 'return_money') {
            return !st.itemCategoryId;
        }
        if (!houseExpenseRowMatchesExplorer(row)) return false;
        return houseExpenseRowMatchesSearch(row, searchQ);
    });
}

function houseExpenseSumRowsForFooter(rows) {
    var totalExpense = 0;
    var totalReturnMoney = 0;
    (rows || []).forEach(function (row) {
        if (!row) return;
        var amount = parseFloat(row.AMOUNT) || 0;
        if (row.record_type === 'return_money') totalReturnMoney += amount;
        else if (houseExpenseIsApprovedForTotals(row)) totalExpense += amount;
    });
    return { totalExpense: totalExpense, totalReturnMoney: totalReturnMoney };
}

function updateHouseExpenseItemFooterTotals(allRows) {
    var sums = houseExpenseSumRowsForFooter(houseExpenseGetFilteredItemRows(allRows));
    setHouseExpenseFooterTotals(sums.totalExpense, sums.totalReturnMoney);
}

function runHouseExpenseItemTableTransition(paintFn) {
    if (typeof paintFn !== 'function') return;

    var $wrap = $('.expense-item-table-wrap');
    if (!$wrap.length) {
        paintFn();
        return;
    }

    var el = $wrap[0];
    $wrap.removeClass('is-bounce-in').off('animationend.expenseItemBounce');
    paintFn();
    void el.offsetWidth;
    $wrap.addClass('is-bounce-in');
    $wrap.on('animationend.expenseItemBounce', function (e) {
        if (e.target !== el) return;
        $wrap.removeClass('is-bounce-in').off('animationend.expenseItemBounce');
    });
}

function renderHouseExpenseItemEntriesTable(allRows, options) {
    options = options || {};
    var shouldAnimate = options.animate === true;

    function paintItemTableBody() {
        var $tbody = $('#expense-item-cat-tbody');
        if (!$tbody.length) return;

        var st = window.houseExpenseExplorerState || {};
        var rows = (allRows || []).slice();
        var noDataText = window.houseExpenseTranslations?.no_data_found || 'No data found';

        if (!houseExpenseIsAllExplorerFilter(st) && !st.mainCategoryId && !st.mainCategory) {
            $('#expense-item-panel-subtitle').text('');
            $tbody.html(
                '<tr><td colspan="7" class="text-muted small text-center py-3">Select a main category</td></tr>'
            );
            updateHouseExpenseItemFooterTotals(allRows);
            syncHouseExpenseItemTableSortHeaders();
            return;
        }

        $('#expense-item-panel-subtitle').text(houseExpenseGetExplorerSubtitleText(st));

        rows = houseExpenseGetFilteredItemRows(allRows);
        rows = sortHouseExpenseItemRows(rows);

        if (rows.length === 0) {
            $tbody.html(
                '<tr><td colspan="7" class="text-center text-muted py-3">' +
                    houseExpenseHtmlEscape(noDataText) +
                    '</td></tr>'
            );
            updateHouseExpenseItemFooterTotals(allRows);
            syncHouseExpenseItemTableSortHeaders();
            if (typeof window.syncHouseExpenseSelectAllCheckboxState === 'function') {
                window.syncHouseExpenseSelectAllCheckboxState();
            }
            return;
        }

        var html = rows
            .map(function (row) {
                var amount = parseFloat(row.AMOUNT) || 0;
                var formattedDate = row.ENCODED_DT
                    ? moment.utc(row.ENCODED_DT).utcOffset(8).format('DD MMM, YYYY HH:mm:ss')
                    : '-';
                var formattedAmount = amount.toLocaleString('en-US', {
                    minimumFractionDigits: 0,
                    maximumFractionDigits: 0
                });
                var amountDisplay =
                    row.record_type === 'return_money'
                        ? (window.fmtIn ? window.fmtIn(amount) : '<span style="color: green;">' + formattedAmount + '</span>')
                        : (window.fmtOut ? window.fmtOut(amount) : formattedAmount);
                var nameLabel = houseExpenseGetExpenseNameLabel(row);
                /* Headers: description key = IN-CHARGE, receipt_no key = DESCRIPTION (see locales) */
                var inChargeCol =
                    row.record_type === 'return_money' ? '-' : row.DESCRIPTION || row.OIC || '-';
                var receiverCol =
                    row.record_type === 'return_money' ? '-' : row.RECEIVER || '-';
                var descriptionColHtml = row.record_type === 'return_money'
                    ? houseExpenseRemarksCellHtml(row, row.DESCRIPTION || '')
                    : houseExpenseHtmlEscape(houseExpenseItemDescriptionColumnText(row));

                return (
                    '<tr class="js-expense-entry-row" data-expense-id="' +
                    attrEncode(row.expense_id) +
                    '">' +
                    '<td class="expense-item-date-cell">' +
                    houseExpenseHtmlEscape(formattedDate) +
                    '</td>' +
                    '<td>' +
                    buildExpenseNameCell(row, nameLabel) +
                    '</td>' +
                    '<td>' +
                    houseExpenseHtmlEscape(inChargeCol) +
                    '</td>' +
                    '<td>' +
                    houseExpenseHtmlEscape(receiverCol) +
                    '</td>' +
                    '<td>' +
                    descriptionColHtml +
                    '</td>' +
                    '<td class="text-end">' +
                    amountDisplay +
                    '</td>' +
                    '<td class="text-end expense-item-action-cell">' +
                    buildHouseExpenseActionButtons(row, amount) +
                    '</td>' +
                    '</tr>'
                );
            })
            .join('');

        $tbody.html(html);
        syncHouseExpenseItemTableSortHeaders();
        updateHouseExpenseItemFooterTotals(allRows);
        if (typeof window.syncHouseExpenseSelectAllCheckboxState === 'function') {
            window.syncHouseExpenseSelectAllCheckboxState();
        }
    }

    if (shouldAnimate) {
        runHouseExpenseItemTableTransition(paintItemTableBody);
    } else {
        paintItemTableBody();
    }
}

function refreshHouseExpenseExplorerOnly() {
    var rows = window.houseExpenseLastRows || [];
    var te = 0;
    var tr = 0;
    rows.forEach(function (r) {
        if (!r) return;
        var a = Number(r.AMOUNT) || 0;
        if (r.record_type === 'return_money') tr += a;
        else if (houseExpenseIsApprovedForTotals(r)) te += a;
    });
    refreshHouseExpenseDashboard(rows, te, tr);
}

// Helper: encode string for safe use in HTML data attributes (handles newlines, quotes, etc.)
function attrEncode(str) {
    if (str == null || str === '') return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/"/g, '&quot;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/\r\n|\r|\n/g, '&#10;');
}

/** Safe string for inline onclick="fn('...')" handlers */
function houseExpenseJsQuote(str) {
    return String(str == null ? '' : str)
        .replace(/\\/g, '\\\\')
        .replace(/'/g, "\\'")
        .replace(/\r\n|\r|\n/g, '');
}

function getClientTodayYmd() {
    var now = new Date();
    return now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0') + '-' + String(now.getDate()).padStart(2, '0');
}

function hasHouseExpenseSettlementForDate(dateStr) {
    return !!dateStr && (window.settledDatesForMonth || []).indexOf(String(dateStr).slice(0, 10)) !== -1;
}

function getHouseExpenseDefaultSubView(dateStr) {
    if (dateStr === getClientTodayYmd()) return 'open';
    return hasHouseExpenseSettlementForDate(dateStr) ? 'settled' : 'open';
}

function buildExpenseSettlementCheckbox(row, modeClass) {
    var id = row.expense_id || row.IDNo;
    var type = row.record_type === 'return_money' ? 'return_money' : 'expense';
    return '<label class="' + modeClass + '-wrap" title="Select record">' +
        '<input type="checkbox" class="' + modeClass + '" value="' + id + '" data-record-type="' + type + '" />' +
        '</label>';
}

function buildExpenseNameCell(row, label) {
    var checkboxHtml = '';
    var filterMode = getHouseExpenseFilterMode();
    var selectedYmd = String(window.selectedSettlementDate || '').slice(0, 10);
    var isTodaySettledView =
        /^\d{4}-\d{2}-\d{2}$/.test(selectedYmd) &&
        selectedYmd === getClientTodayYmd() &&
        window.selectedSettlementSubView === 'settled';

    if (filterMode === 'settlement' && window.isDailySettleSelectionMode) {
        checkboxHtml = buildExpenseSettlementCheckbox(row, 'daily-settle-checkbox');
    } else if (filterMode === 'settlement' && window.isOpenPoolSelectionMode && isTodaySettledView) {
        checkboxHtml = buildExpenseSettlementCheckbox(row, 'open-pool-checkbox');
    }

    return '<div class="d-inline-flex align-items-center gap-1">' + checkboxHtml + '<span>' + (label || 'N/A') + '</span></div>';
}

function formatHouseExpensePeso(n) {
    var v = Number(n) || 0;
    return '₱' + v.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

function formatHouseExpenseNumber(n) {
    var v = Number(n) || 0;
    return v.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

/** Selected-total KPI line: whole numbers without “.0” (e.g. 100% not 100.0%). */
function formatHouseExpenseKpiPercentOfGrand(pct) {
    if (pct == null || isNaN(pct)) return '—';
    var r = Math.round(pct * 10) / 10;
    if (Math.abs(r - Math.round(r)) < 1e-6) {
        return Math.round(r) + '% of grand total';
    }
    return r.toFixed(1) + '% of grand total';
}

// Eight distinct category colors (no repeat within top 8). Green reserved for Return Money only.
var HOUSE_EXPENSE_ANALYTICS_SOLIDS = [
    { bar: '#3b59ff', text: '#1e3a8a', track: 'rgba(59, 89, 255, 0.14)' },
    { bar: '#f06522', text: '#9a3412', track: 'rgba(240, 101, 34, 0.16)' },
    { bar: '#7c3aed', text: '#4c1d95', track: 'rgba(124, 58, 237, 0.14)' },
    { bar: '#db2777', text: '#831843', track: 'rgba(219, 39, 119, 0.14)' },
    { bar: '#0891b2', text: '#164e63', track: 'rgba(8, 145, 178, 0.14)' },
    { bar: '#ca8a04', text: '#713f12', track: 'rgba(202, 138, 4, 0.15)' },
    { bar: '#4f46e5', text: '#312e81', track: 'rgba(79, 70, 229, 0.14)' },
    { bar: '#b45309', text: '#78350f', track: 'rgba(180, 83, 9, 0.14)' }
];

function houseExpenseAnalyticsSolidAtRow(rowIndex) {
    var i = Math.max(0, parseInt(rowIndex, 10) || 0);
    return HOUSE_EXPENSE_ANALYTICS_SOLIDS[i % HOUSE_EXPENSE_ANALYTICS_SOLIDS.length];
}

function houseExpenseAnalyticsReturnMoneySolid() {
    return {
        bar: '#109d59',
        text: '#065f46',
        track: 'rgba(16, 157, 89, 0.14)'
    };
}

function houseExpenseEditLogCount(row) {
    if (row.record_type === 'return_money') return 0;
    var n = row.EDIT_LOG_COUNT != null ? row.EDIT_LOG_COUNT : row.edit_log_count;
    return parseInt(n, 10) || 0;
}

function houseExpenseHtmlEscape(s) {
    if (s == null) return '';
    return String(s)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function houseExpenseCatCountBadgeHtml(count) {
    var n = Number(count) || 0;
    var wideClass = n >= 10 ? ' is-wide' : '';
    return '<span class="expense-cat-count' + wideClass + '">' + n + '</span>';
}

function houseExpenseCanManageCategories() {
    return !(
        window.PermissionViewOnly &&
        window.PermissionViewOnly.isViewOnly &&
        window.PermissionViewOnly.isViewOnly()
    );
}

function houseExpenseFindCategoryRow(catId) {
    return (window.houseExpenseCategoryRows || []).find(function (c) {
        return c && String(c.IDNo) === String(catId);
    });
}

/** True for main vehicle/car category names. */
function houseExpenseIsVehicleMainCategoryName(name) {
    var n = String(name || '').trim().toUpperCase();
    return n === 'CAR' || n === 'VEHICLE' || n === 'VEHICLES';
}

/** True when category is a sub-category under Car / Vehicle. */
function houseExpenseIsCarSubCategoryId(categoryId) {
    if (categoryId == null || categoryId === '') return false;
    var row = houseExpenseFindCategoryRow(categoryId);
    if (!row || row.PARENT_ID == null || row.PARENT_ID === '') return false;
    var parent = houseExpenseFindCategoryRow(row.PARENT_ID);
    if (!parent) return false;
    return houseExpenseIsVehicleMainCategoryName(parent.CATEGORY);
}

function houseExpenseIsEmployeeSubCategory(categoryId) {
    var row = houseExpenseFindCategoryRow(categoryId);
    if (!row) return false;
    var n = String(row.CATEGORY || '').trim().toUpperCase();
    return n === 'EMPLOYEE' || n === 'EMPLOYEES' || n.indexOf('EMPLOYEE') >= 0;
}

function houseExpenseCarSubCategoryShowsVehicleFields(categoryId) {
    return houseExpenseIsCarSubCategoryId(categoryId) && !houseExpenseIsEmployeeSubCategory(categoryId);
}

function houseExpenseUsesVehicleExpenseFormLayout(categoryId) {
    return houseExpenseIsCarSubCategoryId(categoryId);
}

function houseExpenseFormatCategoryBreadcrumb(categoryId) {
    var st = window.houseExpenseExplorerState || {};
    var label = houseExpenseGetExplorerSubtitleText(st);
    if (!label) {
        var row = houseExpenseFindCategoryRow(categoryId);
        if (row && row.PARENT_ID) {
            var parent = houseExpenseFindCategoryRow(row.PARENT_ID);
            var main = parent ? String(parent.CATEGORY || '').trim() : '';
            var sub = String(row.CATEGORY || '').trim();
            label = main && sub ? main + ' > ' + sub : sub || main;
        } else {
            label = row ? row.CATEGORY || '' : '';
        }
    } else {
        label = String(label).replace(/\s*›\s*/g, ' > ');
    }
    return label || '—';
}

function houseExpenseIsNewExpenseCategoryLocked() {
    return $('#house-expense-new-expense-category-id').attr('name') === 'txtCategory';
}

function houseExpenseApplyNewExpenseFormFormat(categoryId) {
    var useLockedItemFormat = houseExpenseIsNewExpenseCategoryLocked();
    var showVehicleFields = houseExpenseCarSubCategoryShowsVehicleFields(categoryId);
    var $form = $('#add_junket_house_expense');
    var $footer = $form.find('.modal-footer');
    var rowMap = {
        preset: '#house-expense-new-cat-preset-wrap',
        select: '#house-expense-new-cat-select-wrap',
        photo: '#house-expense-new-row-receipt-photo',
        vehicle: '#house-expense-vehicle-wrap',
        km: '#house-expense-new-km-l-wrap',
        receiptNo: '#house-expense-new-row-receipt-no',
        officer: '#house-expense-new-row-officer-receiver',
        amount: '#house-expense-new-row-amount'
    };
    var order;

    if (useLockedItemFormat) {
        order = ['preset', 'officer'];
        if (showVehicleFields) order.push('vehicle', 'km');
        order.push('amount', 'receiptNo', 'photo');
    } else {
        order = ['preset', 'select', 'photo', 'vehicle', 'km', 'receiptNo', 'officer', 'amount'];
    }

    if ($form.length && $footer.length) {
        order.forEach(function (key) {
            var $row = $(rowMap[key]);
            if ($row.length) $row.insertBefore($footer);
        });
    }

    var $descLabel = $('#house-expense-new-description-label');
    var $recvLabel = $('#house-expense-new-receiver-label');
    var $receiptLabel = $('#house-expense-new-receipt-no-label');
    var $vehicleLabel = $('#house-expense-new-vehicle-label');
    var $kmLabel = $('#house-expense-new-km-label');

    if ($descLabel.length && !$descLabel.data('default-text')) {
        $descLabel.data('default-text', $.trim($descLabel.text()));
        $recvLabel.data('default-text', $.trim($recvLabel.text()));
        $receiptLabel.data('default-text', $.trim($receiptLabel.text()));
        $vehicleLabel.data('default-text', $.trim($vehicleLabel.text()));
        $kmLabel.data('default-text', $.trim($kmLabel.text()));
    }

    if (useLockedItemFormat) {
        $descLabel.text('Approved By');
        $recvLabel.text('Received By');
        $receiptLabel.text('Description');
        if (showVehicleFields) {
            $vehicleLabel.text('Vehicle Type');
            $kmLabel.text('ODO (Odometer)');
        } else {
            $vehicleLabel.text($vehicleLabel.data('default-text') || 'Vehicle');
            $kmLabel.text($kmLabel.data('default-text') || 'KM');
        }
    } else {
        $descLabel.text($descLabel.data('default-text') || 'Description');
        $recvLabel.text($recvLabel.data('default-text') || 'Receiver');
        $receiptLabel.text($receiptLabel.data('default-text') || 'Receipt No');
        $vehicleLabel.text($vehicleLabel.data('default-text') || 'Vehicle');
        $kmLabel.text($kmLabel.data('default-text') || 'KM');
    }
}

/** Show Vehicle + ODO fields for Car sub-categories except Employees. */
function houseExpenseToggleCarExpenseFields(categoryId) {
    var showVehicleFields = houseExpenseCarSubCategoryShowsVehicleFields(categoryId);
    var $vehicleWrap = $('#house-expense-vehicle-wrap');
    var $newKmWrap = $('#house-expense-new-km-l-wrap');
    var $editVehicleWrap = $('#house-expense-edit-vehicle-wrap');
    var $editKmWrap = $('#house-expense-edit-km-l-wrap');

    houseExpenseApplyNewExpenseFormFormat(categoryId);

    if ($vehicleWrap.length) {
        if (showVehicleFields) {
            $vehicleWrap.removeClass('d-none');
            houseExpensePopulateVehicleSelects($('#txtVehicleId').val() || '');
        } else {
            $vehicleWrap.addClass('d-none');
            $('#txtVehicleId').val('');
        }
    }
    if ($newKmWrap.length) {
        if (showVehicleFields) $newKmWrap.removeClass('d-none');
        else {
            $newKmWrap.addClass('d-none');
            $('#txtKmL').val('');
        }
    }
    if ($editVehicleWrap.length) {
        if (showVehicleFields) $editVehicleWrap.removeClass('d-none');
        else {
            $editVehicleWrap.addClass('d-none');
            $('#editTxtVehicleId').val('');
        }
    }
    if ($editKmWrap.length) {
        if (showVehicleFields) $editKmWrap.removeClass('d-none');
        else {
            $editKmWrap.addClass('d-none');
            $('#editTxtKmL').val('');
        }
    }
}

function houseExpenseIsCarMainCategorySelected(st) {
    st = st || window.houseExpenseExplorerState || {};
    var name = st.mainCategory || '';
    if (!name && st.mainCategoryId) {
        var row = houseExpenseFindCategoryRow(st.mainCategoryId);
        name = row ? row.CATEGORY || '' : '';
    }
    return houseExpenseIsVehicleMainCategoryName(name);
}

function houseExpenseFormatVehicleOptionLabel(v) {
    if (!v) return '';
    var plate = v.PLATE_NO != null ? String(v.PLATE_NO).trim() : '';
    var model = v.MODEL != null ? String(v.MODEL).trim() : '';
    if (model && plate) return model + ' ' + plate;
    return model || plate || '';
}

function houseExpenseFormatVehicleLabel(row) {
    if (!row) return '';
    var plate = row.vehicle_plate != null ? String(row.vehicle_plate).trim() : '';
    var model = row.vehicle_model != null ? String(row.vehicle_model).trim() : '';
    if (!plate) return '';
    return model ? plate + ' — ' + model : plate;
}

function houseExpenseGetExpenseNameLabel(row) {
    var label =
        row.record_type === 'return_money' ? 'Return Money' : row.expense_category || 'N/A';
    var vehicleLabel = houseExpenseFormatVehicleLabel(row);
    if (vehicleLabel && row.record_type !== 'return_money') {
        label = label + ' · ' + vehicleLabel;
    }
    return label;
}

function houseExpenseSyncVehicleBtnVisibility() {
    var $btn = $('.js-house-expense-open-vehicle-modal');
    if (!$btn.length) return;
    if (houseExpenseIsCarMainCategorySelected()) $btn.removeClass('d-none');
    else $btn.addClass('d-none');
}

function houseExpenseVehicleRowEndHtml(vehicleId) {
    if (!vehicleId || !houseExpenseCanManageCategories()) {
        return '<div class="expense-cat-item-end"></div>';
    }
    return (
        '<div class="expense-cat-item-end">' +
        '<div class="expense-cat-actions" role="group" aria-label="Vehicle actions">' +
        '<button type="button" class="expense-cat-action-btn js-house-expense-edit-vehicle" data-vehicle-id="' +
        attrEncode(String(vehicleId)) +
        '" title="Edit" aria-label="Edit"><i class="fa fa-pencil-alt" aria-hidden="true"></i></button>' +
        '<button type="button" class="expense-cat-action-btn js-house-expense-delete-vehicle" data-vehicle-id="' +
        attrEncode(String(vehicleId)) +
        '" title="Delete" aria-label="Delete"><i class="fa fa-trash-alt" aria-hidden="true"></i></button>' +
        '</div></div>'
    );
}

function renderHouseExpenseVehicleList() {
    var t = window.houseExpenseTranslations || {};
    var $list = $('#house-expense-manage-vehicle-list');
    if (!$list.length) return;
    var rows = window.houseExpenseVehicleRows || [];
    if (!rows.length) {
        $list.html('<div class="text-muted small p-3">' + houseExpenseHtmlEscape(t.no_vehicles || 'No vehicles') + '</div>');
        return;
    }
    var html = rows
        .map(function (v) {
            var id = String(v.IDNo);
            var label = houseExpenseFormatVehicleOptionLabel(v);
            return (
                '<div class="expense-cat-item js-expense-vehicle-row" data-vehicle-id="' +
                attrEncode(id) +
                '">' +
                '<span class="expense-cat-name" title="' +
                attrEncode(label) +
                '">' +
                houseExpenseHtmlEscape(label) +
                '</span>' +
                houseExpenseVehicleRowEndHtml(id) +
                '</div>'
            );
        })
        .join('');
    $list.html(html);
}

function openHouseExpenseManageVehicleModal() {
    renderHouseExpenseVehicleList();
    houseExpenseShowCategoryModal($('#modal-house-expense-manage-vehicles'));
}

function reloadHouseExpenseVehicleCatalog(afterLoad) {
    return $.ajax({
        url: '/house_expense_vehicle_data',
        method: 'GET',
        success: function (response) {
            window.houseExpenseVehicleRows = (response || []).slice();
            houseExpensePopulateVehicleSelects();
            renderHouseExpenseVehicleList();
            houseExpenseSyncVehicleBtnVisibility();
            if (typeof afterLoad === 'function') afterLoad(response);
        },
        error: function () {
            if (typeof afterLoad === 'function') afterLoad(null);
        }
    });
}

function houseExpensePopulateVehicleSelects(selectedId) {
    var t = window.houseExpenseTranslations || {};
    var placeholder = t.select_vehicle || '-- Select vehicle --';
    var rows = window.houseExpenseVehicleRows || [];
    var $selects = $('#txtVehicleId, #editTxtVehicleId');
    $selects.each(function () {
        var $sel = $(this);
        var current =
            selectedId != null && String(selectedId).trim() !== ''
                ? String(selectedId)
                : String($sel.val() || '');
        $sel.empty();
        $sel.append($('<option>', { value: '', text: placeholder }));
        rows.forEach(function (v) {
            var id = String(v.IDNo);
            $sel.append(
                $('<option>', {
                    value: id,
                    text: houseExpenseFormatVehicleOptionLabel(v),
                    selected: id === current
                })
            );
        });
        if (current) $sel.val(current);
    });
}

/** @deprecated use houseExpenseToggleCarExpenseFields */
function houseExpenseToggleKmPerLField(categoryId) {
    houseExpenseToggleCarExpenseFields(categoryId);
}

function houseExpenseGetNewExpenseCategoryId() {
    var hiddenVal = $('#house-expense-new-expense-category-id').val();
    if (hiddenVal != null && String(hiddenVal).trim() !== '') return String(hiddenVal);
    var selectVal = $('#expense-category-select').val();
    return selectVal != null && String(selectVal).trim() !== '' ? String(selectVal) : null;
}

function houseExpenseCatRowEndHtml(count, catId, kind) {
    var html =
        '<div class="expense-cat-item-end">' + houseExpenseCatCountBadgeHtml(count);
    if (catId && kind && houseExpenseCanManageCategories()) {
        html +=
            '<div class="expense-cat-actions" role="group" aria-label="Category actions">' +
            '<button type="button" class="expense-cat-action-btn js-house-expense-edit-cat" data-cat-kind="' +
            attrEncode(kind) +
            '" data-cat-id="' +
            attrEncode(String(catId)) +
            '" title="Edit" aria-label="Edit">' +
            '<i class="fa fa-pencil-alt" aria-hidden="true"></i></button>' +
            '<button type="button" class="expense-cat-action-btn js-house-expense-delete-cat" data-cat-kind="' +
            attrEncode(kind) +
            '" data-cat-id="' +
            attrEncode(String(catId)) +
            '" title="Delete" aria-label="Delete">' +
            '<i class="fa fa-trash-alt" aria-hidden="true"></i></button>' +
            '</div>';
    }
    html += '</div>';
    return html;
}

/** Amount line in edit log: show number only (no ₱) in the modal. */
function houseExpenseEditLogValueForDisplay(label, value) {
    if (value == null) return '';
    var v = String(value);
    if (/^amount$/i.test(String(label || '').trim())) {
        v = v.replace(/^\s*\u20B1\s*/, '').trim();
    }
    return v;
}

/** Parses CHANGES_TEXT into rows; drops Edited by/Date lines (shown in card header). */
function houseExpenseRenderEditLogFieldRows(changesText) {
    var lines = String(changesText || '').split(/\r\n|\r|\n/);
    var rows = [];
    for (var i = 0; i < lines.length; i++) {
        var trimmed = lines[i].trim();
        if (!trimmed) continue;
        if (/^edited by\s*:/i.test(trimmed)) continue;
        if (/^date\s*:/i.test(trimmed)) continue;
        var colon = trimmed.indexOf(':');
        if (colon > 0) {
            rows.push({
                label: trimmed.slice(0, colon).trim(),
                value: trimmed.slice(colon + 1).trim()
            });
        } else {
            rows.push({ label: '', value: trimmed });
        }
    }
    if (rows.length === 0) {
        return '<p class="text-muted small mb-0 py-3 px-3">—</p>';
    }
    var out = [];
    for (var j = 0; j < rows.length; j++) {
        var r = rows[j];
        if (r.label) {
            var displayVal = houseExpenseEditLogValueForDisplay(r.label, r.value);
            out.push(
                '<div class="row g-0 house-expense-history-row border-bottom border-light mx-0">' +
                    '<div class="col-12 col-sm-4 py-2 px-3 align-self-start house-expense-history-label">' +
                    houseExpenseHtmlEscape(r.label) +
                    '</div>' +
                    '<div class="col-12 col-sm-8 py-2 px-3 house-expense-history-value">' +
                    houseExpenseHtmlEscape(displayVal) +
                    '</div>' +
                    '</div>'
            );
        } else {
            out.push(
                '<div class="py-2 px-3 small text-secondary border-bottom border-light">' +
                    houseExpenseHtmlEscape(r.value) +
                    '</div>'
            );
        }
    }
    return '<div class="house-expense-history-fields bg-white rounded-bottom">' + out.join('') + '</div>';
}

window.showHouseExpenseEditHistory = function (expenseId) {
    var t = window.houseExpenseTranslations || {};
    var editorLbl = t.edit_history_editor || 'Edited by';
    $.getJSON('/junket_house_expense/' + expenseId + '/edit_log')
        .done(function (entries) {
            var $body = $('#house-expense-edit-history-body');
            if (!entries || entries.length === 0) {
                $body.html(
                    '<div class="text-center py-5 text-muted"><i class="fa fa-inbox fa-2x mb-3 opacity-50"></i><p class="mb-0">' +
                        houseExpenseHtmlEscape(t.edit_history_empty || 'No edit history.') +
                        '</p></div>'
                );
            } else {
                var html = entries
                    .map(function (e) {
                        var dt = e.EDITED_DT != null ? e.EDITED_DT : e.edited_dt;
                        var name =
                            e.edited_by_name != null
                                ? e.edited_by_name
                                : e.EDITED_BY != null
                                  ? 'User ' + e.EDITED_BY
                                  : '—';
                        var text = String(e.CHANGES_TEXT != null ? e.CHANGES_TEXT : e.changes_text || '');
                        var dtStr = dt ? moment(dt).format('DD MMM YYYY, HH:mm:ss') : '—';
                        return (
                            '<div class="house-expense-history-card card border-0 shadow-sm mb-3 bg-white">' +
                                '<div class="house-expense-history-card-head px-3 py-3">' +
                                '<div class="fs-6 fw-semibold text-dark">' +
                                houseExpenseHtmlEscape(dtStr) +
                                '</div>' +
                                '<div class="small text-muted mt-1">' +
                                '<span class="text-secondary">' +
                                houseExpenseHtmlEscape(editorLbl) +
                                '</span>' +
                                ' <span class="mx-1">·</span> ' +
                                '<span class="text-dark fw-medium">' +
                                houseExpenseHtmlEscape(name) +
                                '</span>' +
                                '</div>' +
                                '</div>' +
                                houseExpenseRenderEditLogFieldRows(text) +
                                '</div>'
                        );
                    })
                    .join('');
                $body.html(html);
            }
            var $modal = $('#modal-house-expense-edit-history');
            if ($modal.length) {
                $modal.appendTo('body');
                $modal.modal('show');
            }
        })
        .fail(function () {
            if (window.Swal) {
                Swal.fire(t.error || 'Error', t.edit_history_error || 'Could not load edit history.', 'error');
            } else {
                alert(t.edit_history_error || 'Could not load edit history.');
            }
        });
};

/** Updates expense, return money, and net (expense − return) footer amounts. */
function setHouseExpenseFooterTotals(totalExpense, totalReturnMoney) {
    var te = Number(totalExpense) || 0;
    var tr = Number(totalReturnMoney) || 0;
    $('#TOTAL_EXPENSE_AMOUNT').text(formatHouseExpensePeso(te));
    $('#TOTAL_RETURN_MONEY_AMOUNT').text(formatHouseExpensePeso(tr));
    $('#TOTAL_NET_EXPENSES_AMOUNT').text(formatHouseExpensePeso(te - tr));
}

function houseExpenseApplyLoadedData(data) {
    var rows = data || [];
    var total_expense = 0;
    var total_return_money = 0;
    rows.forEach(function (row) {
        var amount = parseFloat(row.AMOUNT) || 0;
        if (row && row.record_type === 'return_money') total_return_money += amount;
        else if (houseExpenseIsApprovedForTotals(row)) total_expense += amount;
    });
    window.houseExpenseLastRows = rows;
    renderHouseExpenseAnalytics(rows, total_expense, total_return_money);
    houseExpenseReconcileExplorerState();
    if (typeof window.updateSettleButtonState === 'function') {
        window.updateSettleButtonState(rows.length);
    }
    if (typeof window.syncHouseExpenseSelectAllCheckboxState === 'function') {
        window.syncHouseExpenseSelectAllCheckboxState();
    }
}

/** Keep main/sub selection after reload; only clear if category no longer exists */
function houseExpenseReconcileExplorerState() {
    var st = window.houseExpenseExplorerState || {};
    var catRows = window.houseExpenseCategoryRows || [];
    if (!st.mainCategoryId) return;

    var mainRow = catRows.find(function (c) {
        return c && String(c.IDNo) === String(st.mainCategoryId);
    });
    var mainValid = mainRow && houseExpenseIsMainCategoryRow(mainRow);
    if (!mainValid) {
        resetHouseExpenseExplorerState();
        refreshHouseExpenseExplorerOnly();
        return;
    }

    st.mainCategory = mainRow.CATEGORY || st.mainCategory;
    var subCleared = false;
    if (st.itemCategoryId) {
        var subRow = catRows.find(function (c) {
            return c && String(c.IDNo) === String(st.itemCategoryId);
        });
        if (!subRow || String(subRow.PARENT_ID) !== String(st.mainCategoryId)) {
            st.itemCategoryId = null;
            st.itemCategory = null;
            subCleared = true;
        } else {
            st.itemCategory = subRow.CATEGORY || st.itemCategory;
        }
    }
    window.houseExpenseExplorerState = st;
    if (subCleared) refreshHouseExpenseExplorerOnly();
}

function renderHouseExpenseGraphRaceBarsHtml(entries, opts) {
    opts = opts || {};
    var pctBase = opts.percentBase || 0;
    var clickable = !!opts.clickableCategory;
    if (!entries || entries.length === 0) {
        return '<div class="text-muted small py-2">No breakdown data.</div>';
    }
    return entries
        .map(function (entry, rowIdx) {
            var pal = houseExpenseAnalyticsSolidAtRow(rowIdx);
            // Bar width = share of grand total (same as the % label), not vs. largest category
            var shareOfTotal = pctBase > 0 ? (entry.amount / pctBase) * 100 : 0;
            var barPct = Math.min(100, Math.max(0, shareOfTotal));
            var shareText = shareOfTotal.toFixed(1) + '%';
            var rowCls = clickable ? 'expense-graph-race-row js-expense-graph-cat-open' : 'expense-graph-race-row';
            var dataCat = clickable ? ' data-category="' + attrEncode(entry.name) + '"' : '';
            return (
                '<div class="' +
                rowCls +
                '"' +
                dataCat +
                '>' +
                '<div class="expense-graph-race-label-cell">' +
                '<span class="expense-graph-race-dot" style="background-color:' +
                pal.bar +
                '"></span>' +
                '<span class="expense-graph-race-label" title="' +
                attrEncode(entry.name) +
                '">' +
                houseExpenseHtmlEscape(entry.name) +
                '</span>' +
                '</div>' +
                '<div class="expense-graph-race-bar-cell">' +
                '<div class="expense-graph-race-track" style="background:' +
                pal.track +
                '">' +
                '<div class="expense-graph-race-fill" style="width:' +
                barPct.toFixed(2) +
                '%;background:' +
                pal.bar +
                ';"></div>' +
                '</div>' +
                '</div>' +
                '<div class="expense-graph-race-value-cell">' +
                '<span class="expense-graph-race-peso">' +
                formatHouseExpensePeso(entry.amount) +
                '</span>' +
                '<span class="expense-graph-race-pct" style="color:' +
                pal.bar +
                '">(' +
                shareText +
                ')</span>' +
                '</div>' +
                '</div>'
            );
        })
        .join('');
}

function renderHouseExpenseGraphReturnMoneyRowHtml(amount) {
    var a = Number(amount) || 0;
    return (
        '<div class="expense-graph-race-return js-expense-graph-cat-open" data-category="Return Money" title="View return money entries">' +
        '<div class="expense-graph-race-return-inner">' +
        '<span class="expense-graph-race-return-icon" aria-hidden="true"><i class="fa fa-undo"></i></span>' +
        '<div class="expense-graph-race-return-body">' +
        '<div class="expense-graph-race-return-head">' +
        '<span class="expense-graph-race-return-label">Return money</span>' +
        '<span class="expense-graph-race-return-amt">' +
        formatHouseExpensePeso(a) +
        '</span>' +
        '</div>' +
        '</div>' +
        '</div>' +
        '</div>'
    );
}

function renderHouseExpenseGraphRaceBodyFromState(data, totalExpense, totalReturnMoney) {
    var mode = getHouseExpenseFilterMode();
    var $body = $('#expense-graph-race-body');
    var $sub = $('#expense-graph-subtitle');
    if (!$body.length) return;

    if (mode !== 'daterange') {
        $body.empty();
        if ($sub.length) $sub.text('By category');
        return;
    }

    var te = Number(totalExpense) || 0;
    var tr = Number(totalReturnMoney) || 0;
    var expenseRows = (data || []).filter(function (row) {
        return row && row.record_type !== 'return_money';
    });

    if (expenseRows.length === 0) {
        if ($sub.length) $sub.text('By category');
        if (tr > 0) {
            $body.html(renderHouseExpenseGraphReturnMoneyRowHtml(tr));
        } else {
            $body.html('<div class="text-muted small py-2">No expense data yet.</div>');
        }
        return;
    }

    if ($sub.length) $sub.text('By category');

    var byCategory = {};
    expenseRows.forEach(function (row) {
        var amount = Number(row.AMOUNT) || 0;
        var category = row.expense_category || 'Uncategorized';
        byCategory[category] = (byCategory[category] || 0) + amount;
    });
    var categoryEntries = Object.keys(byCategory)
        .map(function (key) {
            return { name: key, amount: byCategory[key] };
        })
        .sort(function (a, b) {
            return b.amount - a.amount;
        })
        .slice(0, 8);

    var percentageBase = te > 0 ? te : 0;
    var mainHtml = renderHouseExpenseGraphRaceBarsHtml(categoryEntries, {
        percentBase: percentageBase,
        clickableCategory: true
    });
    $body.html(mainHtml + renderHouseExpenseGraphReturnMoneyRowHtml(tr));
}

function renderHouseExpenseCategoryLists(data) {
    var st = window.houseExpenseExplorerState || {};
    var expenseRows = (data || []).filter(function (r) {
        return r && r.record_type !== 'return_money';
    });
    var stats = houseExpenseBuildCategoryStats(expenseRows);
    var $mainList = $('#expense-main-cat-list');

    if (!$mainList.length) return;

    var mainRows = getHouseExpenseMainCategoryRows(expenseRows);

    mainRows.sort(function (a, b) {
        var sa = stats[String(a.IDNo)] ? stats[String(a.IDNo)].sum : 0;
        var sb = stats[String(b.IDNo)] ? stats[String(b.IDNo)].sum : 0;
        if (sb !== sa) return sb - sa;
        return String(a.CATEGORY || '').localeCompare(String(b.CATEGORY || ''), undefined, { sensitivity: 'base' });
    });

    st = window.houseExpenseExplorerState || {};

    if (mainRows.length === 0) {
        $mainList.html('<div class="text-muted small p-2">No main categories</div>');
        renderHouseExpenseSubCategoryList(data || []);
        renderHouseExpenseItemEntriesTable(data || []);
        return;
    }

    var mainHtml = [];
    var allLabel = (window.houseExpenseTranslations && window.houseExpenseTranslations.filter_all) || 'All';
    var allCount = (data || []).length;
    var isAllActive = houseExpenseIsAllExplorerFilter(st);

    mainHtml.push(
        '<div class="expense-cat-item js-expense-main-cat-row js-expense-main-cat-all' +
            (isAllActive ? ' is-active' : '') +
            '" data-main-id="" data-main-name="' +
            attrEncode(allLabel) +
            '">' +
            '<span class="expense-cat-name" title="' +
            attrEncode(allLabel) +
            '">' +
            houseExpenseHtmlEscape(allLabel) +
            '</span>' +
            houseExpenseCatRowEndHtml(allCount, '', 'main') +
            '</div>'
    );

    mainRows.forEach(function (main) {
        var mainId = String(main.IDNo);
        var childIds = houseExpenseGetCategoryIdsUnderMain(mainId);
        var itemCount = 0;
        childIds.forEach(function (cid) {
            var s = stats[cid];
            if (s) itemCount += s.count;
        });

        var active = st.mainCategoryId && String(st.mainCategoryId) === mainId ? ' is-active' : '';
        mainHtml.push(
            '<div class="expense-cat-item js-expense-main-cat-row' +
                active +
                '" data-main-id="' +
                attrEncode(mainId) +
                '" data-main-name="' +
                attrEncode(main.CATEGORY || '') +
                '">' +
                '<span class="expense-cat-name" title="' +
                attrEncode(main.CATEGORY || '') +
                '">' +
                houseExpenseHtmlEscape(main.CATEGORY || '') +
                '</span>' +
                houseExpenseCatRowEndHtml(itemCount, mainId, 'main') +
                '</div>'
        );
    });

    $mainList.html(mainHtml.join(''));

    renderHouseExpenseSubCategoryList(data);
    houseExpenseSyncCategoryAddButtons();
    renderHouseExpenseItemEntriesTable(data || [], {
        animate: !!window.houseExpenseAnimateItemTable
    });
    window.houseExpenseAnimateItemTable = false;
}

function renderHouseExpenseSubCategoryList(data) {
    var $list = $('#expense-sub-cat-list');
    if (!$list.length) return;

    var st = window.houseExpenseExplorerState || {};
    var expenseRows = (data || []).filter(function (r) {
        return r && r.record_type !== 'return_money';
    });
    var stats = houseExpenseBuildCategoryStats(expenseRows);

    if (houseExpenseIsAllExplorerFilter(st)) {
        var allSubLabel =
            (window.houseExpenseTranslations && window.houseExpenseTranslations.filter_all_categories) ||
            'All categories';
        $list.html('<div class="text-muted small p-2">' + houseExpenseHtmlEscape(allSubLabel) + '</div>');
        return;
    }

    if (!st.mainCategoryId) {
        $list.html('<div class="text-muted small p-2">Select a main category</div>');
        return;
    }

    var mainId = String(st.mainCategoryId);

    var subRows = getHouseExpenseSubCategoryRows(mainId);
    if (!subRows.length) {
        $list.html('<div class="text-muted small p-2">No sub categories for this main</div>');
        return;
    }

    var html = [];

    subRows.forEach(function (sub) {
        var subId = String(sub.IDNo);
        var s = stats[subId] || { count: 0 };
        var active = st.itemCategoryId && String(st.itemCategoryId) === subId ? ' is-active' : '';
        html.push(
            '<div class="expense-cat-item js-expense-sub-cat-row' +
                active +
                '" data-sub-id="' +
                attrEncode(subId) +
                '" data-sub-name="' +
                attrEncode(sub.CATEGORY || '') +
                '">' +
                '<span class="expense-cat-name" title="' +
                attrEncode(sub.CATEGORY || '') +
                '">' +
                houseExpenseHtmlEscape(sub.CATEGORY || '') +
                '</span>' +
                houseExpenseCatRowEndHtml(s.count, subId, 'sub') +
                '</div>'
        );
    });

    $list.html(html.join(''));
    houseExpenseSyncVehicleBtnVisibility();
}

function refreshHouseExpenseDashboard(data, totalExpense, totalReturnMoney) {
    var te = Number(totalExpense) || 0;
    var st = window.houseExpenseExplorerState || {};

    $('#expense-kpi-grand-amount').text(formatHouseExpensePeso(te));
    $('#expense-kpi-grand-range').text(getHouseExpenseGrandDateLabel());

    var selected = houseExpenseSumExpenseRows(data, function (r) {
        return houseExpenseRowMatchesExplorer(r) && houseExpenseIsApprovedForTotals(r);
    });

    $('#expense-kpi-selected-amount').text(formatHouseExpensePeso(selected));

    var pctGrand = te > 0 ? (selected / te) * 100 : null;
    $('#expense-kpi-pct-grand').text(formatHouseExpenseKpiPercentOfGrand(pctGrand));

    renderHouseExpenseCategoryLists(data);
    renderHouseExpenseGraphRaceBodyFromState(data, te, totalReturnMoney);
    applyHouseExpenseExplorerDataTableFilter();
}

function renderHouseExpenseAnalytics(data, totalExpense, totalReturnMoney) {
    refreshHouseExpenseDashboard(data, totalExpense, totalReturnMoney);
}

function toggleHouseExpenseBreakdownPanel(mode) {
    mode = mode || getHouseExpenseFilterMode();
    var isRange = mode === 'daterange';
    var rangeReady = isRange && hasHouseExpenseDateRangeComplete();
    var $g = $('#expense-graph-race-column');
    var $stack = $('#expense-kpi-stack-col');
    var $dash = $('#house-expense-dashboard');
    var $catCol = $('.expense-explorer-main-col, .expense-explorer-sub-col, .expense-explorer-item-col');
    var $explorerRow = $('.expense-explorer-row');
    if (!$g.length) return;
    if (rangeReady) {
        if ($dash.length) $dash.removeClass('d-none');
        $catCol.removeClass('d-none');
        if ($explorerRow.length) $explorerRow.removeClass('d-none');
        $g.removeClass('d-none').addClass('d-flex align-items-stretch');
        if ($stack.length) {
            $stack.removeClass('col-12').addClass('col-lg-5 col-xl-4');
        }
        $('#expense-kpi-col-grand, #expense-kpi-col-selected').removeClass('col-md-6');
    } else {
        if ($dash.length) $dash.addClass('d-none');
        $catCol.removeClass('d-none');
        if ($explorerRow.length) $explorerRow.removeClass('d-none');
        $g.addClass('d-none').removeClass('d-flex align-items-stretch');
        if ($stack.length) {
            $stack.removeClass('col-lg-5 col-xl-4').addClass('col-12');
        }
        $('#expense-kpi-col-grand, #expense-kpi-col-selected').addClass('col-md-6');
        $('#expense-graph-race-body').empty();
        $('#expense-graph-subtitle').text('By category');
        resetHouseExpenseExplorerState();
        if (window.houseExpenseLastRows && window.houseExpenseLastRows.length) {
            refreshHouseExpenseExplorerOnly();
        } else if (typeof applyHouseExpenseExplorerDataTableFilter === 'function') {
            applyHouseExpenseExplorerDataTableFilter();
        }
    }
}

function houseExpenseFindCategoryRowByName(categoryName) {
    var name = String(categoryName || '').trim();
    if (!name) return null;
    return (
        (window.houseExpenseCategoryRows || []).find(function (c) {
            return c && String(c.CATEGORY || '').trim() === name;
        }) || null
    );
}

/** True for Car main category or any sub-category under Car (Fuel, PMS, etc.). */
function houseExpenseIsCarBreakdownCategory(categoryName) {
    var name = String(categoryName || '').trim();
    if (!name || name === 'Return Money') return false;
    if (houseExpenseIsVehicleMainCategoryName(name)) return true;
    var row = houseExpenseFindCategoryRowByName(name);
    if (!row) return false;
    if (houseExpenseIsMainCategoryRow(row)) {
        return houseExpenseIsVehicleMainCategoryName(name);
    }
    return houseExpenseIsCarSubCategoryId(row.IDNo);
}

function houseExpenseBreakdownColumnCount(showVehicleColumns) {
    return showVehicleColumns ? 7 : 5;
}

function setHouseExpenseBreakdownVehicleColumnsVisible(show) {
    var visible = !!show;
    var state = window.houseExpenseBreakdownState || {};
    state.showVehicleColumns = visible;
    window.houseExpenseBreakdownState = state;
    $('.js-breakdown-vehicle-col').toggleClass('d-none', !visible);
    $('#breakdown-modal-foot-grand-label').attr('colspan', visible ? 4 : 2);
}

function houseExpenseBreakdownVehiclePlateText(row) {
    if (!row || row.record_type === 'return_money') return '-';
    var plate = row.vehicle_plate != null ? String(row.vehicle_plate).trim() : '';
    return plate || '-';
}

function houseExpenseBreakdownVehicleModelText(row) {
    if (!row || row.record_type === 'return_money') return '-';
    var model = row.vehicle_model != null ? String(row.vehicle_model).trim() : '';
    return model || '-';
}

function showExpenseBreakdownModalByCategory(categoryName) {
    var category = String(categoryName || '').trim();
    if (!category) return;

    var rows = (window.houseExpenseLastRows || []).filter(function (row) {
        if (!row) return false;
        if (category === 'Return Money') {
            return row.record_type === 'return_money';
        }
        return row.record_type !== 'return_money' && String(row.expense_category || '').trim() === category;
    });

    $('#breakdown-modal-category-name').text(category);

    var showVehicleColumns = houseExpenseIsCarBreakdownCategory(category);
    setHouseExpenseBreakdownVehicleColumnsVisible(showVehicleColumns);
    var colCount = houseExpenseBreakdownColumnCount(showVehicleColumns);

    if (rows.length === 0) {
        $('#breakdown-modal-tbody').html(
            '<tr><td colspan="' +
                colCount +
                '" class="text-center text-muted py-3">No entries found.</td></tr>'
        );
        $('#breakdown-modal-grand-total').text(formatHouseExpenseNumber(0));
    } else {
        window.houseExpenseBreakdownState.rows = rows.slice();
        window.houseExpenseBreakdownState.sortKey = 'date_time';
        window.houseExpenseBreakdownState.sortDir = 'desc';
        renderExpenseBreakdownModalRows();
    }

    var $breakdownModal = $('#modal-expense-breakdown-details');
    if ($breakdownModal.length) {
        $breakdownModal.appendTo('body');
        $breakdownModal.modal('show');
    }
}

function getBreakdownSortValue(row, key) {
    if (!row) return '';
    if (key === 'amount') return Number(row.AMOUNT) || 0;
    if (key === 'description') {
        return String(houseExpenseItemDescriptionColumnText(row) || '').toLowerCase();
    }
    if (key === 'plate_no') return String(houseExpenseBreakdownVehiclePlateText(row) || '').toLowerCase();
    if (key === 'model') return String(houseExpenseBreakdownVehicleModelText(row) || '').toLowerCase();
    if (key === 'in_charge') return String(row.DESCRIPTION || row.OIC || '').toLowerCase();
    if (key === 'encoded_by') return String(row.FIRSTNAME || '').toLowerCase();
    if (key === 'date_time') return new Date(row.ENCODED_DT || 0).getTime();
    return '';
}

function renderExpenseBreakdownModalRows() {
    var state = window.houseExpenseBreakdownState || {};
    var rows = (state.rows || []).slice();
    var key = state.sortKey || 'date_time';
    var dir = state.sortDir === 'asc' ? 'asc' : 'desc';
    var showVehicleColumns = !!state.showVehicleColumns;
    var colCount = houseExpenseBreakdownColumnCount(showVehicleColumns);

    rows.sort(function (a, b) {
        var av = getBreakdownSortValue(a, key);
        var bv = getBreakdownSortValue(b, key);
        if (av < bv) return dir === 'asc' ? -1 : 1;
        if (av > bv) return dir === 'asc' ? 1 : -1;
        return 0;
    });

    var total = 0;
    var html = rows.map(function (row) {
        var amount = Number(row.AMOUNT) || 0;
        total += amount;
        var displayDate = row.ENCODED_DT
            ? moment.utc(row.ENCODED_DT).utcOffset(8).format('DD MMM YYYY, HH:mm:ss')
            : '-';
        var isReturnMoney = row.record_type === 'return_money';
        var descriptionText = houseExpenseItemDescriptionColumnText(row);
        var plateText = houseExpenseBreakdownVehiclePlateText(row);
        var modelText = houseExpenseBreakdownVehicleModelText(row);
        var inChargeText = isReturnMoney ? '-' : (row.OIC || row.DESCRIPTION || '-');
        var vehicleCells = showVehicleColumns
            ? '<td class="js-breakdown-vehicle-col">' +
              houseExpenseHtmlEscape(modelText) +
              '</td>' +
              '<td class="js-breakdown-vehicle-col">' +
              houseExpenseHtmlEscape(plateText) +
              '</td>'
            : '';
        return (
            '<tr>' +
                '<td>' + houseExpenseHtmlEscape(descriptionText) + '</td>' +
                vehicleCells +
                '<td>' + houseExpenseHtmlEscape(inChargeText) + '</td>' +
                '<td class="fw-semibold text-end">' + (isReturnMoney
                    ? (window.fmtIn ? window.fmtIn(amount) : formatHouseExpenseNumber(amount))
                    : (window.fmtOut ? window.fmtOut(amount) : formatHouseExpenseNumber(amount))) + '</td>' +
                '<td>' + houseExpenseHtmlEscape(row.FIRSTNAME || '-') + '</td>' +
                '<td>' + houseExpenseHtmlEscape(displayDate) + '</td>' +
            '</tr>'
        );
    }).join('');

    $('#breakdown-modal-tbody').html(
        html ||
            '<tr><td colspan="' +
                colCount +
                '" class="text-center text-muted py-3">No entries found.</td></tr>'
    );
    $('#breakdown-modal-grand-total').text(formatHouseExpenseNumber(total));

    $('#breakdown-modal-head-table thead th.sortable-col').each(function () {
        var $th = $(this);
        var thKey = $th.attr('data-sort-key');
        var indicator = '-';
        if (thKey === key) {
            indicator = dir === 'asc' ? '▲' : '▼';
        }
        $th.find('.sort-indicator').text(indicator);
    });
}

$(document).ready(function () {
    function syncHouseExpenseSelectAllCheckboxState() {
        var $master = $('#house-expense-select-all');
        if (!$master.length) return;
        var $cbs = $();
        if ($('body').hasClass('open-pool-select-mode')) {
            $cbs = $('#expense-item-cat-tbody .open-pool-checkbox');
        } else if ($('body').hasClass('daily-settle-select-mode')) {
            $cbs = $('#expense-item-cat-tbody .daily-settle-checkbox');
        }
        if (!$cbs.length) {
            $master.prop('checked', false).prop('indeterminate', false);
            return;
        }
        var n = $cbs.length;
        var c = $cbs.filter(':checked').length;
        $master.prop('checked', c === n && n > 0);
        $master.prop('indeterminate', c > 0 && c < n);
    }
    window.syncHouseExpenseSelectAllCheckboxState = syncHouseExpenseSelectAllCheckboxState;

    function setHouseExpenseDailySettleSelectionMode(enabled) {
        if (enabled && window.isOpenPoolSelectionMode) setHouseExpenseOpenPoolSelectionMode(false);
        window.isDailySettleSelectionMode = !!enabled;
        var $settle = $('#btn-daily-settle');
        var $master = $('#house-expense-select-all');
        if (window.isDailySettleSelectionMode) {
            $('body').addClass('daily-settle-select-mode');
            $settle.addClass('breadcrumb-crumb-armed');
        } else {
            $('body').removeClass('daily-settle-select-mode');
            $settle.removeClass('breadcrumb-crumb-armed');
            $('.daily-settle-checkbox').prop('checked', false);
            if ($master.length) $master.prop('checked', false).prop('indeterminate', false);
        }
        syncHouseExpenseSelectAllCheckboxState();
    }

    function setHouseExpenseOpenPoolSelectionMode(enabled) {
        if (enabled && window.isDailySettleSelectionMode) setHouseExpenseDailySettleSelectionMode(false);
        window.isOpenPoolSelectionMode = !!enabled;
        var $open = $('#btn-breadcrumb-open-pool');
        var $master = $('#house-expense-select-all');
        if (window.isOpenPoolSelectionMode) {
            $('body').addClass('open-pool-select-mode');
            $open.addClass('breadcrumb-crumb-armed');
        } else {
            $('body').removeClass('open-pool-select-mode');
            $open.removeClass('breadcrumb-crumb-armed');
            $('.open-pool-checkbox').prop('checked', false);
            if ($master.length) $master.prop('checked', false).prop('indeterminate', false);
        }
        syncHouseExpenseSelectAllCheckboxState();
    }

    function getSelectedHouseExpenseItems(selector) {
        var items = [];
        var seen = {};
        $(selector + ':checked').each(function () {
            var id = parseInt($(this).val(), 10);
            var type = $(this).data('record-type') === 'return_money' ? 'return_money' : 'expense';
            var key = type + ':' + id;
            if (!isNaN(id) && !seen[key]) {
                seen[key] = true;
                items.push({ id: id, type: type });
            }
        });
        return items;
    }

    window.updateOpenPoolBreadcrumbVisibility = function () {
        var $open = $('#btn-breadcrumb-open-pool');
        if (!$open.length) return;
        var selectedYmd = String(window.selectedSettlementDate || '').slice(0, 10);
        var visible =
            getHouseExpenseFilterMode() === 'settlement' &&
            /^\d{4}-\d{2}-\d{2}$/.test(selectedYmd) &&
            selectedYmd === getClientTodayYmd() &&
            window.selectedSettlementSubView === 'settled';
        if (visible) {
            $open.removeClass('d-none');
        } else {
            if (window.isOpenPoolSelectionMode) setHouseExpenseOpenPoolSelectionMode(false);
            $open.addClass('d-none');
        }
    };

    function clearExpenseTableDisplay() {
        resetHouseExpenseExplorerState();
        window.houseExpenseItemSearchQuery = '';
        $('#expense-item-search').val('');
        houseExpenseApplyLoadedData([]);
    }

    function houseExpenseResolveDateRange(fpInstance) {
        var pad = function (n) {
            return String(n).padStart(2, '0');
        };
        var formatYmd = function (d) {
            return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
        };
        var selectedDates = null;

        if (fpInstance && fpInstance.selectedDates && fpInstance.selectedDates.length) {
            selectedDates = fpInstance.selectedDates;
        } else {
            var el = document.getElementById('daterange-picker');
            if (el && el._flatpickr && el._flatpickr.selectedDates && el._flatpickr.selectedDates.length) {
                selectedDates = el._flatpickr.selectedDates;
            }
        }

        if (selectedDates && selectedDates.length >= 2) {
            var from = formatYmd(selectedDates[0]);
            var to = formatYmd(selectedDates[1]);
            return from <= to ? { fromDate: from, toDate: to } : { fromDate: to, toDate: from };
        }
        if (selectedDates && selectedDates.length === 1) {
            var single = formatYmd(selectedDates[0]);
            return { fromDate: single, toDate: single };
        }

        var wrapper = document.getElementById('daterange-wrapper');
        if (wrapper) {
            var fromDate = wrapper.getAttribute('data-month-start');
            var toDate = wrapper.getAttribute('data-today');
            if (fromDate && toDate) {
                return { fromDate: fromDate, toDate: toDate };
            }
        }

        return { fromDate: null, toDate: null };
    }

    function initializeExpenseTable() {
        function reloadData(resetExplorer, fpInstance) {
            var range = houseExpenseResolveDateRange(fpInstance);
            var fromDate = range.fromDate;
            var toDate = range.toDate;

            if (!fromDate || !toDate) {
                clearExpenseTableDisplay();
                return;
            }

            $.ajax({
                url: '/junket_house_expense_data',
                method: 'GET',
                data: { fromDate: fromDate, toDate: toDate },
                success: function (data) {
                    if (resetExplorer === true) {
                        resetHouseExpenseExplorerState();
                    }
                    houseExpenseApplyLoadedData(data);
                },
                error: function () {
                    // Error fetching data
                }
            });
        }

        // Expose reloadData if needed
        window.reloadData = reloadData;
        
        // Don't load data here - wait for settlement initialization
    }

    // 3. Initialize DataTable
    initializeExpenseTable();

    $(document).on('change', '#house-expense-select-all', function () {
        var checked = $(this).prop('checked');
        if ($('body').hasClass('open-pool-select-mode')) {
            $('#expense-item-cat-tbody .open-pool-checkbox').prop('checked', checked);
        } else if ($('body').hasClass('daily-settle-select-mode')) {
            $('#expense-item-cat-tbody .daily-settle-checkbox').prop('checked', checked);
        }
        syncHouseExpenseSelectAllCheckboxState();
    });

    $(document).on(
        'change',
        '#expense-item-cat-tbody .open-pool-checkbox, #expense-item-cat-tbody .daily-settle-checkbox',
        function () {
            syncHouseExpenseSelectAllCheckboxState();
        }
    );

    $(document).on('input', '#expense-item-search', function () {
        window.houseExpenseItemSearchQuery = $(this).val() || '';
        renderHouseExpenseItemEntriesTable(window.houseExpenseLastRows || []);
    });

    function getHouseExpensePrintRows() {
        var actionColIndex = 6;
        var headers = [];
        $('#expense-item-cat-tbl thead tr:first th').each(function (i) {
            if (i === actionColIndex) return;
            headers.push($(this).text().trim());
        });
        var rows = [];
        $('#expense-item-cat-tbody tr.js-expense-entry-row').each(function () {
            var cells = [];
            $(this)
                .find('td')
                .each(function (i) {
                    if (i === actionColIndex) return;
                    cells.push($(this).text().trim());
                });
            if (cells.length) rows.push(cells);
        });
        if (rows.length) {
            $('.expense-item-table-wrap .expense-item-footer-line').each(function () {
                rows.push([
                    $(this).find('.expense-item-footer-label').text().trim(),
                    '',
                    '',
                    '',
                    '',
                    $(this).find('.expense-item-footer-value').text().trim()
                ]);
            });
        }
        return { headers: headers, rows: rows };
    }

    function getHouseExpensePrintStyles() {
        return [
            '@page{size:landscape;margin:8mm;}',
            'body{font-family:Arial,sans-serif;color:#111;margin:0;}',
            '.print-wrap{width:100%;}',
            'h2{text-align:center;margin:0 0 4px;font-size:18px;}',
            '.subtitle{text-align:center;margin:0 0 12px;font-size:12px;color:#444;}',
            'table{width:100%;border-collapse:collapse;font-size:10px;}',
            'th,td{border:1px solid #777;padding:5px 7px;vertical-align:middle;text-align:left;}',
            'th{background:#d9e1f2;font-weight:700;}',
            'th:nth-child(5),td:nth-child(5),th:nth-child(6),td:nth-child(6){text-align:right;padding-right:14px;}',
            'tbody tr:nth-last-child(-n+3) td{font-weight:700;background:#f4f6fa;}'
        ].join('');
    }

    function printHouseExpenseTable() {
        var payload = getHouseExpensePrintRows();
        var t = window.houseExpenseTranslations || {};
        if (!payload.rows.length) {
            if (window.Swal) {
                Swal.fire({
                    icon: 'info',
                    title: 'Print',
                    text: t.no_data_found || 'No data to print.',
                    confirmButtonColor: '#0d6efd'
                });
            } else {
                alert(t.no_data_found || 'No data to print.');
            }
            return;
        }
        var headerHtml = payload.headers.map(function (h) {
            return '<th>' + houseExpenseHtmlEscape(h) + '</th>';
        }).join('');
        var rowsHtml = payload.rows.map(function (row) {
            return '<tr>' + row.map(function (cell) {
                return '<td>' + houseExpenseHtmlEscape(cell) + '</td>';
            }).join('') + '</tr>';
        }).join('');
        var subtitle = getHouseExpenseDateRangeLabel();
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
            '<!doctype html><html><head><title>Junket Expenses</title><style>',
            getHouseExpensePrintStyles(),
            '</style></head><body><div class="print-wrap">',
            '<h2>Junket Expenses</h2>',
            '<div class="subtitle">', houseExpenseHtmlEscape(subtitle), '</div>',
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

    $('#btn-house-expense-print').on('click', function (e) {
        e.preventDefault();
        printHouseExpenseTable();
    });

    $('#btn-house-expense-export').on('click', function () {
        var t = window.houseExpenseTranslations || {};
        var data = window.houseExpenseLastRows || [];
        if (!data.length) {
            if (window.Swal) {
                Swal.fire({
                    icon: 'info',
                    title: t.export_label || 'Export',
                    text: t.no_data_found || 'No data to export.',
                    confirmButtonColor: '#0d6efd'
                });
            } else {
                alert(t.no_data_found || 'No data to export.');
            }
            return;
        }
        var headers = ['Name', 'In-Charge', 'Description', 'Amount', 'Date & Time'];
        var rows = data.map(function (row) {
            var amount = parseFloat(row.AMOUNT) || 0;
            var formattedAmount = amount.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
            var enc = row.ENCODED_DT
                ? moment.utc(row.ENCODED_DT).utcOffset(8).format('DD MMM, YYYY HH:mm:ss')
                : '';
            return [
                row.expense_category || 'N/A',
                row.record_type === 'return_money' ? '-' : row.DESCRIPTION || row.OIC || '-',
                houseExpenseItemDescriptionColumnText(row),
                formattedAmount,
                enc
            ];
        });
        var outName = 'Junket_Expenses-export.xlsx';
        var $btn = $(this);
        $btn.prop('disabled', true);
        fetch('/house_expense/export_xlsx', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'same-origin',
            body: JSON.stringify({ headers: headers, rows: rows, filename: outName })
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
                if (window.Swal) {
                    Swal.fire({
                        icon: 'error',
                        title: t.error || 'Error',
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
    });

    // ======================= DATE RANGE FILTER ==================

    toggleHouseExpenseBreakdownPanel('daterange');

    var dateRangePicker = null;
    if (document.getElementById('daterange-picker')) {
        var now = new Date();
        var pad = function(n) { return String(n).padStart(2, '0'); };
        var rangeWrapper = document.getElementById('daterange-wrapper');
        var todayStr = (rangeWrapper && rangeWrapper.getAttribute('data-today')) || (now.getFullYear() + '-' + pad(now.getMonth() + 1) + '-' + pad(now.getDate()));
        var monthStart = (rangeWrapper && rangeWrapper.getAttribute('data-month-start')) || (now.getFullYear() + '-' + pad(now.getMonth() + 1) + '-01');

        var earliestAllowed = new Date(now.getFullYear() - 1, 0, 1);
        var earliestSettlementDate =
            earliestAllowed.getFullYear() + '-' + pad(earliestAllowed.getMonth() + 1) + '-' + pad(earliestAllowed.getDate());

        function jumpHouseExpenseRangeToCurrentThreeMonths(instance) {
            if (!instance) return;
            instance.jumpToDate(new Date(now.getFullYear(), now.getMonth() - 2, 1), false);
        }

        dateRangePicker = flatpickr('#daterange-picker', {
            mode: 'range',
            dateFormat: 'Y-m-d',
            altInput: true,
            altFormat: 'M d, Y',
            defaultDate: [monthStart, todayStr],
            showMonths: 3,
            minDate: earliestSettlementDate,
            onReady: function (selectedDates, dateStr, instance) {
                jumpHouseExpenseRangeToCurrentThreeMonths(instance);
                if (typeof window.setupFlatpickrMonthNameRangeSelect === 'function') {
                    window.setupFlatpickrMonthNameRangeSelect(instance);
                }
                toggleHouseExpenseBreakdownPanel('daterange');
                if (typeof window.reloadData === 'function') {
                    setTimeout(function () {
                        window.reloadData(false, instance);
                    }, 200);
                }
            },
            onOpen: function (selectedDates, dateStr, instance) {
                jumpHouseExpenseRangeToCurrentThreeMonths(instance);
                if (typeof window.setupFlatpickrMonthNameRangeSelect === 'function') {
                    window.setupFlatpickrMonthNameRangeSelect(instance);
                }
            },
            onMonthChange: function (selectedDates, dateStr, instance) {
                if (typeof window.styleFlatpickrMonthNameClickable === 'function') {
                    window.styleFlatpickrMonthNameClickable(instance);
                }
            },
            onChange: function (selectedDates) {
                toggleHouseExpenseBreakdownPanel('daterange');
                if (selectedDates.length === 2) {
                    if (typeof window.reloadData === 'function') window.reloadData();
                } else {
                    clearExpenseTableDisplay();
                }
            }
        });
    }

    // Settlement button state management
    var settleBtnLabel = (window.houseExpenseTranslations && window.houseExpenseTranslations.settle) || 'Settle';

    window.updateSettleButtonState = function () {
        $('#btn-daily-settle').addClass('disabled').text(settleBtnLabel).css('pointer-events', 'none').css('opacity', '0.5');
    };

    window.reloadExpenseBySettlementDate = function () {
        if (typeof window.reloadData === 'function') {
            window.reloadData();
        }
    };

    // Settlement button click handler
    $('#btn-daily-settle').on('click', function (e) {
        e.preventDefault();
        if ($(this).hasClass('disabled') || $(this).prop('disabled')) return;
        Swal.fire({
            title: 'Date range filter active',
            text: 'Settle is only available when filtering by a single settlement date.',
            icon: 'info',
            confirmButtonText: 'OK',
            confirmButtonColor: '#0d6efd'
        });
    });

    $('#btn-breadcrumb-open-pool').on('click', function (e) {
        e.preventDefault();
        return;
    });

    if (typeof window.updateSettleButtonState === 'function') window.updateSettleButtonState();
    $('#btn-daily-settle, #btn-breadcrumb-open-pool').addClass('d-none');

    expense_category();

    // Event delegation for Edit button (avoids inline onclick issues with special chars: newlines, quotes, etc.)
    $(document).on('click', '.btn-edit-row', function () {
        var $btn = $(this);
        var recordType = $btn.attr('data-record-type') || 'expense';
        var id = $btn.attr('data-expense-id');
        var description = $btn.attr('data-description') || '';
        var amount = $btn.attr('data-amount') || '0';
        if (recordType === 'return_money') {
            edit_return_money(id, description, amount);
        } else {
            var categoryId = $btn.attr('data-category-id') || '';
            var receiptNo = $btn.attr('data-receipt-no') || '';
            var dateTime = $btn.attr('data-date-time') || '';
            var oic = $btn.attr('data-oic') || '';
            var receiver = $btn.attr('data-receiver') || '';
            var kmL = $btn.attr('data-km-l') || '';
            var vehicleId = $btn.attr('data-vehicle-id') || '';
            edit_expense(id, categoryId, receiptNo, dateTime, description, amount, oic, receiver, kmL, vehicleId);
        }
    });

    $(document).on('click', '.js-expense-graph-cat-open', function () {
        var categoryName = $(this).attr('data-category') || '';
        showExpenseBreakdownModalByCategory(categoryName);
    });

    $(document).on('click', '.js-expense-main-cat-row', function () {
        var mainId = $(this).attr('data-main-id');
        var mainName = $(this).attr('data-main-name') || '';
        var isAll = $(this).hasClass('js-expense-main-cat-all') || mainId === '';

        if (!isAll && !mainId) return;

        var stBefore = window.houseExpenseExplorerState || {};
        var sameSelection = isAll
            ? houseExpenseIsAllExplorerFilter(stBefore) && !stBefore.itemCategoryId
            : String(stBefore.mainCategoryId) === String(mainId) && !stBefore.itemCategoryId;
        window.houseExpenseAnimateItemTable = !sameSelection;
        if (isAll) {
            resetHouseExpenseExplorerState();
        } else {
            window.houseExpenseExplorerState = {
                mainCategoryId: mainId,
                mainCategory: mainName || null,
                itemCategoryId: null,
                itemCategory: null
            };
        }
        refreshHouseExpenseExplorerOnly();
    });

    /* Category modal UI init runs from house_expense.ejs (after this file loads), same as new-expense bindings. */

    $(document).on('click', '.js-expense-sub-cat-row', function () {
        var subId = $(this).attr('data-sub-id') || '';
        var subName = $(this).attr('data-sub-name') || '';
        var st = window.houseExpenseExplorerState || {};
        if (!st.mainCategoryId) return;

        var sameSelection =
            (!subId && !st.itemCategoryId) || (subId && String(st.itemCategoryId) === String(subId));
        window.houseExpenseAnimateItemTable = !sameSelection;
        window.houseExpenseExplorerState.itemCategoryId = subId || null;
        window.houseExpenseExplorerState.itemCategory = subId ? subName || null : null;
        refreshHouseExpenseExplorerOnly();
    });

    $(document).on('click', '#expense-item-cat-tbl thead th.sortable-col', function (e) {
        if ($(e.target).closest('.house-expense-select-all-slot, .house-expense-select-all-cb').length) return;

        var key = $(this).attr('data-sort-key') || 'date_time';
        var sortState = window.houseExpenseItemTableSortState || {
            sortKey: 'date_time',
            sortDir: 'desc'
        };

        if (sortState.sortKey === key) {
            sortState.sortDir = sortState.sortDir === 'asc' ? 'desc' : 'asc';
        } else {
            sortState.sortKey = key;
            sortState.sortDir = key === 'date_time' || key === 'amount' ? 'desc' : 'asc';
        }

        window.houseExpenseItemTableSortState = sortState;
        renderHouseExpenseItemEntriesTable(window.houseExpenseLastRows || []);
    });

    $(document).on('click', '#breakdown-modal-head-table thead th.sortable-col', function () {
        var key = $(this).attr('data-sort-key') || 'date_time';
        var state = window.houseExpenseBreakdownState || {};
        if (state.sortKey === key) {
            state.sortDir = state.sortDir === 'asc' ? 'desc' : 'asc';
        } else {
            state.sortKey = key;
            state.sortDir = key === 'date_time' ? 'desc' : 'asc';
        }
        window.houseExpenseBreakdownState = state;
        renderExpenseBreakdownModalRows();
    });

    // Utility functions for receipt actions
    window.viewReceipt = function (photoUrl) {
        if (!photoUrl || photoUrl.trim() === "" || photoUrl === "null") {
        Swal.fire({
            icon: 'warning',
            title: window.houseExpenseTranslations?.no_receipt_uploaded || 'No Receipt Uploaded',
            text: window.houseExpenseTranslations?.no_receipt_available || 'There is no receipt available to view.',
            confirmButtonText: window.houseExpenseTranslations?.ok || 'OK'
        });
            return;
        }
        Swal.fire({
            title: '',
            imageUrl: photoUrl,
            imageAlt: window.houseExpenseTranslations?.receipt_image || 'Receipt Image',
            showCloseButton: true,
            showConfirmButton: false,
            width: 'auto',
            padding: '1rem',
            background: '#fff'
        });
    };

    window.downloadReceipt = function (photoUrl) {
        var a = document.createElement('a');
        a.href = photoUrl;
        a.download = photoUrl.substring(photoUrl.lastIndexOf('/') + 1);
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
    };


    // Kapag sine-submit ang form para sa pag-edit
    $('#edit_junket_house_expense').submit(function (event) {
        event.preventDefault();

        const $btn = $('#btn-save-edit-expense');
        const originalHtml = $btn.html();

        // Show loading spinner on button
        $btn.prop('disabled', true).html(`
        <span class="spinner-border spinner-border-sm me-1" role="status" aria-hidden="true"></span>
        ${window.houseExpenseTranslations?.saving || 'Saving'}...
    `);

        const formData = new FormData(this);

        $.ajax({
            url: '/junket_house_expense/' + expense_id,
            type: 'PUT',
            data: formData,
            processData: false,
            contentType: false,
            success: function (response) {
                houseExpenseFinishSaveSuccess({
                    $modal: $('#modal-edit-house-expense'),
                    title:
                        window.houseExpenseTranslations?.updated_successfully ||
                        'Updated successfully!',
                    text:
                        window.houseExpenseTranslations?.expense_updated ||
                        'House expense has been updated.',
                    confirmButtonText: window.houseExpenseTranslations?.ok || 'OK',
                    allowOutsideClick: false
                });
            },
            error: function (error) {
                Swal.fire({
                    icon: 'error',
                    title: window.houseExpenseTranslations?.error || 'Error!',
                    text: window.houseExpenseTranslations?.error_updating_expense || 'There was an error updating the expense.',
                    confirmButtonText: window.houseExpenseTranslations?.ok || 'OK'
                });
            },
            complete: function () {
                // Reset button after request finishes
                $btn.prop('disabled', false).html(originalHtml);
            }
        });
    });
});


function houseExpenseSetNewExpenseCategory(categoryId) {
    var $sel = $('#expense-category-select');
    if (!$sel.length || categoryId == null || categoryId === '') return;
    $sel.val(String(categoryId));
    if ($sel.data('select2')) {
        $sel.trigger('change.select2');
    } else {
        $sel.trigger('change');
    }
}

/** Explorer add item: lock category from selected main/sub. */
function houseExpenseApplyNewExpenseCategoryUi(categoryId) {
    var $selectWrap = $('#house-expense-new-cat-select-wrap');
    var $presetWrap = $('#house-expense-new-cat-preset-wrap');
    var $select = $('#expense-category-select');
    var $hidden = $('#house-expense-new-expense-category-id');
    var $presetLabel = $('#house-expense-new-cat-preset-label');

    if (!$selectWrap.length) return;

    if (categoryId != null && categoryId !== '') {
        var label = houseExpenseFormatCategoryBreadcrumb(categoryId);

        $selectWrap.addClass('d-none');
        $select.prop('required', false).removeAttr('name');
        $presetWrap.removeClass('d-none');
        $hidden.val(String(categoryId)).attr('name', 'txtCategory');
        if ($presetLabel.length) $presetLabel.text(label);
        houseExpenseSetNewExpenseCategory(categoryId);
        houseExpenseToggleCarExpenseFields(categoryId);
    } else {
        $selectWrap.removeClass('d-none');
        $select.prop('required', true).attr('name', 'txtCategory');
        $presetWrap.addClass('d-none');
        $hidden.val('').removeAttr('name');
        if ($presetLabel.length) $presetLabel.text('');
        houseExpenseToggleCarExpenseFields(null);
    }
}

/** Category id to use when adding an item from the explorer (+ on Items panel). */
function houseExpenseGetAddItemCategoryId() {
    var st = window.houseExpenseExplorerState || {};
    if (!st.mainCategoryId) return null;
    if (st.itemCategoryId) return String(st.itemCategoryId);
    var subs = getHouseExpenseSubCategoryRows(st.mainCategoryId);
    if (!subs.length) return String(st.mainCategoryId);
    return null;
}

function addHouseExpense(categoryId) {
    if (categoryId != null && categoryId !== '') {
        window.houseExpensePendingNewExpenseCategoryId = String(categoryId);
    } else {
        window.houseExpensePendingNewExpenseCategoryId = null;
    }

    $('#modal-new-house-expense').modal('show');
    get_agent();
    reloadHouseExpenseCategoryCatalog(function () {
        reloadHouseExpenseVehicleCatalog(function () {
            if (window.houseExpensePendingNewExpenseCategoryId) {
                houseExpenseApplyNewExpenseCategoryUi(window.houseExpensePendingNewExpenseCategoryId);
            } else {
                houseExpenseApplyNewExpenseCategoryUi(null);
            }
        });
    });
}

function addHouseExpenseFromExplorer() {
    var t = window.houseExpenseTranslations || {};
    var categoryId = houseExpenseGetAddItemCategoryId();
    if (!categoryId) {
        if (typeof Swal !== 'undefined') {
            Swal.fire({
                icon: 'info',
                title: t.add_item || 'Add item',
                text: t.select_sub_for_item || 'Select a sub category first',
                confirmButtonColor: '#0d6efd'
            });
        }
        return;
    }
    addHouseExpense(categoryId);
}

/** Same wiring as addHouseExpense(): $('#modal-...').modal('show') */
function addHouseExpenseMainCategory() {
    openHouseExpenseAddCategoryModal('main');
}

function addHouseExpenseSubCategory() {
    openHouseExpenseAddCategoryModal('sub');
}

/** Move modal to body so it stacks above .modal-backdrop (fixes backdrop-only visible). */
function houseExpenseShowCategoryModal($modal) {
    if (!$modal || !$modal.length) return;
    if ($modal.parent().length && !$modal.parent().is('body')) {
        $modal.appendTo('body');
    }
    $modal.modal('show');
}

function returnMoney() {
    $('#modal-new-return-money').modal('show');
}

function approveHouseExpense(id) {
    var t = window.houseExpenseTranslations || {};
    if (typeof Swal === 'undefined') return;
    Swal.fire({
        title: t.approve || 'Approve',
        text: t.approve_confirm || 'Approve this expense?',
        icon: 'question',
        showCancelButton: true,
        confirmButtonText: t.yes || 'Yes',
        confirmButtonColor: '#198754',
        cancelButtonText: 'Cancel'
    }).then(function (result) {
        if (!result.isConfirmed) return;
        $.ajax({
            url: '/junket_house_expense/approve/' + id,
            method: 'PUT',
            success: function () {
                houseExpenseFinishSaveSuccess({
                    title: t.updated_successfully || 'Approved successfully'
                });
            },
            error: function (xhr) {
                var msg = (xhr.responseJSON && xhr.responseJSON.error) || 'Failed to approve';
                Swal.fire({ icon: 'error', title: t.error || 'Error', text: msg });
            }
        });
    });
}

function rejectHouseExpense(id) {
    var t = window.houseExpenseTranslations || {};
    if (typeof Swal === 'undefined') return;
    Swal.fire({
        title: t.reject || 'Reject',
        text: t.reject_confirm || 'Reject this expense?',
        icon: 'warning',
        showCancelButton: true,
        confirmButtonText: t.yes || 'Yes',
        confirmButtonColor: '#dc3545',
        cancelButtonText: 'Cancel'
    }).then(function (result) {
        if (!result.isConfirmed) return;
        $.ajax({
            url: '/junket_house_expense/reject/' + id,
            method: 'PUT',
            success: function () {
                houseExpenseFinishSaveSuccess({
                    title: t.rejected || 'Rejected'
                });
            },
            error: function (xhr) {
                var msg = (xhr.responseJSON && xhr.responseJSON.error) || 'Failed to reject';
                Swal.fire({ icon: 'error', title: t.error || 'Error', text: msg });
            }
        });
    });
}

window.approveHouseExpense = approveHouseExpense;
window.rejectHouseExpense = rejectHouseExpense;

function edit_expense(id, category_id, receipt_no, datetimeval, description, amount, oic, receiver, kmL, vehicleId) {
    $('#modal-edit-house-expense').modal('show');
    $('#txtCategory').val(category_id);
    $('#txtReceiptNo').val(receipt_no);

    // ✅ Sanitize and format datetime properly
    let formattedDate = '';
    if (datetimeval) {
        const parsedDate = moment(datetimeval, ['YYYY-MM-DD HH:mm:ss', 'MMMM DD, YYYY HH:mm:ss', moment.ISO_8601], true);
        if (parsedDate.isValid()) {
            formattedDate = parsedDate.format('YYYY-MM-DD');
        } else {
            formattedDate = '';
        }
    }

    $('#txtDateandTime').val(formattedDate);
    $('#txtDescription').val(description);
    $('#txtReceiver').val(receiver || '');
    $('#txtAmount').val(amount);
    $('#editTxtKmL').val(kmL != null && kmL !== '' ? kmL : '');
    houseExpensePopulateVehicleSelects(vehicleId != null && vehicleId !== '' ? vehicleId : '');
    $('#editTxtVehicleId').val(vehicleId != null && vehicleId !== '' ? String(vehicleId) : '');
    // $('#txtOfficerInCharge').val(oic);

    expense_id = id;

    edit_expense_category(category_id);
    houseExpenseToggleCarExpenseFields(category_id);
    // edit_get_agent(oic);
}


function archive_expense(id) {
    Swal.fire({
        title: window.houseExpenseTranslations?.delete_confirmation || 'Are you sure you want to delete this?',
        icon: 'warning',
        showCancelButton: true,
        confirmButtonColor: '#3085d6',
        cancelButtonColor: '#d33',
        confirmButtonText: window.houseExpenseTranslations?.yes || 'Yes'
    }).then((result) => {
        if (result.isConfirmed) {
            $.ajax({
                url: '/junket_house_expense/remove/' + id,
                type: 'PUT',
                success: function (response) {
                    Swal.fire({
                        icon: 'success',
                        title: window.houseExpenseTranslations?.updated_successfully || 'Deleted successfully!',
                        text: window.houseExpenseTranslations?.expense_deleted || 'House expense has been deleted.',
                        confirmButtonText: window.houseExpenseTranslations?.ok || 'OK',
                        allowOutsideClick: false
                    }).then(function () {
                        if (typeof window.reloadData === 'function') window.reloadData();
                    });
                },
                error: function (error) {
                    Swal.fire({
                        icon: 'error',
                        title: window.houseExpenseTranslations?.error || 'Error!',
                        text: window.houseExpenseTranslations?.error_deleting_expense || 'Failed to delete expense. Please try again.',
                        confirmButtonText: window.houseExpenseTranslations?.ok || 'OK'
                    });
                }
            });
        }
    })
}

function edit_return_money(id, description, amount) {
    $('#modal-edit-return-money').modal('show');
    $('#txtReturnMoneyDescription').val(description);
    
    // Format amount with commas
    const amountNum = parseFloat(amount) || 0;
    const formattedAmount = amountNum.toLocaleString('en-US', { 
        minimumFractionDigits: 0, 
        maximumFractionDigits: 0 
    });
    $('#txtReturnMoneyAmount').val(formattedAmount);
    
    return_money_id = id;
}

function archive_return_money(id) {
    Swal.fire({
        title: window.houseExpenseTranslations?.delete_confirmation || 'Are you sure you want to delete this?',
        icon: 'warning',
        showCancelButton: true,
        confirmButtonColor: '#3085d6',
        cancelButtonColor: '#d33',
        confirmButtonText: window.houseExpenseTranslations?.yes || 'Yes'
    }).then((result) => {
        if (result.isConfirmed) {
            $.ajax({
                url: '/remove_return_money/' + id,
                type: 'PUT',
                success: function (response) {
                    Swal.fire({
                        icon: 'success',
                        title: window.houseExpenseTranslations?.updated_successfully || 'Deleted successfully!',
                        text: window.houseExpenseTranslations?.return_deleted || 'Return money has been deleted.',
                        confirmButtonText: window.houseExpenseTranslations?.ok || 'OK',
                        allowOutsideClick: false
                    }).then(function () {
                        if (typeof window.reloadData === 'function') window.reloadData();
                    });
                },
                error: function (error) {
                    Swal.fire({
                        icon: 'error',
                        title: 'Error',
                        text: 'Failed to delete return money. Please try again.'
                    });
                }
            });
        }
    })
}

// Form submission handler for edit return money
$(document).ready(function() {
    $('#edit_return_money').submit(function (event) {
        event.preventDefault();

        const $btn = $('#btn-save-edit-return-money');
        const originalHtml = $btn.html();

        // Show loading spinner on button
        $btn.prop('disabled', true).html(`
            <span class="spinner-border spinner-border-sm me-1" role="status" aria-hidden="true"></span>
            ${window.houseExpenseTranslations?.saving || 'Saving'}...
        `);

        const formData = {
            txtDescription: $('#txtReturnMoneyDescription').val(),
            txtAmount: $('#txtReturnMoneyAmount').val()
        };

        $.ajax({
            url: '/edit_return_money/' + return_money_id,
            type: 'PUT',
            data: formData,
            success: function (response) {
                houseExpenseFinishSaveSuccess({
                    $modal: $('#modal-edit-return-money'),
                    title:
                        window.houseExpenseTranslations?.updated_successfully ||
                        'Updated successfully!',
                    text: 'Return money has been updated.',
                    confirmButtonText: window.houseExpenseTranslations?.ok || 'OK',
                    allowOutsideClick: false
                });
            },
            error: function (error) {
                Swal.fire({
                    icon: 'error',
                    title: window.houseExpenseTranslations?.error || 'Error!',
                    text: 'There was an error updating the return money.',
                    confirmButtonText: window.houseExpenseTranslations?.ok || 'OK'
                });
            },
            complete: function () {
                // Reset button after request finishes
                $btn.prop('disabled', false).html(originalHtml);
            }
        });
    });
});

/** Original success Swal; on OK reload table and close modal — no full page reload */
function houseExpenseFinishSaveSuccess(opts) {
    opts = opts || {};
    var afterOk = function () {
        if (typeof opts.resetSubmitting === 'function') opts.resetSubmitting();
        if (opts.$modal && opts.$modal.length) opts.$modal.modal('hide');
        if (opts.$btn && opts.$btn.length) {
            var html = opts.originalHtml || opts.$btn.data('original-text');
            opts.$btn.prop('disabled', false).html(html || 'Save');
        }
        if (typeof window.reloadData === 'function') window.reloadData();
    };
    if (typeof Swal !== 'undefined' && (opts.title || opts.message)) {
        Swal.fire({
            icon: 'success',
            title: opts.title || opts.message,
            text: opts.text || undefined,
            confirmButtonText: opts.confirmButtonText || 'OK',
            showConfirmButton: true,
            allowOutsideClick: opts.allowOutsideClick !== false
        }).then(afterOk);
    } else {
        afterOk();
    }
}

function reloadHouseExpenseCategoryCatalog(afterLoad) {
    return $.ajax({
        url: '/expense_category_data',
        method: 'GET',
        success: function (response) {
            window.houseExpenseCategoryRows = (response || []).slice();
            window.houseExpenseCategoryCatalog = window.houseExpenseCategoryRows
                .map(function (o) {
                    return o.CATEGORY != null ? String(o.CATEGORY).trim() : '';
                })
                .filter(Boolean)
                .sort(function (a, b) {
                    return String(a).localeCompare(String(b), undefined, { sensitivity: 'base' });
                });
            if (typeof afterLoad === 'function') {
                afterLoad(response);
            } else if (window.houseExpenseLastRows && $('#expense-main-cat-list').length) {
                refreshHouseExpenseExplorerOnly();
            }
            var selectOptions = $('#expense-category-select');
            if (!selectOptions.length) return;
            selectOptions.empty();
            selectOptions.append($('<option>', {
                value: '',
                text: window.houseExpenseTranslations?.select_expense_category || '--SELECT EXPENSE CATEGORY--'
            }));
            (response || []).forEach(function (option) {
                selectOptions.append($('<option>', {
                    value: option.IDNo,
                    text: option.CATEGORY
                }));
            });
        },
        error: function () {
            if (typeof afterLoad === 'function') afterLoad(null);
        }
    });
}

function expense_category() {
    reloadHouseExpenseCategoryCatalog();
    reloadHouseExpenseVehicleCatalog();
}

function houseExpenseShowModal($modal) {
    if (!$modal || !$modal.length) return;
    if ($modal.parent().length && !$modal.parent().is('body')) {
        $modal.appendTo('body');
    }
    if (typeof $modal.modal === 'function') {
        $modal.modal({ backdrop: 'static', keyboard: false, show: true });
        return;
    }
    try {
        if (typeof bootstrap !== 'undefined' && bootstrap.Modal) {
            bootstrap.Modal.getOrCreateInstance($modal[0]).show();
        }
    } catch (e) {
        /* ignore */
    }
}

function houseExpenseHideModal($modal) {
    if (!$modal || !$modal.length) return;
    if (typeof $modal.modal === 'function') {
        $modal.modal('hide');
        return;
    }
    try {
        if (typeof bootstrap !== 'undefined' && bootstrap.Modal) {
            var inst = bootstrap.Modal.getInstance($modal[0]);
            if (inst) inst.hide();
        }
    } catch (e) {
        /* ignore */
    }
}

function houseExpenseSyncCategoryAddButtons() {
    var t = window.houseExpenseTranslations || {};
    var st = window.houseExpenseExplorerState || {};
    var hasMain = !!(st.mainCategoryId);
    var $subBtn = $('.js-house-expense-add-sub-cat');
    $subBtn.prop('disabled', !hasMain);
    $subBtn.attr(
        'title',
        hasMain ? t.add_sub_category || 'Add sub category' : t.select_main_first || 'Select a main category first'
    );

    var itemCatId = houseExpenseGetAddItemCategoryId();
    var $itemBtn = $('.js-house-expense-add-item');
    $itemBtn.prop('disabled', !itemCatId);
    $itemBtn.attr(
        'title',
        itemCatId ? t.add_item || 'Add item' : t.select_sub_for_item || 'Select a sub category first'
    );
}

function houseExpenseAfterCategoryCatalogChange(deletedId) {
    var st = window.houseExpenseExplorerState || {};
    if (deletedId != null && String(st.mainCategoryId) === String(deletedId)) {
        window.houseExpenseExplorerState = {
            mainCategoryId: null,
            mainCategory: null,
            itemCategoryId: null,
            itemCategory: null
        };
    } else if (deletedId != null && String(st.itemCategoryId) === String(deletedId)) {
        st.itemCategoryId = null;
        st.itemCategory = null;
    }
    refreshHouseExpenseExplorerOnly();
}

function houseExpenseShowCategoryFormError($errorEl, message) {
    if (!$errorEl || !$errorEl.length) return;
    if (message) {
        $errorEl.removeClass('d-none').text(message);
    } else {
        $errorEl.addClass('d-none').text('');
    }
}

function openHouseExpenseEditCategoryModal(catId, kind) {
    var t = window.houseExpenseTranslations || {};
    var row = houseExpenseFindCategoryRow(catId);
    if (!row) return;

    var isSub = kind === 'sub';
    var typeVal = row.TYPE != null ? String(row.TYPE) : '2';

    $('#house-expense-edit-cat-id').val(String(catId));
    $('#house-expense-edit-cat-name').val(row.CATEGORY || '').removeClass('is-invalid');
    $('#house-expense-edit-cat-type').val(typeVal === '1' ? '1' : '2');
    $('#house-expense-edit-cat-parent').val(isSub && row.PARENT_ID != null ? String(row.PARENT_ID) : '');
    $('#house-expense-edit-category-title').text(
        isSub ? t.edit_sub_category || 'Edit sub category' : t.edit_main_category || 'Edit main category'
    );
    houseExpenseShowCategoryFormError($('#house-expense-edit-cat-error'), '');
    window.houseExpenseEditCategoryKind = kind;

    houseExpenseShowCategoryModal($('#modal-house-expense-edit-category'));
    $('#modal-house-expense-edit-category').one('shown.bs.modal', function () {
        $('#house-expense-edit-cat-name').trigger('focus').trigger('select');
    });
}

function openHouseExpenseDeleteCategoryModal(catId, kind) {
    var t = window.houseExpenseTranslations || {};
    var row = houseExpenseFindCategoryRow(catId);
    var label = row ? row.CATEGORY || '' : '';
    kind = kind || houseExpenseCategoryKindFromId(catId);
    var itemCount = houseExpenseGetCategoryItemCount(catId, kind);

    window.houseExpenseDeleteCategoryId = catId;
    window.houseExpenseDeleteCategoryKind = kind;
    $('#house-expense-delete-cat-label').text(label);

    var $confirm = $('#house-expense-delete-cat-confirm');
    $confirm.removeClass('d-none').prop('disabled', false);
    var confirmText = $confirm.data('original-text') || 'Delete';
    $confirm.html(confirmText);

    if (itemCount > 0) {
        var msg = t.category_has_items ||
            'Cannot delete: this category has expense item(s) in the list. Remove or reassign them first.';
        houseExpenseShowCategoryFormError($('#house-expense-delete-cat-error'), msg + ' (' + itemCount + ')');
        $confirm.addClass('d-none').prop('disabled', true);
    } else {
        houseExpenseShowCategoryFormError($('#house-expense-delete-cat-error'), '');
    }

    houseExpenseShowCategoryModal($('#modal-house-expense-delete-category'));
}

function confirmDeleteHouseExpenseCategory() {
    var t = window.houseExpenseTranslations || {};
    var catId = window.houseExpenseDeleteCategoryId;
    var kind = window.houseExpenseDeleteCategoryKind || houseExpenseCategoryKindFromId(catId);
    if (catId == null || catId === '') return;

    if (houseExpenseGetCategoryItemCount(catId, kind) > 0) {
        houseExpenseShowCategoryFormError(
            $('#house-expense-delete-cat-error'),
            t.category_has_items ||
                'Cannot delete: this category has expense item(s). Remove or reassign them first.'
        );
        return;
    }

    var $btn = $('#house-expense-delete-cat-confirm');
    var saveHtml = $btn.html();
    $btn.prop('disabled', true).html(t.saving || 'Saving...');

    $.ajax({
        url: '/expense_category/remove/' + catId,
        method: 'PUT',
        success: function () {
            $('#modal-house-expense-delete-category').modal('hide');
            reloadHouseExpenseCategoryCatalog(function () {
                houseExpenseAfterCategoryCatalogChange(catId);
            });
        },
        error: function (xhr) {
            var msg =
                (xhr.responseJSON && xhr.responseJSON.error) ||
                t.error_deleting_category ||
                'Could not delete category';
            houseExpenseShowCategoryFormError($('#house-expense-delete-cat-error'), msg);
            $btn.removeClass('d-none');
        },
        complete: function () {
            $btn.prop('disabled', false).html(saveHtml);
        }
    });
}

function houseExpenseInitCategoryAddUi() {
    if (window.PermissionViewOnly && window.PermissionViewOnly.isViewOnly && window.PermissionViewOnly.isViewOnly()) {
        $('.js-house-expense-add-main-cat, .js-house-expense-add-sub-cat, .js-house-expense-add-item').addClass('d-none');
    }
    houseExpenseSyncCategoryAddButtons();

    $(document)
        .off('click.houseExpenseCatRow', '.js-house-expense-edit-cat')
        .on('click.houseExpenseCatRow', '.js-house-expense-edit-cat', function (e) {
            e.preventDefault();
            e.stopPropagation();
            var id = $(this).attr('data-cat-id');
            var kind = $(this).attr('data-cat-kind');
            if (id) openHouseExpenseEditCategoryModal(id, kind);
        });

    $(document)
        .off('click.houseExpenseCatRow', '.js-house-expense-delete-cat')
        .on('click.houseExpenseCatRow', '.js-house-expense-delete-cat', function (e) {
            e.preventDefault();
            e.stopPropagation();
            var id = $(this).attr('data-cat-id');
            var kind = $(this).attr('data-cat-kind');
            if (id) openHouseExpenseDeleteCategoryModal(id, kind);
        });

    $(document)
        .off('submit.houseExpenseAddCat', '#form-house-expense-add-category')
        .on('submit.houseExpenseAddCat', '#form-house-expense-add-category', function (e) {
            e.preventDefault();
            submitHouseExpenseAddCategoryForm($(this));
        });

    $(document)
        .off('submit.houseExpenseEditCat', '#form-house-expense-edit-category')
        .on('submit.houseExpenseEditCat', '#form-house-expense-edit-category', function (e) {
            e.preventDefault();
            submitHouseExpenseEditCategoryForm($(this));
        });

    $(document)
        .off('click.houseExpenseDeleteCat', '#house-expense-delete-cat-confirm')
        .on('click.houseExpenseDeleteCat', '#house-expense-delete-cat-confirm', function (e) {
            e.preventDefault();
            confirmDeleteHouseExpenseCategory();
        });

    $('#modal-house-expense-add-category').on('hidden.bs.modal', function () {
        var $form = $('#form-house-expense-add-category');
        if ($form.length) $form[0].reset();
        $('#house-expense-add-cat-type').val('2');
        $('#house-expense-add-cat-name').removeClass('is-invalid');
        houseExpenseShowCategoryFormError($('#house-expense-add-cat-error'), '');
        var $save = $('#house-expense-add-cat-save');
        var originalText = $save.data('original-text') || 'Save';
        $save.prop('disabled', false).html(originalText);
    });

    $('#modal-house-expense-edit-category').on('hidden.bs.modal', function () {
        $('#house-expense-edit-cat-name').removeClass('is-invalid');
        houseExpenseShowCategoryFormError($('#house-expense-edit-cat-error'), '');
        var $save = $('#house-expense-edit-cat-save');
        var originalText = $save.data('original-text') || 'Save';
        $save.prop('disabled', false).html(originalText);
    });

    $('#modal-house-expense-delete-category').on('hidden.bs.modal', function () {
        window.houseExpenseDeleteCategoryId = null;
        window.houseExpenseDeleteCategoryKind = null;
        $('#house-expense-delete-cat-label').text('');
        houseExpenseShowCategoryFormError($('#house-expense-delete-cat-error'), '');
        var $btn = $('#house-expense-delete-cat-confirm');
        var originalText = $btn.data('original-text') || 'Delete';
        $btn.removeClass('d-none').prop('disabled', false).html(originalText);
    });
}

function submitHouseExpenseAddCategoryForm($form) {
    var t = window.houseExpenseTranslations || {};
    var mode = window.houseExpenseAddCategoryMode;
    var name = String($('#house-expense-add-cat-name').val() || '').trim();
    var typeVal = $('#house-expense-add-cat-type').val() || '2';
    var parentId = $('#house-expense-add-cat-parent').val() || '';

    if (!name) {
        $('#house-expense-add-cat-name').addClass('is-invalid');
        houseExpenseShowCategoryFormError(
            $('#house-expense-add-cat-error'),
            t.category_name_required || 'Category name is required'
        );
        return;
    }

    var $save = $('#house-expense-add-cat-save');
    var saveHtml = $save.data('original-text') || $save.html();
    if (!$save.data('original-text')) $save.data('original-text', saveHtml);
    $save.prop('disabled', true).html(t.saving || 'Saving...');
    houseExpenseShowCategoryFormError($('#house-expense-add-cat-error'), '');

    $.ajax({
        url: '/add_expense_category',
        method: 'POST',
        data: {
            txtCategory: name,
            txtType: typeVal,
            txtParent: parentId,
            ajax: '1'
        },
        headers: { Accept: 'application/json' },
        success: function (res) {
            $('#modal-house-expense-add-category').modal('hide');
            reloadHouseExpenseCategoryCatalog(function () {
                if (res && res.success && res.id) {
                    if (mode === 'sub') {
                        window.houseExpenseExplorerState.itemCategoryId = String(res.id);
                        window.houseExpenseExplorerState.itemCategory = res.category || name;
                    } else {
                        window.houseExpenseExplorerState = {
                            mainCategoryId: String(res.id),
                            mainCategory: res.category || name,
                            itemCategoryId: null,
                            itemCategory: null
                        };
                    }
                }
                refreshHouseExpenseExplorerOnly();
                houseExpenseSyncCategoryAddButtons();
            });
        },
        error: function (xhr) {
            var msg = (xhr.responseJSON && xhr.responseJSON.error) || t.error || 'Could not save category';
            houseExpenseShowCategoryFormError($('#house-expense-add-cat-error'), msg);
        },
        complete: function () {
            $save.prop('disabled', false).html(saveHtml);
        }
    });
}

function submitHouseExpenseEditCategoryForm($form) {
    var t = window.houseExpenseTranslations || {};
    var catId = $('#house-expense-edit-cat-id').val();
    var name = String($('#house-expense-edit-cat-name').val() || '').trim();
    var typeVal = $('#house-expense-edit-cat-type').val() || '2';
    var parentId = $('#house-expense-edit-cat-parent').val() || '';

    if (!catId) return;
    if (!name) {
        $('#house-expense-edit-cat-name').addClass('is-invalid');
        houseExpenseShowCategoryFormError(
            $('#house-expense-edit-cat-error'),
            t.category_name_required || 'Category name is required'
        );
        return;
    }

    var $save = $('#house-expense-edit-cat-save');
    var saveHtml = $save.data('original-text') || $save.html();
    if (!$save.data('original-text')) $save.data('original-text', saveHtml);
    $save.prop('disabled', true).html(t.saving || 'Saving...');
    houseExpenseShowCategoryFormError($('#house-expense-edit-cat-error'), '');

    $.ajax({
        url: '/expense_category/' + catId,
        method: 'PUT',
        data: {
            txtCategory: name,
            txtType: typeVal,
            txtParent: parentId
        },
        success: function () {
            $('#modal-house-expense-edit-category').modal('hide');
            reloadHouseExpenseCategoryCatalog(function () {
                var st = window.houseExpenseExplorerState || {};
                if (String(st.mainCategoryId) === String(catId)) {
                    st.mainCategory = name;
                }
                if (String(st.itemCategoryId) === String(catId)) {
                    st.itemCategory = name;
                }
                refreshHouseExpenseExplorerOnly();
            });
        },
        error: function () {
            houseExpenseShowCategoryFormError(
                $('#house-expense-edit-cat-error'),
                t.error_updating_category || 'Could not update category'
            );
        },
        complete: function () {
            $save.prop('disabled', false).html(saveHtml);
        }
    });
}

function openHouseExpenseAddCategoryModal(mode) {
    var t = window.houseExpenseTranslations || {};
    var st = window.houseExpenseExplorerState || {};

    if (mode === 'sub' && !st.mainCategoryId) {
        return;
    }

    $('#house-expense-add-cat-name').val('').removeClass('is-invalid');
    $('#house-expense-add-cat-type').val('2');
    houseExpenseShowCategoryFormError($('#house-expense-add-cat-error'), '');

    if (mode === 'sub') {
        $('#house-expense-add-cat-parent').val(String(st.mainCategoryId));
        $('#house-expense-add-category-title').text(t.add_sub_category || 'Add sub category');
        $('#house-expense-add-cat-parent-hint')
            .removeClass('d-none')
            .html('Under: <strong>' + houseExpenseHtmlEscape(st.mainCategory || '') + '</strong>');
    } else {
        $('#house-expense-add-cat-parent').val('');
        $('#house-expense-add-category-title').text(t.add_main_category || 'Add main category');
        $('#house-expense-add-cat-parent-hint').addClass('d-none').text('');
    }

    window.houseExpenseAddCategoryMode = mode;
    houseExpenseShowCategoryModal($('#modal-house-expense-add-category'));
    $('#modal-house-expense-add-category').one('shown.bs.modal', function () {
        $('#house-expense-add-cat-name').trigger('focus');
    });
}

function openHouseExpenseAddVehicleModal() {
    var t = window.houseExpenseTranslations || {};
    $('#house-expense-add-vehicle-plate').val('').removeClass('is-invalid');
    $('#house-expense-add-vehicle-model').val('');
    $('#house-expense-add-vehicle-remarks').val('');
    houseExpenseShowCategoryFormError($('#house-expense-add-vehicle-error'), '');
    houseExpenseShowCategoryModal($('#modal-house-expense-add-vehicle'));
    $('#modal-house-expense-add-vehicle').one('shown.bs.modal', function () {
        $('#house-expense-add-vehicle-plate').trigger('focus');
    });
}

function openHouseExpenseEditVehicleModal(vehicleId) {
    var t = window.houseExpenseTranslations || {};
    var row = (window.houseExpenseVehicleRows || []).find(function (v) {
        return v && String(v.IDNo) === String(vehicleId);
    });
    if (!row) return;
    $('#house-expense-edit-vehicle-id').val(String(row.IDNo));
    $('#house-expense-edit-vehicle-plate').val(row.PLATE_NO || '').removeClass('is-invalid');
    $('#house-expense-edit-vehicle-model').val(row.MODEL || '');
    $('#house-expense-edit-vehicle-remarks').val(row.REMARKS || '');
    houseExpenseShowCategoryFormError($('#house-expense-edit-vehicle-error'), '');
    houseExpenseShowCategoryModal($('#modal-house-expense-edit-vehicle'));
}

function openHouseExpenseDeleteVehicleModal(vehicleId) {
    var row = (window.houseExpenseVehicleRows || []).find(function (v) {
        return v && String(v.IDNo) === String(vehicleId);
    });
    if (!row) return;
    window.houseExpenseDeleteVehicleId = String(vehicleId);
    $('#house-expense-delete-vehicle-label').text(houseExpenseFormatVehicleOptionLabel(row));
    houseExpenseShowCategoryFormError($('#house-expense-delete-vehicle-error'), '');
    houseExpenseShowCategoryModal($('#modal-house-expense-delete-vehicle'));
}

function submitHouseExpenseAddVehicleForm($form) {
    var t = window.houseExpenseTranslations || {};
    var plate = String($('#house-expense-add-vehicle-plate').val() || '').trim();
    if (!plate) {
        $('#house-expense-add-vehicle-plate').addClass('is-invalid');
        houseExpenseShowCategoryFormError(
            $('#house-expense-add-vehicle-error'),
            t.plate_no_required || 'Plate no. is required'
        );
        return;
    }
    var $save = $('#house-expense-add-vehicle-save');
    var saveHtml = $save.data('original-text') || $save.html();
    if (!$save.data('original-text')) $save.data('original-text', saveHtml);
    $save.prop('disabled', true).html(t.saving || 'Saving...');
    houseExpenseShowCategoryFormError($('#house-expense-add-vehicle-error'), '');
    $.ajax({
        url: '/house_expense_vehicle',
        method: 'POST',
        data: {
            txtPlateNo: plate,
            txtModel: $('#house-expense-add-vehicle-model').val(),
            txtRemarks: $('#house-expense-add-vehicle-remarks').val()
        },
        success: function () {
            $('#modal-house-expense-add-vehicle').modal('hide');
            reloadHouseExpenseVehicleCatalog();
        },
        error: function (xhr) {
            var msg = (xhr.responseJSON && xhr.responseJSON.error) || 'Could not save vehicle';
            houseExpenseShowCategoryFormError($('#house-expense-add-vehicle-error'), msg);
        },
        complete: function () {
            $save.prop('disabled', false).html(saveHtml);
        }
    });
}

function submitHouseExpenseEditVehicleForm($form) {
    var t = window.houseExpenseTranslations || {};
    var id = $('#house-expense-edit-vehicle-id').val();
    var plate = String($('#house-expense-edit-vehicle-plate').val() || '').trim();
    if (!plate || !id) {
        $('#house-expense-edit-vehicle-plate').addClass('is-invalid');
        houseExpenseShowCategoryFormError(
            $('#house-expense-edit-vehicle-error'),
            t.plate_no_required || 'Plate no. is required'
        );
        return;
    }
    var $save = $('#house-expense-edit-vehicle-save');
    var saveHtml = $save.data('original-text') || $save.html();
    if (!$save.data('original-text')) $save.data('original-text', saveHtml);
    $save.prop('disabled', true).html(t.saving || 'Saving...');
    houseExpenseShowCategoryFormError($('#house-expense-edit-vehicle-error'), '');
    $.ajax({
        url: '/house_expense_vehicle/' + id,
        method: 'PUT',
        data: {
            txtPlateNo: plate,
            txtModel: $('#house-expense-edit-vehicle-model').val(),
            txtRemarks: $('#house-expense-edit-vehicle-remarks').val()
        },
        success: function () {
            $('#modal-house-expense-edit-vehicle').modal('hide');
            reloadHouseExpenseVehicleCatalog(function () {
                if (typeof window.reloadData === 'function') window.reloadData();
            });
        },
        error: function (xhr) {
            var msg = (xhr.responseJSON && xhr.responseJSON.error) || 'Could not update vehicle';
            houseExpenseShowCategoryFormError($('#house-expense-edit-vehicle-error'), msg);
        },
        complete: function () {
            $save.prop('disabled', false).html(saveHtml);
        }
    });
}

function confirmDeleteHouseExpenseVehicle() {
    var t = window.houseExpenseTranslations || {};
    var id = window.houseExpenseDeleteVehicleId;
    if (!id) return;
    var $btn = $('#house-expense-delete-vehicle-confirm');
    var btnHtml = $btn.data('original-text') || $btn.html();
    if (!$btn.data('original-text')) $btn.data('original-text', btnHtml);
    $btn.prop('disabled', true).html(t.saving || 'Saving...');
    houseExpenseShowCategoryFormError($('#house-expense-delete-vehicle-error'), '');
    $.ajax({
        url: '/house_expense_vehicle/remove/' + id,
        method: 'PUT',
        success: function () {
            $('#modal-house-expense-delete-vehicle').modal('hide');
            reloadHouseExpenseVehicleCatalog(function () {
                if (typeof window.reloadData === 'function') window.reloadData();
            });
        },
        error: function (xhr) {
            var msg =
                (xhr.responseJSON && xhr.responseJSON.error) ||
                t.vehicle_has_expenses ||
                'Could not delete vehicle';
            houseExpenseShowCategoryFormError($('#house-expense-delete-vehicle-error'), msg);
        },
        complete: function () {
            $btn.prop('disabled', false).html(btnHtml);
        }
    });
}

function houseExpenseInitVehicleUi() {
    if (window.PermissionViewOnly && window.PermissionViewOnly.isViewOnly && window.PermissionViewOnly.isViewOnly()) {
        $('.js-house-expense-open-vehicle-modal, .js-house-expense-add-vehicle').addClass('d-none');
    }

    $(document)
        .off('click.houseExpenseVehicle', '.js-house-expense-open-vehicle-modal')
        .on('click.houseExpenseVehicle', '.js-house-expense-open-vehicle-modal', function (e) {
            e.preventDefault();
            e.stopPropagation();
            openHouseExpenseManageVehicleModal();
        });

    $(document)
        .off('click.houseExpenseVehicle', '.js-house-expense-add-vehicle')
        .on('click.houseExpenseVehicle', '.js-house-expense-add-vehicle', function (e) {
            e.preventDefault();
            e.stopPropagation();
            openHouseExpenseAddVehicleModal();
        });

    $(document)
        .off('click.houseExpenseVehicle', '.js-house-expense-edit-vehicle')
        .on('click.houseExpenseVehicle', '.js-house-expense-edit-vehicle', function (e) {
            e.preventDefault();
            e.stopPropagation();
            var id = $(this).attr('data-vehicle-id');
            if (id) openHouseExpenseEditVehicleModal(id);
        });

    $(document)
        .off('click.houseExpenseVehicle', '.js-house-expense-delete-vehicle')
        .on('click.houseExpenseVehicle', '.js-house-expense-delete-vehicle', function (e) {
            e.preventDefault();
            e.stopPropagation();
            var id = $(this).attr('data-vehicle-id');
            if (id) openHouseExpenseDeleteVehicleModal(id);
        });

    $(document)
        .off('submit.houseExpenseAddVehicle', '#form-house-expense-add-vehicle')
        .on('submit.houseExpenseAddVehicle', '#form-house-expense-add-vehicle', function (e) {
            e.preventDefault();
            submitHouseExpenseAddVehicleForm($(this));
        });

    $(document)
        .off('submit.houseExpenseEditVehicle', '#form-house-expense-edit-vehicle')
        .on('submit.houseExpenseEditVehicle', '#form-house-expense-edit-vehicle', function (e) {
            e.preventDefault();
            submitHouseExpenseEditVehicleForm($(this));
        });

    $(document)
        .off('click.houseExpenseDeleteVehicle', '#house-expense-delete-vehicle-confirm')
        .on('click.houseExpenseDeleteVehicle', '#house-expense-delete-vehicle-confirm', function (e) {
            e.preventDefault();
            confirmDeleteHouseExpenseVehicle();
        });

    reloadHouseExpenseVehicleCatalog();
}

window.addHouseExpense = addHouseExpense;
window.addHouseExpenseFromExplorer = addHouseExpenseFromExplorer;
window.addHouseExpenseMainCategory = addHouseExpenseMainCategory;
window.addHouseExpenseSubCategory = addHouseExpenseSubCategory;
window.openHouseExpenseAddCategoryModal = openHouseExpenseAddCategoryModal;
window.openHouseExpenseEditCategoryModal = openHouseExpenseEditCategoryModal;
window.openHouseExpenseDeleteCategoryModal = openHouseExpenseDeleteCategoryModal;
window.houseExpenseInitCategoryAddUi = houseExpenseInitCategoryAddUi;
window.houseExpenseInitVehicleUi = houseExpenseInitVehicleUi;

function get_agent() {
    $.ajax({
        url: '/users',
        method: 'GET',
        success: function (response) {
            var selectOptions = $('#oic');
            selectOptions.empty();
            selectOptions.append($('<option>', {
                value: '',
                text: window.houseExpenseTranslations?.select_officer_in_charge || '--SELECT OFFICER IN CHARGE--'
            }));
            response.forEach(function (option) {
                selectOptions.append($('<option>', {
                    value: option.user_id,
                    text: option.FIRSTNAME + ' ' + option.LASTNAME
                }));
            });
        },
        error: function (xhr, status, error) {
            // Error fetching options
        }
    });
}

function edit_expense_category(id) {
    $.ajax({
        url: '/expense_category_data',
        method: 'GET',
        success: function (response) {
            var selectOptions = $('.txtCategory');
            selectOptions.empty();
            selectOptions.append($('<option>', {
                selected: false,
                value: '',
                text: window.houseExpenseTranslations?.select_expense_category || '--SELECT EXPENSE CATEGORY--',
                disabled: true // Disable the default option
            }));
            response.forEach(function (option) {
                var selected = false;
                if (option.IDNo == id) {
                    selected = true;
                }
                selectOptions.append($('<option>', {
                    selected: selected,
                    value: option.IDNo,
                    text: option.CATEGORY
                }));
            });
        },
        error: function (xhr, status, error) {
            // Error fetching options
        }
    });
}

$(document).ready(function () {
    $("input[data-type='number']").keyup(function (event) {
        // skip for arrow keys
        if (event.which >= 37 && event.which <= 40) {
            event.preventDefault();
        }
        var $this = $(this);
        var num = $this.val().replace(/,/gi, "");
        var num2 = num.split(/(?=(?:\d{3})+$)/).join(",");
        $this.val(num2);
    });

    // New house expense modal: bind only when jQuery and DOM are ready (fixes "$ is not defined")
    var isSubmittingNewExpense = false;
    $('#modal-new-house-expense').on('shown.bs.modal', function () {
        isSubmittingNewExpense = false;
        var $btn = $('#btn-save-new-expense');
        var originalText = $btn.data('original-text') || $btn.html();
        var isViewOnly = window.PermissionViewOnly && window.PermissionViewOnly.isViewOnly && window.PermissionViewOnly.isViewOnly();
        if (!isViewOnly) $btn.prop('disabled', false).html(originalText);
        var $form = $('#add_junket_house_expense');
        if ($form.length) $form[0].reset();
        if (window.houseExpensePendingNewExpenseCategoryId) {
            houseExpenseApplyNewExpenseCategoryUi(window.houseExpensePendingNewExpenseCategoryId);
        } else {
            houseExpenseApplyNewExpenseCategoryUi(null);
        }
    });
    $('#modal-new-house-expense').on('hidden.bs.modal', function () {
        isSubmittingNewExpense = false;
        window.houseExpensePendingNewExpenseCategoryId = null;
        houseExpenseApplyNewExpenseCategoryUi(null);
        var $btn = $('#btn-save-new-expense');
        var originalText = $btn.data('original-text') || $btn.html();
        var isViewOnly = window.PermissionViewOnly && window.PermissionViewOnly.isViewOnly && window.PermissionViewOnly.isViewOnly();
        if (!isViewOnly) $btn.prop('disabled', false).html(originalText);
    });
    $('#add_junket_house_expense').on('submit', function (event) {
        event.preventDefault();
        if (isSubmittingNewExpense) return false;
        var isValid = true;
        $(this).find(':input[required]:enabled').each(function () {
            if ($(this).val() === '') {
                isValid = false;
                $(this).addClass('is-invalid');
            } else {
                $(this).removeClass('is-invalid');
            }
        });
        if (!isValid) {
            if (typeof Swal !== 'undefined') {
                Swal.fire({ icon: 'error', title: 'Inserting Error', text: 'Please fill in all required fields.' });
            }
            return false;
        }
        isSubmittingNewExpense = true;
        var $submitBtn = $('#btn-save-new-expense');
        var originalText = $submitBtn.html();
        $submitBtn.prop('disabled', true).html('Saving...');
        var formData = new FormData(this);
        var $form = $(this);
        $.ajax({
            url: '/add_junket_house_expense',
            type: 'POST',
            data: formData,
            processData: false,
            contentType: false,
            success: function (response) {
                houseExpenseFinishSaveSuccess({
                    resetSubmitting: function () {
                        isSubmittingNewExpense = false;
                    },
                    $modal: $('#modal-new-house-expense'),
                    $btn: $submitBtn,
                    originalHtml: originalText,
                    title: 'Added successfully',
                    confirmButtonText: 'OK'
                });
            },
            error: function (xhr, status, error) {
                isSubmittingNewExpense = false;
                $submitBtn.prop('disabled', false).html(originalText);
                var errorMessage = (xhr.responseJSON && xhr.responseJSON.error) ? xhr.responseJSON.error : 'An error occurred';
                if (typeof Swal !== 'undefined') {
                    Swal.fire({ icon: 'error', title: 'Error', text: errorMessage || 'Failed to save expense. Please try again.' });
                }
                console.error('Error saving house expense:', error);
            }
        });
        return false;
    });

    $(document).on('change', '#expense-category-select', function () {
        houseExpenseToggleCarExpenseFields($(this).val());
    });
    $(document).on('change', '#txtCategory', function () {
        houseExpenseToggleCarExpenseFields($(this).val());
    });

    // New return money modal: bind after jQuery is ready (fixes "$ is not defined" on house_expense page)
    var isSubmittingReturnMoney = false;
    $('#modal-new-return-money').on('shown.bs.modal', function () {
        isSubmittingReturnMoney = false;
        var $btn = $('#btn-save-new-return-money');
        var originalText = $btn.data('original-text') || $btn.html();
        var isViewOnly = window.PermissionViewOnly && window.PermissionViewOnly.isViewOnly && window.PermissionViewOnly.isViewOnly();
        if (!isViewOnly) $btn.prop('disabled', false).html(originalText);
        var $formEl = document.getElementById('add_return_money');
        if ($formEl) $formEl.reset();
    });
    $('#modal-new-return-money').on('hidden.bs.modal', function () {
        isSubmittingReturnMoney = false;
        var $btn = $('#btn-save-new-return-money');
        var originalText = $btn.data('original-text') || $btn.html();
        var isViewOnly = window.PermissionViewOnly && window.PermissionViewOnly.isViewOnly && window.PermissionViewOnly.isViewOnly();
        if (!isViewOnly) $btn.prop('disabled', false).html(originalText);
    });
    $('#add_return_money').on('submit', function (event) {
        event.preventDefault();
        if (isSubmittingReturnMoney) return false;
        var $form = $(this);
        var isValid = true;
        $form.find(':input[required]').each(function () {
            if ($(this).val() === '' || $(this).val().trim() === '') {
                isValid = false;
                $(this).addClass('is-invalid');
            } else {
                $(this).removeClass('is-invalid');
            }
        });
        if (!isValid) {
            if (typeof Swal !== 'undefined') {
                Swal.fire({ icon: 'error', title: 'Error', text: 'Please fill in all required fields.' });
            }
            return false;
        }
        isSubmittingReturnMoney = true;
        var $submitBtn = $('#btn-save-new-return-money');
        var originalText = $submitBtn.html();
        $submitBtn.prop('disabled', true).html('Saving...');
        var descriptionValue = $form.find('textarea[name="txtDescription"]').val() || '';
        var amountValue = $form.find('input[name="txtAmount"]').val() || '';
        if (amountValue) amountValue = amountValue.toString().replace(/,/g, '').trim();
        var formData = { txtDescription: descriptionValue.trim(), txtAmount: amountValue };
        if (!amountValue || amountValue === '' || parseFloat(amountValue) <= 0) {
            isSubmittingReturnMoney = false;
            $submitBtn.prop('disabled', false).html(originalText);
            if (typeof Swal !== 'undefined') {
                Swal.fire({ icon: 'error', title: 'Error', text: 'Please enter a valid amount.' });
            }
            return false;
        }
        $.ajax({
            url: '/add_return_money',
            type: 'POST',
            data: formData,
            success: function (response) {
                houseExpenseFinishSaveSuccess({
                    resetSubmitting: function () {
                        isSubmittingReturnMoney = false;
                    },
                    $modal: $('#modal-new-return-money'),
                    $btn: $submitBtn,
                    originalHtml: originalText,
                    title: 'Added successfully',
                    confirmButtonText: 'OK'
                });
            },
            error: function (xhr, status, error) {
                isSubmittingReturnMoney = false;
                $submitBtn.prop('disabled', false).html(originalText);
                var errorMessage = (xhr.responseJSON && xhr.responseJSON.error) ? xhr.responseJSON.error : 'An error occurred';
                if (typeof Swal !== 'undefined') {
                    Swal.fire({ icon: 'error', title: 'Error', text: errorMessage || 'Failed to save return money. Please try again.' });
                }
                console.error('Error adding return money:', error);
            }
        });
        return false;
    });
})

function onlyNumberKey(evt) {

    let ASCIICode = (evt.which) ? evt.which : evt.keyCode
    if (ASCIICode > 31 && (ASCIICode < 48 || ASCIICode > 57))
        return false;
    return true;
}