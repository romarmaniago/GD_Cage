var record_id = $('#game_id').val();

$(document).ready(function() {
   
  if ($.fn.DataTable.isDataTable('#game_record-tbl')) {
	$('#game_record-tbl').DataTable().destroy();
	}

	var dataTable = $('#game_record-tbl').DataTable({
		columnDefs: [
			{
			createdCell: function(cell, cellData, rowData, rowIndex, colIndex) {
				$(cell).addClass('text-center');
			}
			}
		]
	});

	function reloadDataRecord() {
	$.ajax({
		url: '/game_record_data/' + record_id, // Endpoint to fetch data
		method: 'GET',
		success: function(data) {
		dataTable.clear();
		data.forEach(function(row) {


			var btn = `<div class="btn-group">
			<button type="button" onclick="archive_game_record(${row.game_record_id})" class="btn btn-sm btn-alt-danger js-bs-tooltip-enabled"
			data-bs-toggle="tooltip" aria-label="Archive" data-bs-original-title="Archive">
			<i class="fa fa-trash-alt"></i>
			</button>
		</div>`;

		

			var trading = moment(row.TRADING_DATE).format('MMMM DD, YYYY');
			// var record_date = moment(row.RECORD_DATE).format('MMMM DD, YYYY');

			var buy_in = 0;
			var cash_out = 0;
			var rolling = 0;

			if(row.CAGE_TYPE == 1) {
				buy_in = row.AMOUNT;
			}

			if(row.CAGE_TYPE == 2) {
				cash_out = row.AMOUNT;
			}

			if(row.CAGE_TYPE == 3) {
				rolling = row.AMOUNT;
			}

			var recordId = row.game_record_id || row.IDNo;
			var remarksCell = window.RemarksEditor && recordId
				? window.RemarksEditor.renderCell(row.REMARKS || '', { source: 'game_record', recordId: recordId })
				: (row.REMARKS || '');
			dataTable.row.add([trading, buy_in, cash_out , rolling , remarksCell ,btn]).draw();
		});
		},
		error: function(xhr, status, error) {
		console.error('Error fetching data:', error);
		}
	});
	}

	reloadDataRecord()


  	$('#add_game_record').submit(function(event) {
		event.preventDefault(); 

		var formData = $(this).serialize();

		$.ajax({
			url: '/add_game_record',
			type: 'POST',
			data: formData,
			// processData: false, 
			// contentType: false,
			success: function(response) {
				reloadDataRecord();
				$('#modal-new-game-record').modal('hide');
			},
			error: function(xhr, status, error) {
			var errorMessage = xhr.responseJSON.error;
			// if(errorMessage == 'password') {
			//   Swal.fire({
			//     icon: "error",
			//     title: "Oops...",
			//     text: "Password not match!",
			//   });
			// } else {
				console.error('Error updating user role:', error);
			// }
			}
		});
	});
});
  
function archive_game_record(id){
	Swal.fire({
	  title: 'Are you sure you want to delete this?',
	  icon: 'warning',
	  showCancelButton: true,
	  confirmButtonColor: '#3085d6',
	  cancelButtonColor: '#d33',
	  confirmButtonText: 'Yes'
  }).then((result) => {
	  if (result.isConfirmed) {
		$.ajax({
		  url: '/game_record/remove/' + id,
		  type: 'PUT',
		  success: function(response) {
			window.location.reload();
		  },
		  error: function(error) {
			  console.error('Error deleting game list:', error);
		  }
	  });
	  }
  })
}


function addGameRecord() {
	$('#modal-new-game-record').modal('show');
	$('.txtAmount').val('');
	get_cage_category();
}

function get_cage_category() {
	$.ajax({
		url: '/cage_category_data',
		method: 'GET',
		success: function(response) {
			var selectOptions = $('#txtCategory');
			selectOptions.empty(); 
			selectOptions.append($('<option>', {
			  value: '',
			  text: '--SELECT CONCIERGE CATEGORY--'
		  }));
			response.forEach(function(option) {
				selectOptions.append($('<option>', {
					value: option.IDNo,
					text: option.CATEGORY
				}));
			});
		},
		error: function(xhr, status, error) {
			console.error('Error fetching options:', error);
		}
	});
}