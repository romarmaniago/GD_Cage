/**
 * Settlement slip modal (views/partials/settlement_slip_modal.ejs) — shared by
 * Junket Expenses and Loss Amount "Settle".
 *
 * window.createSettlementSlip(config) wires one modal and returns { openView(id) }.
 * Call it after jQuery / Bootstrap / flatpickr are loaded (e.g. on DOMContentLoaded).
 *
 * config:
 *   modalId          id of the modal element
 *   title            slip title (Copy text header), e.g. 'Settlement (Expenses)'
 *   triggerSelector  button(s) that open the slip in settle mode
 *   getRange()       -> { start, end } (YYYY-MM-DD) as shown in the page filter
 *   getRows()        -> rows already loaded on the page
 *   fetchRows(range) -> jqXHR/promise resolving to rows for an edited range
 *   summarize(rows, range) -> { mains: [{ name, amount }], total, count }
 *                      amounts signed (settled costs negative); count = rows to settle
 *   settleUrl        POST { fromDate, toDate, expectedAmount }
 *   viewUrl(id)      GET a saved settlement -> { date_from, date_to, mains, total }
 *   confirmTitle     e.g. 'Settle expenses?'
 *   afterSettled()   refresh the page / table after a successful settle
 *   imageFileName    download name when image clipboard is unsupported
 *   emptyLabel       shown when there are no rows in the list
 */
