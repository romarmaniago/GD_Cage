/**
 * DataTables length menu → Select2 (gold highlight instead of OS/Select2 blue).
 * Applies on every DataTable init/draw and when modals open.
 */
(function ($) {
	'use strict';

	if (!$ || !$.fn) return;

	function enhanceLengthSelect($select) {
		if (!$select || !$select.length) return;
		if (!$.fn.select2) return;
		if ($select.hasClass('select2-hidden-accessible')) return;
		if ($select.data('gdLengthSelect2') === true) return;

		var $parent = $select.closest('.dataTables_wrapper, .modal-body, .modal, body').first();
		$select.select2({
			minimumResultsForSearch: Infinity,
			width: 'auto',
			dropdownAutoWidth: true,
			dropdownCssClass: 'gd-dt-length-dropdown',
			dropdownParent: $parent.length ? $parent : $(document.body)
		});
		$select.data('gdLengthSelect2', true);
	}

	function enhanceInRoot(root) {
		$(root || document).find('.dataTables_length select').each(function () {
			enhanceLengthSelect($(this));
		});
	}

	function enhanceAll() {
		enhanceInRoot(document);
	}

	$(document).on('init.dt draw.dt', function (e) {
		var table = e.target;
		if (table && table.id) {
			enhanceInRoot(document.getElementById(table.id + '_wrapper') || document);
		} else {
			enhanceAll();
		}
	});

	$(document).on('shown.bs.modal', function (e) {
		enhanceInRoot(e.target || document);
	});

	$(function () {
		enhanceAll();
		// Late-init tables / re-renders
		setTimeout(enhanceAll, 250);
		setTimeout(enhanceAll, 1000);
	});
})(window.jQuery);
