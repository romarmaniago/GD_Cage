(function () {
  var bound = {};

  function layoutDashServiceTableControls(tableId, addButtonId) {
    var $ = window.jQuery;
    if (!$) return;

    var $table = $('#' + tableId);
    if (!$table.length) return;

    var $wrapper = $table.closest('.dataTables_wrapper');
    var $length = $wrapper.find('#' + tableId + '_length');
    var $filter = $wrapper.find('#' + tableId + '_filter');
    var $filterLabel = $filter.find('label');
    var addButton = addButtonId ? document.getElementById(addButtonId) : null;

    if (!$wrapper.length || !$length.length || !$filter.length || !$filterLabel.length) return;

    var $controlsHighlight = $wrapper.find('.dash-service-controls-highlight');
    if (!$controlsHighlight.length) {
      $controlsHighlight = $('<div class="dash-service-controls-highlight"></div>');
      $wrapper.prepend($controlsHighlight);
    }
    if ($length.parent()[0] !== $controlsHighlight[0]) {
      $controlsHighlight.append($length);
    }
    if ($filter.parent()[0] !== $controlsHighlight[0]) {
      $controlsHighlight.append($filter);
    }

    var $filterHighlight = $filter.find('.dash-service-filter-highlight');
    if (!$filterHighlight.length) {
      $filterHighlight = $('<div class="dash-service-filter-highlight"></div>');
      $filter.append($filterHighlight);
    }

    if (addButton) {
      if (addButton.parentElement !== $filterHighlight[0] || $filterHighlight[0].firstElementChild !== addButton) {
        $filterHighlight.prepend(addButton);
      }
      addButton.classList.remove('d-none');
    }
    if ($filterLabel.parent()[0] !== $filterHighlight[0]) {
      $filterHighlight.append($filterLabel);
    }
  }

  function bindDashServiceTableControls(tableId, addButtonId) {
    var key = tableId + ':' + (addButtonId || '');
    layoutDashServiceTableControls(tableId, addButtonId);

    if (bound[key]) return;
    bound[key] = true;

    var $ = window.jQuery;
    if (!$) return;

    $(document).on('init.dt.dashServiceControls draw.dt.dashServiceControls', '#' + tableId, function () {
      layoutDashServiceTableControls(tableId, addButtonId);
    });
  }

  window.layoutDashServiceTableControls = layoutDashServiceTableControls;
  window.bindDashServiceTableControls = bindDashServiceTableControls;
})();
