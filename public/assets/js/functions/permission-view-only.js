/**
 * Reusable permission logic: when permission === 2 (view only):
 * - Modals CAN be opened (viewer can view content). All modals live in views/modals.
 * - Inside any .modal: Submit, Save, Edit and Delete buttons are disabled.
 *
 * Use data-view-only-disable on triggers only if another page needs to block opening.
 * Use disableForViewOnly(selector) for custom elements to disable when view-only.
 */
(function (window) {
    'use strict';

    var VIEW_ONLY = 2;
    var DEFAULT_ROLE_SELECTOR = '#user-role';
    var DATA_ATTR = 'data-permissions';
    var DISABLE_ATTR = 'data-view-only-disable';
    var DISABLED_CLASS = 'view-only-disabled';

    function getPermissions(roleSelector) {
        var el = document.querySelector(roleSelector || DEFAULT_ROLE_SELECTOR);
        if (!el) return null;
        var raw = el.getAttribute(DATA_ATTR);
        if (raw === null || raw === '') return null;
        var num = parseInt(raw, 10);
        return isNaN(num) ? null : num;
    }

    function isViewOnly(roleSelector) {
        var p = getPermissions(roleSelector);
        return p === VIEW_ONLY;
    }

    function disableElement(el) {
        if (!el) return;
        el.classList.add(DISABLED_CLASS);
        if (el.tagName === 'BUTTON' || (el.tagName === 'INPUT' && /submit|button/i.test(el.type))) {
            el.disabled = true;
            el.setAttribute('aria-disabled', 'true');
        } else {
            el.classList.add('disabled'); // so hasClass('disabled') checks in page JS (e.g. Settle) work
            el.setAttribute('aria-disabled', 'true');
            el.style.pointerEvents = 'none';
            el.style.opacity = '0.6';
            el.style.cursor = 'not-allowed';
        }
    }

    function enableElement(el) {
        if (!el) return;
        el.classList.remove(DISABLED_CLASS);
        if (el.tagName === 'BUTTON' || (el.tagName === 'INPUT' && /submit|button/i.test(el.type))) {
            el.disabled = false;
            el.removeAttribute('aria-disabled');
        } else {
            el.classList.remove('disabled');
            el.removeAttribute('aria-disabled');
            el.style.pointerEvents = '';
            el.style.opacity = '';
            el.style.cursor = '';
        }
    }

    /**
     * Disable Submit/Save, Edit and Delete buttons inside .modal when permission === 2.
     * @param {string} [roleSelector] - optional override for #user-role
     * @param {Element} [modalEl] - if provided, only disable inside this modal
     */
    function disableModalSubmitAndDelete(roleSelector, modalEl) {
        if (!isViewOnly(roleSelector)) return;
        var scope = modalEl || document;

        var submitSel = modalEl
            ? 'button[type="submit"], input[type="submit"]'
            : '.modal button[type="submit"], .modal input[type="submit"]';
        var submitList = scope.querySelectorAll(submitSel);
        for (var i = 0; i < submitList.length; i++) {
            disableElement(submitList[i]);
        }

        // Save/Submit buttons that are type="button" (e.g. id="new-services-save", id="submit-settlement-btn")
        var saveButtonSel = modalEl ? 'button[type="button"]' : '.modal button[type="button"]';
        var saveBtnList = scope.querySelectorAll(saveButtonSel);
        for (var s = 0; s < saveBtnList.length; s++) {
            var id = (saveBtnList[s].id || '').toLowerCase();
            var isSave = /save|submit/.test(id);
            if (isSave) disableElement(saveBtnList[s]);
        }

        var dangerSel = modalEl
            ? '.btn-danger, .btn-alt-danger, .btn-danger-subtle'
            : '.modal .btn-danger, .modal .btn-alt-danger, .modal .btn-danger-subtle';
        var dangerList = scope.querySelectorAll(dangerSel);
        for (var j = 0; j < dangerList.length; j++) {
            disableElement(dangerList[j]);
        }

        var trashSel = modalEl ? '.fa-trash, .fa-trash-alt' : '.modal .fa-trash, .modal .fa-trash-alt';
        var trashList = scope.querySelectorAll(trashSel);
        for (var k = 0; k < trashList.length; k++) {
            var node = trashList[k];
            var btn = node.closest ? (node.closest('button') || node.closest('a')) : null;
            if (btn) disableElement(btn);
        }

        var editSel = modalEl ? '.fa-edit, .fa-pen, .fa-pencil, .fa-pencil-alt' : '.modal .fa-edit, .modal .fa-pen, .modal .fa-pencil, .modal .fa-pencil-alt';
        var editList = scope.querySelectorAll(editSel);
        for (var e = 0; e < editList.length; e++) {
            var editNode = editList[e];
            var editBtn = editNode.closest ? (editNode.closest('button') || editNode.closest('a')) : null;
            if (editBtn) disableElement(editBtn);
        }

        // Check Balance and similar action buttons (e.g. account_details modal)
        var balanceCheckSel = modalEl ? '#balanceCheckBtn' : '.modal #balanceCheckBtn';
        var balanceCheckList = scope.querySelectorAll(balanceCheckSel);
        for (var b = 0; b < balanceCheckList.length; b++) {
            disableElement(balanceCheckList[b]);
        }

        // Explicit Save button IDs (house expense, return money, etc.) – ensure disabled when permission = 2
        var saveButtonIds = [
            'btn-save-new-expense',
            'btn-save-edit-expense',
            'btn-save-new-return-money',
            'btn-save-edit-return-money'
        ];
        for (var x = 0; x < saveButtonIds.length; x++) {
            var el = scope.querySelector ? scope.querySelector('#' + saveButtonIds[x]) : null;
            if (el) disableElement(el);
        }
    }

    /**
     * Disable all elements matching selector when permission === 2 (view only).
     */
    function disableForViewOnly(selector, roleSelector) {
        if (!isViewOnly(roleSelector)) return;
        var list = document.querySelectorAll(selector);
        for (var i = 0; i < list.length; i++) {
            disableElement(list[i]);
        }
    }

    /**
     * Apply view-only behavior: modals stay openable; inside modals disable Submit/Edit/Delete.
     * Also disables page-level action buttons (e.g. Settle).
     */
    function applyToPage(roleSelector) {
        if (!isViewOnly(roleSelector)) return;

        disableModalSubmitAndDelete(roleSelector);

        var modals = document.querySelectorAll('.modal');
        for (var m = 0; m < modals.length; m++) {
            modals[m].addEventListener('show.bs.modal', function () {
                disableModalSubmitAndDelete(roleSelector, this);
            });
            // Re-apply on shown so Save stays disabled even if other scripts re-enable the button
            modals[m].addEventListener('shown.bs.modal', function () {
                disableModalSubmitAndDelete(roleSelector, this);
            });
        }

        // Page-level buttons/links to disable when view-only (e.g. Settle, fnb_hotel delete/edit, game_services delete/edit, telegram Save, Change Game No)
        var pageActionSelectors = [
            '#btn-daily-settle',
            '#btn-merge-settle-game-list',
            '#btn-commission-compare-merge-settle',
            '#send-merge-settlement-telegram-btn',
            '#btn-breadcrumb-open-pool',
            '#game-list-select-all',
            '.delete-service-btn',
            '.edit-service-btn',
            '.service-delete-btn',
            '.service-edit-btn',
            '.update-telegram-api-form button[type="submit"]',
            '#btn-save-chat-id',
            '#btn-save-agent-chat-id',
            '#updateGameNumber'
        ];
        for (var p = 0; p < pageActionSelectors.length; p++) {
            var pageEls = document.querySelectorAll(pageActionSelectors[p]);
            for (var q = 0; q < pageEls.length; q++) {
                var el = pageEls[q];
                disableElement(el);
                el.addEventListener('click', function (e) {
                    if (isViewOnly(roleSelector)) {
                        e.preventDefault();
                        e.stopPropagation();
                    }
                }, true);
            }
        }
    }

    window.PermissionViewOnly = {
        VIEW_ONLY: VIEW_ONLY,
        getPermissions: getPermissions,
        isViewOnly: isViewOnly,
        disableForViewOnly: disableForViewOnly,
        disableModalSubmitAndDelete: disableModalSubmitAndDelete,
        applyToPage: applyToPage
    };
})(window);
