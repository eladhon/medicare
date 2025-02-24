// Declare globally to ensure it's accessible throughout the script
let medicineCounter = {};  // Keep track of the count for each searched medicine

// Define the function as 'async'
async function searchMedicine() {
    const Mname = document.getElementById('medicineName').value;
    if (!Mname) {
        alert('Please enter a medicine name.');
        return;
    }

    let rxnormUrl= `https://rxnav.nlm.nih.gov/REST/rxcui.json?name=${Mname}&search=1`;

    try {
        const response = await fetch(rxnormUrl);  // 'await' works only in an 'async' function
        if (!response.ok) {
            throw new Error(`RxNorm API responded with status: ${response.status}`);
        }

        const data = await response.json();
        console.log('RxNorm Response:', data);

        if (data.idGroup && data.idGroup.rxnormId) {
            const rxCUI = data.idGroup.rxnormId[0];

            // Increment the counter for the searched medicine
            medicineCounter[Mname] = (medicineCounter[Mname] || 0) + 1;

            let openFdaUrl = `https://api.fda.gov/drug/label.json?search=openfda.rxcui"${rxCUI}"`;

            const fdaResponse = await fetch(openFdaUrl);
            if (!fdaResponse.ok) {
                throw new Error(`FDA API responded with status: ${fdaResponse.status}`);
            }

            const fdaData = await fdaResponse.json();
            console.log('FDA Response:', fdaData);

            const results = fdaData.results && fdaData.results[0]; // Access results safely

            const brandName = results?.openfda.brand_name || "Brand name not found.";
        const genericName = results?.openfda.generic_name || "Generic name not found.";
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


            document.getElementById('resultDiv').innerHTML = `
                <h1>${brandName}</h1>
                <p><strong>Generic Name:<strong>${genericName}</p>
                <p><strong>Count:</strong> ${medicineCounter[Mname]}</p>
                
                <p><strong>Description:</strong>${description}</p>
                <p><strong>Active Ingredients:</strong>${activeIngredient}</p>
                <p><strong>Substances:</strong>${substance}</p>
                <p><strong>Consult Doctor:</strong>${askDoctor}</p>
                <p><strong>Safe for Children:</strong>${kooroc}</p>
                <p><strong>Information:</strong>${informForPatients}</p>
                <p><strong>When Using:</strong>${whenUsing}</p>
                <p><strong>Safety:</strong>${userSafety}</p>
                <p><strong>When Handling:</strong>${handling}</p>
                <p><strong>Precautions:</strong>${precautions}</p>
                
            `;
            
        } else {
            document.getElementById('resultDiv').innerHTML = `<p>Medicine not found in RxNorm database.</p>`;
        }
    } catch (error) {
        console.error('Error:', error);
        document.getElementById('resultDiv').innerHTML = `<p>Failed to fetch medicine data. Please check the console for more details.</p>`;
    }
}