// Declare globally to ensure it's accessible throughout the script
let medicineCounter = {};  // Keep track of the count for each searched medicine

// Function to fetch FDA data based on medicine name
async function fetchFDAData(medicineName) {
    const openFdaUrl = `https://api.fda.gov/drug/label.json?search=brand_name"${medicineName}"`;

    try {
        const fdaResponse = await fetch(openFdaUrl);
        if (!fdaResponse.ok) {
            throw new Error(`FDA API responded with status: ${fdaResponse.status}`);
        }

        const fdaData = await fdaResponse.json();
        console.log('FDA Response:', fdaData);

        return fdaData;
    } catch (error) {
        console.error('Error fetching FDA data:', error);
        return null;
    }
}

// Function to handle the display of the results in a formatted way
function displayResults(fdaData, medicineName) {
    const results = fdaData?.results && fdaData.results[0]; // Access results safely

    const resultDiv = document.getElementById('resultDiv');
    if (!results) {
        resultDiv.innerHTML = `<p>No data found for the medicine.</p>`;
        resultDiv.classList.add('fade-in'); // Trigger animation even when no data is found
        return;
    }

    // Extract information or provide default messages
    const brandName = results?.openfda?.brand_name || "Brand name not found.";
    const genericName = results?.openfda?.generic_name || "Generic name not found.";
    const description = results?.description || "Description not available.";
    const activeIngredient = results?.active_ingredient || "Active ingredient not available.";
    const substance = results?.openfda?.substance_name || "Substance information not available.";
    const userSafety = results?.user_safety_warnings || "Warnings not found.";
    const handling = results?.storage_and_handling || "Handling information not available.";
    const whenUsing = results?.when_using || "Usage information not available.";
    const kooroc = results?.keep_out_of_reach_of_children || "No child safety info.";
    const informForPatients = results?.information_for_patients || "Patient information not available.";
    const askDoctor = results?.ask_doctor || "Consult a doctor.";
    const precautions = results?.precautions || "Precautions not found.";

    // Increment the counter for the searched medicine
    medicineCounter[medicineName] = (medicineCounter[medicineName] || 0) + 1;

    // Display the results in a nicely formatted way
    resultDiv.innerHTML = `
        <div class="medicine-details">
            <h1>Medicine Information</h1>
            <p><strong>Medicine:</strong> <em>${medicineName}</em></p>
            <p><strong>Search Count:</strong> ${medicineCounter[medicineName]}</p>

            <h2>Brand and Generic Information</h2>
            <p><strong>Brand Name:</strong> ${brandName}</p>
            <p><strong>Generic Name:</strong> ${genericName}</p>

            <h2>Description</h2>
            <p>${description}</p>

            <h2>Active Ingredients</h2>
            <ul>
                ${activeIngredient ? `<li>${activeIngredient}</li>` : '<li>No active ingredients available.</li>'}
            </ul>

            <h2>Substance Information</h2>
            <p>${substance}</p>

            <h2>Safety and Usage</h2>
            <p><strong>Consult Doctor:</strong> ${askDoctor}</p>
            <p><strong>Safe for Children:</strong> ${kooroc}</p>
            <p>${userSafety}</p>
            <p> ${precautions}</p>
            <p><strong>When Using:</strong> ${whenUsing}</p>

            <h2>Handling Instructions</h2>
            <p>${handling}</p>

            <h2>Information for Patients</h2>
            <p>${informForPatients}</p>
        </div>
    `;

    // Apply the fade-in class after content is loaded
    setTimeout(() => {
        resultDiv.classList.add('fade-in');
    }, 50); // Small timeout to ensure class is applied after content is loaded

    resultDiv.scrollIntoView({ behavior: 'smooth' });
}

// Function to handle the entire search process
async function searchMedicine() {
    const medicineName = document.getElementById('medicineName').value;
    if (!medicineName) {
        alert('Please enter a medicine name.');
        return;
    }

    // Fetch FDA data based on the entered medicine name
    const fdaData = await fetchFDAData(medicineName);

    if (fdaData && fdaData.results && fdaData.results.length > 0) {
        // Display the results if FDA data is found
        displayResults(fdaData, medicineName);
    } else {
        // Handle case where no FDA data is available
        displayResults(fdaData, medicineName);
    }
}
