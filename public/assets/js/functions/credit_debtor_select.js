/**
 * Credit "Debtor" account select (Add Buy-in / Cash Out credit panels).
 * The debtor is the account the credit leg is booked to; the game stays on its own account.
 * debtor = null means the game account itself owes it.
 */
(function () {
    'use strict';

    let accountsPromise = null;
    const loadAccounts = function () {
        if (!accountsPromise) {
            accountsPromise = fetch('/account_data', { credentials: 'same-origin' })
                .then(function (r) { return r.ok ? r.json() : []; })
                .then(function (rows) { return Array.isArray(rows) ? rows : []; })
                .catch(function () { accountsPromise = null; return []; });
        }
        return accountsPromise;
    };

    let stylesAdded = false;
    const addStyles = function () {
        if (stylesAdded) return;
        stylesAdded = true;
        const style = document.createElement('style');
        style.textContent =
            '.xl-grid.xl-grid-credit-top { grid-template-columns: repeat(3, minmax(0, 1fr)) !important; }' +
            '.xl-debtor-pick { cursor: pointer; }' +
            '.xl-debtor-pick:hover { background-color: #fff2cc; }';
        document.head.appendChild(style);
    };

    // Center the picked account both ways (equal side padding so the arrow doesn't pull it left).
    const centerRendered = function ($select) {
        $select.next('.select2').find('.select2-selection__rendered').each(function () {
            const st = this.style;
            st.setProperty('display', 'flex', 'important');
            st.setProperty('align-items', 'center', 'important');
            st.setProperty('justify-content', 'center', 'important');
            st.setProperty('height', '100%', 'important');
            st.setProperty('line-height', 'normal', 'important');
            st.setProperty('padding', '0 20px', 'important');
            st.setProperty('text-align', 'center', 'important');
        });
    };

    /**
     * opts: { modal, selectEl, hiddenInput, valueEl, getGameAccountId(), onChange() }
     * valueEl (the balance under the select) also opens the dropdown on click.
     */
    const create = function (opts) {
        addStyles();
        const $ = window.jQuery;
        const $select = $ && opts.selectEl ? $(opts.selectEl) : null;
        let debtor = null;
        let builtFor = null;

        const setDebtor = function (d) {
            debtor = d;
            if (opts.hiddenInput) opts.hiddenInput.value = d ? String(d.accountId) : '';
        };

        const gameAccountId = function () {
            return String(opts.getGameAccountId() || '');
        };

        const applyValue = function () {
            if (!$select || !$select.data('select2')) return;
            const wanted = debtor ? String(debtor.accountId) : gameAccountId();
            if (String($select.val() || '') !== wanted) $select.val(wanted).trigger('change.select2');
        };

        // Rebuild the options once per game account; keep the current pick in sync.
        const sync = function () {
            if (!$select) return;
            const gameId = gameAccountId();
            if (builtFor === gameId) { applyValue(); return; }
            builtFor = gameId;
            loadAccounts().then(function (rows) {
                if (builtFor !== gameId) return;
                if ($select.data('select2')) $select.select2('destroy');
                opts.selectEl.innerHTML = '';
                rows.forEach(function (row) {
                    const id = String(row.account_id || '');
                    if (!id) return;
                    const code = String(row.agent_code || '').trim() || id;
                    const o = new Option(code, id);
                    o.setAttribute('data-code', code);
                    opts.selectEl.appendChild(o);
                });
                $select.select2({ placeholder: 'Select account', dropdownParent: $(opts.modal), width: '100%' });
                centerRendered($select);
                applyValue();
            });
        };

        const pickAccount = function (accountId, code) {
            // loaded: false until its balance arrives (Save then leaves the balance check to the server).
            setDebtor({ accountId: accountId, code: code, totalCredit: 0, history: [], loaded: false });
            opts.onChange();
            fetch('/game_list_cashout_credit/' + encodeURIComponent(accountId), { credentials: 'same-origin' })
                .then(function (r) { return r.ok ? r.json() : Promise.reject(); })
                .then(function (data) {
                    if (!debtor || String(debtor.accountId) !== String(accountId)) return;
                    debtor.totalCredit = Number(data && data.totalCredit) || 0;
                    debtor.history = Array.isArray(data && data.history) ? data.history : [];
                    debtor.name = String((data && data.agentName) || '').trim();
                    debtor.loaded = true;
                    opts.onChange();
                })
                .catch(function () {});
        };

        if ($select) {
            $select.on('select2:select', function () {
                const id = String($select.val() || '');
                if (!id || id === gameAccountId()) {
                    setDebtor(null);
                    opts.onChange();
                    return;
                }
                const opt = opts.selectEl.selectedOptions[0];
                pickAccount(id, opt ? opt.getAttribute('data-code') : id);
            });
        }

        const stop = function (e) { e.stopPropagation(); };
        if (opts.selectEl && opts.selectEl.parentElement) opts.selectEl.parentElement.addEventListener('mousedown', stop);
        if (opts.valueEl) {
            opts.valueEl.classList.add('xl-debtor-pick');
            opts.valueEl.addEventListener('mousedown', stop);
            opts.valueEl.addEventListener('click', function (e) {
                e.stopPropagation();
                if ($select && $select.data('select2')) $select.select2('open');
            });
        }

        return {
            get: function () { return debtor; },
            sync: sync,
            reset: function () {
                setDebtor(null);
                if ($select && $select.data('select2')) $select.select2('close');
                applyValue();
            }
        };
    };

    window.CreditDebtorSelect = { create: create };
})();
