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
    sortDir: 'desc'
};

/** Main category / item explorer + graph (date range only for graph race). */
window.houseExpenseExplorerState = {
    mainCategoryId: null,
    mainCategory: null,
    itemCategoryId: null,
    itemCategory: null
};
window.houseExpenseCategoryRows = [];
window.houseExpenseItemSearchQuery = '';
window.houseExpenseAnimateItemTable = false;

function resetHouseExpenseExplorerState() {
    window.houseExpenseExplorerState = {
        mainCategoryId: null,
        mainCategory: null,
        itemCategoryId: null,
        itemCategory: null
    };
}

function houseExpenseApplyDefaultMainFromRows(mainRows) {
    var st = window.houseExpenseExplorerState || {};
    if (st.mainCategoryId || !mainRows || !mainRows.length) return;
    var first = mainRows[0];
    window.houseExpenseExplorerState.mainCategoryId = String(first.IDNo);
    window.houseExpenseExplorerState.mainCategory = first.CATEGORY || null;
    window.houseExpenseExplorerState.itemCategoryId = null;
    window.houseExpenseExplorerState.itemCategory = null;
}

function getHouseExpenseFilterMode() {
    return $('input[name="filter-mode"]:checked').val() || 'settlement';
}

function hasHouseExpenseDateRangeComplete() {
    var el = document.getElementById('daterange-picker');
    return !!(el && el._flatpickr && el._flatpickr.selectedDates && el._flatpickr.selectedDates.length === 2);
}

