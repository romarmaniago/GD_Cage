/**
 * Shared lightweight autocomplete (credit guarantor, tip name/status, etc.).
 */
(function (window) {
    if (window.CreditGuarantorAutocomplete) return;

    var STYLE_ID = 'credit-guarantor-autocomplete-style';
    var STORAGE_KEY = '_creditGuarantorAutocomplete';

    function ensureStyles() {
        if (document.getElementById(STYLE_ID)) return;
        var style = document.createElement('style');
        style.id = STYLE_ID;
        style.textContent =
            '.credit-guarantor-autocomplete-menu{' +
            'position:fixed;max-height:10rem;overflow-y:auto;background:#fff;border:1px solid #ced4da;' +
            'border-radius:.25rem;box-shadow:0 .25rem .5rem rgba(0,0,0,.12);padding:.15rem 0;}' +
            '.credit-guarantor-autocomplete-item{' +
            'display:block;width:100%;border:0;background:transparent;text-align:center;' +
            'font-size:.78rem;padding:.3rem .45rem;cursor:pointer;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}' +
            '.credit-guarantor-autocomplete-item:hover,.credit-guarantor-autocomplete-item.is-active{' +
            'background:#e9f2ff;color:#0d6efd;}';
        document.head.appendChild(style);
    }

    function parseGuarantorFromRemarks(remarks) {
        var raw = String(remarks || '').trim();
        if (!raw) return '';
        var idx = raw.indexOf('Guarantor:');
        if (idx === -1) return '';
        return raw.slice(idx + 'Guarantor:'.length).trim();
    }

    function pushUnique(list, seen, value) {
        var text = String(value || '').trim();
        if (!text || text === '—' || text === '-') return;
        var key = text.toLowerCase();
        if (seen.has(key)) return;
        seen.add(key);
        list.push(text);
    }

    function buildAccountLabels(accounts) {
        var labels = [];
        var seen = new Set();
        (accounts || []).forEach(function (row) {
            var code = String(row.agent_code || row.AGENT_CODE || '').trim();
            var name = String(row.agent_name || row.AGENT_NAME || '').trim();
            if (code) pushUnique(labels, seen, code);
            if (code && name) pushUnique(labels, seen, code + ' (' + name + ')');
            else if (name) pushUnique(labels, seen, name);
        });
        return labels;
    }

    function buildHistoryGuarantors(historyRows, parseRemarks) {
        var labels = [];
        var seen = new Set();
        var parseFn = typeof parseRemarks === 'function' ? parseRemarks : function (remarks) {
            return { guarantor: parseGuarantorFromRemarks(remarks) };
        };
        (historyRows || []).forEach(function (row) {
            var parsed = parseFn(row && (row.REMARKS || row.remarks) || '');
            var guarantor = parsed && parsed.guarantor ? parsed.guarantor : parseGuarantorFromRemarks(row && (row.REMARKS || row.remarks));
            pushUnique(labels, seen, guarantor);
        });
        return labels;
    }

    function buildSuggestionList(options) {
        options = options || {};
        var historyFirst = buildHistoryGuarantors(options.historyRows, options.parseRemarks);
        var accountLabels = buildAccountLabels(options.accounts);
        var seen = new Set();
        var merged = [];
        historyFirst.forEach(function (label) {
            pushUnique(merged, seen, label);
        });
        accountLabels.forEach(function (label) {
            pushUnique(merged, seen, label);
        });
        (options.extra || []).forEach(function (label) {
            pushUnique(merged, seen, label);
        });
        return merged;
    }

    function buildTipNameSuggestions(historyRows) {
        var labels = [];
        var seen = new Set();
        (historyRows || []).forEach(function (row) {
            pushUnique(labels, seen, row.PERSON_NAME);
            pushUnique(labels, seen, row.ROLLER_NAME);
            pushUnique(labels, seen, row.person_name);
            pushUnique(labels, seen, row.roller_name);
        });
        return labels;
    }

    function buildTipStatusSuggestions(historyRows, defaults) {
        var labels = [];
        var seen = new Set();
        (defaults || ['Roller', 'GM']).forEach(function (label) {
            pushUnique(labels, seen, label);
        });
        (historyRows || []).forEach(function (row) {
            pushUnique(labels, seen, row.STATUS);
            pushUnique(labels, seen, row.TIP_STATUS);
            pushUnique(labels, seen, row.TIP_STATUS_LABEL);
            pushUnique(labels, seen, row.status);
            pushUnique(labels, seen, row.tip_status);
        });
        return labels;
    }

    function wire(inputEl, options) {
        options = options || {};
        if (!inputEl) return null;
        ensureStyles();

        if (inputEl[STORAGE_KEY] && typeof inputEl[STORAGE_KEY].destroy === 'function') {
            inputEl[STORAGE_KEY].destroy();
        }

        var menu = document.createElement('div');
        menu.className = 'credit-guarantor-autocomplete-menu';
        menu.hidden = true;
        document.body.appendChild(menu);

        var activeIndex = -1;
        var suggestions = [];

        function refreshSuggestions() {
            suggestions = typeof options.getSuggestions === 'function' ? options.getSuggestions() : [];
            return suggestions;
        }

        function positionMenu() {
            var rect = inputEl.getBoundingClientRect();
            menu.style.left = rect.left + 'px';
            menu.style.top = (rect.bottom + 2) + 'px';
            menu.style.width = Math.max(rect.width, 120) + 'px';
            menu.style.zIndex = '20000';
        }

        function filteredItems(query) {
            var q = String(query || '').trim().toLowerCase();
            var pool = suggestions.length ? suggestions : refreshSuggestions();
            if (!q) return pool.slice(0, 15);
            return pool.filter(function (item) {
                return item.toLowerCase().indexOf(q) !== -1;
            }).slice(0, 15);
        }

        function render(items) {
            menu.innerHTML = '';
            if (!items.length) {
                menu.hidden = true;
                return;
            }
            items.forEach(function (item, idx) {
                var btn = document.createElement('button');
                btn.type = 'button';
                btn.className = 'credit-guarantor-autocomplete-item' + (idx === activeIndex ? ' is-active' : '');
                btn.textContent = item;
                btn.addEventListener('mousedown', function (e) {
                    e.preventDefault();
                    inputEl.value = item;
                    menu.hidden = true;
                    inputEl.dispatchEvent(new Event('input', { bubbles: true }));
                });
                menu.appendChild(btn);
            });
            positionMenu();
            menu.hidden = false;
        }

        function openMenu() {
            refreshSuggestions();
            activeIndex = -1;
            render(filteredItems(inputEl.value));
        }

        function onFocus() {
            openMenu();
        }

        function onInput() {
            activeIndex = -1;
            render(filteredItems(inputEl.value));
        }

        function onKeyDown(e) {
            if (menu.hidden) {
                if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                    openMenu();
                    e.preventDefault();
                }
                return;
            }
            var items = filteredItems(inputEl.value);
            if (e.key === 'ArrowDown') {
                activeIndex = Math.min(activeIndex + 1, items.length - 1);
                render(items);
                e.preventDefault();
            } else if (e.key === 'ArrowUp') {
                activeIndex = Math.max(activeIndex - 1, 0);
                render(items);
                e.preventDefault();
            } else if (e.key === 'Enter' && activeIndex >= 0 && items[activeIndex]) {
                inputEl.value = items[activeIndex];
                menu.hidden = true;
                inputEl.dispatchEvent(new Event('input', { bubbles: true }));
                e.preventDefault();
            } else if (e.key === 'Escape') {
                menu.hidden = true;
            }
        }

        function onBlur() {
            setTimeout(function () {
                menu.hidden = true;
            }, 150);
        }

        function onResize() {
            if (!menu.hidden) positionMenu();
        }

        inputEl.addEventListener('focus', onFocus);
        inputEl.addEventListener('input', onInput);
        inputEl.addEventListener('keydown', onKeyDown);
        inputEl.addEventListener('blur', onBlur);
        window.addEventListener('resize', onResize);

        var api = {
            refresh: function () {
                refreshSuggestions();
            },
            destroy: function () {
                inputEl.removeEventListener('focus', onFocus);
                inputEl.removeEventListener('input', onInput);
                inputEl.removeEventListener('keydown', onKeyDown);
                inputEl.removeEventListener('blur', onBlur);
                window.removeEventListener('resize', onResize);
                if (menu.parentNode) menu.parentNode.removeChild(menu);
                inputEl[STORAGE_KEY] = null;
            }
        };

        inputEl[STORAGE_KEY] = api;
        refreshSuggestions();
        return api;
    }

    function preloadAccountSuggestions(onReady) {
        if (typeof window.preloadAccounts === 'function' && !Array.isArray(window._accountOptionsCache)) {
            window.preloadAccounts().then(function () {
                if (typeof onReady === 'function') onReady();
            }).catch(function () {
                if (typeof onReady === 'function') onReady();
            });
            return;
        }
        if (typeof onReady === 'function') onReady();
    }

    function initCreditGuarantorField(inputEl, options) {
        options = options || {};
        if (!inputEl) return null;
        var instance = wire(inputEl, {
            getSuggestions: function () {
                return buildSuggestionList({
                    accounts: window._accountOptionsCache || [],
                    historyRows: typeof options.getHistoryRows === 'function' ? options.getHistoryRows() : [],
                    parseRemarks: options.parseRemarks
                });
            }
        });
        preloadAccountSuggestions(function () {
            if (instance) instance.refresh();
        });
        return instance;
    }

    function initTipFieldAutocomplete(inputEl, options) {
        options = options || {};
        if (!inputEl) return null;
        var fieldType = options.fieldType === 'status' ? 'status' : 'name';
        return wire(inputEl, {
            getSuggestions: function () {
                var history = typeof options.getHistoryRows === 'function' ? options.getHistoryRows() : [];
                if (fieldType === 'status') {
                    return buildTipStatusSuggestions(history, options.defaults);
                }
                return buildTipNameSuggestions(history);
            }
        });
    }

    function refreshGroup(instances) {
        (instances || []).forEach(function (instance) {
            if (instance && typeof instance.refresh === 'function') {
                instance.refresh();
            }
        });
    }

    window.CreditGuarantorAutocomplete = {
        wire: wire,
        buildSuggestionList: buildSuggestionList,
        buildTipNameSuggestions: buildTipNameSuggestions,
        buildTipStatusSuggestions: buildTipStatusSuggestions,
        initCreditGuarantorField: initCreditGuarantorField,
        initTipFieldAutocomplete: initTipFieldAutocomplete,
        refreshGroup: refreshGroup,
        parseGuarantorFromRemarks: parseGuarantorFromRemarks
    };
})(window);
