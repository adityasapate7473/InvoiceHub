// public/js/dashboard.js
const ctx = document.getElementById('statsChart').getContext('2d');
const statsChart = new Chart(ctx, {
  type: 'pie',
  data: {
    labels: ['Customers', 'Bills Generated', 'Transporters'],
    datasets: [{
      data: [10, 20, 30], // Replace with real data
      backgroundColor: ['#6482AD', '#7FA1C3', '#E2DAD6'],
    }]
  }
});

// You can dynamically update the numbers
document.getElementById('numCustomers').innerText = 10;  // Example data
document.getElementById('numBills').innerText = 20;
document.getElementById('numTransporters').innerText = 5;
