let tipTable;

function formatMoney(n) {
	return (Number(n) || 0).toLocaleString('en-US', {
		minimumFractionDigits: 0,
		maximumFractionDigits: 2
	});
}

function tipTypeColorClass(tipType) {
	return Number(tipType) === 1 ? 'tip-type-roller' : 'tip-type-dealer';
}

function updateTipAmountTotal(api) {
	const total = api
		.column(3, { search: 'applied' })
		.data()
		.reduce(function (sum, val) {
			return sum + (Number(val) || 0);
		}, 0);

	$(api.column(3).footer()).html('<span class="tip-amount">' + formatMoney(total) + '</span>');
}

function fetchTipData() {
	$.get('/tip_data')
		.done(function (rows) {
			tipTable.clear().rows.add(rows || []).draw();
		})
		.fail(function () {
			Swal.fire('Error', 'Failed to load tip records.', 'error');
		});
}

$(document).ready(function () {
	tipTable = $('#tip-tbl').DataTable({
		pageLength: 25,
		order: [[0, 'desc']],
		footerCallback: function () {
			updateTipAmountTotal(this.api());
		},
		columns: [
			{
				data: 'TIP_DATETIME',
				render: function (data, type) {
					if (!data) return '';
					if (type === 'sort') return data;
					return moment(data).format('DD MMM YYYY HH:mm');
				}
			},
			{ data: 'ACCOUNT_DISPLAY', defaultContent: '-' },
			{
				data: 'GAME_NO',
				defaultContent: '-',
				render: function (data) {
					return data != null && data !== '' ? String(data) : '-';
				}
			},
			{
				data: 'AMOUNT',
				render: function (data, type) {
					const n = Number(data) || 0;
					if (type === 'sort') return n;
					return formatMoney(n);
				}
			},
			{
				data: 'TIP_TYPE',
				render: function (data, type, row) {
					const label = row.TIP_TYPE_LABEL || (Number(data) === 1 ? 'Roller' : 'Dealer');
					if (type === 'sort') return label;
					return '<span class="' + tipTypeColorClass(data) + '">' + label + '</span>';
				}
			}
		]
	});

	fetchTipData();
});
