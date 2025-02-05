// public/js/history.js
function filterBills() {
  const filterValue = document.getElementById('filter').value;
  const tableBody = document.getElementById('billTableBody');

  // Fetch bills from the database based on filter value (placeholder data)
  const bills = [
    { billNumber: '1001', customer: 'Customer A', date: '2024-11-25', total: '$150' },
    { billNumber: '1002', customer: 'Customer B', date: '2024-11-24', total: '$200' }
  ];

  tableBody.innerHTML = '';

  bills.forEach(bill => {
    const row = document.createElement('tr');
    row.innerHTML = `
        <td>${bill.billNumber}</td>
        <td>${bill.customer}</td>
        <td>${bill.date}</td>
        <td>${bill.total}</td>
      `;
    tableBody.appendChild(row);
  });
}

// Initial load of bills
filterBills();
