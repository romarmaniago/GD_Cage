(function () {
	'use strict';

	var i18n = {};
	try {
		var el = document.getElementById('categorize-group-i18n');
		if (el && el.textContent) i18n = JSON.parse(el.textContent);
	} catch (e) { /* ignore */ }

	function t(key, fallback) {
		return i18n[key] || fallback || key;
	}

	function fmtAmt(value, mode) {
		if (mode === 'out' && window.fmtOut) return window.fmtOut(value);
		if (mode === 'signed' && window.fmtSigned) return window.fmtSigned(value);
		if (mode === 'in' && window.fmtIn) return window.fmtIn(value);
		var n = parseFloat(value) || 0;
		return n.toLocaleString('en-US');
	}

	function ymd(d) {
		if (!d) return '';
		if (typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d.trim())) return d.trim().slice(0, 10);
		if (typeof moment !== 'undefined') {
			var m = moment.utc(d);
			if (!m.isValid()) m = moment(d);
			if (!m.isValid()) return '';
			return m.utcOffset(8).format('YYYY-MM-DD');
		}
		var dt = d instanceof Date ? d : new Date(d);
		if (isNaN(dt.getTime())) return '';
		var pad = function (n) { return String(n).padStart(2, '0'); };
		return dt.getUTCFullYear() + '-' + pad(dt.getUTCMonth() + 1) + '-' + pad(dt.getUTCDate());
	}

	function hasActionColumn() {
		return $('#gi-agent-groups-tbl thead th').length > 2;
	}

	function isViewOnly() {
		var roleEl = document.getElementById('user-role');
		if (!roleEl) return false;
		return String(roleEl.getAttribute('data-permissions') || '') === '2';
	}

	var groupsTable = null;
	var summaryTable = null;
	var groupsReloadGen = 0;
	var summaryReloadGen = 0;
	var programFrom = null;
	var programTo = null;
	var cgSplitOverrideRange = null;
	var cgSplitDateRange = null;
	var agentOptionsLoaded = false;
	var allAgentOptions = [];
	var selectedAgents = [];
	var editingGroupId = null;
	var summaryRowsByGroupId = {};
	var activeGroupGamesContext = { groupId: null, groupLabel: '' };
	var groupGamesTable = null;

	function formatGameStart(dt) {
		if (!dt || typeof moment === 'undefined') return '—';
		return moment.utc(dt).utcOffset(8).format('YYYY-MM-DD HH:mm');
	}

	function commissionBadge(row) {
		var type = parseInt(row.COMMISSION_TYPE, 10) || 1;
		var pct = parseFloat(row.COMMISSION_PERCENTAGE) || 0;
		var label = 'R';
		var cls = 'commission-badge-r';
		var title = 'Rolling';
		if (type === 2) {
			label = 'S';
			cls = 'commission-badge-s';
			title = 'Shared';
		} else if (type === 3) {
			label = 'L';
			cls = 'commission-badge-l';
			title = 'Lossing';
		}
		return pct.toFixed(2) + '% <span class="badge commission-badge ' + cls + '" title="' + title + '">' + label + '</span>';
	}

	function formatGameType(row) {
		return String(row.GAME_TYPE || '').toUpperCase() === 'TELEBET' ? 'TELEBET' : 'LIVE';
	}

	function buildGamesCountCell(row) {
		var count = parseInt(row.game_count, 10) || 0;
		if (count <= 0) return '0';
		return '<button type="button" class="btn btn-link p-0 cg-games-detail-btn" data-group-id="' + row.group_id + '">' + count + '</button>';
	}

	function setGroupGamesGrandTotals(tots) {
		$('#CG_GAMES_GRAND_BUYIN').html(fmtAmt(tots.buy_in));
		$('#CG_GAMES_GRAND_CASHOUT').html(fmtAmt(tots.cash_out, 'out'));
		$('#CG_GAMES_GRAND_WINLOSS').html(fmtAmt(tots.win_loss, 'signed'));
		$('#CG_GAMES_GRAND_ROLLING').html(fmtAmt(tots.rolling, 'signed'));
		$('#CG_GAMES_GRAND_COMMISSION').html(fmtAmt(tots.commission, 'out'));
		$('#CG_GAMES_GRAND_ADD_CHG').html(fmtAmt(tots.add_charge, 'out'));
		$('#CG_GAMES_GRAND_SETTLE').html(fmtAmt(tots.total_settlement, 'out'));
	}

	function buildGroupGameRowCells(game) {
		var addChg = parseFloat(game.ADD_CHARGE) || 0;
		var net = parseFloat(game.COMMISSION) || 0;
		var settle = parseFloat(game.TOTAL_SETTLEMENT) || 0;
		return [
			ymd(game.PROGRAM_DATE) || '—',
			formatGameStart(game.GAME_START),
			formatGameType(game),
			game.GAME_NO || '—',
			game.ACCOUNT_TEXT || '—',
			game.GUEST_NAME || '—',
			fmtAmt(game.BUY_IN),
			fmtAmt(game.CASH_OUT, 'out'),
			fmtAmt(game.WIN_LOSS, 'signed'),
			fmtAmt(game.ROLLING, 'signed'),
			commissionBadge(game),
			fmtAmt(net, 'out'),
			fmtAmt(addChg, 'out'),
			fmtAmt(settle, 'out'),
			formatGameStart(game.GAME_ENDED)
		];
	}

	function initGroupGamesTable() {
		if (groupGamesTable || !$('#cg-group-games-tbl').length) return;
		groupGamesTable = $('#cg-group-games-tbl').DataTable({
			paging: true,
			pageLength: 10,
			lengthMenu: [10, 25, 50],
			info: true,
			searching: true,
			ordering: true,
			order: [[0, 'asc'], [3, 'asc']],
			autoWidth: false,
			columnDefs: [
				{ targets: [0, 1], className: 'text-start' },
				{ targets: [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14], className: 'text-center' },
				{ targets: 10, orderable: false }
			],
			language: {
				search: 'Search:',
				lengthMenu: 'Show _MENU_',
				emptyTable: t('gameDetailsEmpty', 'No games in this group for the selected date range.')
			},
			drawCallback: function () {
				applyCgGroupGamesControlsLayout();
			}
		});
	}

	function applyCgGroupGamesControlsLayout() {
		var wrapper = document.getElementById('cg-group-games-tbl_wrapper');
		var lengthWrap = document.getElementById('cg-group-games-tbl_length');
		var filterWrap = document.getElementById('cg-group-games-tbl_filter');
		var toolbarMount = document.getElementById('cg-group-games-toolbar-mount');
		var searchLabel = filterWrap ? filterWrap.querySelector('label') : null;
		var searchInput = searchLabel ? searchLabel.querySelector('input') : null;
		if (!wrapper || !lengthWrap || !filterWrap || !searchLabel) return;

		var controlsHighlight = wrapper.querySelector('.cg-group-games-controls-highlight');
		if (!controlsHighlight) {
			controlsHighlight = document.createElement('div');
			controlsHighlight.className = 'cg-group-games-controls-highlight';
			wrapper.insertBefore(controlsHighlight, wrapper.firstChild);
		}
		if (lengthWrap.parentElement !== controlsHighlight) controlsHighlight.appendChild(lengthWrap);
		if (toolbarMount) {
			if (toolbarMount.parentElement !== controlsHighlight || toolbarMount.previousElementSibling !== lengthWrap) {
				if (lengthWrap.nextSibling) {
					controlsHighlight.insertBefore(toolbarMount, lengthWrap.nextSibling);
				} else {
					controlsHighlight.appendChild(toolbarMount);
				}
			}
			toolbarMount.classList.add('is-placed');
		}
		if (filterWrap.parentElement !== controlsHighlight) controlsHighlight.appendChild(filterWrap);

		var filterHighlight = filterWrap.querySelector('.cg-group-games-filter-highlight');
		if (!filterHighlight) {
			filterHighlight = document.createElement('div');
			filterHighlight.className = 'cg-group-games-filter-highlight';
			filterWrap.appendChild(filterHighlight);
		}
		if (searchLabel.parentElement !== filterHighlight) filterHighlight.appendChild(searchLabel);
		if (searchInput) {
			searchInput.setAttribute('placeholder', 'Search...');
			Array.prototype.slice.call(searchLabel.childNodes).forEach(function (node) {
				if (node.nodeType === 3) searchLabel.removeChild(node);
			});
		}
	}

	function openGroupGamesModal(groupId) {
		var row = summaryRowsByGroupId[groupId];
		if (!row) return;

		initGroupGamesTable();
		if (!groupGamesTable) return;

		var groupLabel = displayGroupName(row);
		activeGroupGamesContext = { groupId: groupId, groupLabel: groupLabel };
		$('#modal-cg-group-games-title').text(t('gameDetailsTitle', 'Group Games') + ' — ' + groupLabel);

		var games = Array.isArray(row.games) ? row.games : [];
		groupGamesTable.clear();
		games.forEach(function (game) {
			groupGamesTable.row.add(buildGroupGameRowCells(game));
		});
		groupGamesTable.draw();

		if (!games.length) {
			setGroupGamesGrandTotals({
				buy_in: 0,
				cash_out: 0,
				win_loss: 0,
				rolling: 0,
				commission: 0,
				add_charge: 0,
				total_settlement: 0
			});
		} else {
			setGroupGamesGrandTotals(row);
		}

		var modalEl = document.getElementById('modal-cg-group-games');
		if (modalEl && typeof bootstrap !== 'undefined') {
			var modal = bootstrap.Modal.getOrCreateInstance(modalEl);
			modal.show();
			modalEl.addEventListener('shown.bs.modal', function onShown() {
				modalEl.removeEventListener('shown.bs.modal', onShown);
				groupGamesTable.columns.adjust().draw(false);
				applyCgGroupGamesControlsLayout();
			});
		} else {
			$('#modal-cg-group-games').modal('show');
		}
	}

	function escapeHtml(value) {
		return String(value || '')
			.replace(/&/g, '&amp;')
			.replace(/</g, '&lt;')
			.replace(/>/g, '&gt;')
			.replace(/"/g, '&quot;');
	}

	function giApiEndDate(endYmd) {
		if (!endYmd || !/^\d{4}-\d{2}-\d{2}$/.test(String(endYmd))) return endYmd;
		var parts = String(endYmd).slice(0, 10).split('-').map(Number);
		var lastDayOfMonth = new Date(parts[0], parts[1], 0).getDate();
		if (parts[2] === lastDayOfMonth - 1 && window.MonthEndCutoffRange) {
			return window.MonthEndCutoffRange.expandApiEndDateToMonthEnd(endYmd);
		}
		return endYmd;
	}

	function getDefaultCutoffRange() {
		if (window.MonthEndCutoffRange && typeof window.MonthEndCutoffRange.getMonthEndCutoffRange === 'function') {
			return window.MonthEndCutoffRange.getMonthEndCutoffRange();
		}
		var now = new Date();
		var startAt = new Date(now.getFullYear(), now.getMonth(), 0);
		var endAt = new Date(now.getFullYear(), now.getMonth() + 1, 0);
		endAt.setDate(endAt.getDate() - 1);
		return {
			defaultDate: [startAt, endAt],
			startDate: ymd(startAt),
			endDate: ymd(endAt),
			endDateApi: ymd(endAt)
		};
	}

	function buildSummaryQuery() {
		var q = {};
		if (cgSplitOverrideRange && cgSplitOverrideRange.start && cgSplitOverrideRange.end) {
			q.programFrom = cgSplitOverrideRange.start;
			q.programTo = cgSplitOverrideRange.end;
		} else if (programFrom && programTo) {
			q.programFrom = programFrom;
			q.programTo = programTo;
		}
		return q;
	}

	function applyCgProgramRange(fromDate, toDate) {
		var from = fromDate;
		var to = toDate;
		if (from > to) {
			var swap = from;
			from = to;
			to = swap;
		}
		programFrom = from;
		programTo = to;
		reloadSummary();
	}

	function resetGrandTotals() {
		$('#CG_GRAND_BUYIN, #CG_GRAND_CASHOUT, #CG_GRAND_WINLOSS, #CG_GRAND_ROLLING, #CG_GRAND_COMMISSION, #CG_GRAND_ADD_CHG, #CG_GRAND_SETTLE').text('0.00');
	}

	function setGrandTotals(tots) {
		$('#CG_GRAND_BUYIN').html(fmtAmt(tots.buy_in));
		$('#CG_GRAND_CASHOUT').html(fmtAmt(tots.cash_out, 'out'));
		$('#CG_GRAND_WINLOSS').html(fmtAmt(tots.win_loss, 'signed'));
		$('#CG_GRAND_ROLLING').html(fmtAmt(tots.rolling, 'signed'));
		$('#CG_GRAND_COMMISSION').html(fmtAmt(tots.commission, 'out'));
		$('#CG_GRAND_ADD_CHG').html(fmtAmt(tots.add_charge, 'out'));
		$('#CG_GRAND_SETTLE').html(fmtAmt(tots.total_settlement, 'out'));
	}

	function displayGroupName(row) {
		if (row.group_name === 'No Agent') return t('noAgent', 'No Agent');
		return row.group_name || '—';
	}

	function buildGroupActionCell(groupId) {
		if (!hasActionColumn()) return '';
		return (
			'<div class="cg-group-actions">' +
			'<button type="button" class="btn btn-sm btn-alt-primary cg-group-edit" data-id="' + groupId + '" title="' + t('edit', 'Edit') + '" data-view-only-disable>' +
			'<i class="fa fa-pencil"></i></button>' +
			'<button type="button" class="btn btn-sm btn-alt-danger cg-group-delete" data-id="' + groupId + '" title="' + t('delete', 'Delete') + '" data-view-only-disable>' +
			'<i class="fa fa-trash"></i></button>' +
			'</div>'
		);
	}

	function reloadGroups() {
		if (!groupsTable) return;
		var gen = ++groupsReloadGen;
		groupsTable.clear().draw();

		$.ajax({
			url: '/categorize_group_groups',
			method: 'GET',
			success: function (rows) {
				if (gen !== groupsReloadGen) return;
				rows = Array.isArray(rows) ? rows : [];
				rows.forEach(function (row) {
					var cells = [
						row.group_name || '—',
						row.agents_text || '—'
					];
					var actionCell = buildGroupActionCell(row.group_id);
					if (actionCell) cells.push(actionCell);
					groupsTable.row.add(cells);
				});
				groupsTable.draw();
			},
			error: function (xhr) {
				console.error('categorize_group_groups failed', xhr);
			}
		});
	}

	function reloadSummary() {
		if (!summaryTable) return;
		var gen = ++summaryReloadGen;
		summaryTable.clear().draw();
		resetGrandTotals();

		$.ajax({
			url: '/categorize_group_summary',
			method: 'GET',
			data: buildSummaryQuery(),
			success: function (payload) {
				if (gen !== summaryReloadGen) return;
				var rows = Array.isArray(payload.rows) ? payload.rows : [];
				summaryRowsByGroupId = {};
				rows.forEach(function (row) {
					summaryRowsByGroupId[row.group_id] = row;
					var rowNode = summaryTable.row.add([
						displayGroupName(row),
						row.agents_text || '—',
						buildGamesCountCell(row),
						fmtAmt(row.buy_in),
						fmtAmt(row.cash_out, 'out'),
						fmtAmt(row.win_loss, 'signed'),
						fmtAmt(row.rolling, 'signed'),
						fmtAmt(row.commission, 'out'),
						fmtAmt(row.add_charge, 'out'),
						fmtAmt(row.total_settlement, 'out')
					]).node();
					if (row.is_custom_group && rowNode) {
						$(rowNode).addClass('cg-row-custom');
					}
				});
				summaryTable.draw();
				if (payload.grand) setGrandTotals(payload.grand);
			},
			error: function (xhr) {
				console.error('categorize_group_summary failed', xhr);
			}
		});
	}

	function initGroupsTable() {
		groupsTable = $('#gi-agent-groups-tbl').DataTable({
			paging: true,
			pageLength: 10,
			lengthMenu: [5, 10, 25],
			info: true,
			searching: true,
			ordering: true,
			order: [[0, 'asc']],
			autoWidth: false,
			columnDefs: [
				{ targets: 0, className: 'text-start' },
				{ targets: 1, className: 'text-start' },
				{ targets: 2, orderable: false, searchable: false, className: 'text-center' }
			],
			language: {
				search: 'Search:',
				lengthMenu: 'Show _MENU_',
				emptyTable: t('emptyGroups', 'No agent groups yet')
			},
			drawCallback: function () {
				applyCgGroupsControlsLayout();
			}
		});
	}

	function initSummaryTable() {
		summaryTable = $('#gi-group-summary-tbl').DataTable({
			paging: true,
			pageLength: 25,
			lengthMenu: [10, 25, 50],
			info: true,
			searching: true,
			ordering: true,
			order: [[0, 'asc']],
			autoWidth: false,
			language: {
				search: 'Search:',
				lengthMenu: 'Show _MENU_',
				emptyTable: t('emptySummary', 'No games found for this date range')
			},
			drawCallback: function () {
				applyCgSummaryControlsLayout();
			}
		});
	}

	function applyCgGroupsControlsLayout() {
		var wrapper = document.getElementById('gi-agent-groups-tbl_wrapper');
		var lengthWrap = document.getElementById('gi-agent-groups-tbl_length');
		var filterWrap = document.getElementById('gi-agent-groups-tbl_filter');
		var searchLabel = filterWrap ? filterWrap.querySelector('label') : null;
		var searchInput = searchLabel ? searchLabel.querySelector('input') : null;
		var addBtn = document.getElementById('btn-add-gi-agent-group');
		if (!wrapper || !lengthWrap || !filterWrap || !searchLabel) return;

		var controlsHighlight = wrapper.querySelector('.cg-groups-controls-highlight');
		if (!controlsHighlight) {
			controlsHighlight = document.createElement('div');
			controlsHighlight.className = 'cg-groups-controls-highlight';
			wrapper.insertBefore(controlsHighlight, wrapper.firstChild);
		}
		if (lengthWrap.parentElement !== controlsHighlight) controlsHighlight.appendChild(lengthWrap);
		if (filterWrap.parentElement !== controlsHighlight) controlsHighlight.appendChild(filterWrap);

		var filterHighlight = filterWrap.querySelector('.cg-groups-filter-highlight');
		if (!filterHighlight) {
			filterHighlight = document.createElement('div');
			filterHighlight.className = 'cg-groups-filter-highlight';
			filterWrap.appendChild(filterHighlight);
		}
		if (searchLabel.parentElement !== filterHighlight) {
			filterHighlight.appendChild(searchLabel);
		}
		if (addBtn && filterHighlight && searchLabel) {
			if (addBtn.parentElement !== filterHighlight || addBtn.nextElementSibling !== searchLabel) {
				filterHighlight.insertBefore(addBtn, searchLabel);
			}
		}
		if (searchInput) {
			searchInput.setAttribute('placeholder', 'Search...');
			Array.prototype.slice.call(searchLabel.childNodes).forEach(function (node) {
				if (node.nodeType === 3) searchLabel.removeChild(node);
			});
		}
	}

	function applyCgSummaryControlsLayout() {
		var wrapper = document.getElementById('gi-group-summary-tbl_wrapper');
		var lengthWrap = document.getElementById('gi-group-summary-tbl_length');
		var filterWrap = document.getElementById('gi-group-summary-tbl_filter');
		var dateMount = document.getElementById('cg-daterange-mount');
		var searchLabel = filterWrap ? filterWrap.querySelector('label') : null;
		var searchInput = searchLabel ? searchLabel.querySelector('input') : null;
		if (!wrapper || !lengthWrap || !filterWrap || !searchLabel) return;

		var controlsHighlight = wrapper.querySelector('.cg-summary-controls-highlight');
		if (!controlsHighlight) {
			controlsHighlight = document.createElement('div');
			controlsHighlight.className = 'cg-summary-controls-highlight';
			wrapper.insertBefore(controlsHighlight, wrapper.firstChild);
		}
		if (lengthWrap.parentElement !== controlsHighlight) controlsHighlight.appendChild(lengthWrap);
		if (dateMount) {
			if (dateMount.parentElement !== controlsHighlight || dateMount.previousElementSibling !== lengthWrap) {
				if (lengthWrap.nextSibling) {
					controlsHighlight.insertBefore(dateMount, lengthWrap.nextSibling);
				} else {
					controlsHighlight.appendChild(dateMount);
				}
			}
			dateMount.classList.add('is-placed');
		}
		if (filterWrap.parentElement !== controlsHighlight) controlsHighlight.appendChild(filterWrap);

		var filterHighlight = filterWrap.querySelector('.cg-summary-filter-highlight');
		if (!filterHighlight) {
			filterHighlight = document.createElement('div');
			filterHighlight.className = 'cg-summary-filter-highlight';
			filterWrap.appendChild(filterHighlight);
		}
		if (searchLabel.parentElement !== filterHighlight) filterHighlight.appendChild(searchLabel);
		if (searchInput) {
			searchInput.setAttribute('placeholder', 'Search...');
			Array.prototype.slice.call(searchLabel.childNodes).forEach(function (node) {
				if (node.nodeType === 3) searchLabel.removeChild(node);
			});
		}
		if (window.fitCgSplitDateWidths) window.fitCgSplitDateWidths();
		if (window.MonthEndCutoffRange && typeof window.MonthEndCutoffRange.fitRangePickerInstance === 'function') {
			var pickerEl = document.getElementById('cg-program-date-range-picker');
			if (pickerEl && pickerEl._flatpickr) {
				window.MonthEndCutoffRange.fitRangePickerInstance(pickerEl._flatpickr);
			}
		}
	}

	function initCgSplitDateRange() {
		if (!window.SplitDateRange || typeof window.SplitDateRange.attach !== 'function') {
			cgSplitDateRange = { syncFromRange: function () {}, fitWidths: function () {}, isSyncing: function () { return false; } };
			return;
		}

		cgSplitDateRange = window.SplitDateRange.attach({
			rangePickerId: 'cg-program-date-range-picker',
			startId: 'categorize-group-start-date',
			endId: 'categorize-group-end-date',
			splitWrapperId: 'categorize-group-split-daterange-wrapper',
			independent: true,
			invalidDateMessage: 'Invalid date range.',
			onRangeApplied: function (range) {
				if (!range || !range.start || !range.end) return;
				cgSplitOverrideRange = { start: range.start, end: giApiEndDate(range.end) };
				applyCgProgramRange(cgSplitOverrideRange.start, cgSplitOverrideRange.end);
			}
		});

		window.fitCgSplitDateWidths = function () {
			if (cgSplitDateRange && typeof cgSplitDateRange.fitWidths === 'function') {
				cgSplitDateRange.fitWidths();
			}
		};
	}

	function initCgFlatpickrRange() {
		var pickerEl = document.getElementById('cg-program-date-range-picker');
		if (!pickerEl || typeof flatpickr === 'undefined') return;

		var cutoff = getDefaultCutoffRange();
		programFrom = cutoff.startDate;
		programTo = giApiEndDate(cutoff.endDateApi || cutoff.endDate);

		var fp = flatpickr(pickerEl, {
			mode: 'range',
			dateFormat: 'Y-m-d',
			defaultDate: cutoff.defaultDate,
			onReady: function (_dates, _str, instance) {
				if (window.MonthEndCutoffRange && typeof window.MonthEndCutoffRange.fitRangePickerInstance === 'function') {
					window.MonthEndCutoffRange.fitRangePickerInstance(instance);
				}
			},
			onChange: function (selectedDates) {
				if (selectedDates.length < 2) return;
				if (cgSplitDateRange && cgSplitDateRange.isSyncing()) return;
				var from = ymd(selectedDates[0]);
				var to = giApiEndDate(ymd(selectedDates[1]));
				cgSplitOverrideRange = null;
				applyCgProgramRange(from, to);
				if (cgSplitDateRange && typeof cgSplitDateRange.syncFromRange === 'function') {
					cgSplitDateRange.syncFromRange(from, to);
				}
			}
		});

		if (window.MonthEndCutoffRange && typeof window.MonthEndCutoffRange.fitRangePickerInstance === 'function' && fp) {
			window.MonthEndCutoffRange.fitRangePickerInstance(fp);
		}
	}

	function loadAgentOptions() {
		return $.ajax({
			url: '/agent_data',
			method: 'GET'
		}).then(function (rows) {
			allAgentOptions = (rows || []).map(function (row) {
				var id = row.agent_id || row.IDNo;
				var code = String(row.agent_code || row.AGENT_CODE || '').trim();
				var name = String(row.NAME || row.agent_name || '').trim();
				var label = code && name ? code + ' - ' + name : (code || name || String(id));
				return { id: id, label: label };
			});
			agentOptionsLoaded = true;
		});
	}

	function destroyAgentPickerSelect2() {
		var $picker = $('#gi-agent-group-agent-picker');
		if (!$picker.length || !$.fn.select2) return;
		if ($picker.hasClass('select2-hidden-accessible')) {
			try {
				$picker.select2('destroy');
			} catch (e) { /* ignore */ }
		}
	}

	function initAgentPickerSelect2() {
		var $picker = $('#gi-agent-group-agent-picker');
		var $modal = $('#modal-gi-agent-group');
		if (!$picker.length || !$.fn.select2 || !$modal.length) return;
		destroyAgentPickerSelect2();
		$picker.select2({
			width: '100%',
			placeholder: $picker.data('placeholder') || t('searchAgent', 'Search agent...'),
			allowClear: true,
			dropdownParent: $modal,
			minimumResultsForSearch: 0
		});
		$picker.off('select2:open.cgAgents').on('select2:open.cgAgents', function () {
			setTimeout(function () {
				var field = document.querySelector(
					'#modal-gi-agent-group .select2-container--open .select2-search__field'
				);
				if (field) field.focus();
			}, 0);
		});
	}

	function refreshAgentPickerOptions() {
		var $picker = $('#gi-agent-group-agent-picker');
		if (!$picker.length) return;
		var selectedIds = selectedAgents.map(function (a) { return String(a.agent_id); });
		destroyAgentPickerSelect2();
		$picker.empty().append(new Option('', '', false, false));
		allAgentOptions.forEach(function (opt) {
			if (selectedIds.indexOf(String(opt.id)) === -1) {
				$picker.append(new Option(opt.label, opt.id, false, false));
			}
		});
		initAgentPickerSelect2();
		$picker.val(null).trigger('change');
	}

	function renderSelectedAgents() {
		var $box = $('#gi-agent-group-selected');
		if (!$box.length) return;
		if (!selectedAgents.length) {
			$box.empty();
			return;
		}
		var html = selectedAgents.map(function (agent) {
			return (
				'<span class="gi-agent-chip" data-id="' + agent.agent_id + '">' +
				escapeHtml(agent.label) +
				'<button type="button" class="gi-agent-chip-remove" data-id="' + agent.agent_id + '" aria-label="Remove">&times;</button>' +
				'</span>'
			);
		}).join('');
		$box.html(html);
	}

	function setSelectedAgents(agents) {
		selectedAgents = (agents || []).map(function (a) {
			return {
				agent_id: a.agent_id,
				label: a.label || String(a.agent_id)
			};
		});
	}

	function getSelectedAgentIds() {
		return selectedAgents.map(function (a) { return a.agent_id; });
	}

	function openGroupModal(mode, groupData) {
		editingGroupId = mode === 'edit' && groupData ? groupData.group_id : null;
		$('#modal-gi-agent-group-title').text(
			mode === 'edit' ? t('editGroup', 'Edit Group') : t('newGroup', 'New Group')
		);
		$('#gi-agent-group-id').val(editingGroupId || '');
		$('#gi-agent-group-name').val(groupData ? groupData.group_name || '' : '');

		var pendingAgents = (groupData && groupData.agents) ? groupData.agents : [];

		var ensureAgents = agentOptionsLoaded ? Promise.resolve() : loadAgentOptions();
		ensureAgents.then(function () {
			var $modal = $('#modal-gi-agent-group').appendTo('body');

			setSelectedAgents(pendingAgents);
			destroyAgentPickerSelect2();

			$modal.off('shown.bs.modal.cgAgents').on('shown.bs.modal.cgAgents', function () {
				refreshAgentPickerOptions();
				renderSelectedAgents();
			});

			$modal.off('hidden.bs.modal.cgAgents').on('hidden.bs.modal.cgAgents', function () {
				destroyAgentPickerSelect2();
			});

			var modal = bootstrap.Modal.getOrCreateInstance($modal[0]);
			modal.show();
		});
	}

	function closeGroupModal() {
		var $modal = $('#modal-gi-agent-group');
		var inst = bootstrap.Modal.getInstance($modal[0]);
		if (inst) inst.hide();
		destroyAgentPickerSelect2();
		$('#form-gi-agent-group')[0].reset();
		selectedAgents = [];
		renderSelectedAgents();
		editingGroupId = null;
	}

	function saveGroup() {
		var groupName = String($('#gi-agent-group-name').val() || '').trim();
		var agentIds = getSelectedAgentIds();
		if (!groupName) return;
		if (!agentIds.length) {
			Swal.fire({ icon: 'warning', title: 'Select at least one agent.' });
			return;
		}

		var url = editingGroupId
			? '/categorize_group_groups/' + editingGroupId
			: '/categorize_group_groups';
		var method = editingGroupId ? 'PUT' : 'POST';

		$.ajax({
			url: url,
			method: method,
			data: {
				groupName: groupName,
				agentIds: agentIds
			},
			success: function () {
				closeGroupModal();
				reloadGroups();
				reloadSummary();
				Swal.fire({
					icon: 'success',
					title: editingGroupId ? t('updateSuccess', 'Updated') : t('saveSuccess', 'Saved'),
					timer: 1500,
					showConfirmButton: false
				});
			},
			error: function (xhr) {
				var msg = (xhr.responseJSON && xhr.responseJSON.error) || t('saveFailed', 'Failed to save');
				Swal.fire({ icon: 'error', title: 'Error', text: msg });
			}
		});
	}

	function deleteGroup(groupId) {
		Swal.fire({
			title: t('deleteConfirm', 'Delete this group?'),
			icon: 'warning',
			showCancelButton: true,
			confirmButtonColor: '#3085d6',
			cancelButtonColor: '#d33',
			confirmButtonText: 'Yes'
		}).then(function (result) {
			if (!result.isConfirmed) return;
			$.ajax({
				url: '/categorize_group_groups/remove/' + groupId,
				method: 'PUT',
				success: function () {
					reloadGroups();
					reloadSummary();
					Swal.fire({
						icon: 'success',
						title: t('deleteSuccess', 'Deleted'),
						timer: 1500,
						showConfirmButton: false
					});
				},
				error: function (xhr) {
					var msg = (xhr.responseJSON && xhr.responseJSON.error) || t('saveFailed', 'Failed');
					Swal.fire({ icon: 'error', title: 'Error', text: msg });
				}
			});
		});
	}

	function fetchGroupById(groupId) {
		return $.ajax({
			url: '/categorize_group_groups',
			method: 'GET'
		}).then(function (rows) {
			rows = Array.isArray(rows) ? rows : [];
			return rows.find(function (r) { return String(r.group_id) === String(groupId); }) || null;
		});
	}

	function getCgDateRangeLabel() {
		if (programFrom && programTo) return programFrom + ' to ' + programTo;
		return '';
	}

	function getCgSummaryTablePayload(includeFooter) {
		if (!summaryTable) return { headers: [], rows: [], dataRowCount: 0 };
		var headers = [];
		$('#gi-group-summary-tbl thead tr:first th').each(function () {
			headers.push($(this).text().trim());
		});

		var rows = [];
		summaryTable.rows({ search: 'applied' }).every(function () {
			var cells = [];
			$(this.node()).find('td').each(function () {
				cells.push($(this).text().trim());
			});
			if (cells.length) rows.push(cells);
		});

		var dataRowCount = rows.length;
		if (includeFooter && dataRowCount) {
			rows.push([
				'',
				'',
				$('#gi-group-summary-tbl tfoot th').eq(0).text().trim(),
				$('#CG_GRAND_BUYIN').text().trim(),
				$('#CG_GRAND_CASHOUT').text().trim(),
				$('#CG_GRAND_WINLOSS').text().trim(),
				$('#CG_GRAND_ROLLING').text().trim(),
				$('#CG_GRAND_COMMISSION').text().trim(),
				$('#CG_GRAND_ADD_CHG').text().trim(),
				$('#CG_GRAND_SETTLE').text().trim()
			]);
		}

		return { headers: headers, rows: rows, dataRowCount: dataRowCount };
	}

	function getCgGroupGamesTablePayload(includeFooter) {
		var headers = [];
		$('#cg-group-games-tbl thead tr:first th').each(function () {
			headers.push($(this).text().trim());
		});

		var rows = [];
		if (groupGamesTable) {
			groupGamesTable.rows({ search: 'applied' }).every(function () {
				var cells = [];
				$(this.node()).find('td').each(function () {
					cells.push($(this).text().trim());
				});
				if (cells.length) rows.push(cells);
			});
		}

		var dataRowCount = rows.length;
		if (includeFooter && dataRowCount) {
			rows.push([
				'',
				'',
				'',
				'',
				'',
				$('#cg-group-games-tbl tfoot th').eq(0).text().trim(),
				$('#CG_GAMES_GRAND_BUYIN').text().trim(),
				$('#CG_GAMES_GRAND_CASHOUT').text().trim(),
				$('#CG_GAMES_GRAND_WINLOSS').text().trim(),
				$('#CG_GAMES_GRAND_ROLLING').text().trim(),
				'',
				$('#CG_GAMES_GRAND_COMMISSION').text().trim(),
				$('#CG_GAMES_GRAND_ADD_CHG').text().trim(),
				$('#CG_GAMES_GRAND_SETTLE').text().trim(),
				''
			]);
		}

		return { headers: headers, rows: rows, dataRowCount: dataRowCount };
	}

	function getCgGroupGamesPrintStyles() {
		return [
			'@page{size:landscape;margin:8mm;}',
			'body{font-family:Arial,sans-serif;color:#111;margin:0;}',
			'.print-wrap{width:100%;}',
			'h2{text-align:center;margin:0 0 4px;font-size:18px;}',
			'.subtitle{text-align:center;margin:0 0 12px;font-size:12px;color:#444;}',
			'table{width:100%;border-collapse:collapse;font-size:8px;}',
			'th,td{border:1px solid #777;padding:4px 6px;vertical-align:middle;}',
			'th{background:#d9e1f2;font-weight:700;}',
			'tbody tr:last-child td{font-weight:700;background:#f4f6fa;}'
		].join('');
	}

	function getCgGroupGamesExportFilename() {
		var groupPart = String(activeGroupGamesContext.groupLabel || 'Group')
			.replace(/[^a-zA-Z0-9._-]+/g, '_')
			.replace(/^_+|_+$/g, '') || 'Group';
		if (programFrom && programTo) {
			return 'Group_Games_' + groupPart + '_' + programFrom + '_to_' + programTo + '.xlsx';
		}
		return 'Group_Games_' + groupPart + '.xlsx';
	}

	function printCgGroupGamesTable() {
		var payload = getCgGroupGamesTablePayload(true);
		if (!payload.dataRowCount) {
			notifyCgNoData('print');
			return;
		}

		var title = t('gameDetailsTitle', 'Group Games') + ' — ' + (activeGroupGamesContext.groupLabel || '');
		var headerHtml = payload.headers.map(function (h) {
			return '<th>' + escapeHtml(h) + '</th>';
		}).join('');
		var rowsHtml = payload.rows.map(function (row) {
			return '<tr>' + row.map(function (cell) {
				return '<td>' + escapeHtml(cell) + '</td>';
			}).join('') + '</tr>';
		}).join('');

		var iframe = document.createElement('iframe');
		iframe.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;';
		document.body.appendChild(iframe);

		var frameWindow = iframe.contentWindow;
		var frameDoc = frameWindow.document;
		frameDoc.open();
		frameDoc.write([
			'<!doctype html><html><head><title>Group Games</title><style>',
			getCgGroupGamesPrintStyles(),
			'</style></head><body><div class="print-wrap">',
			'<h2>', escapeHtml(title), '</h2>',
			'<div class="subtitle">', escapeHtml(getCgDateRangeLabel()), '</div>',
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

	function exportCgGroupGamesTable() {
		var payload = getCgGroupGamesTablePayload(false);
		if (!payload.dataRowCount) {
			notifyCgNoData('export');
			return;
		}

		var outName = getCgGroupGamesExportFilename();
		var $btn = $('#btn-cg-group-games-export');
		$btn.prop('disabled', true);
		fetch('/game_information/export_xlsx', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			credentials: 'same-origin',
			body: JSON.stringify({
				headers: payload.headers,
				rows: payload.rows,
				filename: outName
			})
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
				if (typeof Swal !== 'undefined') {
					Swal.fire({ icon: 'error', title: 'Error', text: err.message || 'Export failed', confirmButtonColor: '#0d6efd' });
				} else {
					alert(err.message || 'Export failed');
				}
			})
			.finally(function () {
				$btn.prop('disabled', false);
			});
	}

	function getCgSummaryPrintStyles() {
		return [
			'@page{size:landscape;margin:8mm;}',
			'body{font-family:Arial,sans-serif;color:#111;margin:0;}',
			'.print-wrap{width:100%;}',
			'h2{text-align:center;margin:0 0 4px;font-size:18px;}',
			'.subtitle{text-align:center;margin:0 0 12px;font-size:12px;color:#444;}',
			'table{width:100%;border-collapse:collapse;font-size:10px;}',
			'th,td{border:1px solid #777;padding:5px 7px;vertical-align:middle;}',
			'th{background:#d9e1f2;font-weight:700;}',
			'tbody tr:last-child td{font-weight:700;background:#f4f6fa;}'
		].join('');
	}

	function notifyCgNoData(mode) {
		var title = mode === 'print' ? t('print', 'Print') : t('export', 'Export');
		var text = t('noData', 'No data to export for the current filter.');
		if (typeof Swal !== 'undefined') {
			Swal.fire({ icon: 'info', title: title, text: text, confirmButtonColor: '#0d6efd' });
		} else {
			alert(text);
		}
	}

	function printCgSummaryTable() {
		if (!summaryTable) return;
		var payload = getCgSummaryTablePayload(true);
		if (!payload.dataRowCount) {
			notifyCgNoData('print');
			return;
		}

		var headerHtml = payload.headers.map(function (h) {
			return '<th>' + escapeHtml(h) + '</th>';
		}).join('');
		var rowsHtml = payload.rows.map(function (row) {
			return '<tr>' + row.map(function (cell) {
				return '<td>' + escapeHtml(cell) + '</td>';
			}).join('') + '</tr>';
		}).join('');

		var iframe = document.createElement('iframe');
		iframe.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;';
		document.body.appendChild(iframe);

		var frameWindow = iframe.contentWindow;
		var frameDoc = frameWindow.document;
		frameDoc.open();
		frameDoc.write([
			'<!doctype html><html><head><title>Categorize Group</title><style>',
			getCgSummaryPrintStyles(),
			'</style></head><body><div class="print-wrap">',
			'<h2>Grouped Games Summary</h2>',
			'<div class="subtitle">', escapeHtml(getCgDateRangeLabel()), '</div>',
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

	function getCgSummaryExportFilename() {
		if (programFrom && programTo) {
			return 'Categorize_Group_' + programFrom + '_to_' + programTo + '.xlsx';
		}
		return 'Categorize_Group-export.xlsx';
	}

	function exportCgSummaryTable() {
		if (!summaryTable) return;
		var payload = getCgSummaryTablePayload(false);
		if (!payload.dataRowCount) {
			notifyCgNoData('export');
			return;
		}

		var outName = getCgSummaryExportFilename();
		var $btn = $('#btn-cg-summary-export');
		$btn.prop('disabled', true);
		fetch('/categorize_group_summary/export_xlsx', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			credentials: 'same-origin',
			body: JSON.stringify({
				headers: payload.headers,
				rows: payload.rows,
				filename: outName
			})
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
				if (typeof Swal !== 'undefined') {
					Swal.fire({ icon: 'error', title: 'Error', text: err.message || 'Export failed', confirmButtonColor: '#0d6efd' });
				} else {
					alert(err.message || 'Export failed');
				}
			})
			.finally(function () {
				$btn.prop('disabled', false);
			});
	}

	$(document).ready(function () {
		if (!$('.categorize-group-page').length) return;

		initGroupsTable();
		initSummaryTable();
		initGroupGamesTable();
		initCgSplitDateRange();
		initCgFlatpickrRange();

		reloadGroups();
		reloadSummary();

		$('#btn-add-gi-agent-group').on('click', function () {
			if (isViewOnly()) return;
			openGroupModal('add', null);
		});

		$('#form-gi-agent-group').on('submit', function (e) {
			e.preventDefault();
			if (isViewOnly()) return;
			saveGroup();
		});

		$('#gi-agent-group-agent-picker').on('change', function () {
			if (isViewOnly()) return;
			var val = $(this).val();
			if (!val) return;
			var opt = allAgentOptions.find(function (o) { return String(o.id) === String(val); });
			if (!opt) return;
			var exists = selectedAgents.some(function (a) { return String(a.agent_id) === String(opt.id); });
			if (!exists) {
				selectedAgents.push({ agent_id: opt.id, label: opt.label });
				renderSelectedAgents();
				refreshAgentPickerOptions();
			}
		});

		$('#gi-agent-group-selected').on('click', '.gi-agent-chip-remove', function () {
			if (isViewOnly()) return;
			var id = $(this).data('id');
			selectedAgents = selectedAgents.filter(function (a) { return String(a.agent_id) !== String(id); });
			renderSelectedAgents();
			refreshAgentPickerOptions();
		});

		$('#gi-agent-groups-tbl').on('click', '.cg-group-edit', function () {
			if (isViewOnly()) return;
			var groupId = $(this).data('id');
			fetchGroupById(groupId).then(function (group) {
				if (group) openGroupModal('edit', group);
			});
		});

		$('#gi-agent-groups-tbl').on('click', '.cg-group-delete', function () {
			if (isViewOnly()) return;
			deleteGroup($(this).data('id'));
		});

		$('#gi-group-summary-tbl').on('click', '.cg-games-detail-btn', function () {
			openGroupGamesModal($(this).data('group-id'));
		});

		$('#btn-cg-summary-print').on('click', function (e) {
			e.preventDefault();
			printCgSummaryTable();
		});
		$('#btn-cg-summary-export').on('click', function (e) {
			e.preventDefault();
			exportCgSummaryTable();
		});

		$('#btn-cg-group-games-print').on('click', function (e) {
			e.preventDefault();
			printCgGroupGamesTable();
		});
		$('#btn-cg-group-games-export').on('click', function (e) {
			e.preventDefault();
			exportCgGroupGamesTable();
		});

		$(document).on('init.dt draw.dt', '#gi-agent-groups-tbl', applyCgGroupsControlsLayout);
		$(document).on('init.dt draw.dt', '#gi-group-summary-tbl', applyCgSummaryControlsLayout);
		$(document).on('init.dt draw.dt', '#cg-group-games-tbl', applyCgGroupGamesControlsLayout);
		applyCgGroupsControlsLayout();
		applyCgSummaryControlsLayout();
	});
})();
