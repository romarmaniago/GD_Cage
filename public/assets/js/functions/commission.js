$(document).ready(function() {

    function jumpCommissionRangeToCurrentThreeMonths(instance) {
        if (!instance) return;
        const current = new Date();
        instance.jumpToDate(new Date(current.getFullYear(), current.getMonth() - 2, 1), false);
    }

    // Initialize Flatpickr for date range
    var flatpickrInstance = flatpickr("#daterange", {
        mode: "range",
        altInput: true,
        altFormat: "M d, Y",
        dateFormat: "Y-m-d",
        defaultDate: [
            moment().startOf('month').format('YYYY-MM-DD'),
            moment().endOf('month').format('YYYY-MM-DD')
        ],
        showMonths: 3,
        onReady: function (selectedDates, dateStr, instance) {
            jumpCommissionRangeToCurrentThreeMonths(instance);
            if (typeof window.setupFlatpickrMonthNameRangeSelect === 'function') {
                window.setupFlatpickrMonthNameRangeSelect(instance);
            }
        },
        onOpen: function (selectedDates, dateStr, instance) {
            jumpCommissionRangeToCurrentThreeMonths(instance);
            if (typeof window.setupFlatpickrMonthNameRangeSelect === 'function') {
                window.setupFlatpickrMonthNameRangeSelect(instance);
            }
        },
        onMonthChange: function (selectedDates, dateStr, instance) {
            if (typeof window.styleFlatpickrMonthNameClickable === 'function') {
                window.styleFlatpickrMonthNameClickable(instance);
            }
        }
    });

    // Destroy existing DataTable if already initialized
    if ($.fn.DataTable.isDataTable('#commission-tbl')) {
        $('#commission-tbl').DataTable().destroy();
    }

    // Initialize DataTable
    var dataTable = $('#commission-tbl').DataTable({
    "order": [[10, 'desc']], // Set column 10 to be sorted in descending order
    "columnDefs": [
      {
        "targets": 10, // Column index for the ENCODED_DT
        "render": function (data, type, row) {
          // For sorting, return the raw date data
          if (type === 'sort') {
            return moment.utc(data, 'MMMM DD, YYYY HH:mm:ss').format('YYYY-MM-DD HH:mm:ss'); // Raw date for sorting
          }

          // Determine if the date is already in UTC
          const dateMoment = moment(data, 'MMMM DD, YYYY HH:mm:ss'); // Parse with format specification

          if (dateMoment.isValid()) {
            // For display, convert to local time and return the formatted date
            return dateMoment.local().format('DD MMM, YYYY HH:mm:ss');
          } else {
            // If the date is invalid, return an error message or a placeholder
            return window.commissionTranslations?.invalid_date || 'Invalid Date';
          }
        },
        
        "createdCell": function (cell, cellData, rowData, rowIndex, colIndex) {
          $(cell).addClass('text-center');
        }
      }
    ],
    "language": {
        "search": (window.commissionTranslations?.search || "Search:"),
        "info": (window.commissionTranslations?.showing_entries || "Showing _START_ to _END_ of _TOTAL_ entries"),
        "paginate": {
            "previous": (window.commissionTranslations?.previous || "Previous"),
            "next": (window.commissionTranslations?.next || "Next")
        },
        "emptyTable": (window.commissionTranslations?.no_data_found || "No data available in table")
    },
});


    function reloadData() {

        const dateRange = $('#daterange').val();

        if (!dateRange) {
            alert(window.commissionTranslations?.please_select_date_range || 'Please select a date range.');
            return;
        }

        // Split by ' to ' (with spaces)
        let start, end;
        if (dateRange.includes(' to ')) {
            [start, end] = dateRange.split(' to ');
        } else {
            // If only one date, use it for both start and end
            start = dateRange;
            end = dateRange;
        }
        
        // Ensure both dates are valid
        if (!start || !end) {
            alert('Invalid date range. Please select a valid range.');
            return;
        }

        $.ajax({
            url: '/commission_data', // Endpoint to fetch commission data
            method: 'GET',
            data: { start, end },
            success: function(data) {
                dataTable.clear(); // Clear existing table rows

                var ajaxCalls = [];
                var totalInitialBuyIn = 0;
                var totalAdditionalBuyIn = 0;
                var totalAmount = 0;
                var totalRolling = 0;
                var totalChipsReturn = 0;
                var totalWinLoss = 0;

                var totalRollingSettlement = 0;
                var totalFNB = 0;
                var totalPayment = 0;
               // let CommissionType = data[0].COMMISSION_TYPE; 

                data.forEach(function(row) {
                    // Only process records that are settled
                    if (row.SETTLED === 1) {
                        var RollingRate = row.COMMISSION_PERCENTAGE; // Ensure the RollingRate is correct
                        var fb = row.fnb || 0; // Use the FNB value from the row
                        var payment = row.payment || 0; // Use the PAYMENT value from the row

                        ajaxCalls.push(
                            $.ajax({
                                url: '/game_list/' + row.game_list_id + '/record',
                                method: 'GET',
                                success: function(response) {
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

                                    // Loop through the response and calculate totals
                                    response.forEach(function(res) {
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

                                        if (res.CAGE_TYPE == 5) {
                                            var rollerTransaction = parseInt(res.ROLLER_TRANSACTION) || 1;
                                            if (rollerTransaction === 2) {
                                                total_roller_return_cc += parseFloat(res.ROLLER_CC_CHIPS) || 0;
                                            }
                                        }
                                    });

                                    var total_initial = total_nn_init + total_cc_init;
                                    var total_buy_in_chips = total_nn + total_cc;
                                    var total_cash_out_chips = total_cash_out_nn + total_cash_out_cc;
                                    // TOTAL ROLLING: Follow same logic as game_list_data (reloadData function)
                                    // Formula: total_rolling_nn + totalRollingCCWithReturns + total_rolling + total_rolling_real + total_rolling_nn_real + total_rolling_cc_real - total_cash_out_nn
                                    // Note: CC chips from CAGE_TYPE == 3 (TOTAL ROLLING) should NOT be included
                                    // Note: CC chips from CAGE_TYPE == 4 (REAL ROLLING) SHOULD be included
                                    // Note: Buy-in amounts are NOT included here - they are separate from rolling transactions
                                    var totalRollingCCWithReturns = total_roller_return_cc;  // Only include roller return CC, exclude CC from CAGE_TYPE == 3
                                    var total_rolling_chips = total_rolling_nn + totalRollingCCWithReturns + total_rolling + total_rolling_real + total_rolling_nn_real + total_rolling_cc_real - total_cash_out_nn;

                                    var gross = total_buy_in - total_cash_out;
                                    var total_amount = total_buy_in_chips + total_initial;

                                    // Calculate the net commission
                                   // var netValue = total_rolling_chips * (RollingRate / 100); // Calculate the net value
                                  //  var net = netValue.toLocaleString(); // Format net value
                                    var winlossValue = total_amount - total_cash_out_chips; // Calculate win/loss
                                    var winloss = winlossValue.toLocaleString(); // Format win/loss

                                  //  var WinLoss = total_amount - total_cash_out_chips;
							
							        var net;
							
								if (row.COMMISSION_TYPE == 1 || row.COMMISSION_TYPE == 3) {
									// Kung ang COMMISSION_TYPE ay 1, ang net ay computed gamit ang total rolling chips
									net = Math.round((total_rolling_chips * RollingRate) / 100);
								} else if (row.COMMISSION_TYPE == 2) {
									// Kung ang COMMISSION_TYPE ay 2, ang net ay computed gamit ang winloss
									net = Math.round((winlossValue * RollingRate) / 100);
								}

                                    // Payment calculation based on RollingSettlement and fb
                                    var RollingSettlement = (total_rolling_chips * RollingRate) / 100;
                                    var paymentValue = Math.round(net - fb);


                                    // Add to grand totals
                                    totalInitialBuyIn += total_initial;
                                    totalAdditionalBuyIn += total_buy_in_chips;
                                    totalAmount += total_amount;
                                    totalRolling += total_rolling_chips;
                                    totalChipsReturn += total_cash_out_chips;
                                    totalWinLoss += winlossValue; // Ensure unformatted value for calculation
                                    totalRollingSettlement += net;
                                    totalFNB += fb;
                                    totalPayment += paymentValue;
                                    
                                    
                         var formattedDate = moment.utc(row.GAME_ENDED).utcOffset(8).format('MMMM DD, YYYY HH:mm:ss');
                                    // Add row to table with total_amount in a separate column (without drawing yet)
                                    dataTable.row.add([
                                        row.game_list_id,
                                        `${row.agent_code} - ${row.agent_name}`,
                                        total_amount.toLocaleString(),
                                        total_cash_out_chips.toLocaleString(),
                                        winloss.toLocaleString(),
                                        parseFloat(total_rolling_chips).toLocaleString(),
                                        `${row.COMMISSION_PERCENTAGE}%`,
                                        net.toLocaleString(),
                                        fb.toLocaleString(),
                                        paymentValue.toLocaleString(),
                                        formattedDate
                                    ]);
                                },
                                error: function(xhr, status, error) {
                                    console.error('Error fetching options:', error);
                                }
                            })
                        );
                    }
                });
                
                // Wait for all AJAX calls to complete before drawing the table once
                $.when.apply($, ajaxCalls).done(function() {
                    dataTable.draw();
                });

               
            },
            error: function(xhr, status, error) {
                console.error('Error fetching data:', error);
            }
        });
    }

    // Load data initially
    reloadData();

    // Reload data when date range changes (use 'close' event instead of 'change' to avoid multiple triggers)
    flatpickrInstance.config.onClose.push(function(selectedDates, dateStr, instance) {
        if (selectedDates.length === 2) {
            reloadData();
        }
    });

    function getCommissionExportFilename() {
        var dr = document.getElementById('daterange');
        if (dr && dr._flatpickr && dr._flatpickr.selectedDates && dr._flatpickr.selectedDates.length === 2) {
            var pad = function (n) {
                return String(n).padStart(2, '0');
            };
            var fmt = function (dt) {
                return dt.getFullYear() + '-' + pad(dt.getMonth() + 1) + '-' + pad(dt.getDate());
            };
            return 'Commission_' + fmt(dr._flatpickr.selectedDates[0]) + '_to_' + fmt(dr._flatpickr.selectedDates[1]) + '.xlsx';
        }
        return 'Commission-export.xlsx';
    }

    function escapeHtml(value) {
        return String(value == null ? '' : value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function getCommissionTablePayload(includeFooter) {
        var dt = $('#commission-tbl').DataTable();
        var headers = [];
        $('#commission-tbl thead tr:first th').each(function () {
            headers.push($(this).text().trim());
        });

        var rows = [];
        dt.rows({ search: 'applied' }).every(function () {
            var cells = [];
            $(this.node()).find('td').each(function () {
                cells.push($(this).text().trim());
            });
            if (cells.length) rows.push(cells);
        });

        var dataRowCount = rows.length;
        if (includeFooter && dataRowCount > 0) {
            rows.push([
                $('#commission-tbl tfoot th:first').text().trim(),
                '',
                $('#GRAND_TOTAL_AMOUNT').text().trim(),
                $('#GRAND_CHIPS_RETURN').text().trim(),
                $('#GRAND_WIN_LOSS').text().trim(),
                $('#GRAND_TOTAL_ROLLING').text().trim(),
                '',
                $('#GRAND_ROLLING_SETTLEMENT').text().trim(),
                $('#GRAND_FNB').text().trim(),
                $('#GRAND_PAYMENT').text().trim(),
                ''
            ]);
        }

        return { headers: headers, rows: rows, dataRowCount: dataRowCount };
    }

    function getCommissionPrintStyles() {
        return [
            '@page{size:landscape;margin:8mm;}',
            'body{font-family:Arial,sans-serif;color:#111;margin:0;}',
            '.print-wrap{width:100%;}',
            'h2{text-align:center;margin:0 0 4px;font-size:18px;}',
            '.subtitle{text-align:center;margin:0 0 12px;font-size:12px;color:#444;}',
            'table{width:100%;border-collapse:collapse;font-size:9px;}',
            'th,td{border:1px solid #777;padding:5px 7px;vertical-align:middle;}',
            'th{background:#d9e1f2;text-align:right;font-weight:700;}',
            'th:nth-child(1){text-align:center;}',
            'th:nth-child(2),th:nth-child(11){text-align:left;}',
            'td{text-align:right;}',
            'td:nth-child(1){text-align:center;}',
            'td:nth-child(2),td:nth-child(11){text-align:left;}',
            'tbody tr:last-child td{font-weight:700;background:#f4f6fa;}'
        ].join('');
    }

    function printCommissionTable() {
        if (!$.fn.DataTable.isDataTable('#commission-tbl')) return;
        var payload = getCommissionTablePayload(true);
        var t = window.commissionTranslations || {};
        if (payload.dataRowCount === 0) {
            if (window.Swal) {
                Swal.fire({
                    icon: 'info',
                    title: 'Print',
                    text: t.no_data_found || 'No rows to print for the current filter.',
                    confirmButtonColor: '#0d6efd'
                });
            } else {
                alert(t.no_data_found || 'No rows to print.');
            }
            return;
        }

        var dateRange = $('#daterange').val() || '';
        var headerHtml = payload.headers.map(function (h) {
            return '<th>' + escapeHtml(h) + '</th>';
        }).join('');
        var rowsHtml = payload.rows.map(function (row) {
            return '<tr>' + row.map(function (cell) {
                return '<td>' + escapeHtml(cell) + '</td>';
            }).join('') + '</tr>';
        }).join('');

        var iframe = document.createElement('iframe');
        iframe.style.position = 'fixed';
        iframe.style.right = '0';
        iframe.style.bottom = '0';
        iframe.style.width = '0';
        iframe.style.height = '0';
        iframe.style.border = '0';
        document.body.appendChild(iframe);

        var frameWindow = iframe.contentWindow;
        var frameDoc = frameWindow.document;
        frameDoc.open();
        frameDoc.write([
            '<!doctype html><html><head><title>Commission</title><style>',
            getCommissionPrintStyles(),
            '</style></head><body><div class="print-wrap">',
            '<h2>Commission</h2>',
            '<div class="subtitle">', escapeHtml(dateRange), '</div>',
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

    $('#btn-commission-export').on('click', function (e) {
        e.preventDefault();
        if (!$.fn.DataTable.isDataTable('#commission-tbl')) return;
        var payload = getCommissionTablePayload(true);
        var headers = payload.headers;
        var rows = payload.rows;
        var t = window.commissionTranslations || {};
        if (payload.dataRowCount === 0) {
            if (window.Swal) {
                Swal.fire({
                    icon: 'info',
                    title: t.export_label || 'Export',
                    text: t.no_data_found || 'No rows to export for the current filter.',
                    confirmButtonColor: '#0d6efd'
                });
            } else {
                alert(t.no_data_found || 'No rows to export.');
            }
            return;
        }
        var outName = getCommissionExportFilename();
        var $btn = $(this);
        $btn.prop('disabled', true);
        fetch('/commission/export_xlsx', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'same-origin',
            body: JSON.stringify({ headers: headers, rows: rows, filename: outName })
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
                if (window.Swal) {
                    Swal.fire({
                        icon: 'error',
                        title: 'Error',
                        text: err.message || 'Export failed',
                        confirmButtonColor: '#0d6efd'
                    });
                } else {
                    alert(err.message || 'Export failed');
                }
            })
            .finally(function () {
                $btn.prop('disabled', false);
            });
    });

    $('#btn-commission-print').on('click', function (e) {
        e.preventDefault();
        printCommissionTable();
    });
});