// ============== FRONTEND (house_expense.js) =======================
var expense_id;
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

/** EN → KR dictionary for category name autocomplete (ENGLISH 한글). */
window.HOUSE_EXPENSE_CATEGORY_DICTIONARY = {
    EMPLOYEES: '직원',
    EMPLOYEE: '직원',
    OPERATION: '운영',
    OPERATIONS: '운영',
    OTHERS: '기타',
    OTHER: '기타',
    VEHICLE: '차량',
    CAR: '차량',
    CONSUMABLES: '소모품',
    CONSUMABLE: '소모품',
    SUPPLIES: '소모품',
    MARKETING: '마케팅',
    'RECURRING COST': '정기 비용',
    RECURRING: '정기 비용',
    FUEL: '연료',
    PMS: 'PMS',
    TIRES: '타이어',
    TIRE: '타이어',
    BATTERY: '배터리',
    SALARY: '급여',
    ALLOWANCE: '수당',
    TRANSPORT: '교통비',
    TRANSPORTATION: '교통비',
    MEALS: '식대',
    MEAL: '식대',
    OFFICE: '사무용품',
    UTILITIES: '공과금',
    RENT: '임대료',
    INSURANCE: '보험',
    MAINTENANCE: '유지보수',
    COMMUNICATION: '통신비',
    TRAVEL: '출장비',
    ENTERTAINMENT: '접대비',
    TRAINING: '교육',
    SECURITY: '경비',
    CLEANING: '청소',
    PARKING: '주차',
    TOLL: '통행료',
    REPAIR: '수리',
    LODGING: '숙박',
    GIFT: '선물',
    MISC: '기타',
    MISCELLANEOUS: '기타'
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
            return el._flatpickr.altInput.value.trim();
        }
        if (el._flatpickr.selectedDates && el._flatpickr.selectedDates.length === 2) {
            var a = el._flatpickr.selectedDates[0];
            var b = el._flatpickr.selectedDates[1];
            if (window.MonthEndCutoffRange && typeof window.MonthEndCutoffRange.formatDisplayDate === 'function') {
                return window.MonthEndCutoffRange.formatDisplayDate(a) + ' to ' + window.MonthEndCutoffRange.formatDisplayDate(b);
            }
            return moment(a).format('YYYY-MM-DD') + ' to ' + moment(b).format('YYYY-MM-DD');
        }
    }
    return '';
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
        if (!row) return;
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
    if (!row) return true;
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
        if (!r) return;
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
        if (!r) return;
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
    if (!row) return 1;
    var s = parseInt(row.APPROVAL_STATUS, 10);
    return Number.isNaN(s) ? 1 : s;
}

function houseExpenseIsApprovedForTotals(row) {
    return houseExpenseGetApprovalStatus(row) !== 2;
}

/** Pending/rejected first; approved last. */
function houseExpenseItemApprovalSortRank(row) {
    if (!row) return 1;
    var status = houseExpenseGetApprovalStatus(row);
    if (status === 1) return 1;
    return 0;
}

