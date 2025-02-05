document.getElementById("add-product").addEventListener("click", function () {
  const productContainer = document.getElementById("product-container");
  const newRow = document.createElement("tr");
  newRow.classList.add("product-row");

  newRow.innerHTML = `
    <td class="serial-number"></td>
    <td>
      <input type="text" class="item-code" placeholder="Item Code" oninput="fetchProducts(this)" required>
      <div id="product-suggestions" class="product-dropdown"></div>
    </td>
    <td><input type="text" class="product-name" placeholder="Product Name"></td>
    <td><input type="text" class="product-hsn" placeholder="HSN Code"></td>
    <td><input type="number" class="product-quantity" placeholder="Quantity" oninput="updateBill()"></td>
    <td><input type="text" class="product-units" placeholder="Units"></td>
    <td><input type="number" class="product-rate" placeholder="Rate" oninput="updateBill()"></td>
    <td class="product-amount">0.00</td>
    <td><button type="button" class="delete-row" onclick="deleteRow(this)">X</button></td>
  `;

  // Append the new row to the table and update serial numbers
  productContainer.querySelector("tbody").appendChild(newRow);
  updateSerialNumbers();
  updateBill();
});

function deleteRow(button) {
  const row = button.closest("tr");
  // Check if this is not the first row before deleting
  if (!row.classList.contains("first-row")) {
    row.remove();
    updateSerialNumbers(); // Adjust serial numbers after deletion
    updateBill();
  }
}

function updateSerialNumbers() {
  const rows = document.querySelectorAll(".product-row");
  rows.forEach((row, index) => {
    const serialNumberCell = row.querySelector(".serial-number");
    if (serialNumberCell) {
      serialNumberCell.textContent = index + 1; // Set the serial number starting from 1
    }
  });
}

function updateBill() {
  let totalQuantity = 0;
  let totalAmount = 0;

  document.querySelectorAll('.product-row').forEach(row => {
    const quantity = parseFloat(row.querySelector('.product-quantity').value) || 0;
    const rate = parseFloat(row.querySelector('.product-rate').value) || 0;
    const amount = quantity * rate;

    row.querySelector('.product-amount').innerText = amount.toFixed(2);
    totalQuantity += quantity;
    totalAmount += amount;
  });

  const gstRate = parseFloat(document.getElementById('gst-rate').value);
  const cgstAmount = (totalAmount * (gstRate / 100)) / 2;
  const sgstAmount = cgstAmount;

  const roundOffAmount = Math.round(totalAmount + cgstAmount + sgstAmount) - (totalAmount + cgstAmount + sgstAmount);
  const grandTotal = totalAmount + cgstAmount + sgstAmount + roundOffAmount;

  // Update totals in the form
  document.getElementById('total-quantity').innerText = totalQuantity.toFixed(2);
  document.getElementById('total-product-amount').innerText = `₹ ${totalAmount.toFixed(2)}`;
  document.getElementById('cgst-amount').innerText = `₹ ${cgstAmount.toFixed(2)}`;
  document.getElementById('sgst-amount').innerText = `₹ ${sgstAmount.toFixed(2)}`;
  document.getElementById('round-off-amount').innerText = `₹ ${roundOffAmount.toFixed(2)}`;
  document.getElementById('grand-total').innerText = `₹ ${grandTotal.toFixed(2)}`;

  // Update Amount in Words (you might want to create a function for this)
  // Update Amount in Words
  const amountInWords = convertNumberToWords(grandTotal);
  document.getElementById('amount-in-words').innerText = amountInWords;
}


// Function to convert a number to words
function convertNumberToWords(num) {
  if (num === 0) return "Zero Only";

  const units = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine"];
  const teens = ["Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"];
  const tens = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];
  const lakhsAndCrores = ["", "Lakh", "Crore"];

  // Function to convert a number less than 100
  function convertToWords(n) {
    if (n === 0) return "";
    if (n < 10) return units[n];
    if (n < 20) return teens[n - 10];
    if (n < 100) return tens[Math.floor(n / 10)] + (n % 10 !== 0 ? " " + units[n % 10] : "");
    return units[Math.floor(n / 100)] + " Hundred" + (n % 100 !== 0 ? " " + convertToWords(n % 100) : "");
  }

  // Function to convert large numbers
  function convertLargeNumber(n) {
    let words = "";
    let crore = Math.floor(n / 10000000); // Crores
    let lakh = Math.floor((n % 10000000) / 100000); // Lakhs
    let thousand = Math.floor((n % 100000) / 1000); // Thousands
    let remainder = n % 1000; // Remainder

    if (crore > 0) {
      words += convertToWords(crore) + " Crore";
    }
    if (lakh > 0) {
      if (words) words += " ";
      words += convertToWords(lakh) + " Lakh";
    }
    if (thousand > 0) {
      if (words) words += " ";
      words += convertToWords(thousand) + " Thousand";
    }
    if (remainder > 0) {
      if (words) words += " ";
      words += convertToWords(remainder);
    }

    return words.trim();
  }

  let [integerPart, decimalPart] = num.toString().split(".");

  // Convert the integer part to words using the Indian system
  let integerWords = convertLargeNumber(parseInt(integerPart));

  // Handle the decimal part
  let decimalWords = "";
  if (decimalPart) {
    decimalWords = " and " + decimalPart.split("").map(digit => units[parseInt(digit)]).join(" ") + "/100";
  }

  return integerWords + decimalWords + " Only";
}