(function () {
    if (window.createSettlementSlip) return;

    var html2canvasPromise = null;

    function esc(s) {
        return String(s == null ? '' : s)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    function fmtAmount(n) {
        var v = Math.round(Number(n) || 0);
        var s = Math.abs(v).toLocaleString('en-US');
        return v < 0 ? '(' + s + ')' : s;
    }

    function amountHtml(n, extraCls) {
        var cls = 'hes-amount' + (Number(n) < 0 ? ' is-negative' : '') + (extraCls ? ' ' + extraCls : '');
        return '<span class="' + cls + '">' + fmtAmount(n) + '</span>';
    }

    /** YYYY-MM-DD -> M/D/YYYY */
    function fmtDate(ymd) {
        if (!ymd) return '-';
        var p = String(ymd).split('-').map(Number);
        return p[1] + '/' + p[2] + '/' + p[0];
    }

    function swalMsg(icon, title, text) {
        if (typeof Swal !== 'undefined') {
            return Swal.fire({ icon: icon, title: title, text: text, confirmButtonText: 'OK' });
        }
        alert(title + (text ? '\n' + text : ''));
        return Promise.resolve();
    }

    function notify(ok, msg) {
        if (typeof Swal === 'undefined') return;
        if (ok) {
            Swal.fire({ icon: 'success', title: 'Copied!', text: msg, timer: 2000, showConfirmButton: false });
        } else {
            Swal.fire({ icon: 'error', title: 'Copy failed', text: msg, confirmButtonText: 'OK' });
        }
    }

    function withBusy($btn, promise) {
        var original = $btn.html();
        $btn.prop('disabled', true).html('<span class="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span>');
        return promise.finally(function () { $btn.prop('disabled', false).html(original); });
    }

    function loadHtml2Canvas() {
        if (typeof html2canvas !== 'undefined') return Promise.resolve();
        if (html2canvasPromise) return html2canvasPromise;
        html2canvasPromise = new Promise(function (resolve, reject) {
            var script = document.createElement('script');
            script.src = 'https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.min.js';
            script.onload = function () { resolve(); };
            script.onerror = function () {
                html2canvasPromise = null;
                reject(new Error('Failed to load image copy library.'));
            };
            document.body.appendChild(script);
        });
        return html2canvasPromise;
    }

    function buildImageBlob(el) {
        return loadHtml2Canvas()
            .then(function () {
                return html2canvas(el, { backgroundColor: '#ffffff', scale: 2, useCORS: true, logging: false });
            })
            .then(function (canvas) {
                return new Promise(function (resolve, reject) {
                    canvas.toBlob(function (blob) {
                        if (blob) resolve(blob); else reject(new Error('Failed to create image.'));
                    }, 'image/png');
                });
            });
    }

    window.createSettlementSlip = function (config) {
        var modalSel = '#' + config.modalId;
        var $modal = function () { return $(modalSel); };
        var find = function (sel) { return $modal().find(sel); };

        // Current range (YYYY-MM-DD) and the rows the slip is computed from.
        var range = { start: null, end: null };
        var rows = [];
        var fetchSeq = 0;
        var pickers = null;
        var pending = { count: 0, amount: 0 };
        var viewMode = false;

        function initDatePickers() {
            if (pickers || typeof flatpickr !== 'function') return;
            var opts = {
                dateFormat: 'Y-m-d',
                altInput: true,
                altFormat: 'n/j/Y',
                allowInput: true,
                disableMobile: true,
                onChange: onDatesEdited
            };
            pickers = {
                start: flatpickr(find('.hes-start-date')[0], opts),
                end: flatpickr(find('.hes-end-date')[0], opts)
            };
        }

        function setPickerDates() {
            if (!pickers) return;
            pickers.start.setDate(range.start, false);
            pickers.end.setDate(range.end, false);
        }

        function onDatesEdited() {
            if (viewMode) return;
            var a = find('.hes-start-date').val();
            var b = find('.hes-end-date').val();
            if (!/^\d{4}-\d{2}-\d{2}$/.test(a) || !/^\d{4}-\d{2}-\d{2}$/.test(b)) return;
            range = a <= b ? { start: a, end: b } : { start: b, end: a };
            setPickerDates();
            fetchRowsAndRender();
        }

        /** Reload rows for the edited range (it may fall outside what the page has loaded). */
        function fetchRowsAndRender() {
            var seq = ++fetchSeq;
            var $summary = find('.hes-summary').addClass('is-loading');
            $.when(config.fetchRows({ start: range.start, end: range.end }))
                .done(function (data) {
                    if (seq !== fetchSeq) return;
                    rows = data || [];
                    renderSettle();
                })
                .fail(function () {
                    if (seq !== fetchSeq) return;
                    swalMsg('error', 'Error', 'Unable to load records for the selected dates.');
                })
                .always(function () {
                    if (seq === fetchSeq) $summary.removeClass('is-loading');
                });
        }

        function renderSettle() {
            var data = config.summarize(rows, range);
            renderTotals(data);
            // Net amount to withdraw from junket_capital (costs are negatives here).
            pending = { count: data.count, amount: Math.round(-data.total * 100) / 100 };
            find('.hes-save-btn')
                .prop('disabled', data.count === 0)
                .attr('title', data.count === 0 ? 'Nothing to settle for the selected dates' : '');
        }

        /** data = { mains: [{ name, amount }], total } */
        function renderTotals(data) {
            var html = [];
            if (!data.mains.length) {
                html.push('<div class="hes-empty">' + esc(config.emptyLabel || 'No records') + '</div>');
            }
            data.mains.forEach(function (m) {
                html.push(
                    '<span class="hes-cat-name" title="' + esc(m.name) + '">' + esc(m.name) + '</span>' +
                    amountHtml(m.amount)
                );
            });
            html.push('<span class="hes-total-label">Total</span>' + amountHtml(data.total, 'hes-total-value'));
            find('.hes-cat-list').html(html.join(''));
            find('.hes-authorized-amount').text(fmtAmount(Math.abs(data.total)));
        }

        /** Settle mode (editable dates + Save) vs. view mode (a saved settlement, read-only). */
        function setViewMode(on) {
            viewMode = !!on;
            find('.hes-save-btn').toggleClass('d-none', viewMode);
            if (pickers) {
                [pickers.start, pickers.end].forEach(function (fp) {
                    fp.set('clickOpens', !viewMode);
                    if (fp.altInput) fp.altInput.readOnly = viewMode;
                });
            }
            find('.hes-start-date, .hes-end-date').prop('readonly', viewMode);
            $modal().toggleClass('is-view-mode', viewMode);
        }

        function showModal() {
            var modalEl = document.getElementById(config.modalId);
            // Keep it a direct child of <body> so no (hidden) page wrapper can swallow it.
            if (modalEl.parentNode !== document.body) document.body.appendChild(modalEl);
            bootstrap.Modal.getOrCreateInstance(modalEl).show();
        }

        function buildText() {
            var lines = [];
            lines.push(config.title);
            lines.push('Program Date : ' + fmtDate(range.start) + ' ~ ' + fmtDate(range.end));
            lines.push('');
            var $list = find('.hes-cat-list').children();
            for (var i = 0; i + 1 < $list.length; i += 2) {
                lines.push($list.eq(i).text().trim() + ' : ' + $list.eq(i + 1).text().trim());
            }
            lines.push('');
            lines.push('Transfer : ' + find('.hes-transfer-info').text().trim());
            lines.push('Authorized : ' + find('.hes-authorized-amount').text().trim());
            lines.push('Master Account : ' + find('.hes-master-account').text().trim());
            return lines.join('\n');
        }

        $(document).on('click', config.triggerSelector, function (e) {
            e.preventDefault();
            var r = config.getRange() || {};
            if (!r.start || !r.end) {
                swalMsg('info', 'Please select a date range.', '');
                return;
            }
            fetchSeq++;
            range = { start: r.start, end: r.end };
            rows = config.getRows() || [];
            initDatePickers();
            setPickerDates();
            setViewMode(false);
            find('.hes-summary').removeClass('is-loading');
            renderSettle();
            showModal();
        });

        $(document).on('show.bs.modal', modalSel, function () {
            $('body').addClass('hes-modal-open');
        });

        $(document).on('shown.bs.modal', modalSel, function () {
            $('.modal-backdrop').last().addClass('hes-backdrop');
        });

        $(document).on('hidden.bs.modal', modalSel, function () {
            if (!$('.hes-modal.show').length) $('body').removeClass('hes-modal-open');
        });

        $(document).on('click', modalSel + ' .hes-save-btn', function (e) {
            e.preventDefault();
            var $btn = $(this);
            if ($btn.prop('disabled') || !pending.count || viewMode) return;

            var settleRange = { start: range.start, end: range.end };
            var amount = pending.amount;
            var confirmText =
                'Settle ' + pending.count + ' record(s) from ' + fmtDate(settleRange.start) + ' to ' + fmtDate(settleRange.end) +
                '. ' + fmtAmount(amount) + ' will be deducted from the Authorized Master Account. Settled records can no longer be edited.';

            var confirmPromise = typeof Swal !== 'undefined'
                ? Swal.fire({
                    icon: 'question',
                    title: config.confirmTitle || 'Settle?',
                    text: confirmText,
                    showCancelButton: true,
                    confirmButtonText: 'Settle',
                    cancelButtonText: 'Cancel'
                }).then(function (r) { return !!r.isConfirmed; })
                : Promise.resolve(window.confirm(confirmText));

            confirmPromise.then(function (ok) {
                if (!ok) return;
                var original = $btn.html();
                $btn.prop('disabled', true).html('<span class="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span>');
                $.ajax({
                    url: config.settleUrl,
                    method: 'POST',
                    contentType: 'application/json',
                    data: JSON.stringify({ fromDate: settleRange.start, toDate: settleRange.end, expectedAmount: amount })
                })
                    .done(function (res) {
                        swalMsg('success', 'Settled', fmtAmount(res.amount) + ' settled.').then(function () {
                            bootstrap.Modal.getOrCreateInstance(document.getElementById(config.modalId)).hide();
                            if (typeof config.afterSettled === 'function') config.afterSettled(res);
                        });
                    })
                    .fail(function (xhr) {
                        var msg = (xhr.responseJSON && xhr.responseJSON.error) || 'Failed to settle.';
                        swalMsg('error', 'Settle failed', msg);
                        // Totals changed on the server (409) or rows were settled elsewhere — refresh the slip.
                        fetchRowsAndRender();
                    })
                    .always(function () {
                        $btn.html(original);
                        $btn.prop('disabled', !pending.count);
                    });
            });
        });

        $(document).on('click', modalSel + ' .hes-copy-image-btn', function (e) {
            e.preventDefault();
            var $btn = $(this);
            var blobPromise = buildImageBlob(find('.hes-receipt')[0]);
            var task;
            if (navigator.clipboard && typeof ClipboardItem !== 'undefined') {
                // clipboard.write must start inside the click gesture; the blob resolves later.
                task = navigator.clipboard.write([new ClipboardItem({ 'image/png': blobPromise })])
                    .then(function () { notify(true, 'Settlement image copied. You can paste it anywhere.'); });
            } else {
                task = blobPromise.then(function (blob) {
                    var url = URL.createObjectURL(blob);
                    var link = document.createElement('a');
                    link.href = url;
                    link.download = config.imageFileName || 'settlement.png';
                    link.click();
                    URL.revokeObjectURL(url);
                    notify(true, 'Settlement image downloaded.');
                });
            }
            withBusy($btn, task.catch(function (err) {
                notify(false, (err && err.message) || 'Unable to copy image.');
            }));
        });

        $(document).on('click', modalSel + ' .hes-copy-text-btn', function (e) {
            e.preventDefault();
            var $btn = $(this);
            if (!navigator.clipboard || typeof navigator.clipboard.writeText !== 'function') {
                notify(false, 'Clipboard is not supported in this browser.');
                return;
            }
            withBusy($btn, navigator.clipboard.writeText(buildText())
                .then(function () { notify(true, 'Settlement text copied. You can paste it anywhere.'); })
                .catch(function (err) { notify(false, (err && err.message) || 'Unable to copy text.'); }));
        });

        return {
            /** Open a saved settlement read-only (Authorized Master Account ledger). */
            openView: function (settlementId) {
                fetchSeq++;
                $.ajax({ url: config.viewUrl(settlementId), method: 'GET' })
                    .done(function (res) {
                        range = { start: res.date_from, end: res.date_to };
                        initDatePickers();
                        setPickerDates();
                        setViewMode(true);
                        find('.hes-summary').removeClass('is-loading');
                        renderTotals({ mains: res.mains || [], total: Number(res.total) || 0 });
                        showModal();
                    })
                    .fail(function (xhr) {
                        swalMsg('error', 'Error', (xhr.responseJSON && xhr.responseJSON.error) || 'Unable to load the settlement.');
                    });
            }
        };
    };
})();
