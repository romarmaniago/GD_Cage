$(document).ready(function () {
	if ($.fn.DataTable.isDataTable('#guest_statistic-tbl')) {
		$('#guest_statistic-tbl').DataTable().destroy();
	}
	
	var dataTable = $('#guest_statistic-tbl').DataTable({
	//	"order": [[0, 'desc']], // Set the first column (index 0) to be sorted in descending order
		"pageLength": 10, // Set the page length to 100
		"columnDefs": [{
			createdCell: function (cell, cellData, rowData, rowIndex, colIndex) {
				$(cell).addClass('text-center');
			}
		}],
		
		"language": {
			"search": (window.guestStatisticTranslations?.search || "Search:"),
			"info": (window.guestStatisticTranslations?.showing_entries || "Showing _START_ to _END_ of _TOTAL_ entries"),
			"paginate": {
				"previous": (window.guestStatisticTranslations?.previous || "Previous"),
				"next": (window.guestStatisticTranslations?.next || "Next")
			}
		},
		
	});
	

	function getQueryParam(param) {
		const urlParams = new URLSearchParams(window.location.search);
		return urlParams.get(param);
	}
	
	  // Fetch agency, start_date, and end_date from query parameters
	  const agency = getQueryParam('agency'); 
	  const cutoff = (window.MonthEndCutoffRange && window.MonthEndCutoffRange.getMonthEndCutoffRange())
	    || (typeof window.getMonthEndCutoffRange === 'function' ? window.getMonthEndCutoffRange() : null);
	  const start_date = getQueryParam('start_date') || (cutoff ? cutoff.startDate : (function () {
	    const now = new Date();
	    const y = now.getFullYear();
	    const m = now.getMonth();
	    return moment(new Date(y, m + 1, 0)).format('YYYY-MM-DD');
	  })());
	  const end_date = getQueryParam('end_date') || (cutoff ? (cutoff.endDateApi || cutoff.endDate) : (function () {
	    const now = new Date();
	    const y = now.getFullYear();
	    const m = now.getMonth();
	    const endAt = new Date(y, m + 2, 0);
	    endAt.setDate(endAt.getDate() - 1);
	    return moment(endAt).format('YYYY-MM-DD');
	  })());

	  console.log(`Agency: ${agency}`);
	  console.log(`Date Range: ${start_date} to ${end_date}`);
	
	function reloadData() {
		$.ajax({
			url: '/guest_statistics_data', // Endpoint to fetch data
			method: 'GET',
			data: { agency, start_date, end_date },
			success: function (data) {
				dataTable.clear();
				
				// Initialize totals
				let totalInitialBuyIn = 0;
				let totalAdditionalBuyIn = 0;
				let totalAmount = 0;
				let totalRolling = 0;
				let totalChipsReturn = 0;
				let totalWinLoss = 0;

				// Create an object to store aggregated data for each agency
				let agentData = {};
				let requests = []; // Array to hold AJAX requests
	
				data.forEach(function (row) {
					// Create a promise for each AJAX request
					let request = $.ajax({
						url: '/game_statistics/' + row.game_list_id + '/record',
						method: 'GET'
					}).done(function (response) {
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
	
						response.forEach(function (res) {
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

							if (res.CAGE_TYPE == 5 && parseInt(res.ROLLER_TRANSACTION) === 2) {
								total_roller_return_cc += parseFloat(res.ROLLER_CC_CHIPS) || 0;
							}
						});

						var expense = parseFloat(row.EXPENSE);
	
						var total_initial = total_nn_init + total_cc_init;
						var total_buy_in_chips = total_nn + total_cc;
						var total_cash_out_chips = total_cash_out_nn + total_cash_out_cc;
						var total_rolling_chips = total_rolling_nn + total_rolling_cc + total_rolling + total_rolling_real + total_rolling_nn_real + total_rolling_cc_real + total_roller_return_cc - total_cash_out_nn;
	
						var total_amount = total_buy_in_chips + total_initial;
						var WinLoss = total_amount - total_cash_out_chips;
						var net = 0;
	
						if (row.COMMISSION_TYPE == 1 || row.COMMISSION_TYPE == 3) {
							net = Math.round(total_rolling_chips * (row.COMMISSION_PERCENTAGE / 100));
						} else if (row.COMMISSION_TYPE == 2) {
							net = Math.round(WinLoss * (row.COMMISSION_PERCENTAGE / 100));
						}

						var houseshare = row.HOUSE_SHARE != null ? row.HOUSE_SHARE.toLocaleString('en-US') : '';

						var ngr = (WinLoss * (houseshare / 100)) - net;

						var profit = ngr - expense;
					
	
						// Store the aggregated values by agency
						if (!agentData[row.agent_name]) {
							agentData[row.agent_name] = {
								agency_name: row.agency_name, // I-assign ang agency_name dito
								totalAmount: 0,
								totalWinLoss: 0,
								totalRolling: 0,
								totalNet: 0,
								totalNgr: 0,
								totalHouseshare: 0,
								houseshareCount: 0, // New counter for houseshare
								totalExpense: 0,
								totalProfit: 0
							};
						}
	
						agentData[row.agent_name].totalAmount += total_amount;
						agentData[row.agent_name].totalWinLoss += WinLoss;
						agentData[row.agent_name].totalRolling += total_rolling_chips;
						agentData[row.agent_name].totalExpense += expense;
						agentData[row.agent_name].totalNet += net;
						agentData[row.agent_name].totalProfit += profit;
						agentData[row.agent_name].totalNgr += ngr;
						
						agentData[row.agent_name].totalHouseshare += Number(houseshare); // Convert to number
						agentData[row.agent_name].houseshareCount += 1; // Increment houseshare count
	
					}).fail(function (xhr, status, error) {
						console.error('Error fetching options:', error);
					});
	
					requests.push(request); // Add the AJAX request to the array
				});

				// Wait for all AJAX requests to complete
				$.when.apply($, requests).done(function () {
					console.log('Aggregated Data:', agentData); // Log the aggregated data for debugging
	
					// After all data is processed, add the aggregated data to the DataTable
					for (let agent in agentData) {
						let aggregated = agentData[agent];

						 // Calculate the average houseshare
    					let averageHouseshare = (aggregated.houseshareCount > 0) ? (aggregated.totalHouseshare / aggregated.houseshareCount) : 0;

						dataTable.row.add([
							`<a href="/guest_game_statistic?agency=${encodeURIComponent(aggregated.agency_name)}&guest=${encodeURIComponent(agent)}&start_date=${start_date}&end_date=${end_date}">${agent}</a>`, // Make agent clickable with agency
							aggregated.totalAmount.toLocaleString('en-US'),
							aggregated.totalWinLoss.toLocaleString('en-US'),
							aggregated.totalRolling.toLocaleString('en-US'),
							aggregated.totalNet.toLocaleString('en-US'),
							averageHouseshare,
							Math.round(aggregated.totalNgr).toLocaleString('en-US'),
							`${(aggregated.totalWinLoss / aggregated.totalRolling).toFixed(2)}%`,
							(aggregated.totalRolling / aggregated.totalAmount).toFixed(2),
							aggregated.totalExpense.toLocaleString('en-US'),
							Math.round(aggregated.totalProfit).toLocaleString('en-US')
						]).draw();
					}
				});
	
	
			},
			error: function (xhr, status, error) {
				console.error('Error fetching data:', error);
			}
		});
	}

	// START Event listener for houseShare input change
	$('#guest_statistic-tbl').on('change', '.house-share-live-input', function () {
		var rowIndex = $(this).data('rowindex');
		var newValue = $(this).val();
		var gameType = $(this).closest('tr').find('td:first').text();

		// Store the value in local storage using gameType as the key
		localStorage.setItem('houseShareLive_' + gameType, newValue);

		// Recalculate NGR
		var rowData = dataTable.row(rowIndex).data();
		var houseSharePercentageLive = parseFloat(newValue) / 100; // Convert new houseShare to number
		var winLoss = parseFloat(rowData[2].replace(/,/g, '')); // Get winloss value from row
		var net = parseFloat(rowData[4].replace(/,/g, '')); // Get formatted net value from row
		var ngr = (winLoss * houseSharePercentageLive) - net; // Recalculate NGR

		// Update the NGR column in the DataTable
		dataTable.cell(rowIndex, 6).data(parseFloat(ngr).toLocaleString('en-US')).draw(); // Assuming NGR is in the 6th column

	//	calculateTotalNGR();
		
	});
	//END

	
	reloadData();

});