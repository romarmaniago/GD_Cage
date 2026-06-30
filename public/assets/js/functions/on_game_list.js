var account_id;
var record_id;
var game_id;

$(document).ready(function () {
    // Initialize Flatpickr for date range (month-end cut-off defaults via month_end_cutoff_range.js)
    flatpickr("#daterange", {
        mode: "range",
        showMonths: 2,
    });

    // Function to reload data into the table
    function reloadData() {
        const dateRange = $('#daterange').val();
        if (!dateRange) {
            alert('Please select a date range.');
            return;
        }

        const [startRaw, endRaw] = dateRange.split(' to ');
        const apiRange = window.MonthEndCutoffRange
            ? window.MonthEndCutoffRange.parseRangeToApiDates(dateRange)
            : { start: startRaw, end: endRaw || startRaw };

        $.ajax({
            url: '/on_game_list_data',
            method: 'GET',
            data: { start: apiRange.start, end: apiRange.end },
            success: function (data) {
                // Clear the table before inserting new data
                $("#on_game-tbl tbody").empty();

                data.forEach(function (row) {
                    $.ajax({
                        url: '/game_list/' + row.game_list_id + '/record',
                        method: 'GET',
                        success: function (response) {
                            var total_buy_in = 0;
                            var total_cash_out = 0;
                            var total_rolling = 0;
                            var total_nn_init = 0, total_cc_init = 0;
                            var total_nn = 0, total_cc = 0;
                            var total_cash_out_nn = 0, total_cash_out_cc = 0;
                            var total_rolling_nn = 0, total_rolling_cc = 0;
                            var total_rolling_real = 0, total_rolling_nn_real = 0, total_rolling_cc_real = 0;

                            response.forEach(function (res) {
                                if (res.CAGE_TYPE == 1 && (total_nn_init != 0 || total_cc_init != 0)) {
                                    total_buy_in += res.AMOUNT;
                                    total_nn += res.NN_CHIPS;
                                    total_cc += res.CC_CHIPS;
                                }
                                if ((total_nn_init == 0 && total_cc_init == 0) && res.CAGE_TYPE == 1) {
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
                            });

                            var total_initial = total_nn_init + total_cc_init;
                            var total_buy_in_chips = total_nn + total_cc;
                            var total_cash_out_chips = total_cash_out_nn + total_cash_out_cc;
                            var total_rolling_chips = total_rolling_nn + total_rolling_cc + total_rolling + total_rolling_real + total_rolling_nn_real + total_rolling_cc_real - total_cash_out_nn;
                            var total_amount = total_buy_in_chips + total_initial;

                            $("#on_game-tbl tbody").append(`
                                <tr>
                                    <td>
                                        <a href="/game_list?id=${row.game_list_id}" class="text-primary" style="text-decoration: underline;" target="_blank">
                                            ${row.game_list_id}
                                        </a>
                                    </td>
                                    <td>${row.agent_name} (${row.agent_code})</td>
                                    <td>
                                        <span class="${row.GAME_TYPE === 'LIVE' ? 'css-blue' : row.GAME_TYPE === 'TELEBET' ? 'css-red' : ''}">
                                            ${row.GAME_TYPE === 'LIVE' ? (window.onGameListTranslations?.live || 'LIVE') : row.GAME_TYPE === 'TELEBET' ? (window.onGameListTranslations?.telebet || 'TELEBET') : row.GAME_TYPE}
                                        </span>
                                    </td>
                                    <td>${window.fmtAmt ? window.fmtAmt(total_amount) : total_amount.toLocaleString('en-US')}</td>
                                    <td>${window.fmtAmt ? window.fmtAmt(total_rolling_chips) : total_rolling_chips.toLocaleString('en-US')}</td>
                                    <td>${window.fmtOut ? window.fmtOut(total_cash_out_chips) : total_cash_out_chips.toLocaleString('en-US')}</td>
                                </tr>
                            `);
                            
                        },
                        error: function (xhr, status, error) {
                            console.error('Error fetching game record:', error);
                        }
                    });
                });
            },
            error: function (xhr, status, error) {
                console.error('Error fetching on game data:', error);
            }
        });
    }

    reloadData(); // Call this function to load data initially
});