function getHouseExpenseItemSortValue(row, key) {
    if (!row) return '';
    if (key === 'name') return String(houseExpenseGetExpenseNameLabel(row) || '').toLowerCase();
    if (key === 'in_charge') {
        return String(row.DESCRIPTION || row.OIC || '').toLowerCase();
    }
    if (key === 'receiver') {
        return String(row.RECEIVER || '').toLowerCase();
    }
    if (key === 'description') return String(houseExpenseItemDescriptionColumnText(row) || '').toLowerCase();
    if (key === 'amount') return parseFloat(row.AMOUNT) || 0;
    if (key === 'program_date') return getHouseExpenseProgramDateSortValue(row);
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

        return getHouseExpenseProgramDateSortValue(b) - getHouseExpenseProgramDateSortValue(a);
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

function buildHouseExpenseSlipReceiptBtn(expenseId) {
    var title =
        (window.houseExpenseTranslations && window.houseExpenseTranslations.expense_slip_receipt) ||
        'Expense Receipt';
    return (
        '<button type="button" class="btn btn-sm btn-alt-secondary" onclick="showHouseExpenseReceipt(' +
        expenseId +
        ')" data-bs-toggle="tooltip" data-bs-placement="top" title="' +
        houseExpenseHtmlEscape(title) +
        '"><i class="fa fa-receipt"></i></button>'
    );
}

function formatHouseExpenseReceiptAmount(value) {
    return Number(value || 0).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

/** Expense amounts shown as red (n) on slip — matches receipt layout. */
function formatHouseExpenseReceiptAmountParen(value) {
    var n = Math.abs(Number(value) || 0);
    var formatted = n.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
    if (!n) return '0';
    return '(' + formatted + ')';
}

function formatHouseExpenseReceiptDateTime(encodedDt) {
    if (!encodedDt) return '';
    var m = moment.utc(encodedDt).utcOffset(8);
    if (!m.isValid()) return '';
    return m.format('YYYY-MM-DD HH:mm');
}

function formatHouseExpenseReceiptDateOnly(encodedDt) {
    if (!encodedDt) return '';
    var m = moment.utc(encodedDt).utcOffset(8);
    if (!m.isValid()) return '';
    return m.format('YYYY-MM-DD');
}

function formatHouseExpenseProgramDateCell(row) {
    if (!row) return '-';
    var raw = row.PROGRAM_DATE != null && row.PROGRAM_DATE !== '' ? row.PROGRAM_DATE : null;
    if (!raw) {
        return row.ENCODED_DT ? formatHouseExpenseReceiptDateOnly(row.ENCODED_DT) : '-';
    }
    var m = moment.utc(raw).utcOffset(8);
    if (!m.isValid()) return formatHouseExpenseReceiptDateOnly(raw) || '-';
    return m.format('YYYY-MM-DD');
}

function getHouseExpenseProgramDateSortValue(row) {
    if (!row) return 0;
    var raw = row.PROGRAM_DATE != null && row.PROGRAM_DATE !== '' ? row.PROGRAM_DATE : row.ENCODED_DT;
    return new Date(raw || 0).getTime();
}

function hasHouseExpenseReceiptField(value) {
    if (value == null) return false;
    if (typeof value === 'number') return Number.isFinite(value) && value !== 0;
    return String(value).trim() !== '';
}

function buildHouseExpenseReceiptLegRow(label, value, isTotal) {
    if (!hasHouseExpenseReceiptField(value)) return '';
    var valueClass = 'her-value' + (isTotal ? ' her-amount-value' : '');
    var labelClass = 'her-label' + (isTotal ? ' her-total-label' : '');
    var rowClass = isTotal ? ' class="her-total-row"' : '';
    var display = isTotal
        ? formatHouseExpenseReceiptAmountParen(value)
        : formatHouseExpenseReceiptAmount(value);
    return (
        '<tr' +
        rowClass +
        '><td class="' +
        labelClass +
        '">' +
        label +
        '</td><td class="' +
        valueClass +
        '">' +
        display +
        '</td></tr>'
    );
}

function buildHouseExpenseReceiptTextLegRow(label, value) {
    if (!hasHouseExpenseReceiptField(value)) return '';
    return (
        '<tr><td class="her-label">' +
        label +
        '</td><td class="her-value">' +
        houseExpenseHtmlEscape(String(value)) +
        '</td></tr>'
    );
}

function buildHouseExpenseReceiptSlipHtml(data) {
    var kmDisplay = '';
    if (data.km_l != null && Number.isFinite(Number(data.km_l))) {
        kmDisplay = houseExpenseFormatKmDisplay(data.km_l);
    }

    var programDateDisplay = formatHouseExpenseReceiptDateOnly(data.program_date);
    var detailsRows = '';

    if (data.use_item_format) {
        detailsRows =
            '<tr><td class="her-label">Program Date :</td><td class="her-value">' +
            houseExpenseHtmlEscape(programDateDisplay || '') +
            '</td></tr>' +
            buildHouseExpenseReceiptTextLegRow('Approved By :', data.description) +
            buildHouseExpenseReceiptTextLegRow('Received By :', data.receiver) +
            buildHouseExpenseReceiptLegRow('Amount :', data.amount, true);
    } else {
        detailsRows =
            (programDateDisplay
                ? buildHouseExpenseReceiptTextLegRow('- PROGRAM DATE', programDateDisplay)
                : '') +
            buildHouseExpenseReceiptTextLegRow('- RECEIPT NO', data.receipt_no) +
            buildHouseExpenseReceiptTextLegRow('- IN-CHARGE', data.description) +
            buildHouseExpenseReceiptTextLegRow('- RECEIVER', data.receiver) +
            buildHouseExpenseReceiptTextLegRow('- VEHICLE', data.vehicle) +
            (kmDisplay ? buildHouseExpenseReceiptTextLegRow('- KM/L', kmDisplay) : '') +
            buildHouseExpenseReceiptTextLegRow('- ENCODED BY', data.encoded_by) +
            buildHouseExpenseReceiptLegRow('* AMOUNT', data.amount, true);
    }

    var detailsTable = detailsRows
        ? '<table class="her-table her-section-details"><tbody>' + detailsRows + '</tbody></table>'
        : '';

    return (
        '<div class="house-expense-receipt-slip">' +
        '<div class="house-expense-receipt-slip-body">' +
        '<p class="her-brand">GOLDEN DRAGON</p>' +
        '<p class="her-title">' +
        (data.title || '* Expenses *') +
        '</p>' +
        '<p class="her-datetime">' +
        formatHouseExpenseReceiptDateTime(data.created_dt) +
        '</p>' +
        '<p class="her-category">' +
        houseExpenseHtmlEscape(data.category || '') +
        '</p>' +
        detailsTable +
        '</div>' +
        '<div class="house-expense-receipt-slip-actions">' +
        '<button type="button" class="btn house-expense-receipt-copy-btn js-copy-house-expense-receipt-slip-image">' +
        'Copy image</button>' +
        '<button type="button" class="btn house-expense-receipt-copy-btn js-copy-house-expense-receipt-slip-text">' +
        'Copy text</button>' +
        '</div>' +
        '</div>'
    );
}

function buildHouseExpenseReceiptSectionTable(sectionClass, bodyRows) {
    if (!bodyRows) return '';
    return '<table class="her-table ' + sectionClass + '"><tbody>' + bodyRows + '</tbody></table>';
}

function populateHouseExpenseReceipt(data) {
    var $container = $('#house-expense-receipt-container');
    if (!$container.length) return;
    $container.html(buildHouseExpenseReceiptSlipHtml(data || {}));
}

function showHouseExpenseReceiptModal() {
    var modalEl = document.getElementById('modal-house-expense-receipt');
    if (!modalEl) return;
    var $modal = $('#modal-house-expense-receipt');
    if ($modal.length) {
        $modal.appendTo('body');
    }
    if (typeof bootstrap !== 'undefined' && bootstrap.Modal) {
        bootstrap.Modal.getOrCreateInstance(modalEl).show();
    } else if ($('#modal-house-expense-receipt').modal) {
        $('#modal-house-expense-receipt').modal('show');
    }
}

function setHouseExpenseReceiptBackdrop(active) {
    if (active) {
        $('body').addClass('house-expense-receipt-open');
    } else {
        $('body').removeClass('house-expense-receipt-open');
    }
}

function showHouseExpenseReceipt(expenseId) {
    if (!expenseId) return;
    $.ajax({
        url: '/junket_house_expense/' + expenseId + '/receipt',
        method: 'GET',
        success: function (data) {
            populateHouseExpenseReceipt(data);
            showHouseExpenseReceiptModal();
        },
        error: function (xhr) {
            var msg = (xhr.responseJSON && xhr.responseJSON.error) || 'Unable to load expense receipt.';
            if (typeof Swal !== 'undefined') {
                Swal.fire({ icon: 'error', title: 'Error', text: msg, confirmButtonText: 'OK' });
            } else {
                alert(msg);
            }
        }
    });
}
window.showHouseExpenseReceipt = showHouseExpenseReceipt;

var houseExpenseReceiptHtml2CanvasPromise = null;

function loadHouseExpenseReceiptHtml2Canvas() {
    if (typeof html2canvas !== 'undefined') {
        return Promise.resolve();
    }
    if (houseExpenseReceiptHtml2CanvasPromise) {
        return houseExpenseReceiptHtml2CanvasPromise;
    }
    houseExpenseReceiptHtml2CanvasPromise = new Promise(function (resolve, reject) {
        var script = document.createElement('script');
        script.src = 'https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.min.js';
        script.onload = function () {
            resolve();
        };
        script.onerror = function () {
            houseExpenseReceiptHtml2CanvasPromise = null;
            reject(new Error('Failed to load image copy library.'));
        };
        document.body.appendChild(script);
    });
    return houseExpenseReceiptHtml2CanvasPromise;
}

function buildHouseExpenseReceiptSlipImageBlob(slipBodyEl) {
    return loadHouseExpenseReceiptHtml2Canvas()
        .then(function () {
            return html2canvas(slipBodyEl, {
                backgroundColor: '#ffffff',
                scale: 2,
                useCORS: true,
                logging: false
            });
        })
        .then(function (canvas) {
            return new Promise(function (resolve, reject) {
                canvas.toBlob(function (blob) {
                    if (!blob) {
                        reject(new Error('Failed to create receipt image.'));
                        return;
                    }
                    resolve(blob);
                }, 'image/png');
            });
        });
}

function copyHouseExpenseReceiptSlipText(slipBodyEl) {
    var text = slipBodyEl && slipBodyEl.innerText ? slipBodyEl.innerText.trim() : '';
    if (!text) {
        return Promise.reject(new Error('Receipt has no text to copy.'));
    }
    if (!navigator.clipboard || typeof navigator.clipboard.writeText !== 'function') {
        return Promise.reject(new Error('Clipboard is not supported in this browser.'));
    }
    return navigator.clipboard.writeText(text);
}

function getHouseExpenseReceiptCopyUiHelpers($btn) {
    var originalHtml = $btn.html();
    $btn.prop('disabled', true).html('<span class="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span>');

    return {
        showCopySuccess: function (message) {
            if (typeof Swal !== 'undefined') {
                Swal.fire({
                    icon: 'success',
                    title: 'Copied!',
                    text: message,
                    timer: 2000,
                    showConfirmButton: false
                });
            }
        },
        showCopyError: function (msg) {
            if (typeof Swal !== 'undefined') {
                Swal.fire({ icon: 'error', title: 'Copy failed', text: msg, confirmButtonText: 'OK' });
            } else {
                alert(msg);
            }
        },
        restoreBtn: function () {
            $btn.prop('disabled', false).html(originalHtml);
        }
    };
}

function copyHouseExpenseReceiptSlipImage(slipBodyEl, $btn) {
    if (!slipBodyEl || !$btn || !$btn.length) return;

    var ui = getHouseExpenseReceiptCopyUiHelpers($btn);
    var imageBlobPromise = buildHouseExpenseReceiptSlipImageBlob(slipBodyEl);

    if (navigator.clipboard && typeof ClipboardItem !== 'undefined') {
        navigator.clipboard
            .write([new ClipboardItem({ 'image/png': imageBlobPromise })])
            .then(function () {
                ui.showCopySuccess('Receipt image copied. You can paste it anywhere.');
            })
            .catch(function (err) {
                var msg = (err && err.message) ? err.message : 'Unable to copy receipt image.';
                ui.showCopyError(msg);
            })
            .finally(ui.restoreBtn);
        return;
    }

    imageBlobPromise
        .then(function (blob) {
            var url = URL.createObjectURL(blob);
            var link = document.createElement('a');
            link.href = url;
            link.download = 'expense-receipt.png';
            link.click();
            URL.revokeObjectURL(url);
            ui.showCopySuccess('Receipt image downloaded.');
        })
        .catch(function (err) {
            var msg = (err && err.message) ? err.message : 'Unable to copy receipt image.';
            ui.showCopyError(msg);
        })
        .finally(ui.restoreBtn);
}

function copyHouseExpenseReceiptSlipTextButton(slipBodyEl, $btn) {
    if (!slipBodyEl || !$btn || !$btn.length) return;

    var ui = getHouseExpenseReceiptCopyUiHelpers($btn);

    copyHouseExpenseReceiptSlipText(slipBodyEl)
        .then(function () {
            ui.showCopySuccess('Receipt text copied. You can paste it anywhere.');
        })
        .catch(function (err) {
            var msg = (err && err.message) ? err.message : 'Unable to copy receipt text.';
            ui.showCopyError(msg);
        })
        .finally(ui.restoreBtn);
}

function buildHouseExpenseActionButtons(row, amount) {
    var permissions = parseInt($('#user-role').data('permissions'), 10);
    var approvalStatus = houseExpenseGetApprovalStatus(row);
    var t = window.houseExpenseTranslations || {};

    var isPendingExpense = approvalStatus === 0;
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

    if (approvalStatus === 2) {
        var rejectedPillClass =
            'house-expense-status-pill house-expense-status-pill--rejected' +
            (permissions === 0 ? ' house-expense-status-pill--rejected-clickable' : '');
        var rejectedPillAttrs =
            permissions === 0
                ? ' role="button" tabindex="0" onclick="revertRejectedHouseExpense(' +
                  row.expense_id +
                  ')" data-bs-toggle="tooltip" data-bs-placement="top" title="' +
                  houseExpenseHtmlEscape(t.revert_reject || 'Revert rejection') +
                  '"'
                : '';
        return (
            '<div class="house-expense-actions house-expense-approval-actions">' +
            '<span class="' +
            rejectedPillClass +
            '"' +
            rejectedPillAttrs +
            '>' +
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
            buildHouseExpenseSlipReceiptBtn(row.expense_id) +
            '<button type="button" class="btn btn-sm btn-alt-secondary" onclick="viewReceipt(\'' +
            houseExpenseJsQuote(row.photoUrl || '') +
            '\')" ' +
            '' +
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
            '' +
            ' data-bs-toggle="tooltip" data-bs-placement="top" title="' +
            (window.houseExpenseTranslations?.download_receipt || 'Download Receipt') +
            '"><i class="fa fa-download"></i></button>' +
            '<button type="button" class="btn btn-sm btn-alt-secondary" onclick="archive_expense(' +
            row.expense_id +
            ')" data-bs-toggle="tooltip" data-bs-placement="top" title="' +
            (window.houseExpenseTranslations?.archive_expense || 'Archive Expense') +
            '"><i class="fa fa-trash-alt"></i></button>' +
            '</div>'
        );
    }
    return (
        '<div class="house-expense-actions">' +
        buildHouseExpenseSlipReceiptBtn(row.expense_id) +
        '<button type="button" class="btn btn-sm btn-primary" onclick="viewReceipt(\'' +
        houseExpenseJsQuote(row.photoUrl || '') +
        '\')" ' +
        '' +
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
        '' +
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

/** Clickable remarks for expense rows (DESCRIPTION column). */
function houseExpenseRemarksCellHtml(row, displayText) {
    return houseExpenseHtmlEscape(displayText || '-');
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
        if (!houseExpenseRowMatchesExplorer(row)) return false;
        return houseExpenseRowMatchesSearch(row, searchQ);
    });
}

function houseExpenseSumRowsForFooter(rows) {
    var totalExpense = 0;
    (rows || []).forEach(function (row) {
        if (!row) return;
        if (houseExpenseIsApprovedForTotals(row)) totalExpense += parseFloat(row.AMOUNT) || 0;
    });
    return { totalExpense: totalExpense };
}

function updateHouseExpenseItemFooterTotals(allRows) {
    var sums = houseExpenseSumRowsForFooter(houseExpenseGetFilteredItemRows(allRows));
    setHouseExpenseFooterTotals(sums.totalExpense);
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
                '<tr><td colspan="8" class="text-muted small text-center py-3">Select a main category</td></tr>'
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
                '<tr><td colspan="8" class="text-center text-muted py-3">' +
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
                var formattedProgramDate = formatHouseExpenseProgramDateCell(row);
                var formattedDate = row.ENCODED_DT
                    ? moment.utc(row.ENCODED_DT).utcOffset(8).format('YYYY-MM-DD HH:mm')
                    : '-';
                var formattedAmount = amount.toLocaleString('en-US', {
                    minimumFractionDigits: 0,
                    maximumFractionDigits: 0
                });
                var amountDisplay = window.fmtOut
                    ? window.fmtOut(amount)
                    : '<span class="text-dash-neg">(' + formattedAmount + ')</span>';
                var nameLabel = houseExpenseGetExpenseNameLabel(row);
                var inChargeCol = row.DESCRIPTION || row.OIC || '-';
                var receiverCol = row.RECEIVER || '-';
                var descriptionColHtml = houseExpenseHtmlEscape(houseExpenseItemDescriptionColumnText(row));

                return (
                    '<tr class="js-expense-entry-row" data-expense-id="' +
                    attrEncode(row.expense_id) +
                    '">' +
                    '<td class="expense-item-program-date-cell">' +
                    houseExpenseHtmlEscape(formattedProgramDate) +
                    '</td>' +
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
                    '<td class="text-start expense-item-action-cell">' +
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
    rows.forEach(function (r) {
        if (!r) return;
        if (houseExpenseIsApprovedForTotals(r)) te += Number(r.AMOUNT) || 0;
    });
    refreshHouseExpenseDashboard(rows, te);
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
    return '<label class="' + modeClass + '-wrap" title="Select record">' +
        '<input type="checkbox" class="' + modeClass + '" value="' + id + '" data-record-type="expense" />' +
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

// Eight distinct category colors (no repeat within top 8). 
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

/** True for main vehicle/car category names (e.g. "VEHICLE", "VEHICLE 차량", "Car Expenses"). */
function houseExpenseIsVehicleMainCategoryName(name) {
    var raw = String(name || '').trim();
    if (!raw) return false;
    var upper = raw.toUpperCase();
    if (upper === 'CAR' || upper === 'VEHICLE' || upper === 'VEHICLES') return true;
    var lead = (upper.match(/^[A-Z]+/) || [])[0] || '';
    if (lead === 'CAR' || lead === 'VEHICLE' || lead === 'VEHICLES') return true;
    if (raw.indexOf('차량') >= 0) return true;
    return false;
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

function ensureHouseExpenseProgramDatePicker() {
    var el = document.getElementById('houseExpenseProgramDate');
    if (!el || typeof flatpickr === 'undefined') return;
    if (el._flatpickr) {
        el._flatpickr.destroy();
    }
    flatpickr(el, {
        enableTime: false,
        dateFormat: 'Y-m-d',
        altInput: true,
        altFormat: 'M j, Y',
        defaultDate: new Date(),
        allowInput: true,
        disableMobile: true
    });
}

function houseExpenseApplyNewExpenseFormFormat(categoryId) {
    var useLockedItemFormat = houseExpenseIsNewExpenseCategoryLocked();
    var showVehicleFields = houseExpenseCarSubCategoryShowsVehicleFields(categoryId);
    var $form = $('#add_junket_house_expense');
    var $footer = $form.find('.modal-footer');
    var rowMap = {
        programDate: '#house-expense-new-row-program-date',
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
        order = ['preset', 'programDate', 'officer'];
        if (showVehicleFields) order.push('vehicle', 'km');
        order.push('amount', 'receiptNo', 'photo');
    } else {
        order = ['preset', 'select', 'programDate', 'photo', 'vehicle', 'km', 'receiptNo', 'officer', 'amount'];
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
        row.expense_category || 'N/A';
    var vehicleLabel = houseExpenseFormatVehicleLabel(row);
    if (vehicleLabel) {
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
                        var dtStr = dt ? moment(dt).format('YYYY-MM-DD HH:mm') : '—';
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

/** Updates expense footer amount. */
function setHouseExpenseFooterTotals(totalExpense) {
    var te = Number(totalExpense) || 0;
    $('#TOTAL_EXPENSE_AMOUNT').text(formatHouseExpensePeso(te));
    updateDashboardExpensesTotal(te);
}

function updateDashboardExpensesTotal(amount) {
    var v = Math.round(Number(amount) || 0);
    var html = !v
        ? '0'
        : '<span class="text-dash-neg">(' + Math.abs(v).toLocaleString('en-US') + ')</span>';
    ['dash-expenses-total', 'dash-expenses-total-anticipated'].forEach(function (id) {
        var el = document.getElementById(id);
        if (el) el.innerHTML = html;
    });
    if (typeof window.dashboardPeriodReload === 'function' && document.getElementById('dash-anticipated-panel')) {
        window.dashboardPeriodReload();
    }
}
window.updateDashboardExpensesTotal = updateDashboardExpensesTotal;

function houseExpenseApplyLoadedData(data) {
    var rows = (data || []).filter(function (row) {
        return !!row;
    });
    var total_expense = 0;
    rows.forEach(function (row) {
        if (houseExpenseIsApprovedForTotals(row)) total_expense += parseFloat(row.AMOUNT) || 0;
    });
    window.houseExpenseLastRows = rows;
    renderHouseExpenseAnalytics(rows, total_expense);
    updateDashboardExpensesTotal(total_expense);
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

function renderHouseExpenseGraphRaceBodyFromState(data, totalExpense) {
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
    var expenseRows = (data || []).filter(function (row) {
        return !!row;
    });

    if (expenseRows.length === 0) {
        if ($sub.length) $sub.text('By category');
        $body.html('<div class="text-muted small py-2">No expense data yet.</div>');
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
    $body.html(mainHtml);
}

function renderHouseExpenseCategoryLists(data) {
    var st = window.houseExpenseExplorerState || {};
    var expenseRows = (data || []).filter(function (r) {
        return !!r;
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
        return !!r;
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

function refreshHouseExpenseDashboard(data, totalExpense) {
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
    renderHouseExpenseGraphRaceBodyFromState(data, te);
    applyHouseExpenseExplorerDataTableFilter();
}

function renderHouseExpenseAnalytics(data, totalExpense) {
    refreshHouseExpenseDashboard(data, totalExpense);
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
    if (!name) return false;
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
    if (!row) return '-';
    var plate = row.vehicle_plate != null ? String(row.vehicle_plate).trim() : '';
    return plate || '-';
}

function houseExpenseBreakdownVehicleModelText(row) {
    if (!row) return '-';
    var model = row.vehicle_model != null ? String(row.vehicle_model).trim() : '';
    return model || '-';
}

function showExpenseBreakdownModalByCategory(categoryName) {
    var category = String(categoryName || '').trim();
    if (!category) return;

    var rows = (window.houseExpenseLastRows || []).filter(function (row) {
        if (!row) return false;
        return String(row.expense_category || '').trim() === category;
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
            ? moment.utc(row.ENCODED_DT).utcOffset(8).format('YYYY-MM-DD HH:mm')
            : '-';
        var descriptionText = houseExpenseItemDescriptionColumnText(row);
        var plateText = houseExpenseBreakdownVehiclePlateText(row);
        var modelText = houseExpenseBreakdownVehicleModelText(row);
        var inChargeText = row.OIC || row.DESCRIPTION || '-';
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
                '<td class="fw-semibold text-end">' + (window.fmtOut ? window.fmtOut(amount) : formatHouseExpenseNumber(amount)) + '</td>' +
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
            var type = 'expense';
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

    var houseExpenseSplitOverrideRange = null;

    function houseExpenseApiEndDate(endYmd) {
        if (!endYmd || !/^\d{4}-\d{2}-\d{2}$/.test(String(endYmd))) return endYmd;
        var parts = String(endYmd).slice(0, 10).split('-').map(Number);
        var lastDayOfMonth = new Date(parts[0], parts[1], 0).getDate();
        if (parts[2] === lastDayOfMonth - 1 && window.MonthEndCutoffRange) {
            return window.MonthEndCutoffRange.expandApiEndDateToMonthEnd(endYmd);
        }
        return endYmd;
    }

    function houseExpenseResolveDateRange(fpInstance) {
        if (houseExpenseSplitOverrideRange && houseExpenseSplitOverrideRange.fromDate && houseExpenseSplitOverrideRange.toDate) {
            return houseExpenseSplitOverrideRange;
        }
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
            var to = houseExpenseApiEndDate(formatYmd(selectedDates[1]));
            return from <= to ? { fromDate: from, toDate: to } : { fromDate: to, toDate: from };
        }
        if (selectedDates && selectedDates.length === 1) {
            var single = houseExpenseApiEndDate(formatYmd(selectedDates[0]));
            return { fromDate: single, toDate: single };
        }

        var label = getHouseExpenseDateRangeLabel();
        if (label && window.MonthEndCutoffRange) {
            var parsed = window.MonthEndCutoffRange.parseRangeString(label);
            var fromDate = window.MonthEndCutoffRange.toApiDate(parsed.start);
            var toDate = houseExpenseApiEndDate(window.MonthEndCutoffRange.toApiDate(parsed.end));
            if (fromDate && toDate) {
                return fromDate <= toDate
                    ? { fromDate: fromDate, toDate: toDate }
                    : { fromDate: toDate, toDate: fromDate };
            }
        }

        if (window.MonthEndCutoffRange) {
            var fallback = window.MonthEndCutoffRange.getMonthEndCutoffRange();
            return {
                fromDate: fallback.startDate,
                toDate: houseExpenseApiEndDate(fallback.endDateApi || fallback.endDate)
            };
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
        var actionColIndex = 7;
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
            'th:nth-child(7),td:nth-child(7){text-align:right;padding-right:14px;}',
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
        var headers = ['Program Date', 'Date & Time', 'Name', 'In-Charge', 'Receiver', 'Description', 'Amount'];
        var rows = data.map(function (row) {
            var amount = parseFloat(row.AMOUNT) || 0;
            var programDate = formatHouseExpenseProgramDateCell(row);
            var enc = row.ENCODED_DT
                ? moment.utc(row.ENCODED_DT).utcOffset(8).format('YYYY-MM-DD HH:mm')
                : '';
            return [
                programDate === '-' ? '' : programDate,
                enc,
                row.expense_category || 'N/A',
                row.DESCRIPTION || row.OIC || '-',
                row.RECEIVER || '-',
                houseExpenseItemDescriptionColumnText(row),
                amount
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
    var houseExpenseSplitDateRange = (window.SplitDateRange && SplitDateRange.attach({
        rangePickerId: 'daterange-picker',
        startId: 'house-expense-start-date',
        endId: 'house-expense-end-date',
        splitWrapperId: 'house-expense-split-daterange-wrapper',
        independent: true,
        invalidDateMessage: (window.houseExpenseTranslations && window.houseExpenseTranslations.invalid_date) || 'Invalid date range.',
        onRangeApplied: function (range) {
            if (!range || !range.start || !range.end) return;
            var fromDate = range.start;
            var toDate = houseExpenseApiEndDate(range.end);
            if (fromDate > toDate) {
                var swap = fromDate;
                fromDate = toDate;
                toDate = swap;
            }
            houseExpenseSplitOverrideRange = { fromDate: fromDate, toDate: toDate };
            toggleHouseExpenseBreakdownPanel('daterange');
            if (typeof window.reloadData === 'function') window.reloadData();
        }
    })) || { syncFromRange: function () {}, isSyncing: function () { return false; } };

    if (document.getElementById('daterange-picker')) {
        var now = new Date();
        var pad = function (n) {
            return String(n).padStart(2, '0');
        };

        var earliestAllowed = new Date(now.getFullYear() - 1, 0, 1);
        var earliestSettlementDate =
            earliestAllowed.getFullYear() + '-' + pad(earliestAllowed.getMonth() + 1) + '-' + pad(earliestAllowed.getDate());

        dateRangePicker = flatpickr('#daterange-picker', {
            mode: 'range',
            showMonths: 3,
            minDate: earliestSettlementDate,
            onReady: function (selectedDates, dateStr, instance) {
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
                houseExpenseSplitOverrideRange = null;
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
        var id = $btn.attr('data-expense-id');
        var categoryId = $btn.attr('data-category-id') || '';
        var receiptNo = $btn.attr('data-receipt-no') || '';
        var dateTime = $btn.attr('data-date-time') || '';
        var description = $btn.attr('data-description') || '';
        var amount = $btn.attr('data-amount') || '0';
        var oic = $btn.attr('data-oic') || '';
        var receiver = $btn.attr('data-receiver') || '';
        var kmL = $btn.attr('data-km-l') || '';
        var vehicleId = $btn.attr('data-vehicle-id') || '';
        edit_expense(id, categoryId, receiptNo, dateTime, description, amount, oic, receiver, kmL, vehicleId);
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
            sortState.sortDir = key === 'date_time' || key === 'program_date' || key === 'amount' ? 'desc' : 'asc';
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

    $(document)
        .off('click', '.js-copy-house-expense-receipt-slip-image')
        .on('click', '.js-copy-house-expense-receipt-slip-image', function (e) {
            e.preventDefault();
            var $btn = $(this);
            var slipBody = $btn.closest('.house-expense-receipt-slip').find('.house-expense-receipt-slip-body')[0];
            copyHouseExpenseReceiptSlipImage(slipBody, $btn);
        });

    $(document)
        .off('click', '.js-copy-house-expense-receipt-slip-text')
        .on('click', '.js-copy-house-expense-receipt-slip-text', function (e) {
            e.preventDefault();
            var $btn = $(this);
            var slipBody = $btn.closest('.house-expense-receipt-slip').find('.house-expense-receipt-slip-body')[0];
            copyHouseExpenseReceiptSlipTextButton(slipBody, $btn);
        });

    $(document)
        .off('click', '.js-copy-house-expense-receipt-slip')
        .on('click', '.js-copy-house-expense-receipt-slip', function (e) {
            e.preventDefault();
            var $btn = $(this);
            var slipBody = $btn.closest('.house-expense-receipt-slip').find('.house-expense-receipt-slip-body')[0];
            copyHouseExpenseReceiptSlipImage(slipBody, $btn);
        });

    $(document)
        .off('shown.bs.modal.houseExpenseReceipt', '#modal-house-expense-receipt')
        .on('shown.bs.modal.houseExpenseReceipt', '#modal-house-expense-receipt', function () {
            setHouseExpenseReceiptBackdrop(true);
            loadHouseExpenseReceiptHtml2Canvas().catch(function () {});
        });

    $(document)
        .off('hidden.bs.modal.houseExpenseReceipt', '#modal-house-expense-receipt')
        .on('hidden.bs.modal.houseExpenseReceipt', '#modal-house-expense-receipt', function () {
            setHouseExpenseReceiptBackdrop(false);
        });


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

function houseExpenseHasHangul(text) {
    return /[\uAC00-\uD7A3]/.test(String(text || ''));
}

function houseExpenseCategoryDictionaryLabel(enKey, kr) {
    var en = String(enKey || '').trim().toUpperCase();
    var ko = String(kr || '').trim();
    if (!en) return '';
    return ko ? en + ' ' + ko : en;
}

/** Build suggestion list: dictionary EN+KR + existing category names. */
function houseExpenseGetCategoryNameSuggestions() {
    var dict = window.HOUSE_EXPENSE_CATEGORY_DICTIONARY || {};
    var labels = [];
    var seen = {};

    function pushLabel(label) {
        var text = String(label || '').trim();
        if (!text) return;
        var key = text.toLowerCase();
        if (seen[key]) return;
        seen[key] = true;
        labels.push(text);
    }

    Object.keys(dict).forEach(function (enKey) {
        pushLabel(houseExpenseCategoryDictionaryLabel(enKey, dict[enKey]));
    });

    (window.houseExpenseCategoryRows || []).forEach(function (row) {
        pushLabel(row && row.CATEGORY);
    });

    labels.sort(function (a, b) {
        return a.localeCompare(b, undefined, { sensitivity: 'base' });
    });
    return labels;
}

/**
 * Exact dictionary match only (safe for delete/edit).
 * "marketing" → "MARKETING 마케팅"
 */
function houseExpenseResolveCategoryDictionaryName(raw) {
    var name = String(raw || '').trim();
    if (!name) return name;
    if (houseExpenseHasHangul(name)) return name;

    var dict = window.HOUSE_EXPENSE_CATEGORY_DICTIONARY || {};
    var upper = name.toUpperCase();
    if (Object.prototype.hasOwnProperty.call(dict, upper)) {
        return houseExpenseCategoryDictionaryLabel(upper, dict[upper]);
    }

    var keys = Object.keys(dict);
    for (var i = 0; i < keys.length; i++) {
        if (keys[i].toUpperCase() === upper) {
            return houseExpenseCategoryDictionaryLabel(keys[i], dict[keys[i]]);
        }
    }

    var q = name.toLowerCase();
    for (var j = 0; j < keys.length; j++) {
        var kr = String(dict[keys[j]] || '').trim();
        if (kr && kr.toLowerCase() === q) {
            return houseExpenseCategoryDictionaryLabel(keys[j], kr);
        }
    }

    return name;
}

function houseExpenseWireCategoryNameDictionary(inputEl) {
    if (!inputEl) return;
    var Autocomplete = window.CreditGuarantorAutocomplete;
    if (!Autocomplete || typeof Autocomplete.wire !== 'function') return;

    Autocomplete.wire(inputEl, {
        getSuggestions: houseExpenseGetCategoryNameSuggestions,
        showOnEmpty: false
    });

    if (inputEl._houseExpenseDictBlurBound) return;
    inputEl._houseExpenseDictBlurBound = true;
    inputEl.addEventListener('blur', function () {
        var resolved = houseExpenseResolveCategoryDictionaryName(inputEl.value);
        if (resolved && resolved !== String(inputEl.value || '').trim()) {
            inputEl.value = resolved;
        }
    });
}

/** Move modal to body so it stacks above .modal-backdrop (fixes backdrop-only visible). */
function houseExpenseShowCategoryModal($modal) {
    if (!$modal || !$modal.length) return;
    if ($modal.parent().length && !$modal.parent().is('body')) {
        $modal.appendTo('body');
    }
    $modal.modal('show');
}

function approveHouseExpense(id) {
    var t = window.houseExpenseTranslations || {};
    if (typeof Swal === 'undefined') return;
    SwalConfirm.fire({
        title: t.approve || 'Approve',
        message: t.approve_confirm || 'Approve this expense?',
        confirmButtonText: t.yes || 'Yes',
        confirmButtonColor: '#198754'
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
    SwalConfirm.fire({
        title: t.reject || 'Reject',
        message: t.reject_confirm || 'Reject this expense?',
        confirmButtonText: t.yes || 'Yes',
        confirmButtonColor: '#dc3545'
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

function revertRejectedHouseExpense(id) {
    var permissions = parseInt($('#user-role').data('permissions'), 10);
    if (permissions !== 0) return;

    var t = window.houseExpenseTranslations || {};
    if (typeof Swal === 'undefined') return;
    SwalConfirm.fire({
        title: t.revert_reject || 'Revert rejection',
        message: t.revert_reject_confirm || 'Revert this expense back to pending?',
        confirmButtonText: t.yes || 'Yes',
        confirmButtonColor: '#198754'
    }).then(function (result) {
        if (!result.isConfirmed) return;
        $.ajax({
            url: '/junket_house_expense/revert-reject/' + id,
            method: 'PUT',
            success: function () {
                houseExpenseFinishSaveSuccess({
                    title: t.updated_successfully || 'Updated successfully'
                });
            },
            error: function (xhr) {
                var msg = (xhr.responseJSON && xhr.responseJSON.error) || 'Failed to revert rejection';
                Swal.fire({ icon: 'error', title: t.error || 'Error', text: msg });
            }
        });
    });
}

window.approveHouseExpense = approveHouseExpense;
window.rejectHouseExpense = rejectHouseExpense;
window.revertRejectedHouseExpense = revertRejectedHouseExpense;

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
    SwalConfirm.fire({
        title: window.houseExpenseTranslations?.delete_confirmation || 'Are you sure you want to delete this?',
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

function houseExpenseCategoryAddButtonScope() {
    return '#modal-dash-house-expense .expense-cat-panel-add-btn, .expense-explorer-row .expense-cat-panel-add-btn';
}

function houseExpenseSyncCategoryAddButtons() {
    var t = window.houseExpenseTranslations || {};
    var st = window.houseExpenseExplorerState || {};
    var hasMain = !!(st.mainCategoryId);
    var $subBtn = $(houseExpenseCategoryAddButtonScope()).filter('.js-house-expense-add-sub-cat');
    $subBtn.prop('disabled', !hasMain);
    $subBtn.attr(
        'title',
        hasMain ? t.add_sub_category || 'Add sub category' : t.select_main_first || 'Select a main category first'
    );

    var itemCatId = houseExpenseGetAddItemCategoryId();
    var $itemBtn = $(houseExpenseCategoryAddButtonScope()).filter('.js-house-expense-add-item');
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

    $('#house-expense-edit-cat-id').val(String(catId));
    $('#house-expense-edit-cat-name').val(row.CATEGORY || '').removeClass('is-invalid');
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
        $(houseExpenseCategoryAddButtonScope()).filter('.js-house-expense-add-main-cat, .js-house-expense-add-sub-cat, .js-house-expense-add-item').addClass('d-none');
    }
    houseExpenseSyncCategoryAddButtons();

    houseExpenseWireCategoryNameDictionary(document.getElementById('house-expense-add-cat-name'));
    houseExpenseWireCategoryNameDictionary(document.getElementById('house-expense-edit-cat-name'));

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
    var name = houseExpenseResolveCategoryDictionaryName($('#house-expense-add-cat-name').val());
    $('#house-expense-add-cat-name').val(name);
    var typeVal = '2';
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
    var name = houseExpenseResolveCategoryDictionaryName($('#house-expense-edit-cat-name').val());
    $('#house-expense-edit-cat-name').val(name);
    var row = houseExpenseFindCategoryRow(catId);
    var typeVal = row && row.TYPE != null ? String(row.TYPE) : '2';
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
    var $addCatModal = $('#modal-house-expense-add-category');
    $addCatModal.off('shown.bs.modal.houseExpenseFocus').one('shown.bs.modal.houseExpenseFocus', function () {
        $('#house-expense-add-cat-name').trigger('focus');
    });
    houseExpenseShowCategoryModal($addCatModal);
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
    ensureHouseExpenseProgramDatePicker();
    $('#modal-new-house-expense').on('shown.bs.modal', function () {
        isSubmittingNewExpense = false;
        var $btn = $('#btn-save-new-expense');
        var originalText = $btn.data('original-text') || $btn.html();
        var isViewOnly = window.PermissionViewOnly && window.PermissionViewOnly.isViewOnly && window.PermissionViewOnly.isViewOnly();
        if (!isViewOnly) $btn.prop('disabled', false).html(originalText);
        var $form = $('#add_junket_house_expense');
        if ($form.length) $form[0].reset();
        ensureHouseExpenseProgramDatePicker();
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
                isSubmittingNewExpense = false;
                $submitBtn.prop('disabled', false).html(originalText);
                $('#modal-new-house-expense').modal('hide');
                $form[0].reset();
                if (typeof window.reloadData === 'function') window.reloadData();
                if (response && response.id) {
                    showHouseExpenseReceipt(response.id);
                } else if (typeof Swal !== 'undefined') {
                    Swal.fire({
                        icon: 'success',
                        title: 'Added successfully',
                        confirmButtonText: window.houseExpenseTranslations?.ok || 'OK'
                    });
                }
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
})

function onlyNumberKey(evt) {

    let ASCIICode = (evt.which) ? evt.which : evt.keyCode
    if (ASCIICode > 31 && (ASCIICode < 48 || ASCIICode > 57))
        return false;
    return true;
}