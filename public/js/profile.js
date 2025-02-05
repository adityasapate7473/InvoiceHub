// public/js/profile.js
document.getElementById('profileForm').addEventListener('submit', function (e) {
    e.preventDefault();
  
    // Get form data
    const businessName = document.getElementById('businessName').value;
    const gstNumber = document.getElementById('gstNumber').value;
    const panNumber = document.getElementById('panNumber').value;
    const stateCode = document.getElementById('stateCode').value;
    const businessLogo = document.getElementById('businessLogo').files[0];
    const resetBillNumber = document.getElementById('resetBillNumber').value;
  
    // Simulate saving profile data
    alert(`
      Business Name: ${businessName}
      GST Number: ${gstNumber}
      PAN Number: ${panNumber}
      State Code: ${stateCode}
      Logo: ${businessLogo ? businessLogo.name : 'No file selected'}
      Reset Bill Number: ${resetBillNumber || 'No reset requested'}
    `);
  
    // Here, send the data to the server via an API call (e.g., using fetch or axios)
  });
  