(() => {
  const tbody = document.getElementById('junket-tables-tbody');
  const btnOpenAdd = document.getElementById('btn-open-add-junket-table');
  const form = document.getElementById('junket-table-form');
  const fieldId = document.getElementById('junket-table-id');
  const fieldName = document.getElementById('junket-table-name');
  const modalTitle = document.getElementById('junket-table-modal-title');
  const modalEl = document.getElementById('junket-table-modal');
  const modal = modalEl ? new bootstrap.Modal(modalEl) : null;

  if (!tbody || !btnOpenAdd || !form || !fieldId || !fieldName || !modalTitle || !modal) {
    return;
  }

  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function renderRows(rows) {
    if (!Array.isArray(rows) || rows.length === 0) {
      tbody.innerHTML = '<tr><td colspan="5" class="text-center text-muted py-3">No tables yet.</td></tr>';
      return;
    }

    const items = rows.map((row) => {
      const isActive = Number(row.active) === 1;
      const statusBadge = isActive
        ? '<span class="badge bg-success">Active</span>'
        : '<span class="badge bg-secondary">Inactive</span>';
      const actions = isActive
        ? `
          <button type="button" class="btn btn-sm btn-outline-primary me-1 btn-edit-junket-table"
            data-id="${row.id}" data-name="${escapeHtml(row.table_name)}">Edit</button>
          <button type="button" class="btn btn-sm btn-outline-danger btn-remove-junket-table"
            data-id="${row.id}" data-name="${escapeHtml(row.table_name)}">Delete</button>
        `
        : '<span class="text-muted small">No actions</span>';

      return `
        <tr>
          <td>${row.id}</td>
          <td>${escapeHtml(row.table_name)}</td>
          <td>${statusBadge}</td>
          <td>${escapeHtml(row.edited_dt || row.encoded_dt || '-')}</td>
          <td class="text-center">${actions}</td>
        </tr>
      `;
    });

    tbody.innerHTML = items.join('');
  }

  async function loadTables() {
    tbody.innerHTML = '<tr><td colspan="5" class="text-center text-muted py-3">Loading tables...</td></tr>';
    try {
      const response = await fetch('/junket_tables_data');
      if (!response.ok) throw new Error('Failed to load tables');
      const data = await response.json();
      renderRows(data);
    } catch (error) {
      console.error('loadTables:', error);
      tbody.innerHTML = '<tr><td colspan="5" class="text-center text-danger py-3">Failed to load data.</td></tr>';
    }
  }

  function openAddModal() {
    fieldId.value = '';
    fieldName.value = '';
    modalTitle.textContent = 'Add Table';
    modal.show();
  }

  function openEditModal(id, name) {
    fieldId.value = String(id);
    fieldName.value = name || '';
    modalTitle.textContent = 'Edit Table';
    modal.show();
  }

  async function saveTable(event) {
    event.preventDefault();

    const id = fieldId.value.trim();
    const name = fieldName.value.trim();
    if (!name) {
      Swal.fire({ icon: 'warning', title: 'Required', text: 'Table name is required.' });
      return;
    }

    const isEdit = !!id;
    const url = isEdit ? `/junket_table/${id}` : '/add_junket_table';
    const method = isEdit ? 'PUT' : 'POST';

    try {
      const response = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ table_name: name })
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload.message || 'Unable to save table');
      }

      modal.hide();
      await loadTables();
      Swal.fire({
        icon: 'success',
        title: 'Saved',
        text: payload.message || 'Table saved successfully.',
        timer: 1300,
        showConfirmButton: false
      });
    } catch (error) {
      console.error('saveTable:', error);
      Swal.fire({ icon: 'error', title: 'Error', text: error.message || 'Unable to save table.' });
    }
  }

  async function removeTable(id, name) {
    const confirm = await Swal.fire({
      icon: 'warning',
      title: 'Delete table?',
      text: `Remove "${name}" from active list?`,
      showCancelButton: true,
      confirmButtonText: 'Delete',
      cancelButtonText: 'Cancel',
      confirmButtonColor: '#d33'
    });
    if (!confirm.isConfirmed) return;

    try {
      const response = await fetch(`/junket_table/remove/${id}`, { method: 'PUT' });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload.message || 'Unable to delete table');
      }

      await loadTables();
      Swal.fire({
        icon: 'success',
        title: 'Deleted',
        text: payload.message || 'Table deleted successfully.',
        timer: 1300,
        showConfirmButton: false
      });
    } catch (error) {
      console.error('removeTable:', error);
      Swal.fire({ icon: 'error', title: 'Error', text: error.message || 'Unable to delete table.' });
    }
  }

  btnOpenAdd.addEventListener('click', openAddModal);
  form.addEventListener('submit', saveTable);

  tbody.addEventListener('click', (event) => {
    const editBtn = event.target.closest('.btn-edit-junket-table');
    if (editBtn) {
      openEditModal(editBtn.dataset.id, editBtn.dataset.name);
      return;
    }

    const removeBtn = event.target.closest('.btn-remove-junket-table');
    if (removeBtn) {
      removeTable(removeBtn.dataset.id, removeBtn.dataset.name);
    }
  });

  loadTables();
})();
