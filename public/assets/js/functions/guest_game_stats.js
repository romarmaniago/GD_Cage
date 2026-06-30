$(document).ready(function () {
	if ($.fn.DataTable.isDataTable('#guest_game_statistic-tbl')) {
		$('#guest_game_statistic-tbl').DataTable().destroy();
	}
	
	var dataTable = $('#guest_game_statistic-tbl').DataTable({
	//	"order": [[0, 'desc']], // Set the first column (index 0) to be sorted in descending order
		"pageLength": 10, // Set the page length to 100
		"columnDefs": [{
			createdCell: function (cell, cellData, rowData, rowIndex, colIndex) {
				$(cell).addClass('text-center');
			}
		}],

		"language": {
			"search": (window.guestGameStatisticTranslations?.search || "Search:"),
			"info": (window.guestGameStatisticTranslations?.showing_entries || "Showing _START_ to _END_ of _TOTAL_ entries"),
			"paginate": {
				"previous": (window.guestGameStatisticTranslations?.previous || "Previous"),
				"next": (window.guestGameStatisticTranslations?.next || "Next")
			}
		},
		
	});

	function getQueryParam(param) {
        const urlParams = new URLSearchParams(window.location.search);
        return urlParams.get(param);
    }

	const agency = getQueryParam('agency');
    const guest = getQueryParam('guest');
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

    console.log(`Agency: ${agency}, Guest: ${guest}, Date Range: ${start_date} to ${end_date}`);

	

	// Store the agency in localStorage when first visiting the page
const agencyFromURL = getQueryParam('agency');
if (agencyFromURL) {
    localStorage.setItem('agency', agencyFromURL);
}

// Retrieve the agency from localStorage when returning to the page
if (!agency) {
    agency = localStorage.getItem('agency'); // Fallback to localStorage
}

// Log the retrieved agency for debugging
console.log(`Agency from URL: ${agencyFromURL}`);
console.log(`Retrieved agency: ${agency}`);

// Set the href for the backToGuests link
 // Update back button link
 const backToGuestsLink = document.getElementById('backToGuests');
 if (backToGuestsLink) {
	 backToGuestsLink.href = `/guest_statistic?agency=${encodeURIComponent(agency)}&start_date=${start_date}&end_date=${end_date}`;
 }
	
	
	function reloadData() {
		
		$.ajax({
			url: `/guest_game_statistics_data?agency=${encodeURIComponent(agency)}&guest=${encodeURIComponent(guest)}&start_date=${start_date}&end_date=${end_date}`,
			method: 'GET',
			success: function (data) {
				dataTable.clear();
				
				// Initialize totals
				let totalInitialBuyIn = 0;
				let totalAdditionalBuyIn = 0;
				let totalAmount = 0;
				let totalRolling = 0;
				let totalChipsReturn = 0;
				let totalWinLoss = 0;
	
				data.forEach(function (row, rowIndex) {
	
	
					$.ajax({
						url: '/game_statistics/' + row.game_list_id + '/record',
						method: 'GET',
						success: function (response) {
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
									total_buy_in = total_buy_in + res.AMOUNT;
									total_nn = total_nn + res.NN_CHIPS;
									total_cc = total_cc + res.CC_CHIPS;
								}
	
								if ((total_nn_init == 0 && total_cc_init == 0) && res.CAGE_TYPE == 1) {
									initial_buy_in = res.AMOUNT;
									total_nn_init = total_nn_init + res.NN_CHIPS;
									total_cc_init = total_cc_init + res.CC_CHIPS;
								}
	
								if (res.CAGE_TYPE == 2) {
									total_cash_out = total_cash_out + res.AMOUNT;
									total_cash_out_nn = total_cash_out_nn + res.NN_CHIPS;
									total_cash_out_cc = total_cash_out_cc + res.CC_CHIPS;
								}
	
								if (res.CAGE_TYPE == 3) {
									total_rolling = total_rolling + res.AMOUNT;
									total_rolling_nn = total_rolling_nn + res.NN_CHIPS;
									total_rolling_cc = total_rolling_cc + res.CC_CHIPS;
								}
	
							if (res.CAGE_TYPE == 4) {
									total_rolling_real = total_rolling_real + res.AMOUNT;
									total_rolling_nn_real = total_rolling_nn_real + res.NN_CHIPS;
									total_rolling_cc_real = total_rolling_cc_real + res.CC_CHIPS;
								}

							if (res.CAGE_TYPE == 5 && parseInt(res.ROLLER_TRANSACTION) === 2) {
								total_roller_return_cc += parseFloat(res.ROLLER_CC_CHIPS) || 0;
							}
							});

							var expense = '';

							expense = '<button class="btn btn-link" style="font-size:13px;text-decoration: underline;" onclick="updateExpense(' + row.game_list_id + ', ' + row.ACCOUNT_ID + ', ' + row.EXPENSE + ')">' + parseFloat(row.EXPENSE).toLocaleString('en-US') + '</button>';


	
							var total_initial = total_nn_init + total_cc_init;
							var total_buy_in_chips = total_nn + total_cc;
							var total_cash_out_chips = total_cash_out_nn + total_cash_out_cc;
							var total_rolling_chips = total_rolling_nn + total_rolling_cc + total_rolling + total_rolling_real + total_rolling_nn_real + total_rolling_cc_real + total_roller_return_cc - total_cash_out_nn;
	
							var total_rolling_real_chips = total_rolling_real + total_rolling_nn_real + total_rolling_cc_real;
	
							var gross = total_buy_in - total_cash_out;
	
							var total_amount = total_buy_in_chips + total_initial;
	
						//	var net = (total_rolling_chips * (row.COMMISSION_PERCENTAGE / 100)).toLocaleString('en-US');
	
							var winloss = parseFloat(total_amount - total_cash_out_chips).toLocaleString('en-US');
							
							var WinLoss = total_amount - total_cash_out_chips;

							 // Calculate net and format as an integer
							 var net = 0;
							 if (row.COMMISSION_TYPE == 1 || row.COMMISSION_TYPE == 3) {
								 // If COMMISSION_TYPE is 1 or 3, compute net using total rolling chips
								 net = Math.round(total_rolling_chips * (row.COMMISSION_PERCENTAGE / 100));
							 } else if (row.COMMISSION_TYPE == 2) {
								 // If COMMISSION_TYPE is 2, compute net using winloss
								 net = Math.round(WinLoss * (row.COMMISSION_PERCENTAGE / 100));
							 }
	
							// Add to grand totals
							totalInitialBuyIn += total_initial;
							totalAdditionalBuyIn += total_buy_in_chips;
							totalAmount += total_amount;
							totalRolling += total_rolling_chips;
							totalChipsReturn += total_cash_out_chips;
							totalWinLoss += parseFloat(winloss.replace(/,/g, ''));

									// Format net value as an integer
								var formattedNet = net.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 });

								var houseshare = row.HOUSE_SHARE != null ? row.HOUSE_SHARE.toLocaleString('en-US') : '';

							// Calculate NGR: (winloss * (houseShare / 100)) - formattedNet
							var ngr = (WinLoss * (houseshare / 100)) - net;

							var rtp = WinLoss / total_rolling_chips;

							var rm = total_rolling_chips / total_amount;

							// Convert back to string with specific formatting
								rtp = rtp % 1 === 0 ? rtp.toString() : rtp.toFixed(2);
								rm = rm % 1 === 0 ? rm.toString() : rm.toFixed(2);

							//expense = parseFloat(row.EXPENSE).toLocaleString('en-US');

							var profit = ngr - row.EXPENSE;

								dataTable.row.add([
									`${row.game_list_id}`,
									total_amount.toLocaleString('en-US'),
									winloss,
									parseFloat(total_rolling_chips).toLocaleString('en-US'),
									formattedNet,
									houseshare, 
									Math.round(ngr).toLocaleString('en-US'),
									`${rtp}%`,
									rm,
									expense,
									profit.toLocaleString('en-US')
								]).draw();
								
	
						},
							error: function (xhr, status, error) {
								console.error('Error fetching options:', error);
						}
					});
				});
	
	
			},
			error: function (xhr, status, error) {
				console.error('Error fetching data:', error);
			}
		});
	}

	// START Event listener for houseShare input change
	$('#guest_game_statistic-tbl').on('change', '.house-share-live-input', function () {
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


function updateExpense(id, account, expense) {
	$('#modal-update-expense').modal('show');

	$('.txtExpense').val(expense);

	$('.game_list_id').val(id);
	$('.txtAccountCode').val(account);

}

$('#update_expense').on('submit', function(e) {
    e.preventDefault();  // Prevent the default form submission

    const data = {
        game_id: $('.game_list_id').val(),
        txtExpense: $('#txtExpense').val(),
    };

    console.log(data);  // Debugging: Check the data being sent

    $.ajax({
        url: '/update_expense',
        type: 'PUT',
        data: data,
        success: function(response) {
			// Replace alert with SweetAlert2
            Swal.fire({
                title: 'Success!',
                text: response.message,
                icon: 'success',
                confirmButtonText: 'OK'
            }).then((result) => {
                if (result.isConfirmed) {
					$('#modal-update-expense').modal('hide');
					 // If you prefer a full page reload:
                     location.reload(); // Uncomment this if you want to reload the entire page
                }
            });
        },
        error: function(xhr) {
            console.error('Failed to update expense:', xhr.responseText);
            // Use SweetAlert2 for error messages too
            Swal.fire({
                title: 'Error!',
                text: 'Failed to update expense: ' + xhr.responseText,
                icon: 'error',
                confirmButtonText: 'OK'
            });
        }
    });
});


