$(document).ready(function () {
	if ($.fn.DataTable.isDataTable('#agent_statistic-tbl')) {
		$('#agent_statistic-tbl').DataTable().destroy();
	}
	
	var dataTable = $('#agent_statistic-tbl').DataTable({
	//	"order": [[0, 'desc']], // Set the first column (index 0) to be sorted in descending order
		"pageLength": 10, // Set the page length to 100
		"columnDefs": [{
			createdCell: function (cell, cellData, rowData, rowIndex, colIndex) {
				$(cell).addClass('text-center');
			}
		}],

		"language": {
			"search": (window.agentStatisticTranslations?.search || "Search:"),
			"info": (window.agentStatisticTranslations?.showing_entries || "Showing _START_ to _END_ of _TOTAL_ entries"),
			"paginate": {
				"previous": (window.agentStatisticTranslations?.previous || "Previous"),
				"next": (window.agentStatisticTranslations?.next || "Next")
			}
		},
		
	});
	
 // Function to reload data from the server
 function reloadData() {
	// Get the date range
	const dateRange = $('#daterange').val();
	let start_date, end_date;

	// If no date range is selected, use month-end cut-off defaults
	if (!dateRange) {
		const cutoff = (window.MonthEndCutoffRange && window.MonthEndCutoffRange.getMonthEndCutoffRange())
			|| (typeof window.getMonthEndCutoffRange === 'function' ? window.getMonthEndCutoffRange() : null);
		start_date = cutoff ? cutoff.startDate : (function () {
			const now = new Date();
			const y = now.getFullYear();
			const m = now.getMonth();
			return moment(new Date(y, m, 0)).format('YYYY-MM-DD');
		})();
		end_date = cutoff ? (cutoff.endDateApi || cutoff.endDate) : (function () {
			const now = new Date();
			const y = now.getFullYear();
			const m = now.getMonth();
			const endAt = new Date(y, m + 1, 0);
			endAt.setDate(endAt.getDate() - 1);
			return moment(endAt).format('YYYY-MM-DD');
		})();
	} else {
		if (window.MonthEndCutoffRange) {
			const apiRange = window.MonthEndCutoffRange.parseRangeToApiDates(dateRange);
			start_date = apiRange.start;
			end_date = apiRange.end;
		} else {
			[start_date, end_date] = dateRange.split(' to ');
		}
	}
	$('#modal-new-capital .loading-overlay').show();
    $('#modal-new-capital .progress-bar').css('width', '0%');

     // Simulate progress (useful if you can't track real progress)
     let progress = 0;
    const interval = setInterval(() => {
        if (progress < 90) {
            progress += 5; // Increment progress smoothly
            $('#modal-new-capital .progress-bar').css('width', `${progress}%`);
        } else {
            clearInterval(interval); // Stop at 90% and let AJAX complete control
        }
    }, 100); // Adjust interval time for smoother effect (100ms = smoother)
       

		$.ajax({
			url: '/agent_statistics_data', // Endpoint to fetch data
			method: 'GET',
			data: { start_date, end_date },
			success: function (data) {
				dataTable.clear();
	
				console.log('Original Data:', data); // Log the original data for debugging
	
				// Create an object to store aggregated data for each agency
				let agencyData = {};
				let requests = []; // Array to hold AJAX requests
	
				data.forEach(function (row) {
					// Create a promise for each AJAX request

					console.log('game_list_id = ', row.game_list_id); 
console.log('Constructed URL = ', '/game_statistics/' + row.game_list_id + '/record');
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
						
						var expense = parseFloat(row.EXPENSE);

						var houseshare = row.HOUSE_SHARE != null ? row.HOUSE_SHARE.toLocaleString('en-US') : '';

						var ngr = (WinLoss * (houseshare / 100)) - net;

						var profit = ngr - expense;

						// Store the aggregated values by agency
						if (!agencyData[row.agency_name]) {
							agencyData[row.agency_name] = {
								totalAmount: 0,
								totalWinLoss: 0,
								totalRolling: 0,
								totalNet: 0,
								totalNgr: 0,
								totalExpense: 0,
								totalHouseshare: 0,
								houseshareCount: 0, // New counter for houseshare
								totalProfit: 0
							};
						}
	
						agencyData[row.agency_name].totalAmount += total_amount;
						agencyData[row.agency_name].totalWinLoss += WinLoss;
						agencyData[row.agency_name].totalRolling += total_rolling_chips;
						agencyData[row.agency_name].totalExpense += expense;
						agencyData[row.agency_name].totalNet += net;
						agencyData[row.agency_name].totalNgr += ngr;
						agencyData[row.agency_name].totalProfit += profit;

						agencyData[row.agency_name].totalHouseshare += Number(houseshare); // Convert to number
						agencyData[row.agency_name].houseshareCount += 1; // Increment houseshare count

					}).fail(function (xhr, status, error) {
						console.error('Error fetching options:', error);
					});
	
					requests.push(request); // Add the AJAX request to the array
				});
	
				// Wait for all AJAX requests to complete
				$.when.apply($, requests).done(function () {
					console.log('Aggregated Data:', agencyData); // Log the aggregated data for debugging
	
					// After all data is processed, add the aggregated data to the DataTable
					for (let agency in agencyData) {
						let aggregated = agencyData[agency];

						 // Calculate the average houseshare
						 let averageHouseshare = (aggregated.houseshareCount > 0) ? (aggregated.totalHouseshare / aggregated.houseshareCount) : 0;

						 // Debugging logs
						console.log(`Agent: ${agency}`);
						console.log(`Total Houseshare: ${aggregated.totalHouseshare}`);
						console.log(`Houseshare Count: ${aggregated.houseshareCount}`);
						console.log(`Average Houseshare: ${averageHouseshare}`);
						
						dataTable.row.add([
							`<a href="/guest_statistic?agency=${encodeURIComponent(agency)}&start_date=${start_date}&end_date=${end_date}">${agency}</a>`, // Make agency name clickable
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
			},
			complete: function () {
				// Ensure progress reaches 100% before hiding the overlay
				clearInterval(interval); // Clear simulated progress interval
				$('#modal-new-capital .progress-bar').css('width', '100%'); // Jump to 100%
				setTimeout(() => {
					$('#modal-new-capital .loading-overlay').fadeOut();
				}, 300); // Short delay for user to notice 100% before hiding
			}
		});
	}
	
 // Attach event listener for date range changes
 $('#daterange').on('change', reloadData);

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