function houseExpenseEscapeRegex(s) {
    return String(s || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function getHouseExpenseGrandDateLabel() {
    var mode = getHouseExpenseFilterMode();
    if (mode === 'settlement') {
        return $('#settlement-date-picker').val() || '—';
    }
    var el = document.getElementById('daterange-picker');
    if (el && el._flatpickr && el._flatpickr.selectedDates && el._flatpickr.selectedDates.length === 2) {
        var a = el._flatpickr.selectedDates[0];
        var b = el._flatpickr.selectedDates[1];
        return moment(a).format('MMM D, YYYY') + ' – ' + moment(b).format('MMM D, YYYY');
    }
    return 'Select date range';
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

function buildHouseExpenseActionButtons(row, amount) {
    var permissions = parseInt($('#user-role').data('permissions'), 10);
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
            '" data-oic="' +
            attrEncode(row.OIC || '') +
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
        row.AMOUNT
    ];
    return parts.some(function (p) {
        return p != null && String(p).toLowerCase().indexOf(q) !== -1;
    });
}

function houseExpenseGetFilteredItemRows(allRows) {
    var st = window.houseExpenseExplorerState || {};
    var rows = (allRows || []).slice();
    var searchQ = String(window.houseExpenseItemSearchQuery || '').trim();

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
        var amount = parseFloat(row.AMOUNT) || 0;
        if (row.record_type === 'return_money') totalReturnMoney += amount;
        else totalExpense += amount;
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

        if (!st.mainCategoryId && !st.mainCategory) {
            $('#expense-item-panel-subtitle').text('');
            $tbody.html(
                '<tr><td colspan="6" class="text-muted small text-center py-3">Select a main category</td></tr>'
            );
            updateHouseExpenseItemFooterTotals(allRows);
            return;
        }

        $('#expense-item-panel-subtitle').text(houseExpenseGetExplorerSubtitleText(st));

        rows = houseExpenseGetFilteredItemRows(allRows);

        rows.sort(function (a, b) {
            return new Date(b.ENCODED_DT || 0).getTime() - new Date(a.ENCODED_DT || 0).getTime();
        });

        if (rows.length === 0) {
            $tbody.html(
                '<tr><td colspan="6" class="text-center text-muted py-3">' +
                    houseExpenseHtmlEscape(noDataText) +
                    '</td></tr>'
            );
            updateHouseExpenseItemFooterTotals(allRows);
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
                        ? '<span style="color: green;">' + formattedAmount + '</span>'
                        : formattedAmount;
                var nameLabel =
                    row.record_type === 'return_money' ? 'Return Money' : row.expense_category || 'N/A';
                /* Headers: description key = IN-CHARGE, receipt_no key = DESCRIPTION (see locales) */
                var inChargeCol =
                    row.record_type === 'return_money' ? '-' : row.DESCRIPTION || row.OIC || '-';
                var descriptionCol =
                    row.record_type === 'return_money' ? row.DESCRIPTION || '-' : row.RECEIPT_NO || '-';

                return (
                    '<tr class="js-expense-entry-row" data-expense-id="' +
                    attrEncode(row.expense_id) +
                    '">' +
                    '<td>' +
                    buildExpenseNameCell(row, nameLabel) +
                    '</td>' +
                    '<td>' +
                    houseExpenseHtmlEscape(inChargeCol) +
                    '</td>' +
                    '<td>' +
                    houseExpenseHtmlEscape(descriptionCol) +
                    '</td>' +
                    '<td class="text-end">' +
                    amountDisplay +
                    '</td>' +
                    '<td class="text-end expense-item-date-cell">' +
                    houseExpenseHtmlEscape(formattedDate) +
                    '</td>' +
                    '<td class="text-end expense-item-action-cell">' +
                    buildHouseExpenseActionButtons(row, amount) +
                    '</td>' +
                    '</tr>'
                );
            })
            .join('');

        $tbody.html(html);
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
        else te += a;
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
        else total_expense += amount;
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
        var expenseRows = (window.houseExpenseLastRows || []).filter(function (r) {
            return r && r.record_type !== 'return_money';
        });
        houseExpenseApplyDefaultMainFromRows(getHouseExpenseMainCategoryRows(expenseRows));
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

    houseExpenseApplyDefaultMainFromRows(mainRows);
    st = window.houseExpenseExplorerState || {};

    if (mainRows.length === 0) {
        $mainList.html('<div class="text-muted small p-2">No main categories</div>');
        renderHouseExpenseSubCategoryList(data || []);
        renderHouseExpenseItemEntriesTable(data || []);
        return;
    }

    var mainHtml = [];

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
}

function refreshHouseExpenseDashboard(data, totalExpense, totalReturnMoney) {
    var te = Number(totalExpense) || 0;
    var st = window.houseExpenseExplorerState || {};

    $('#expense-kpi-grand-amount').text(formatHouseExpensePeso(te));
    $('#expense-kpi-grand-range').text(getHouseExpenseGrandDateLabel());

    var selected = houseExpenseSumExpenseRows(data, function (r) {
        return houseExpenseRowMatchesExplorer(r);
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

    if (rows.length === 0) {
        $('#breakdown-modal-tbody').html('<tr><td colspan="5" class="text-center text-muted py-3">No entries found.</td></tr>');
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
    if (key === 'description') return String(row.RECEIPT_NO || '').toLowerCase();
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
        var descriptionText = isReturnMoney ? (row.DESCRIPTION || '-') : (row.RECEIPT_NO || '-');
        var inChargeText = isReturnMoney ? '-' : (row.OIC || row.DESCRIPTION || '-');
        return (
            '<tr>' +
                '<td>' + houseExpenseHtmlEscape(descriptionText) + '</td>' +
                '<td>' + houseExpenseHtmlEscape(inChargeText) + '</td>' +
                '<td class="fw-semibold text-end">' + formatHouseExpenseNumber(amount) + '</td>' +
                '<td>' + houseExpenseHtmlEscape(row.FIRSTNAME || '-') + '</td>' +
                '<td>' + houseExpenseHtmlEscape(displayDate) + '</td>' +
            '</tr>'
        );
    }).join('');

    $('#breakdown-modal-tbody').html(html || '<tr><td colspan="5" class="text-center text-muted py-3">No entries found.</td></tr>');
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

    window.updateSettlementSubviewIndicator = function () {
        var $indicator = $('#settlement-subview-indicator');
        if (!$indicator.length) return;
        if (getHouseExpenseFilterMode() !== 'settlement') {
            $indicator.text('').removeClass('is-open is-settled').hide();
            if (typeof window.updateOpenPoolBreadcrumbVisibility === 'function') window.updateOpenPoolBreadcrumbVisibility();
            return;
        }
        $indicator.show();
        if (window.selectedSettlementSubView === 'settled') {
            $indicator.text('Settled').removeClass('is-open').addClass('is-settled');
        } else {
            $indicator.text('Open').removeClass('is-settled').addClass('is-open');
        }
        if (typeof window.updateOpenPoolBreadcrumbVisibility === 'function') window.updateOpenPoolBreadcrumbVisibility();
    };

    function clearExpenseTableDisplay() {
        resetHouseExpenseExplorerState();
        window.houseExpenseItemSearchQuery = '';
        $('#expense-item-search').val('');
        houseExpenseApplyLoadedData([]);
    }

    function initializeExpenseTable() {
        function reloadData(resetExplorer) {
            var filterMode = $('input[name="filter-mode"]:checked').val() || 'settlement';
            var requestData = {};
            var requestMode = filterMode;
            
            if (filterMode === 'settlement') {
                // Settlement date mode
                var settlementDate = window.selectedSettlementDate || 'current';
                requestData.date = settlementDate;
                requestData.settlement_view = window.selectedSettlementSubView || 'open';
            } else {
                // Date range mode
                var dateRangePicker = document.getElementById('daterange-picker');
                var fromDate = null;
                var toDate = null;
                
                if (dateRangePicker && dateRangePicker._flatpickr) {
                    var selectedDates = dateRangePicker._flatpickr.selectedDates;
                    if (selectedDates && selectedDates.length === 2) {
                        var pad = function(n) { return String(n).padStart(2, '0'); };
                        fromDate = selectedDates[0].getFullYear() + '-' + pad(selectedDates[0].getMonth() + 1) + '-' + pad(selectedDates[0].getDate());
                        toDate = selectedDates[1].getFullYear() + '-' + pad(selectedDates[1].getMonth() + 1) + '-' + pad(selectedDates[1].getDate());
                    }
                }
                
                if (!fromDate || !toDate) {
                    clearExpenseTableDisplay();
                    return;
                }
                
                requestData.fromDate = fromDate;
                requestData.toDate = toDate;
            }
            
            $.ajax({
                url: '/junket_house_expense_data',
                method: 'GET',
                data: requestData,
                success: function (data) {
                    var currentMode = $('input[name="filter-mode"]:checked').val() || 'settlement';
                    if (currentMode !== requestMode) {
                        // Ignore stale response from previous mode
                        return;
                    }
                    if (resetExplorer === true) {
                        resetHouseExpenseExplorerState();
                    }
                    houseExpenseApplyLoadedData(data);

                },
                error: function (xhr, status, error) {
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
        var actionColIndex = 5;
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
            rows.push([
                $('#expense-item-cat-tbl tfoot tr').eq(0).find('th').eq(0).text().trim(),
                '',
                '',
                $('#TOTAL_EXPENSE_AMOUNT').text().trim(),
                '',
                ''
            ]);
            rows.push([
                $('#expense-item-cat-tbl tfoot tr').eq(1).find('th').eq(0).text().trim(),
                '',
                '',
                $('#TOTAL_RETURN_MONEY_AMOUNT').text().trim(),
                '',
                ''
            ]);
            rows.push([
                $('#expense-item-cat-tbl tfoot tr').eq(2).find('th').eq(0).text().trim(),
                '',
                '',
                $('#TOTAL_NET_EXPENSES_AMOUNT').text().trim(),
                '',
                ''
            ]);
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
            'th:nth-child(4),td:nth-child(4){text-align:right;padding-right:14px;}',
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
        var mode = $('input[name="filter-mode"]:checked').val() || 'settlement';
        var subtitle = mode === 'settlement'
            ? ($('#settlement-date-picker').val() || '')
            : ($('#daterange-picker').val() || '');
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
                row.record_type === 'return_money' ? row.DESCRIPTION || '-' : row.RECEIPT_NO || '-',
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

    // ======================= EXPENSE SETTLEMENT FUNCTIONALITY ==================
    
    // Filter mode toggle handler
    $('input[name="filter-mode"]').on('change', function() {
        var mode = $(this).val();
        setHouseExpenseDailySettleSelectionMode(false);
        setHouseExpenseOpenPoolSelectionMode(false);
        if (mode === 'settlement') {
            $('#settlement-date-wrapper').show();
            $('#daterange-wrapper').hide();
            toggleHouseExpenseBreakdownPanel(mode);
            if (typeof window.updateSettlementSubviewIndicator === 'function') window.updateSettlementSubviewIndicator();
            if (typeof window.reloadData === 'function') {
                window.reloadData();
            }
        } else {
            $('#settlement-date-wrapper').hide();
            $('#daterange-wrapper').show();
            var daterangePickerEl = document.getElementById('daterange-picker');
            if (daterangePickerEl && daterangePickerEl._flatpickr) {
                daterangePickerEl._flatpickr.clear();
            }
            clearExpenseTableDisplay();
            toggleHouseExpenseBreakdownPanel(mode);
            if (typeof window.updateSettlementSubviewIndicator === 'function') window.updateSettlementSubviewIndicator();
        }
    });

    // Initial visibility based on default selected mode.
    toggleHouseExpenseBreakdownPanel();
    
    // Initialize date range picker (single input with range mode)
    var dateRangePicker = null;
    if (document.getElementById('daterange-picker')) {
        var now = new Date();
        var pad = function(n) { return String(n).padStart(2, '0'); };
        
        var wrapper = document.querySelector('#settlement-date-wrapper .input-group');
        var settledDates = [];
        if (wrapper) {
            var settledDatesRaw = wrapper.getAttribute('data-settled-dates');
            try {
                var parsedDates = settledDatesRaw ? JSON.parse(settledDatesRaw) : [];
                // Make sure window.settledDatesForMonth is set if not already set
                if (!window.settledDatesForMonth || window.settledDatesForMonth.length === 0) {
                    window.settledDatesForMonth = parsedDates;
                }
                settledDates = window.settledDatesForMonth || parsedDates;
            } catch (e) {
                // Error parsing settled dates
            }
        }
        
        // Get earliest settlement date (start of settlement period)
        var earliestSettlementDate = null;
        if (settledDates.length > 0) {
            var sortedDates = settledDates.slice().sort();
            earliestSettlementDate = sortedDates[0];
        } else {
            // If no settled dates, allow navigation back to January 1 of previous year
            var earliestAllowed = new Date(now.getFullYear() - 1, 0, 1);
            earliestSettlementDate = earliestAllowed.getFullYear() + '-' + pad(earliestAllowed.getMonth() + 1) + '-' + pad(earliestAllowed.getDate());
        }
        
        function jumpHouseExpenseRangeToCurrentThreeMonths(instance) {
            if (!instance) return;
            var current = new Date();
            instance.jumpToDate(new Date(current.getFullYear(), current.getMonth() - 2, 1), false);
        }

        dateRangePicker = flatpickr("#daterange-picker", {
            mode: 'range',
            dateFormat: 'Y-m-d',
            altInput: true,
            altFormat: 'M d, Y',
            defaultDate: [],
            showMonths: 3,
            onDayCreate: function (dayElem) {
                if (!dayElem || !dayElem.dateObj) return;
                var d = dayElem.dateObj;
                var dStr = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
                var settledDates = window.settledDatesForMonth || [];
                if (dStr && settledDates.indexOf(dStr) !== -1) {
                    dayElem.classList.add('settled-day');
                }
            },
            onReady: function (selectedDates, dateStr, instance) {
                jumpHouseExpenseRangeToCurrentThreeMonths(instance);
                // Highlight settled dates when calendar is ready (initial render)
                setTimeout(function () {
                    if (!instance.calendarContainer) return;
                    var settledDates = window.settledDatesForMonth || [];
                    var days = instance.calendarContainer.querySelectorAll('.flatpickr-day');
                    days.forEach(function (el) {
                        el.classList.remove('settled-day');
                        if (!el.dateObj) return;
                        var d = el.dateObj;
                        var dStr = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
                        if (dStr && settledDates.indexOf(dStr) !== -1) {
                            el.classList.add('settled-day');
                        }
                    });
                }, 100);
            },
            onOpen: function (selectedDates, dateStr, instance) {
                jumpHouseExpenseRangeToCurrentThreeMonths(instance);
                setTimeout(function () {
                    if (!instance.calendarContainer) return;
                    var settledDates = window.settledDatesForMonth || [];
                    var days = instance.calendarContainer.querySelectorAll('.flatpickr-day');
                    days.forEach(function (el) {
                        el.classList.remove('settled-day');
                        if (!el.dateObj) return;
                        var d = el.dateObj;
                        var dStr = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
                        if (dStr && settledDates.indexOf(dStr) !== -1) {
                            el.classList.add('settled-day');
                        }
                    });
                }, 0);
            },
            onMonthChange: function (selectedDates, dateStr, instance) {
                setTimeout(function () {
                    if (!instance.calendarContainer) return;
                    var settledDates = window.settledDatesForMonth || [];
                    var days = instance.calendarContainer.querySelectorAll('.flatpickr-day');
                    days.forEach(function (el) {
                        el.classList.remove('settled-day');
                        if (!el.dateObj) return;
                        var d = el.dateObj;
                        var dStr = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
                        if (dStr && settledDates.indexOf(dStr) !== -1) {
                            el.classList.add('settled-day');
                        }
                    });
                }, 0);
            },
            onChange: function(selectedDates, dateStr, instance) {
                // Also highlight settled dates when date selection changes
                setTimeout(function () {
                    if (!instance.calendarContainer) return;
                    var settledDates = window.settledDatesForMonth || [];
                    var days = instance.calendarContainer.querySelectorAll('.flatpickr-day');
                    days.forEach(function (el) {
                        el.classList.remove('settled-day');
                        if (!el.dateObj) return;
                        var d = el.dateObj;
                        var dStr = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
                        if (dStr && settledDates.indexOf(dStr) !== -1) {
                            el.classList.add('settled-day');
                        }
                    });
                }, 0);
                if (getHouseExpenseFilterMode() === 'daterange') {
                    toggleHouseExpenseBreakdownPanel('daterange');
                    if (selectedDates.length === 2) {
                        if (typeof window.reloadData === 'function') {
                            window.reloadData();
                        }
                    } else {
                        clearExpenseTableDisplay();
                    }
                }
            }
        });
    }
    
    // Initialize settlement date picker
    var settlementDatePicker = null;
    if (document.getElementById('settlement-date-picker')) {
        var wrapper = document.querySelector('#settlement-date-wrapper .input-group');
        if (wrapper) {
            var defaultDate = wrapper.getAttribute('data-initial-settlement-date') ||
                wrapper.getAttribute('data-today') ||
                new Date().toISOString().slice(0, 10);
            var maxPickerDate = wrapper.getAttribute('data-max-settlement-date');
            var settledDatesRaw = wrapper.getAttribute('data-settled-dates');
            try {
                window.settledDatesForMonth = settledDatesRaw ? JSON.parse(settledDatesRaw) : [];
            } catch (e) {
                window.settledDatesForMonth = [];
            }
            
            window.selectedSettlementDate = defaultDate;
            
            // Calculate earliest allowed date (January 1 of previous year)
            var now = new Date();
            var pad = function(n) { return String(n).padStart(2, '0'); };
            var earliestAllowed = new Date(now.getFullYear() - 1, 0, 1);
            var earliestSettlementDate = earliestAllowed.getFullYear() + '-' + pad(earliestAllowed.getMonth() + 1) + '-' + pad(earliestAllowed.getDate());
            
            var settlementPickerOptions = {
                dateFormat: 'Y-m-d',
                altInput: true,
                altFormat: 'F d, Y',
                defaultDate: defaultDate,
                minDate: earliestSettlementDate,
                allowInput: false,
                onDayCreate: function (dayElem) {
                    if (!dayElem || !dayElem.dateObj) return;
                    var d = dayElem.dateObj;
                    var dStr = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
                    var settledDates = window.settledDatesForMonth || [];
                    if (dStr && settledDates.indexOf(dStr) !== -1) dayElem.classList.add('settled-day');
                },
                onOpen: function (selectedDates, dateStr, instance) {
                    setTimeout(function () {
                        if (!instance.calendarContainer) return;
                        var settledDates = window.settledDatesForMonth || [];
                        var days = instance.calendarContainer.querySelectorAll('.flatpickr-day');
                        days.forEach(function (el) {
                            el.classList.remove('settled-day');
                            if (!el.dateObj) return;
                            var d = el.dateObj;
                            var dStr = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
                            if (dStr && settledDates.indexOf(dStr) !== -1) el.classList.add('settled-day');
                        });
                    }, 0);
                },
                onChange: function (selectedDates, dateStr, instance) {
                    setHouseExpenseDailySettleSelectionMode(false);
                    setHouseExpenseOpenPoolSelectionMode(false);
                    window.selectedSettlementDate = dateStr || '';
                    window.selectedSettlementSubView = getHouseExpenseDefaultSubView(dateStr);
                    if (typeof window.updateNavigationButtons === 'function') window.updateNavigationButtons();
                    if (typeof window.updateSettlementSubviewIndicator === 'function') window.updateSettlementSubviewIndicator();
                    if (typeof window.updateSettleButtonState === 'function') window.updateSettleButtonState();
                    if (typeof window.reloadData === 'function') window.reloadData();
                },
                onMonthChange: function (selectedDates, dateStr, instance) {
                    setTimeout(function () {
                        if (!instance.calendarContainer) return;
                        var settledDates = window.settledDatesForMonth || [];
                        var days = instance.calendarContainer.querySelectorAll('.flatpickr-day');
                        days.forEach(function (el) {
                            el.classList.remove('settled-day');
                            if (!el.dateObj) return;
                            var d = el.dateObj;
                            var dStr = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
                            if (dStr && settledDates.indexOf(dStr) !== -1) el.classList.add('settled-day');
                        });
                    }, 0);
                }
            };
            if (maxPickerDate) {
                settlementPickerOptions.maxDate = maxPickerDate;
            }
            settlementDatePicker = flatpickr("#settlement-date-picker", settlementPickerOptions);
        }
    }

    // Settlement button state management
    var settleBtnLabel = (window.houseExpenseTranslations && window.houseExpenseTranslations.settle) || 'Settle';
    
    window.updateSettleButtonState = function (recordCount) {
        // Only update if in settlement mode
        var filterMode = $('input[name="filter-mode"]:checked').val() || 'settlement';
        if (filterMode !== 'settlement') {
            // Hide settle button in date range mode
            $('#btn-daily-settle').addClass('disabled').css('pointer-events', 'none').css('opacity', '0.5');
            return;
        }
        
        var date = window.selectedSettlementDate;
        var todayStr = $('#settlement-date-wrapper .input-group').attr('data-today') || new Date().toISOString().slice(0, 10);
        if (!date) {
            $('#btn-daily-settle').addClass('disabled').text(settleBtnLabel).css('pointer-events', 'none').css('opacity', '0.5');
            return;
        }
        var isPastDate = date < todayStr;
        var noRecordsForPastDate = (recordCount !== undefined && recordCount === 0 && isPastDate);
        var $btn = $('#btn-daily-settle');
        if (noRecordsForPastDate) {
            $btn.addClass('disabled').text(settleBtnLabel).css('pointer-events', 'none').css('opacity', '0.5');
        } else {
            $btn.removeClass('disabled').text(settleBtnLabel).css('pointer-events', 'auto').css('opacity', '1');
        }
    };

    // Previous/Next Date Navigation Functions
    function getEarliestSettlementDate() {
        // Allow navigation back to January 1 of previous year
        // (no longer restricted by settledDatesForMonth which only contains current month's settled dates)
        var now = new Date();
        var pad = function(n) { return String(n).padStart(2, '0'); };
        var earliestAllowed = new Date(now.getFullYear() - 1, 0, 1);
        return earliestAllowed.getFullYear() + '-' + pad(earliestAllowed.getMonth() + 1) + '-' + pad(earliestAllowed.getDate());
    }
    
    function getPreviousDate(currentDate) {
        if (!currentDate) return null;
        var current = new Date(currentDate + 'T12:00:00');
        var previous = new Date(current);
        previous.setDate(previous.getDate() - 1);
        var pad = function(n) { return String(n).padStart(2, '0'); };
        var previousDateStr = previous.getFullYear() + '-' + pad(previous.getMonth() + 1) + '-' + pad(previous.getDate());
        var earliestSettlementDate = getEarliestSettlementDate();
        if (previousDateStr < earliestSettlementDate) {
            return null;
        }
        return previousDateStr;
    }
    
    function getNextDate(currentDate) {
        if (!currentDate) return null;
        
        var current = new Date(currentDate + 'T12:00:00');
        var next = new Date(current);
        next.setDate(next.getDate() + 1);
        
        var pad = function(n) { return String(n).padStart(2, '0'); };
        var nextDateStr = next.getFullYear() + '-' + pad(next.getMonth() + 1) + '-' + pad(next.getDate());
        
        // Match Expense List: only cap Next when server sends a non-empty data-max-settlement-date.
        var wrapper = document.querySelector('#settlement-date-wrapper .input-group');
        var maxAllowedStr = wrapper && wrapper.getAttribute('data-max-settlement-date');
        if (maxAllowedStr && String(maxAllowedStr).trim() !== '' && nextDateStr > maxAllowedStr) {
            return null;
        }
        
        return nextDateStr;
    }
    
    // Expose updateNavigationButtons globally so it can be called from flatpickr onChange
    window.updateNavigationButtons = function() {
        var currentDate =
            window.selectedSettlementDate ||
            $('#settlement-date-wrapper .input-group').attr('data-initial-settlement-date') ||
            $('#settlement-date-wrapper .input-group').attr('data-today');
        var previousDate = getPreviousDate(currentDate);
        var nextDate = getNextDate(currentDate);
        
        // Update previous button state
        if (previousDate) {
            $('#btn-settlement-prev').prop('disabled', false);
        } else {
            $('#btn-settlement-prev').prop('disabled', true);
        }
        
        // Update next button state
        if (nextDate) {
            $('#btn-settlement-next').prop('disabled', false);
        } else {
            $('#btn-settlement-next').prop('disabled', true);
        }
    };
    
    function navigateToDate(targetDate, preferredSubView) {
        if (!targetDate) return;
        setHouseExpenseDailySettleSelectionMode(false);
        setHouseExpenseOpenPoolSelectionMode(false);
        
        // Update global selected date
        window.selectedSettlementDate = targetDate;
        window.selectedSettlementSubView =
            preferredSubView === 'settled' || preferredSubView === 'open'
                ? preferredSubView
                : getHouseExpenseDefaultSubView(targetDate);
        
        // Update flatpickr date picker
        var pickerEl = document.getElementById('settlement-date-picker');
        if (pickerEl && pickerEl._flatpickr) {
            pickerEl._flatpickr.setDate(targetDate, false);
        }
        
        // Update navigation button states
        updateNavigationButtons();
        if (typeof window.updateSettlementSubviewIndicator === 'function') window.updateSettlementSubviewIndicator();
        
        // Update settle button state
        if (typeof window.updateSettleButtonState === 'function') {
            window.updateSettleButtonState();
        }
        
        // Reload data
        if (typeof window.reloadExpenseBySettlementDate === 'function') {
            window.reloadExpenseBySettlementDate();
        }
    }
    
    // Previous button click handler
    $('#btn-settlement-prev').on('click', function() {
        var currentDate = window.selectedSettlementDate || $('.day-selector-wrapper').attr('data-default-settlement-date');
        if (currentDate === getClientTodayYmd() && hasHouseExpenseSettlementForDate(currentDate) && window.selectedSettlementSubView !== 'settled') {
            navigateToDate(currentDate, 'settled');
            return;
        }
        var previousDate = getPreviousDate(currentDate);
        
        if (previousDate) {
            navigateToDate(previousDate, getHouseExpenseDefaultSubView(previousDate));
        } else {
            var earliestDate = getEarliestSettlementDate();
            var formattedEarliest = earliestDate ? new Date(earliestDate + 'T12:00:00').toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }) : 'earliest settlement date';
            Swal.fire({
                icon: 'info',
                title: 'No Previous Date',
                text: 'You are already at the earliest settlement date (' + formattedEarliest + ').',
                confirmButtonText: 'OK',
                timer: 2000,
                showConfirmButton: false
            });
        }
    });
    
    // Next button click handler
    $('#btn-settlement-next').on('click', function() {
        var currentDate = window.selectedSettlementDate || $('#settlement-date-wrapper .input-group').attr('data-default-settlement-date');
        if (currentDate === getClientTodayYmd() && hasHouseExpenseSettlementForDate(currentDate) && window.selectedSettlementSubView === 'settled') {
            navigateToDate(currentDate, 'open');
            return;
        }
        var nextDate = getNextDate(currentDate);
        
        if (nextDate) {
            navigateToDate(nextDate, getHouseExpenseDefaultSubView(nextDate));
        } else {
            Swal.fire({
                icon: 'info',
                title: 'No Next Date',
                text: 'You are already at the latest available date.',
                confirmButtonText: 'OK',
                timer: 2000,
                showConfirmButton: false
            });
        }
    });

    window.reloadExpenseBySettlementDate = function () {
        if (typeof window.reloadData === 'function') {
            window.reloadData();
        }
    };

    // Settlement button click handler
    $('#btn-daily-settle').on('click', function (e) {
        e.preventDefault();
        if ($(this).hasClass('disabled') || $(this).prop('disabled')) return;
        if (getHouseExpenseFilterMode() !== 'settlement') {
            Swal.fire({
                title: 'Settlement Date mode required',
                text: 'Switch to Settlement Date mode first.',
                icon: 'warning',
                confirmButtonText: 'OK',
                confirmButtonColor: '#0d6efd'
            });
            return;
        }
        var settlementDate = window.selectedSettlementDate || new Date().toISOString().slice(0, 10);
        var $btn = $(this);

        if (!window.isDailySettleSelectionMode) {
            if (!Array.isArray(window.houseExpenseLastRows) || window.houseExpenseLastRows.length === 0) {
                Swal.fire({
                    title: 'No Records',
                    text: 'There are no expenses or return money records to settle.',
                    icon: 'info',
                    confirmButtonText: 'OK',
                    confirmButtonColor: '#0d6efd'
                });
                return;
            }
            setHouseExpenseDailySettleSelectionMode(true);
            if (typeof window.reloadExpenseBySettlementDate === 'function') {
                window.reloadExpenseBySettlementDate();
            } else if (typeof window.reloadData === 'function') {
                window.reloadData();
            }
            return;
        }

        var settlementItems = getSelectedHouseExpenseItems('.daily-settle-checkbox');
        if (settlementItems.length === 0) {
            setHouseExpenseDailySettleSelectionMode(false);
            if (typeof window.reloadExpenseBySettlementDate === 'function') window.reloadExpenseBySettlementDate();
            return;
        }
        
        var wrapperEl = document.querySelector('#settlement-date-wrapper .input-group');
        var todayStr = (wrapperEl && wrapperEl.getAttribute('data-today')) || getClientTodayYmd();
        var nowForMin = new Date();
        var minDateObj = new Date(nowForMin.getFullYear() - 1, 0, 1);
        var minAllowedDate =
            minDateObj.getFullYear() +
            '-' +
            String(minDateObj.getMonth() + 1).padStart(2, '0') +
            '-' +
            String(minDateObj.getDate()).padStart(2, '0');
        var initialDate = settlementDate || todayStr;
        window._swalExpenseSettlementTransferFp = null;

        Swal.fire({
            title: 'Assign settlement date',
            html:
                '<div class="text-start">' +
                '<div class="d-flex align-items-center gap-2">' +
                '<label for="swal-expense-settlement-date" class="form-label mb-0" style="white-space: nowrap;">Date:</label>' +
                '<input id="swal-expense-settlement-date" class="form-control text-center" readonly />' +
                '</div>' +
                '</div>',
            icon: 'question',
            showCancelButton: true,
            confirmButtonText: 'Continue',
            cancelButtonText: 'Cancel',
            confirmButtonColor: '#0d6efd',
            cancelButtonColor: '#6c757d',
            didOpen: function () {
                var inputEl = document.getElementById('swal-expense-settlement-date');
                if (!inputEl || !window.flatpickr) return;
                window._swalExpenseSettlementTransferFp = flatpickr(inputEl, {
                    dateFormat: 'Y-m-d',
                    altInput: true,
                    altFormat: 'F d, Y',
                    defaultDate: initialDate,
                    minDate: minAllowedDate,
                    allowInput: false
                });
            },
            preConfirm: function () {
                var fp = window._swalExpenseSettlementTransferFp;
                var chosenDate = '';
                if (fp && fp.selectedDates && fp.selectedDates[0]) {
                    var d = fp.selectedDates[0];
                    chosenDate =
                        d.getFullYear() +
                        '-' +
                        String(d.getMonth() + 1).padStart(2, '0') +
                        '-' +
                        String(d.getDate()).padStart(2, '0');
                }
                if (!/^\d{4}-\d{2}-\d{2}$/.test(chosenDate)) {
                    Swal.showValidationMessage('Please select a valid settlement date.');
                    return false;
                }
                return { settlement_date: chosenDate };
            }
        }).then(function (dateResult) {
            if (!dateResult.isConfirmed) return;
            var choice = dateResult.value;
            if (!choice || typeof choice !== 'object') return;
            settlementDate = choice.settlement_date;
            var formattedDate = settlementDate ? new Date(settlementDate + 'T12:00:00').toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }) : settlementDate;

            Swal.fire({
                title: 'Confirm',
                text: 'Assign ' + settlementItems.length + ' selected record(s) to settlement date ' + formattedDate + '?',
                icon: 'question',
                showCancelButton: true,
                confirmButtonText: 'Yes',
                cancelButtonText: 'Cancel',
                confirmButtonColor: '#0d6efd',
                cancelButtonColor: '#6c757d'
            }).then(function (result) {
                if (!result.isConfirmed) return;
                $btn.addClass('disabled').css('pointer-events', 'none').css('opacity', '0.5');
                $.ajax({
                    url: '/expense_daily_settlement/transfer',
                    method: 'POST',
                    contentType: 'application/json',
                    data: JSON.stringify({
                        settlement_date: settlementDate,
                        items: settlementItems
                    }),
                    success: function (res) {
                        var settledDate = (res && res.settlement_date) ? res.settlement_date : $('.day-selector-wrapper').attr('data-today');
                        window.selectedSettlementDate = settledDate || '';
                        
                        // Update settled dates array to include the newly settled date
                        if (settledDate && window.settledDatesForMonth) {
                            if (window.settledDatesForMonth.indexOf(settledDate) === -1) {
                                window.settledDatesForMonth.push(settledDate);
                                window.settledDatesForMonth.sort();
                            }
                        }
                        
                        var pickerEl = document.getElementById('settlement-date-picker');
                        if (pickerEl && pickerEl._flatpickr) pickerEl._flatpickr.setDate(settledDate || '', false);
                        window.selectedSettlementSubView = 'settled';
                        setHouseExpenseDailySettleSelectionMode(false);
                        
                        // Refresh date range picker highlighting if it exists
                        var dateRangePickerEl = document.getElementById('daterange-picker');
                        if (dateRangePickerEl && dateRangePickerEl._flatpickr && dateRangePickerEl._flatpickr.isOpen) {
                            var instance = dateRangePickerEl._flatpickr;
                            setTimeout(function () {
                                if (!instance.calendarContainer) return;
                                var currentSettledDates = window.settledDatesForMonth || [];
                                var days = instance.calendarContainer.querySelectorAll('.flatpickr-day');
                                days.forEach(function (el) {
                                    el.classList.remove('settled-day');
                                    if (!el.dateObj) return;
                                    var d = el.dateObj;
                                    var dStr = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
                                    if (dStr && currentSettledDates.indexOf(dStr) !== -1) el.classList.add('settled-day');
                                });
                            }, 0);
                        }
                        
                        var settledFormatted = (settledDate || settlementDate) ? new Date((settledDate || settlementDate) + 'T12:00:00').toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }) : (settledDate || settlementDate);
                        Swal.fire({
                            title: 'Settled',
                            text: 'Settlement for ' + settledFormatted + ' completed. Expenses: ' + (res.expense_count || 0) + ', Return Money: ' + (res.return_money_count || 0),
                            icon: 'success',
                            confirmButtonText: 'OK',
                            confirmButtonColor: '#0d6efd'
                        }).then(function () {
                            try {
                                if (settledDate && window.sessionStorage) {
                                    window.sessionStorage.setItem(
                                        'expenseDailySettleViewState',
                                        JSON.stringify({ date: settledDate, subView: 'settled' })
                                    );
                                }
                            } catch (e) {}
                            window.location.reload();
                        });
                    },
                    error: function (xhr) {
                        var err = (xhr.responseJSON && xhr.responseJSON.error) || 'Failed to run settlement';
                        Swal.fire({
                            title: 'Error',
                            text: err,
                            icon: 'error',
                            confirmButtonText: 'OK',
                            confirmButtonColor: '#0d6efd'
                        });
                    },
                    complete: function () {
                        if (typeof window.updateSettleButtonState === 'function') window.updateSettleButtonState();
                    }
                });
            });
        });
    });

    $('#btn-breadcrumb-open-pool').on('click', function (e) {
        e.preventDefault();
        if (getHouseExpenseFilterMode() !== 'settlement') {
            Swal.fire({
                title: 'Settlement Date mode required',
                text: 'Switch to Settlement Date mode first.',
                icon: 'warning',
                confirmButtonText: 'OK',
                confirmButtonColor: '#0d6efd'
            });
            return;
        }

        var selectedYmd = String(window.selectedSettlementDate || '').slice(0, 10);
        var isTodaySettledView =
            /^\d{4}-\d{2}-\d{2}$/.test(selectedYmd) &&
            selectedYmd === getClientTodayYmd() &&
            window.selectedSettlementSubView === 'settled';
        if (!isTodaySettledView) {
            Swal.fire({
                title: 'Today settled only',
                text: 'Set the picker to today and open the Settled list first.',
                icon: 'info',
                confirmButtonText: 'OK',
                confirmButtonColor: '#0d6efd'
            });
            return;
        }

        if (!window.isOpenPoolSelectionMode) {
            if (!Array.isArray(window.houseExpenseLastRows) || window.houseExpenseLastRows.length === 0) {
                Swal.fire({
                    title: 'No Records',
                    text: "No rows in today's settled list.",
                    icon: 'info',
                    confirmButtonText: 'OK',
                    confirmButtonColor: '#0d6efd'
                });
                return;
            }
            setHouseExpenseOpenPoolSelectionMode(true);
            if (typeof window.reloadExpenseBySettlementDate === 'function') {
                window.reloadExpenseBySettlementDate();
            }
            return;
        }

        var selectedItems = getSelectedHouseExpenseItems('.open-pool-checkbox');
        if (selectedItems.length === 0) {
            setHouseExpenseOpenPoolSelectionMode(false);
            if (typeof window.reloadExpenseBySettlementDate === 'function') window.reloadExpenseBySettlementDate();
            return;
        }

        Swal.fire({
            title: 'Return to Open?',
            text: 'Move ' + selectedItems.length + ' selected record(s) to Open?',
            icon: 'question',
            showCancelButton: true,
            confirmButtonText: 'Yes',
            cancelButtonText: 'Cancel',
            confirmButtonColor: '#0d6efd',
            cancelButtonColor: '#6c757d'
        }).then(function (result) {
            if (!result.isConfirmed) return;
            var $lnk = $('#btn-breadcrumb-open-pool');
            $lnk.css('pointer-events', 'none').css('opacity', '0.65');
            $.ajax({
                url: '/expense_daily_settlement/release',
                method: 'POST',
                contentType: 'application/json',
                data: JSON.stringify({ items: selectedItems }),
                success: function (res) {
                    var n = (res && res.total_count) || selectedItems.length;
                    Swal.fire({
                        title: 'Done',
                        text: n + ' record(s) returned to Open.',
                        icon: 'success',
                        confirmButtonText: 'OK',
                        confirmButtonColor: '#0d6efd'
                    }).then(function () {
                        try {
                            if (selectedYmd && window.sessionStorage) {
                                window.sessionStorage.setItem(
                                    'expenseDailySettleViewState',
                                    JSON.stringify({ date: selectedYmd, subView: 'open' })
                                );
                            }
                        } catch (e) {}
                        window.location.reload();
                    });
                },
                error: function (xhr) {
                    var err = (xhr.responseJSON && xhr.responseJSON.error) || 'Request failed';
                    Swal.fire({ title: 'Error', text: err, icon: 'error', confirmButtonColor: '#0d6efd' });
                },
                complete: function () {
                    $lnk.css('pointer-events', '').css('opacity', '');
                    if (typeof window.updateOpenPoolBreadcrumbVisibility === 'function') {
                        window.updateOpenPoolBreadcrumbVisibility();
                    }
                }
            });
        });
    });

    // Initialize settlement UI state
    try {
        var restoredExpenseView = window.sessionStorage ? window.sessionStorage.getItem('expenseDailySettleViewState') : null;
        if (restoredExpenseView) {
            window.sessionStorage.removeItem('expenseDailySettleViewState');
            var parsedExpenseView = JSON.parse(restoredExpenseView);
            if (parsedExpenseView && /^\d{4}-\d{2}-\d{2}$/.test(String(parsedExpenseView.date || ''))) {
                window.selectedSettlementDate = String(parsedExpenseView.date).slice(0, 10);
                window.selectedSettlementSubView = parsedExpenseView.subView === 'settled' ? 'settled' : 'open';
                var restoredPickerEl = document.getElementById('settlement-date-picker');
                if (restoredPickerEl && restoredPickerEl._flatpickr) {
                    restoredPickerEl._flatpickr.setDate(window.selectedSettlementDate, false);
                }
            }
        } else {
            window.selectedSettlementSubView = getHouseExpenseDefaultSubView(window.selectedSettlementDate);
        }
    } catch (e) {
        window.selectedSettlementSubView = getHouseExpenseDefaultSubView(window.selectedSettlementDate);
    }
    if (typeof window.updateSettlementSubviewIndicator === 'function') window.updateSettlementSubviewIndicator();
    if (typeof window.updateSettleButtonState === 'function') window.updateSettleButtonState();
    if (typeof window.updateNavigationButtons === 'function') window.updateNavigationButtons();

    expense_category();

    // Initial load with settlement date
    if (typeof window.reloadData === 'function') {
        window.reloadData();
    }

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
            edit_expense(id, categoryId, receiptNo, dateTime, description, amount, oic);
        }
    });

    $(document).on('click', '.js-expense-graph-cat-open', function () {
        var categoryName = $(this).attr('data-category') || '';
        showExpenseBreakdownModalByCategory(categoryName);
    });

    $(document).on('click', '.js-expense-main-cat-row', function () {
        var mainId = $(this).attr('data-main-id') || '';
        var mainName = $(this).attr('data-main-name') || '';
        if (!mainId) return;

        var stBefore = window.houseExpenseExplorerState || {};
        var sameSelection = String(stBefore.mainCategoryId) === String(mainId) && !stBefore.itemCategoryId;
        window.houseExpenseAnimateItemTable = !sameSelection;
        window.houseExpenseExplorerState = {
            mainCategoryId: mainId,
            mainCategory: mainName || null,
            itemCategoryId: null,
            itemCategory: null
        };
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

/** Explorer add item: lock category from main/sub; top New Expense keeps dropdown. */
function houseExpenseApplyNewExpenseCategoryUi(categoryId) {
    var $selectWrap = $('#house-expense-new-cat-select-wrap');
    var $presetWrap = $('#house-expense-new-cat-preset-wrap');
    var $select = $('#expense-category-select');
    var $hidden = $('#house-expense-new-expense-category-id');
    var $presetLabel = $('#house-expense-new-cat-preset-label');

    if (!$selectWrap.length) return;

    if (categoryId != null && categoryId !== '') {
        var st = window.houseExpenseExplorerState || {};
        var label = houseExpenseGetExplorerSubtitleText(st);
        if (!label) {
            var row = houseExpenseFindCategoryRow(categoryId);
            label = row ? row.CATEGORY || '' : '';
        }

        $selectWrap.addClass('d-none');
        $select.prop('required', false).removeAttr('name');
        $presetWrap.removeClass('d-none');
        $hidden.val(String(categoryId)).attr('name', 'txtCategory');
        if ($presetLabel.length) $presetLabel.text(label || '—');
        houseExpenseSetNewExpenseCategory(categoryId);
    } else {
        $selectWrap.removeClass('d-none');
        $select.prop('required', true).attr('name', 'txtCategory');
        $presetWrap.addClass('d-none');
        $hidden.val('').removeAttr('name');
        if ($presetLabel.length) $presetLabel.text('');
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
        if (window.houseExpensePendingNewExpenseCategoryId) {
            houseExpenseApplyNewExpenseCategoryUi(window.houseExpensePendingNewExpenseCategoryId);
        } else {
            houseExpenseApplyNewExpenseCategoryUi(null);
        }
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

function edit_expense(id, category_id, receipt_no, datetimeval, description, amount, oic) {
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
    $('#txtAmount').val(amount);
    // $('#txtOfficerInCharge').val(oic);

    expense_id = id;

    edit_expense_category(category_id);
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

window.addHouseExpense = addHouseExpense;
window.addHouseExpenseFromExplorer = addHouseExpenseFromExplorer;
window.addHouseExpenseMainCategory = addHouseExpenseMainCategory;
window.addHouseExpenseSubCategory = addHouseExpenseSubCategory;
window.openHouseExpenseAddCategoryModal = openHouseExpenseAddCategoryModal;
window.openHouseExpenseEditCategoryModal = openHouseExpenseEditCategoryModal;
window.openHouseExpenseDeleteCategoryModal = openHouseExpenseDeleteCategoryModal;
window.houseExpenseInitCategoryAddUi = houseExpenseInitCategoryAddUi;

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
        $(this).find(':input[required]').each(function () {
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