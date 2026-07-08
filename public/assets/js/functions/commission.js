$(document).ready(function() {

    if (!$('#commission-tbl').length) {
        return;
    }

    var dashCommissionModalEl = document.getElementById('modal-dash-commission');

    var compareSelection = new Map();
    var commissionGameMeta = new Map();
    var compareModalRows = [];
    var compareSelectMode = false;
    var compareModalSortKey = 'dateTime';
    var compareModalSortDir = 'desc';

    function compareT() {
        return window.commissionTranslations || {};
    }

    function escapeHtml(value) {
        return String(value == null ? '' : value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function formatCommissionProgramDate(row) {
        var raw = row.PROGRAM_DATE || row.GAME_DATE_START;
        if (!raw) return '-';
        return moment.utc(raw).utcOffset(8).format('YYYY-MM-DD');
    }

    function formatCommissionGameStart(row) {
        if (!row.GAME_DATE_START) return '-';
        var m = moment.utc(row.GAME_DATE_START);
        if (!m.isValid()) return '-';
        return m.utcOffset(8).format('YYYY-MM-DD HH:mm');
    }

    function formatCommissionGameType(row) {
        var t = String(row.GAME_TYPE || 'LIVE').toUpperCase();
        var cls = t === 'TELEBET' ? 'css-red' : 'css-blue';
        var label = t === 'TELEBET' ? 'TELEBET' : 'LIVE';
        return '<span class="' + cls + '">' + escapeHtml(label) + '</span>';
    }

    function parseCommissionDisplayDate(value) {
        var raw = String(value == null ? '' : value).trim();
        if (!raw || raw === '-') return null;
        var formats = [
            'YYYY-MM-DD HH:mm',
            'DD MMM, YYYY HH:mm:ss',
            'DD MMM YY HH:mm',
            'MM/DD HH:mm',
            'MMMM DD, YYYY HH:mm:ss',
            'MMMM DD, YYYY',
            'MMM DD, YYYY HH:mm:ss',
            'MMM DD, YYYY',
            'MMM DD, YY',
            moment.ISO_8601
        ];
        var m = moment.utc(raw, formats, true);
        if (m.isValid()) return m;
        m = moment(raw, formats, true);
        return m.isValid() ? m : null;
    }

    function formatCommissionGameEnd(row) {
        if (!row.GAME_ENDED) return '-';
        var m = moment.utc(row.GAME_ENDED);
        if (!m.isValid()) return '-';
        return m.utcOffset(8).format('YYYY-MM-DD HH:mm');
    }

    function formatCommissionDateTimeDisplay(value) {
        var m = parseCommissionDisplayDate(value);
        if (!m) {
            var raw = String(value == null ? '' : value).trim();
            return raw && raw !== '-' ? raw : '-';
        }
        return m.utcOffset(8).format('YYYY-MM-DD HH:mm');
    }

    function formatCommissionGameEndDisplay(value) {
        return formatCommissionDateTimeDisplay(value);
    }

    function updateCompareUi() {
        var $selectionMount = $('#commission-compare-selection-mount');
        var $toolbarIdle = $('#commission-compare-toolbar-idle');
        var $toolbarActive = $('#commission-compare-toolbar-active');
        var $chips = $('#commission-compare-chips');
        var $btn = $('#btn-commission-compare-confirm');
        if (!$toolbarIdle.length) return;

        if (!compareSelectMode) {
            $selectionMount.addClass('d-none');
            $toolbarIdle.removeClass('d-none');
            $toolbarActive.addClass('d-none');
            $chips.empty();
            $btn.prop('disabled', true);
            return;
        }

        $toolbarIdle.addClass('d-none');
        $toolbarActive.removeClass('d-none');

        if (compareSelection.size) {
            $selectionMount.removeClass('d-none');
            $chips.html(
                Array.from(compareSelection.values())
                    .map(function (row) {
                        return '<span class="badge bg-primary">' +
                            escapeHtml(row.chipLabel || ('Game #' + row.gameNo)) + '</span>';
                    })
                    .join('')
            );
        } else {
            $selectionMount.addClass('d-none');
            $chips.empty();
        }

        $btn.prop('disabled', !compareSelection.size);
    }

    function enterCompareSelectMode() {
        if (compareSelectMode) return;
        compareSelectMode = true;
        $('#commission-tbl').addClass('commission-compare-select-mode');
        if (dataTable) {
            dataTable.rows().invalidate();
            dataTable.draw(false);
            refreshCompareSelectAllHeader();
            refreshCompareCheckboxCells();
        }
        updateCompareUi();
    }

    function exitCompareSelectMode() {
        compareSelectMode = false;
        compareSelection.clear();
        $('#commission-tbl').removeClass('commission-compare-select-mode');
        if (dataTable) {
            dataTable.rows().invalidate();
            dataTable.draw(false);
            refreshCompareSelectAllHeader();
            refreshCompareCheckboxCells();
        }
        updateCompareUi();
    }

    function parseNumCell(value, options) {
        options = options || {};
        if (typeof value === 'number') {
            return Number.isFinite(value) ? value : 0;
        }
        var raw = String(value == null ? '' : value);
        if (raw.indexOf('<') !== -1) {
            var tmp = document.createElement('div');
            tmp.innerHTML = raw;
            raw = (tmp.textContent || tmp.innerText || raw).trim();
        } else {
            raw = raw.trim();
        }
        var isParenNegative = /^\(\s*[\d,.]+\s*\)$/.test(raw);
        var cleaned = raw.replace(/,/g, '').replace(/[()]/g, '').replace(/[^\d.-]/g, '').trim();
        if (!cleaned || cleaned === '-' || cleaned === '.') return 0;
        var n = parseFloat(cleaned);
        if (!isFinite(n)) return 0;
        n = Math.abs(n);
        if (options.signed) {
            if (isParenNegative || /^-/.test(raw)) return -n;
            return n;
        }
        return n;
    }

    function formatRollingRatePercent(value) {
        var raw = String(value == null ? '' : value).trim().replace(/%/g, '');
        if (!raw) return '';
        var n = parseFloat(raw);
        if (!isFinite(n)) return String(value).trim();
        var rounded = Math.round(n * 100) / 100;
        return parseFloat(rounded.toFixed(2)) + '%';
    }

    function parseRollingRatePercent(value) {
        var raw = String(value == null ? '' : value).trim().replace(/%/g, '');
        if (!raw) return 0;
        var n = parseFloat(raw);
        return isFinite(n) ? n : 0;
    }

    function fmtCompareAmount(num) {
        return Number(num).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
    }

    function formatAddChgAmount(num) {
        return Number(num || 0).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
    }

    function fmtCommissionAmount(value, mode) {
        if (mode === 'out' && window.fmtOut) return window.fmtOut(value);
        if (mode === 'signed' && window.fmtSigned) return window.fmtSigned(value);
        if (mode === 'in' && window.fmtIn) return window.fmtIn(value);
        return formatAddChgAmount(value);
    }

    function computeCompareRowAmounts(row, ratePercent) {
        var rate = parseFloat(ratePercent) || 0;
        var net;
        if (Number(row.commissionType) === 2) {
            net = Math.round((row.winLossNum * rate) / 100);
        } else {
            net = Math.round((row.totalRollingNum * rate) / 100);
        }
        return {
            settlement: net,
            payment: Math.round(net - row.fnbNum)
        };
    }

    function buildCompareModalRowFromSnapshot(snapshot) {
        var rateNum = parseRollingRatePercent(snapshot.rollingRate);
        var acctNo = snapshot.acctNo || '';
        var guest = snapshot.guest || '';
        return {
            programDate: snapshot.programDate,
            gameStart: snapshot.gameStart,
            type: snapshot.type,
            gameNo: snapshot.gameNo,
            acctNo: acctNo,
            guest: guest,
            account: snapshot.account || (acctNo + (guest && guest !== '-' ? ' - ' + guest : '')),
            totalBuyIn: snapshot.totalBuyIn,
            chipsReturn: snapshot.chipsReturn,
            winLoss: snapshot.winLoss,
            totalRolling: snapshot.totalRolling,
            fnb: snapshot.fnb,
            dateTime: snapshot.dateTime,
            commissionType: Number(snapshot.commissionType) || 1,
            totalRollingNum: parseNumCell(snapshot.totalRolling),
            winLossNum: parseNumCell(snapshot.winLoss, { signed: true }),
            fnbNum: parseNumCell(snapshot.fnb),
            rollingRateNum: rateNum,
            originalRollingRateNum: rateNum,
            settlementNum: parseNumCell(snapshot.settlement),
            paymentNum: parseNumCell(snapshot.payment)
        };
    }

    function parseCompareModalSortDate(value) {
        var m = parseCommissionDisplayDate(value);
        return m ? m.valueOf() : 0;
    }

    function getCompareModalSortValue(row, key) {
        if (!row) return '';
        if (key === 'programDate') return parseCompareModalSortDate(row.programDate);
        if (key === 'gameStart') return parseCompareModalSortDate(row.gameStart);
        if (key === 'type') return String(row.type || '').toLowerCase();
        if (key === 'gameNo') return Number(row.gameNo) || 0;
        if (key === 'acctNo') return String(row.acctNo || '').toLowerCase();
        if (key === 'guest') return String(row.guest || '').toLowerCase();
        if (key === 'account') return String(row.account || '').toLowerCase();
        if (key === 'totalBuyIn') return parseNumCell(row.totalBuyIn);
        if (key === 'chipsReturn') return parseNumCell(row.chipsReturn);
        if (key === 'winLoss') return row.winLossNum || 0;
        if (key === 'totalRolling') return row.totalRollingNum || 0;
        if (key === 'rollingRate') return row.rollingRateNum || 0;
        if (key === 'settlement') return row.settlementNum || 0;
        if (key === 'fnb') return row.fnbNum || 0;
        if (key === 'payment') return row.paymentNum || 0;
        if (key === 'dateTime') return parseCompareModalSortDate(row.dateTime);
        return '';
    }

    function sortCompareModalRowsInPlace() {
        var sortKey = compareModalSortKey || 'dateTime';
        var sortDir = compareModalSortDir === 'asc' ? 'asc' : 'desc';
        compareModalRows.sort(function (a, b) {
            var av = getCompareModalSortValue(a, sortKey);
            var bv = getCompareModalSortValue(b, sortKey);
            if (typeof av === 'string' && typeof bv === 'string') {
                var cmp = av.localeCompare(bv, undefined, { numeric: true, sensitivity: 'base' });
                return sortDir === 'asc' ? cmp : -cmp;
            }
            if (av < bv) return sortDir === 'asc' ? -1 : 1;
            if (av > bv) return sortDir === 'asc' ? 1 : -1;
            return 0;
        });
    }

    function renderCompareModalSortIndicators() {
        var key = compareModalSortKey || 'dateTime';
        var dir = compareModalSortDir === 'asc' ? 'asc' : 'desc';
        $('#commission-compare-modal-tbl thead th.commission-compare-sortable-col').each(function () {
            var $th = $(this);
            var thKey = $th.attr('data-sort-key');
            var indicator = '-';
            if (thKey === key) {
                indicator = dir === 'asc' ? '▲' : '▼';
                $th.addClass('is-active');
            } else {
                $th.removeClass('is-active');
            }
            $th.find('.commission-compare-sort-indicator').text(indicator);
        });
    }

    function rerenderCompareModalTableBody() {
        sortCompareModalRowsInPlace();
        $('#commission-compare-modal-body').html(
            compareModalRows.map(function (row, idx) {
                return renderCompareModalRowHtml(row, idx);
            }).join('')
        );
        updateCompareModalTotals();
        renderCompareModalSortIndicators();
    }

    function renderCompareModalRowHtml(row, rowIndex) {
        var rateCell = '<span class="commission-compare-rate-display">' +
            escapeHtml(formatRollingRatePercent(row.rollingRateNum)) + '</span>';
        var rowCls = rowIndex === 0 ? ' commission-compare-first-row' : '';
        return (
            '<tr data-row-index="' + rowIndex + '" class="' + rowCls.trim() + '">' +
            '<td>' + escapeHtml(row.programDate) + '</td>' +
            '<td>' + escapeHtml(row.gameStart) + '</td>' +
            '<td>' + row.type + '</td>' +
            '<td>' + escapeHtml(row.gameNo) + '</td>' +
            '<td>' + escapeHtml(row.acctNo) + '</td>' +
            '<td>' + escapeHtml(row.guest) + '</td>' +
            '<td>' + escapeHtml(row.totalBuyIn) + '</td>' +
            '<td>' + escapeHtml(row.chipsReturn) + '</td>' +
            '<td>' + formatWinLossHtml(row.winLoss) + '</td>' +
            '<td>' + escapeHtml(row.totalRolling) + '</td>' +
            '<td class="commission-compare-rate-cell">' + rateCell + '</td>' +
            '<td class="commission-compare-settlement-cell">' +
            escapeHtml(fmtCompareAmount(row.settlementNum)) + '</td>' +
            '<td>' + escapeHtml(formatAddChgAmount(row.fnbNum)) + '</td>' +
            '<td class="commission-compare-payment-cell">' +
            escapeHtml(fmtCompareAmount(row.paymentNum)) + '</td>' +
            '<td>' + escapeHtml(row.dateTime) + '</td>' +
            '</tr>'
        );
    }

    function updateCompareModalTotals() {
        var totals = {
            buyIn: 0,
            chipsReturn: 0,
            winLoss: 0,
            rolling: 0,
            settlement: 0,
            fnb: 0,
            payment: 0
        };
        compareModalRows.forEach(function (row) {
            totals.buyIn += parseNumCell(row.totalBuyIn);
            totals.chipsReturn += parseNumCell(row.chipsReturn);
            totals.winLoss += row.winLossNum;
            totals.rolling += row.totalRollingNum;
            totals.settlement += row.settlementNum;
            totals.fnb += row.fnbNum;
            totals.payment += row.paymentNum;
        });
        $('#commission-compare-total-buyin').text(fmtCompareAmount(totals.buyIn));
        $('#commission-compare-total-return').html(fmtCommissionAmount(totals.chipsReturn, 'out'));
        var $compareWinLossTotal = $('#commission-compare-total-winloss');
        $compareWinLossTotal.html(fmtCommissionAmount(totals.winLoss, 'signed'));
        applyWinLossColor($compareWinLossTotal, totals.winLoss);
        $('#commission-compare-total-rolling').text(fmtCompareAmount(totals.rolling));
        $('#commission-compare-total-settlement').text(fmtCompareAmount(totals.settlement));
        $('#commission-compare-total-fnb').text(formatAddChgAmount(totals.fnb));
        $('#commission-compare-total-payment').html(fmtCommissionAmount(totals.payment, 'out'));
    }

    function refreshCompareModalRowCells() {
        $('#commission-compare-modal-body tr').each(function (idx) {
            var row = compareModalRows[idx];
            if (!row) return;
            $(this).find('.commission-compare-rate-display')
                .text(formatRollingRatePercent(row.rollingRateNum));
            $(this).find('.commission-compare-settlement-cell')
                .text(fmtCompareAmount(row.settlementNum));
            $(this).find('.commission-compare-payment-cell')
                .text(fmtCompareAmount(row.paymentNum));
        });
        updateCompareModalTotals();
    }

    function applyMasterRateToCompareModal(rateNum) {
        if (!isFinite(rateNum) || rateNum < 0) return;
        compareModalRows.forEach(function (row) {
            row.rollingRateNum = rateNum;
            var amounts = computeCompareRowAmounts(row, rateNum);
            row.settlementNum = amounts.settlement;
            row.paymentNum = amounts.payment;
        });
        refreshCompareModalRowCells();
        renderCompareModalSortIndicators();
    }

    function openCompareRatePreviewPopup(currentRate) {
        var $input = $('#commission-rate-preview-input');
        $input.val(String(currentRate));

        var rateModalEl = document.getElementById('modal-commission-rate-preview');
        var compareModalEl = document.getElementById('modal-commission-compare');
        if (!rateModalEl) return;

        if (compareModalEl && window.bootstrap && bootstrap.Modal) {
            compareModalEl.setAttribute('data-bs-focus', 'false');
        }

        if (window.bootstrap && bootstrap.Modal) {
            bootstrap.Modal.getOrCreateInstance(rateModalEl).show();
        } else if ($('#modal-commission-rate-preview').modal) {
            $('#modal-commission-rate-preview').modal('show');
        }

        setTimeout(function () {
            var input = document.getElementById('commission-rate-preview-input');
            if (input) {
                input.focus();
                input.select();
            }
        }, 150);
    }

    function closeCompareRatePreviewPopup() {
        var rateModalEl = document.getElementById('modal-commission-rate-preview');
        var compareModalEl = document.getElementById('modal-commission-compare');
        if (rateModalEl && window.bootstrap && bootstrap.Modal) {
            var instance = bootstrap.Modal.getInstance(rateModalEl);
            if (instance) instance.hide();
        } else if ($('#modal-commission-rate-preview').modal) {
            $('#modal-commission-rate-preview').modal('hide');
        }
        if (compareModalEl) {
            compareModalEl.setAttribute('data-bs-focus', 'true');
        }
    }

    function submitCompareRatePreview() {
        var raw = String($('#commission-rate-preview-input').val() || '').trim().replace(/%/g, '');
        var val = parseFloat(raw);
        if (!isFinite(val) || val < 0) {
            notifyCompare('Enter a valid rate.', 'warning');
            return;
        }
        applyMasterRateToCompareModal(val);
        closeCompareRatePreviewPopup();
    }

    function applyWinLossColor($el, value) {
        if (!$el || !$el.length) return;
        var n = typeof value === 'number' ? value : parseNumCell(value, { signed: true });
        $el.removeClass('commission-winloss-positive commission-winloss-negative');
        if (n > 0) {
            $el.addClass('commission-winloss-positive');
        } else if (n < 0) {
            $el.addClass('commission-winloss-negative');
        }
    }

    function formatWinLossHtml(value) {
        var n = parseNumCell(value, { signed: true });
        var text = n.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
        var cls = n > 0 ? 'commission-winloss-positive' : (n < 0 ? 'commission-winloss-negative' : '');
        return '<span class="' + cls + '">' + escapeHtml(text) + '</span>';
    }

    function rowSnapshotFromData(data) {
        if (!data || !data.length) return null;
        var gameNo = String(data[4] == null ? '' : data[4]).trim();
        if (!gameNo) return null;
        var acctNo = String(data[5] == null ? '' : data[5]);
        var guest = String(data[6] == null ? '' : data[6]);
        return {
            programDate: String(data[1] == null ? '' : data[1]),
            gameStart: String(data[2] == null ? '' : data[2]),
            type: String(data[3] == null ? '' : data[3]),
            gameNo: gameNo,
            acctNo: acctNo,
            guest: guest,
            account: acctNo + (guest && guest !== '-' ? ' - ' + guest : ''),
            totalBuyIn: String(data[7] == null ? '' : data[7]),
            chipsReturn: String(data[8] == null ? '' : data[8]),
            winLoss: String(data[9] == null ? '' : data[9]),
            totalRolling: String(data[10] == null ? '' : data[10]),
            rollingRate: String(data[11] == null ? '' : data[11]),
            settlement: String(data[12] == null ? '' : data[12]),
            fnb: String(data[13] == null ? '' : data[13]),
            payment: String(data[14] == null ? '' : data[14]),
            dateTime: String(data[15] == null ? '' : data[15]),
            chipLabel: 'Game #' + gameNo
        };
    }

    function syncCompareCheckboxes() {
        $('#commission-tbl tbody .commission-compare-cb').each(function () {
            var gameId = String($(this).data('game-id') || '').trim();
            $(this).prop('checked', compareSelection.has(gameId));
        });
    }

    function forEachFilteredCompareRow(callback) {
        if (!dataTable || typeof callback !== 'function') return;
        dataTable.rows({ search: 'applied' }).every(function () {
            var data = this.data();
            if (data) callback(data);
        });
    }

    function addRowToCompareSelection(rowData) {
        var snapshot = rowSnapshotFromData(rowData);
        if (!snapshot) return;
        var meta = commissionGameMeta.get(snapshot.gameNo);
        snapshot.commissionType = meta ? meta.commissionType : 1;
        compareSelection.set(snapshot.gameNo, snapshot);
    }

    function refreshCompareSelectAllHeader() {
        var $th = $('#commission-tbl thead th.commission-compare-col');
        if (!$th.length) return;
        if (!compareSelectMode) {
            if (!$th.find('.commission-compare-col-icon').length) {
                $th.html(
                    '<span class="commission-compare-col-icon" title="' +
                    escapeHtml(compareT().compare_hint || '') +
                    '"><i class="fa fa-check-square-o" aria-hidden="true"></i></span>'
                );
            }
            return;
        }
        if (!$th.find('#commission-compare-select-all').length) {
            $th.html(
                '<input type="checkbox" id="commission-compare-select-all" ' +
                'class="commission-compare-select-all form-check-input m-0" ' +
                'title="' + escapeHtml(compareT().compare_select_all || 'Select all filtered rows') + '">'
            );
        }
        updateCompareSelectAllState();
    }

    function updateCompareSelectAllState() {
        var $all = $('#commission-compare-select-all');
        if (!$all.length || !compareSelectMode) return;
        var total = 0;
        var selected = 0;
        forEachFilteredCompareRow(function (data) {
            var gameId = String(data[4] == null ? '' : data[4]).trim();
            if (!gameId) return;
            total++;
            if (compareSelection.has(gameId)) selected++;
        });
        if (!total) {
            $all.prop({ checked: false, indeterminate: false, disabled: true });
            return;
        }
        $all.prop('disabled', false);
        $all.prop('checked', selected === total);
        $all.prop('indeterminate', selected > 0 && selected < total);
    }

    function toggleSelectAllFiltered(checked) {
        forEachFilteredCompareRow(function (data) {
            var gameId = String(data[4] == null ? '' : data[4]).trim();
            if (!gameId) return;
            if (checked) {
                addRowToCompareSelection(data);
            } else {
                compareSelection.delete(gameId);
            }
        });
        refreshCompareCheckboxCells();
        updateCompareSelectAllState();
        updateCompareUi();
    }

    function refreshCompareCheckboxCells() {
        if (!dataTable) return;
        dataTable.rows({ page: 'current' }).every(function () {
            var data = this.data();
            var node = this.node();
            if (!data || !node) return;
            var gameId = String(data[4] == null ? '' : data[4]).trim();
            var $cell = $('td:eq(0)', node);
            if (!compareSelectMode) {
                $cell.empty();
                return;
            }
            var $existing = $cell.find('.commission-compare-cb');
            if ($existing.length) {
                $existing.prop('checked', gameId && compareSelection.has(gameId));
                return;
            }
            var $cb = $('<input type="checkbox" class="commission-compare-cb form-check-input m-0">')
                .attr('data-game-id', gameId)
                .prop('checked', gameId && compareSelection.has(gameId));
            $cell.html($cb);
        });
        updateCompareSelectAllState();
    }

    function clearCompareSelection() {
        exitCompareSelectMode();
    }

    function notifyCompare(message, icon) {
        if (window.Swal) {
            Swal.fire({
                icon: icon || 'info',
                title: compareT().compare_merge || 'Merge',
                text: message,
                confirmButtonColor: '#0d6efd'
            });
        } else {
            alert(message);
        }
    }

    function calculateCommissionTotals() {
        var totalBuyIn = 0;
        var totalChipsReturn = 0;
        var totalWinLoss = 0;
        var totalRolling = 0;
        var totalRollingSettlement = 0;
        var totalFnb = 0;
        var totalPayment = 0;

        var table = $('#commission-tbl').DataTable();
        table.rows({ search: 'applied' }).every(function () {
            var data = this.data();
            if (!data) return;

            var buyInValue = data[7] || '0';
            var chipsReturnValue = data[8] || '0';
            var winLossValue = data[9] || '0';
            var rollingValue = data[10] || '0';
            var rollingSettlementValue = data[12] || '0';
            var fnbValue = data[13] || '0';
            var paymentValue = data[14] || '0';

            totalBuyIn += parseNumCell(buyInValue);
            totalChipsReturn += parseNumCell(chipsReturnValue);
            totalWinLoss += parseNumCell(winLossValue, { signed: true });
            totalRolling += parseNumCell(rollingValue);
            totalRollingSettlement += parseNumCell(rollingSettlementValue);
            totalFnb += parseNumCell(fnbValue);
            totalPayment += parseNumCell(paymentValue);
        });

        function formatNumber(num) {
            return num.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
        }

        $('#GRAND_TOTAL_AMOUNT').text(formatNumber(totalBuyIn));
        $('#GRAND_CHIPS_RETURN').html(fmtCommissionAmount(totalChipsReturn, 'out'));
        var $grandWinLoss = $('#GRAND_WIN_LOSS');
        $grandWinLoss.html(fmtCommissionAmount(totalWinLoss, 'signed'));
        applyWinLossColor($grandWinLoss, totalWinLoss);
        $('#GRAND_TOTAL_ROLLING').text(formatNumber(totalRolling));
        $('#GRAND_ROLLING_SETTLEMENT').text(formatNumber(totalRollingSettlement));
        $('#GRAND_FNB').text(formatAddChgAmount(totalFnb));
        $('#GRAND_PAYMENT').html(fmtCommissionAmount(totalPayment, 'out'));
    }

    function jumpCommissionRangeToCurrentThreeMonths(instance) {
        if (!instance) return;
        const current = new Date();
        instance.jumpToDate(new Date(current.getFullYear(), current.getMonth() - 2, 1), false);
    }

    function getCommissionDateInput() {
        return document.getElementById('commission-daterange') || document.getElementById('daterange');
    }

    function placeCommissionDateFilter() {
        var $mount = $('#commission-daterange-mount');
        var $length = $('#commission-tbl').closest('.dataTables_wrapper').find('.dataTables_length').first();
        if (!$mount.length || !$length.length) return;
        if ($mount.data('placed')) return;
        $mount.detach().insertAfter($length).addClass('is-placed').data('placed', true);
        if (window.MonthEndCutoffRange && typeof window.MonthEndCutoffRange.fitRangePickerInstance === 'function') {
            var el = getCommissionDateInput();
            if (el && el._flatpickr) {
                window.MonthEndCutoffRange.fitRangePickerInstance(el._flatpickr);
            }
            fitCommissionManualInputWidth();
        }
    }

    function placeCommissionCompareToolbar() {
        var $mount = $('#commission-compare-toolbar-mount');
        var $filter = $('#commission-tbl').closest('.dataTables_wrapper').find('.dataTables_filter').first();
        if (!$mount.length || !$filter.length) return;
        if ($mount.data('placed')) return;
        $mount.detach().prependTo($filter).addClass('is-placed').data('placed', true);
    }

    function placeCommissionCompareSelection() {
        var $mount = $('#commission-compare-selection-mount');
        var $date = $('#commission-daterange-mount');
        var $length = $('#commission-tbl').closest('.dataTables_wrapper').find('.dataTables_length').first();
        if (!$mount.length) return;
        if ($mount.data('placed')) return;
        if ($date.length && $date.hasClass('is-placed')) {
            $mount.detach().insertAfter($date).addClass('is-placed').data('placed', true);
        } else if ($length.length) {
            $mount.detach().insertAfter($length).addClass('is-placed').data('placed', true);
        }
    }

    function getCommissionDateRangeValue() {
        var el = getCommissionDateInput();
        if (el && el._flatpickr) {
            var fp = el._flatpickr;
            if (fp.selectedDates && fp.selectedDates.length === 2) {
                return moment(fp.selectedDates[0]).format('YYYY-MM-DD') + ' to ' +
                    moment(fp.selectedDates[1]).format('YYYY-MM-DD');
            }
            return (fp.input.value || '').trim();
        }
        return ($('#commission-daterange').val() || $('#daterange').val() || '').trim();
    }

    function getCommissionDateRangeLabel() {
        var el = getCommissionDateInput();
        if (el && el._flatpickr && el._flatpickr.altInput && el._flatpickr.altInput.value) {
            return el._flatpickr.altInput.value.trim();
        }
        return getCommissionDateRangeValue();
    }

    var commissionSplitDateRange = (window.SplitDateRange && SplitDateRange.attach({
        rangePickerId: 'commission-daterange',
        startId: 'commission-start-date',
        endId: 'commission-end-date',
        splitWrapperId: 'commission-split-daterange-wrapper',
        invalidDateMessage: window.commissionTranslations?.invalid_date || 'Invalid date range.'
    })) || { syncFromRange: function () {}, isSyncing: function () { return false; } };

    function syncCommissionSplitFromFlatpickr() {
        commissionSplitDateRange.syncFromRange();
    }

    // Initialize Flatpickr for date range
    var commissionDateInput = getCommissionDateInput();
    var flatpickrInstance = commissionDateInput ? flatpickr(commissionDateInput, {
        mode: "range",
        showMonths: 3,
        onReady: function (selectedDates, dateStr, instance) {
            jumpCommissionRangeToCurrentThreeMonths(instance);
            if (typeof window.setupFlatpickrMonthNameRangeSelect === 'function') {
                window.setupFlatpickrMonthNameRangeSelect(instance);
            }
            setTimeout(syncCommissionSplitFromFlatpickr, 0);
        },
        onOpen: function (selectedDates, dateStr, instance) {
            jumpCommissionRangeToCurrentThreeMonths(instance);
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
            if (selectedDates.length === 2) {
                if (!commissionSplitDateRange.isSyncing()) {
                    syncCommissionSplitFromFlatpickr();
                }
                reloadData();
            }
        }
    }) : null;

    if (flatpickrInstance) {
        setTimeout(syncCommissionSplitFromFlatpickr, 0);
    }

    // Destroy existing DataTable if already initialized
    if ($.fn.DataTable.isDataTable('#commission-tbl')) {
        $('#commission-tbl').DataTable().destroy();
    }

    // Initialize DataTable
    var dataTable = $('#commission-tbl').DataTable({
    "scrollX": false,
    "autoWidth": false,
    "order": [[15, 'desc']],
    "columnDefs": [
      {
        "targets": 0,
        "orderable": false,
        "searchable": false,
        "width": "28px",
        "className": "text-center commission-compare-cell"
      },
      {
        "targets": 1,
        "width": "7%",
        "className": "col-program-date",
        "render": function (data, type) {
          var dateMoment = parseCommissionDisplayDate(data);
          if (type === 'sort' || type === 'type') {
            return dateMoment ? dateMoment.valueOf() : 0;
          }
          return data || '-';
        }
      },
      {
        "targets": 2,
        "width": "7%",
        "className": "col-game-start",
        "render": function (data, type) {
          var dateMoment = parseCommissionDisplayDate(data);
          if (type === 'sort' || type === 'type') {
            return dateMoment ? dateMoment.valueOf() : 0;
          }
          return formatCommissionDateTimeDisplay(data);
        }
      },
      { "targets": 3, "width": "3%", "className": "col-type text-center" },
      { "targets": 4, "width": "3%" },
      { "targets": 5, "width": "4%", "className": "col-acct-no" },
      { "targets": 6, "width": "9%", "className": "col-guest" },
      { "targets": 7, "width": "6%", "className": "col-buyin" },
      { "targets": 8, "width": "6%", "className": "col-cashout" },
      { "targets": 9, "width": "6%", "className": "col-winloss" },
      { "targets": 10, "width": "6%", "className": "col-total-rolling" },
      { "targets": 11, "width": "4%", "className": "col-game-rate" },
      { "targets": 12, "width": "5.5%", "className": "col-commission" },
      { "targets": 13, "width": "4.5%" },
      { "targets": 14, "width": "6%" },
      {
        "targets": [7, 8, 9, 10, 11, 12, 13, 14],
        "searchable": false
      },
      {
        "targets": 15,
        "width": "8%",
        "className": "col-game-end",
        "render": function (data, type) {
          var dateMoment = parseCommissionDisplayDate(data);
          if (type === 'sort' || type === 'type') {
            return dateMoment ? dateMoment.valueOf() : 0;
          }
          return formatCommissionGameEndDisplay(data);
        },
        "createdCell": function (cell) {
          $(cell).addClass('text-center');
        }
      }
    ],
    "createdRow": function (row, data) {
        applyWinLossColor($('td:eq(9)', row), data[9]);
        var guestText = String(data[6] == null ? '' : data[6]).trim();
        if (guestText && guestText !== '-') {
            $('td:eq(6)', row).attr('title', guestText);
        }
        var acctText = String(data[5] == null ? '' : data[5]).trim();
        if (acctText && acctText !== '-') {
            $('td:eq(5)', row).attr('title', acctText);
        }
    },
    "drawCallback": function () {
        placeCommissionDateFilter();
        placeCommissionCompareSelection();
        placeCommissionCompareToolbar();
        refreshCompareSelectAllHeader();
        refreshCompareCheckboxCells();
        calculateCommissionTotals();
        if ($.fn.DataTable.isDataTable('#commission-tbl')) {
            $('#commission-tbl').DataTable().columns.adjust();
        }
    },
    "language": {
        "search": (window.commissionTranslations?.search || "Search:"),
        "info": (window.commissionTranslations?.showing_entries || "Showing _START_ to _END_ of _TOTAL_ entries"),
        "paginate": {
            "previous": (window.commissionTranslations?.previous || "Previous"),
            "next": (window.commissionTranslations?.next || "Next")
        },
        "emptyTable": (window.commissionTranslations?.no_data_found || "No data available in table")
    },
});

    placeCommissionDateFilter();
    placeCommissionCompareSelection();
    placeCommissionCompareToolbar();

    function reloadData() {

        const dateRange = getCommissionDateRangeValue();

        if (!dateRange) {
            alert(window.commissionTranslations?.please_select_date_range || 'Please select a date range.');
            return;
        }

        // Split by ' to ' (with spaces)
        let start, end;
        if (dateRange.includes(' to ')) {
            if (window.MonthEndCutoffRange) {
                var apiRange = window.MonthEndCutoffRange.parseRangeToApiDates(dateRange);
                start = apiRange.start;
                end = apiRange.end;
            } else {
                [start, end] = dateRange.split(' to ');
            }
        } else {
            start = window.MonthEndCutoffRange ? window.MonthEndCutoffRange.toApiDate(dateRange) : dateRange;
            end = start;
        }
        
        // Ensure both dates are valid
        if (!start || !end) {
            alert('Invalid date range. Please select a valid range.');
            return;
        }

        $.ajax({
            url: '/commission_data', // Endpoint to fetch commission data
            method: 'GET',
            data: { start, end },
            success: function(data) {
                clearCompareSelection();
                dataTable.clear(); // Clear existing table rows

                var ajaxCalls = [];
                var totalInitialBuyIn = 0;
                var totalAdditionalBuyIn = 0;
                var totalAmount = 0;
                var totalRolling = 0;
                var totalChipsReturn = 0;
                var totalWinLoss = 0;

                var totalRollingSettlement = 0;
                var totalFNB = 0;
                var totalPayment = 0;

                commissionGameMeta.clear();

                data.forEach(function(row) {
                    // Only process records that are settled
                    if (row.SETTLED === 1) {
                        commissionGameMeta.set(String(row.game_list_id), {
                            commissionType: Number(row.COMMISSION_TYPE) || 1,
                            accountId: row.ACCOUNT_ID
                        });
                        var RollingRate = row.COMMISSION_PERCENTAGE; // Ensure the RollingRate is correct
                        var fb = row.fnb || 0; // Use the FNB value from the row
                        var payment = row.payment || 0; // Use the PAYMENT value from the row

                        ajaxCalls.push(
                            $.ajax({
                                url: '/game_list/' + row.game_list_id + '/record',
                                method: 'GET',
                                success: function(response) {
                                    var total_buy_in = 0;
                                    var total_cash_out = 0;
                                    var total_rolling = 0;
                                    var initial_buy_in = 0;

                                    var total_nn_init = 0;
                                    var total_cc_init = 0;
                                    var total_nn = 0;
                                    var total_cc = 0;
                                    var total_cash_out_nn = 0;
                                    var total_cash_out_cc = 0;
                                    var total_rolling_nn = 0;
                                    var total_rolling_cc = 0;

                                    var total_rolling_real = 0;
                                    var total_rolling_nn_real = 0;
                                    var total_rolling_cc_real = 0;
                                    var total_roller_return_cc = 0;

                                    // Loop through the response and calculate totals
                                    response.forEach(function(res) {
                                        if (res.CAGE_TYPE == 1 && (total_nn_init != 0 || total_cc_init != 0)) {
                                            total_buy_in += res.AMOUNT;
                                            total_nn += res.NN_CHIPS;
                                            total_cc += res.CC_CHIPS;
                                        }

                                        if ((total_nn_init == 0 && total_cc_init == 0) && res.CAGE_TYPE == 1) {
                                            initial_buy_in = res.AMOUNT;
                                            total_nn_init += res.NN_CHIPS;
                                            total_cc_init += res.CC_CHIPS;
                                        }

                                        if (res.CAGE_TYPE == 2) {
                                            total_cash_out += res.AMOUNT;
                                            total_cash_out_nn += res.NN_CHIPS;
                                            total_cash_out_cc += res.CC_CHIPS;
                                        }

                                        if (res.CAGE_TYPE == 3) {
                                            total_rolling += res.AMOUNT;
                                            total_rolling_nn += res.NN_CHIPS;
                                            total_rolling_cc += res.CC_CHIPS;
                                        }

                                        if (res.CAGE_TYPE == 4) {
                                            total_rolling_real += res.AMOUNT;
                                            total_rolling_nn_real += res.NN_CHIPS;
                                            total_rolling_cc_real += res.CC_CHIPS;
                                        }

                                        if (res.CAGE_TYPE == 5) {
                                            var rollerTransaction = parseInt(res.ROLLER_TRANSACTION) || 1;
                                            if (rollerTransaction === 2) {
                                                total_roller_return_cc += parseFloat(res.ROLLER_CC_CHIPS) || 0;
                                            }
                                        }
                                    });

                                    var total_initial = total_nn_init + total_cc_init;
                                    var total_buy_in_chips = total_nn + total_cc;
                                    var total_cash_out_chips = total_cash_out_nn + total_cash_out_cc;
                                    // TOTAL ROLLING: Follow same logic as game_list_data (reloadData function)
                                    // Formula: total_rolling_nn + totalRollingCCWithReturns + total_rolling + total_rolling_real + total_rolling_nn_real + total_rolling_cc_real - total_cash_out_nn
                                    // Note: CC chips from CAGE_TYPE == 3 (TOTAL ROLLING) should NOT be included
                                    // Note: CC chips from CAGE_TYPE == 4 (REAL ROLLING) SHOULD be included
                                    // Note: Buy-in amounts are NOT included here - they are separate from rolling transactions
                                    var totalRollingCCWithReturns = total_roller_return_cc;  // Only include roller return CC, exclude CC from CAGE_TYPE == 3
                                    var total_rolling_chips = total_rolling_nn + totalRollingCCWithReturns + total_rolling + total_rolling_real + total_rolling_nn_real + total_rolling_cc_real - total_cash_out_nn;

                                    var gross = total_buy_in - total_cash_out;
                                    var total_amount = total_buy_in_chips + total_initial;

                                    // Calculate the net commission
                                   // var netValue = total_rolling_chips * (RollingRate / 100); // Calculate the net value
                                  //  var net = netValue.toLocaleString('en-US'); // Format net value
                                    var winlossValue = total_amount - total_cash_out_chips;
                                    var winloss = fmtCommissionAmount(winlossValue, 'signed');

                                  //  var WinLoss = total_amount - total_cash_out_chips;
							
							        var net;
							
								if (row.COMMISSION_TYPE == 1 || row.COMMISSION_TYPE == 3) {
									// Kung ang COMMISSION_TYPE ay 1, ang net ay computed gamit ang total rolling chips
									net = Math.round((total_rolling_chips * RollingRate) / 100);
								} else if (row.COMMISSION_TYPE == 2) {
									// Kung ang COMMISSION_TYPE ay 2, ang net ay computed gamit ang winloss
									net = Math.round((winlossValue * RollingRate) / 100);
								}

                                    // Payment calculation based on RollingSettlement and fb
                                    var RollingSettlement = (total_rolling_chips * RollingRate) / 100;
                                    var paymentValue = Math.round(net - fb);


                                    // Add to grand totals
                                    totalInitialBuyIn += total_initial;
                                    totalAdditionalBuyIn += total_buy_in_chips;
                                    totalAmount += total_amount;
                                    totalRolling += total_rolling_chips;
                                    totalChipsReturn += total_cash_out_chips;
                                    totalWinLoss += winlossValue; // Ensure unformatted value for calculation
                                    totalRollingSettlement += net;
                                    totalFNB += fb;
                                    totalPayment += paymentValue;
                                    
                                    
                         var formattedGameEnd = formatCommissionGameEnd(row);
                                    dataTable.row.add([
                                        '',
                                        formatCommissionProgramDate(row),
                                        formatCommissionGameStart(row),
                                        formatCommissionGameType(row),
                                        row.game_list_id,
                                        row.agent_code || '',
                                        row.guest_name || '-',
                                        formatAddChgAmount(total_amount),
                                        fmtCommissionAmount(total_cash_out_chips, 'out'),
                                        winloss,
                                        formatAddChgAmount(total_rolling_chips),
                                        formatRollingRatePercent(row.COMMISSION_PERCENTAGE),
                                        formatAddChgAmount(net),
                                        formatAddChgAmount(fb),
                                        fmtCommissionAmount(paymentValue, 'out'),
                                        formattedGameEnd
                                    ]);
                                },
                                error: function(xhr, status, error) {
                                    console.error('Error fetching options:', error);
                                }
                            })
                        );
                    }
                });
                
                // Wait for all AJAX calls to complete before drawing the table once
                $.when.apply($, ajaxCalls).done(function() {
                    dataTable.draw();
                });

               
            },
            error: function(xhr, status, error) {
                console.error('Error fetching data:', error);
            }
        });
    }

    function parseCommissionIsoDateLocal(value) {
        var m = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
        if (!m) return null;
        return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    }

    function setCommissionDateRange(from, to) {
        if (!flatpickrInstance) return;
        var start = parseCommissionIsoDateLocal(from);
        var end = parseCommissionIsoDateLocal(to);
        if (!start || !end) return;
        flatpickrInstance.setDate([start, end], false);
        syncCommissionSplitFromFlatpickr();
    }

    function applyCommissionDefaultDateRange() {
        if (!flatpickrInstance) return;
        if (window.MonthEndCutoffRange && typeof window.MonthEndCutoffRange.getMonthEndCutoffRange === 'function') {
            var range = window.MonthEndCutoffRange.getMonthEndCutoffRange();
            if (range && range.defaultDate && range.defaultDate.length === 2) {
                flatpickrInstance.setDate(range.defaultDate, false);
                syncCommissionSplitFromFlatpickr();
                return;
            }
        }
        var now = new Date();
        var monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
        var monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0);
        flatpickrInstance.setDate([monthStart, monthEnd], false);
        syncCommissionSplitFromFlatpickr();
    }

    window.setCommissionDateRange = setCommissionDateRange;
    window.commissionReloadData = reloadData;

    // Load data initially (full page only; dashboard loads on modal open)
    if (!dashCommissionModalEl) {
        reloadData();
    }

    if (dashCommissionModalEl) {
        window.openDashboardCommissionModal = function () {
            bootstrap.Modal.getOrCreateInstance(dashCommissionModalEl).show();
        };

        dashCommissionModalEl.addEventListener('shown.bs.modal', function () {
            applyCommissionDefaultDateRange();
            reloadData();
            if ($.fn.DataTable.isDataTable('#commission-tbl')) {
                $('#commission-tbl').DataTable().columns.adjust().draw(false);
            }
            placeCommissionDateFilter();
            placeCommissionCompareToolbar();
            placeCommissionCompareSelection();
        });
    }

    function getCommissionExportFilename() {
        var dr = getCommissionDateInput();
        if (dr && dr._flatpickr && dr._flatpickr.selectedDates && dr._flatpickr.selectedDates.length === 2) {
            var pad = function (n) {
                return String(n).padStart(2, '0');
            };
            var fmt = function (dt) {
                return dt.getFullYear() + '-' + pad(dt.getMonth() + 1) + '-' + pad(dt.getDate());
            };
            return 'Commission_' + fmt(dr._flatpickr.selectedDates[0]) + '_to_' + fmt(dr._flatpickr.selectedDates[1]) + '.xlsx';
        }
        return 'Commission-export.xlsx';
    }

    function escapeHtml(value) {
        return String(value == null ? '' : value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function getCommissionTablePayload(includeFooter) {
        var dt = $('#commission-tbl').DataTable();
        var headers = [];
        $('#commission-tbl thead tr:first th').each(function () {
            headers.push($(this).text().trim());
        });

        var rows = [];
        dt.rows({ search: 'applied' }).every(function () {
            var cells = [];
            $(this.node()).find('td').each(function () {
                cells.push($(this).text().trim());
            });
            if (cells.length) rows.push(cells);
        });

        var dataRowCount = rows.length;
        if (includeFooter && dataRowCount > 0) {
            rows.push([
                '',
                $('#commission-tbl tfoot th').eq(1).text().trim(),
                '',
                '',
                '',
                '',
                '',
                $('#GRAND_TOTAL_AMOUNT').text().trim(),
                $('#GRAND_CHIPS_RETURN').text().trim(),
                $('#GRAND_WIN_LOSS').text().trim(),
                $('#GRAND_TOTAL_ROLLING').text().trim(),
                '',
                $('#GRAND_ROLLING_SETTLEMENT').text().trim(),
                $('#GRAND_FNB').text().trim(),
                $('#GRAND_PAYMENT').text().trim(),
                ''
            ]);
        }

        return { headers: headers, rows: rows, dataRowCount: dataRowCount };
    }

    function getCommissionPrintStyles() {
        return [
            '@page{size:landscape;margin:8mm;}',
            'body{font-family:Arial,sans-serif;color:#111;margin:0;}',
            '.print-wrap{width:100%;}',
            'h2{text-align:center;margin:0 0 4px;font-size:18px;}',
            '.subtitle{text-align:center;margin:0 0 12px;font-size:12px;color:#444;}',
            'table{width:100%;border-collapse:collapse;font-size:9px;}',
            'th,td{border:1px solid #777;padding:5px 7px;vertical-align:middle;}',
            'th{background:#d9e1f2;text-align:right;font-weight:700;}',
            'th:nth-child(1){text-align:center;}',
            'th:nth-child(2),th:nth-child(3),th:nth-child(5),th:nth-child(6),th:nth-child(7),th:nth-child(16){text-align:left;}',
            'td{text-align:right;}',
            'td:nth-child(1){text-align:center;}',
            'td:nth-child(2),td:nth-child(3),td:nth-child(5),td:nth-child(6),td:nth-child(7),td:nth-child(16){text-align:left;}',
            'tbody tr:last-child td{font-weight:700;background:#f4f6fa;}'
        ].join('');
    }

    function printCommissionTable() {
        if (!$.fn.DataTable.isDataTable('#commission-tbl')) return;
        var payload = getCommissionTablePayload(true);
        var t = window.commissionTranslations || {};
        if (payload.dataRowCount === 0) {
            if (window.Swal) {
                Swal.fire({
                    icon: 'info',
                    title: 'Print',
                    text: t.no_data_found || 'No rows to print for the current filter.',
                    confirmButtonColor: '#0d6efd'
                });
            } else {
                alert(t.no_data_found || 'No rows to print.');
            }
            return;
        }

        var dateRange = getCommissionDateRangeLabel();
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
            '<!doctype html><html><head><title>Commission</title><style>',
            getCommissionPrintStyles(),
            '</style></head><body><div class="print-wrap">',
            '<h2>Commission</h2>',
            '<div class="subtitle">', escapeHtml(dateRange), '</div>',
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

    $('#btn-commission-export').on('click', function (e) {
        e.preventDefault();
        if (!$.fn.DataTable.isDataTable('#commission-tbl')) return;
        var payload = getCommissionTablePayload(false);
        var headers = payload.headers;
        var rows = payload.rows;
        var t = window.commissionTranslations || {};
        if (payload.dataRowCount === 0) {
            if (window.Swal) {
                Swal.fire({
                    icon: 'info',
                    title: t.export_label || 'Export',
                    text: t.no_data_found || 'No rows to export for the current filter.',
                    confirmButtonColor: '#0d6efd'
                });
            } else {
                alert(t.no_data_found || 'No rows to export.');
            }
            return;
        }
        var outName = getCommissionExportFilename();
        var $btn = $(this);
        $btn.prop('disabled', true);
        fetch('/commission/export_xlsx', {
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
                        title: 'Error',
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

    $('#btn-commission-print').on('click', function (e) {
        e.preventDefault();
        printCommissionTable();
    });

    function formatMergeNumeric(value) {
        return Number(value || 0).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
    }

    function fetchMergeServicesTotal(selectedIds) {
        if (!Array.isArray(selectedIds) || !selectedIds.length) return Promise.resolve(0);
        var requests = selectedIds.map(function (gameId) {
            return $.ajax({
                url: '/game_services/' + gameId,
                method: 'GET'
            }).then(function (rows) {
                if (!Array.isArray(rows)) return 0;
                return rows.reduce(function (sum, item) {
                    var amt = parseFloat(item.AMOUNT || item.amount || 0);
                    return sum + (isNaN(amt) ? 0 : amt);
                }, 0);
            }).catch(function () {
                return 0;
            });
        });
        return Promise.all(requests).then(function (totals) {
            return totals.reduce(function (sum, n) { return sum + (parseFloat(n) || 0); }, 0);
        });
    }

    function openMergeSettlementFromCommissionCompare(rowsToMerge) {
        var rows = rowsToMerge || compareModalRows;
        if (!rows.length) {
            notifyCompare(compareT().compare_select_one || 'Select at least one row.', 'warning');
            return;
        }

        var $modal = $('#modal-merge-settlement');
        if (!$modal.length) {
            notifyCompare('Merge settlement modal is not loaded.', 'error');
            return;
        }

        var selectedIds = [];
        var accountIds = [];
        var selectedAccountDisplays = [];
        var selectedRates = [];
        var totalBuyIn = 0;
        var totalChipsReturn = 0;
        var totalRolling = 0;
        var totalSettlement = 0;
        var totalWinLoss = 0;

        rows.forEach(function (row) {
            var gameId = parseInt(String(row.gameNo), 10);
            if (!isNaN(gameId) && selectedIds.indexOf(gameId) === -1) selectedIds.push(gameId);

            var accountText = String(row.account || '').replace(/\s+/g, ' ').trim();
            if (accountText && selectedAccountDisplays.indexOf(accountText) === -1) {
                selectedAccountDisplays.push(accountText);
            }

            var meta = commissionGameMeta.get(String(row.gameNo));
            if (meta && meta.accountId != null) {
                var accId = parseInt(meta.accountId, 10);
                if (!isNaN(accId) && accountIds.indexOf(accId) === -1) accountIds.push(accId);
            }

            totalBuyIn += row.totalBuyIn != null ? parseNumCell(row.totalBuyIn) : 0;
            totalChipsReturn += row.chipsReturn != null ? parseNumCell(row.chipsReturn) : 0;
            totalRolling += row.totalRollingNum || 0;
            totalSettlement += row.settlementNum || 0;
            totalWinLoss += row.winLossNum || 0;

            var rateText = formatRollingRatePercent(row.rollingRateNum).replace(/%/g, '').trim();
            if (rateText && selectedRates.indexOf(rateText) === -1) selectedRates.push(rateText);
        });

        if (!selectedIds.length) {
            notifyCompare('No valid games to merge.', 'warning');
            return;
        }

        var now = moment();
        var nameText = selectedAccountDisplays.length === 1
            ? selectedAccountDisplays[0]
            : (selectedAccountDisplays.length > 1 ? selectedAccountDisplays.join(', ') : '-');
        var rateTextValue = selectedRates.length === 1
            ? selectedRates[0]
            : (selectedRates.length > 1 ? 'Mixed' : '0');

        fetchMergeServicesTotal(selectedIds).then(function (servicesTotal) {
            var paymentAmount = totalSettlement - servicesTotal;

            $modal.find('#mergeGameIds').val(selectedIds.join(','));
            $modal.find('#txtAccountIDMergeSettle').val(accountIds.join(','));
            $modal.find('#accNoMerge').text(nameText);
            $modal.find('#gameNoMerge').text(selectedIds.join(', '));
            $modal.find('#dateMerge').text(now.format('YYYY-MM-DD'));
            $modal.find('#timeMerge').text(now.format('HH:mm'));
            $modal.find('#buyInMerge').val(formatMergeNumeric(totalBuyIn));
            $modal.find('#chipsReturnMerge').val(formatMergeNumeric(totalChipsReturn));
            $modal.find('#winLossMerge').val(formatMergeNumeric(totalWinLoss));
            $modal.find('#rollingMerge').val(formatMergeNumeric(totalRolling));
            $modal.find('#rollingRateMerge').val(rateTextValue);
            $modal.find('#rollingSettlementMerge').val(formatMergeNumeric(totalSettlement));
            $modal.find('#fbMerge').val(formatMergeNumeric(servicesTotal));
            $modal.find('#paymentMerge').val(formatMergeNumeric(paymentAmount));

            if ($modal.modal) {
                $modal.modal('show');
            } else if (window.bootstrap && bootstrap.Modal) {
                bootstrap.Modal.getOrCreateInstance($modal[0]).show();
            }
        });
    }

    function openCompareModal() {
        var snapshots = Array.from(compareSelection.values()).sort(function (a, b) {
            return String(b.gameNo).localeCompare(String(a.gameNo), undefined, { numeric: true });
        });
        if (!snapshots.length) {
            notifyCompare(compareT().compare_select_one || 'Select at least one row.');
            return;
        }

        compareModalSortKey = 'dateTime';
        compareModalSortDir = 'desc';
        compareModalRows = snapshots.map(buildCompareModalRowFromSnapshot);
        rerenderCompareModalTableBody();

        var dateRange = getCommissionDateRangeLabel();
        $('#commission-compare-modal-range').text(
            (compareT().select_date_range || 'Date range') + ': ' + dateRange +
            ' · ' + compareModalRows.length + ' row(s)'
        );

        var modalEl = document.getElementById('modal-commission-compare');
        if (modalEl && window.bootstrap && bootstrap.Modal) {
            bootstrap.Modal.getOrCreateInstance(modalEl).show();
        } else if ($('#modal-commission-compare').modal) {
            $('#modal-commission-compare').modal('show');
        }
    }

    $(document).on('click', '#commission-compare-modal-tbl thead th.commission-compare-sortable-col', function () {
        var key = $(this).attr('data-sort-key') || 'dateTime';
        if (compareModalSortKey === key) {
            compareModalSortDir = compareModalSortDir === 'asc' ? 'desc' : 'asc';
        } else {
            compareModalSortKey = key;
            compareModalSortDir = key === 'dateTime' || key === 'gameNo' ? 'desc' : 'asc';
        }
        rerenderCompareModalTableBody();
    });

    $(document).on('click', '#commission-compare-modal-body tr.commission-compare-first-row', function () {
        var row = compareModalRows[0];
        if (!row) return;
        openCompareRatePreviewPopup(row.rollingRateNum);
    });

    $('#btn-commission-rate-preview').on('click', function (e) {
        e.preventDefault();
        submitCompareRatePreview();
    });

    $('#commission-rate-preview-input').on('keydown', function (e) {
        if (e.key === 'Enter') {
            e.preventDefault();
            submitCompareRatePreview();
        }
    });

    $(document).on('hidden.bs.modal', '#modal-commission-rate-preview', function () {
        var compareModalEl = document.getElementById('modal-commission-compare');
        if (compareModalEl) {
            compareModalEl.setAttribute('data-bs-focus', 'true');
        }
    });

    $(document).on('change', '#commission-tbl .commission-compare-cb', function () {
        var $cb = $(this);
        var gameId = String($cb.data('game-id') || '').trim();
        if (!gameId) {
            $cb.prop('checked', false);
            return;
        }

        if ($cb.is(':checked')) {
            var $tr = $cb.closest('tr');
            var rowData = dataTable.row($tr).data();
            var snapshot = rowSnapshotFromData(rowData);
            if (!snapshot) {
                $cb.prop('checked', false);
                return;
            }
            var meta = commissionGameMeta.get(gameId);
            snapshot.commissionType = meta ? meta.commissionType : 1;
            compareSelection.set(gameId, snapshot);
        } else {
            compareSelection.delete(gameId);
        }

        updateCompareSelectAllState();
        updateCompareUi();
    });

    $(document).on('change', '#commission-compare-select-all', function () {
        toggleSelectAllFiltered($(this).is(':checked'));
    });

    $('#commission-tbl').on('search.dt draw.dt', function () {
        if (!compareSelectMode) return;
        refreshCompareCheckboxCells();
        updateCompareSelectAllState();
    });

    $('#btn-commission-compare-start').on('click', function (e) {
        e.preventDefault();
        enterCompareSelectMode();
    });

    $('#btn-commission-compare-clear').on('click', function (e) {
        e.preventDefault();
        clearCompareSelection();
    });

    $('#btn-commission-compare-confirm').on('click', function (e) {
        e.preventDefault();
        openCompareModal();
    });

    $('#btn-commission-compare-merge-settle').on('click', function (e) {
        e.preventDefault();
        openMergeSettlementFromCommissionCompare(compareModalRows);
    });

    $(document).on('click', '#send-merge-settlement-telegram-btn', function (e) {
        if (!$('#modal-commission-compare').length) return;
        e.preventDefault();
        var $modal = $('#modal-merge-settlement');
        var rawIds = String($modal.find('#mergeGameIds').val() || '').trim();
        var rawAccounts = String($modal.find('#txtAccountIDMergeSettle').val() || '').trim();
        if (!rawIds || !rawAccounts) {
            notifyCompare('No selected games for merge settlement.', 'warning');
            return;
        }

        var payload = {
            account_ids: rawAccounts.split(',').map(function (s) {
                return parseInt(String(s).trim(), 10);
            }).filter(function (n) { return !isNaN(n); }),
            account_display: ($modal.find('#accNoMerge').text() || '').trim(),
            game_numbers: ($modal.find('#gameNoMerge').text() || '').trim(),
            date: ($modal.find('#dateMerge').text() || '').trim(),
            time: ($modal.find('#timeMerge').text() || '').trim(),
            buy_in: ($modal.find('#buyInMerge').val() || '').trim(),
            chips_return: ($modal.find('#chipsReturnMerge').val() || '').trim(),
            win_loss: ($modal.find('#winLossMerge').val() || '').trim(),
            rolling: ($modal.find('#rollingMerge').val() || '').trim(),
            rate: ($modal.find('#rollingRateMerge').val() || '').trim(),
            settlement: ($modal.find('#rollingSettlementMerge').val() || '').trim(),
            services: ($modal.find('#fbMerge').val() || '').trim(),
            payment: ($modal.find('#paymentMerge').val() || '').trim()
        };

        if (!payload.account_ids.length) {
            notifyCompare('Account information is missing.', 'warning');
            return;
        }

        var $btn = $('#send-merge-settlement-telegram-btn');
        $btn.prop('disabled', true).text('Sending...');
        $.ajax({
            url: '/merge_settlement_telegram',
            method: 'POST',
            data: payload,
            success: function (response) {
                if (window.Swal) {
                    Swal.fire({
                        icon: 'success',
                        title: 'Telegram sent',
                        text: response && response.message ? response.message : 'Sent successfully.',
                        confirmButtonColor: '#0d6efd'
                    });
                }
            },
            error: function (xhr) {
                var msg = (xhr.responseJSON && xhr.responseJSON.error)
                    ? xhr.responseJSON.error
                    : 'Failed to send telegram.';
                notifyCompare(msg, 'error');
            },
            complete: function () {
                $btn.prop('disabled', false).text('Send Telegram');
            }
        });
    });

    updateCompareUi();
});