// ===== Medicare — Script.js =====
// Single-page drug search with OpenFDA API
// Google-style search → Wikipedia-style article view

(function () {
  'use strict';

  // --- DOM References ---
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => document.querySelectorAll(sel);

  const appHeader = $('#appHeader');
  const searchHome = $('#searchHome');
  const loadingState = $('#loadingState');
  const noResults = $('#noResults');
  const detailsView = $('#detailsView');
  const heroSearchInput = $('#heroSearchInput');
  const headerSearchInput = $('#headerSearchInput');
  const heroAutocomplete = $('#heroAutocomplete');
  const headerAutocomplete = $('#headerAutocomplete');
  const btnSearch = $('#btnSearch');
  const headerBrand = $('#headerBrand');
  const headerClearBtn = $('#headerClearBtn');
  const btnBackHome = $('#btnBackHome');
  const tocNav = $('#tocNav');
  const articleTitle = $('#articleTitle');
  const articleContent = $('#articleContent');
  const drugInfobox = $('#drugInfobox');
  const noResultsMsg = $('#noResultsMsg');

  // --- State ---
  let currentView = 'search'; // 'search' | 'loading' | 'details' | 'noResults'
  let currentDrugData = null;
  let autocompleteTimer = null;
  let highlightedIndex = -1;

  // ===========================
  // VIEW STATE MANAGEMENT
  // ===========================
  function setView(view) {
    currentView = view;

    // Hide all
    searchHome.classList.add('hidden');
    loadingState.classList.remove('visible');
    noResults.classList.remove('visible');
    detailsView.classList.remove('visible');
    appHeader.classList.remove('visible');

    switch (view) {
      case 'search':
        searchHome.classList.remove('hidden');
        document.title = 'Medicare — Drug & Medicine Search';
        heroSearchInput.focus();
        break;
      case 'loading':
        appHeader.classList.add('visible');
        loadingState.classList.add('visible');
        break;
      case 'details':
        appHeader.classList.add('visible');
        detailsView.classList.add('visible');
        window.scrollTo({ top: 0, behavior: 'smooth' });
        break;
      case 'noResults':
        appHeader.classList.add('visible');
        noResults.classList.add('visible');
        break;
    }
  }

  // ===========================
  // API LAYER — RxNorm + OpenFDA
  // ===========================
  const FDA_BASE = 'https://api.fda.gov/drug/label.json';
  const RXNORM_BASE = 'https://rxnav.nlm.nih.gov/REST';

  async function apiFetch(url) {
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`API ${resp.status}`);
    return resp.json();
  }

  // --- Drug Details (OpenFDA) ---
  async function fetchDrugData(query) {
    const q = query.replace(/[^a-zA-Z0-9\s-]/g, '').trim();
    // Try exact matches first on specific openfda fields, then wildcard matches
    const urls = [
      `${FDA_BASE}?search=openfda.brand_name.exact:"${encodeURIComponent(q.toUpperCase())}"&limit=1`,
      `${FDA_BASE}?search=openfda.generic_name.exact:"${encodeURIComponent(q.toUpperCase())}"&limit=1`,
      `${FDA_BASE}?search=openfda.brand_name:${encodeURIComponent(q)}*&limit=1`,
      `${FDA_BASE}?search=openfda.generic_name:${encodeURIComponent(q)}*&limit=1`,
      `${FDA_BASE}?search=openfda.substance_name:${encodeURIComponent(q)}*&limit=1`,
    ];
    for (const url of urls) {
      try {
        const data = await apiFetch(url);
        if (data?.results?.length > 0) return data;
      } catch (err) {
        // 404 means no match for this specific query, continue to next
      }
    }
    return null;
  }

  // --- Pill Image (DailyMed) ---
  async function fetchPillImage(query) {
    try {
      const q = query.replace(/[^a-zA-Z0-9\s-]/g, '').trim();
      const splsUrl = `https://corsproxy.io/?${encodeURIComponent(`https://dailymed.nlm.nih.gov/dailymed/services/v2/spls.json?drug_name=${encodeURIComponent(q)}&pagesize=5`)}`;
      const splsData = await apiFetch(splsUrl);

      if (splsData.data && splsData.data.length > 0) {
        // Look through up to 5 SPLs to find a good image
        for (const spl of splsData.data) {
          const setid = spl.setid;
          const mediaProxyUrl = `https://corsproxy.io/?${encodeURIComponent(`https://dailymed.nlm.nih.gov/dailymed/services/v2/spls/${setid}/media.json`)}`;
          const mediaData = await apiFetch(mediaProxyUrl);

          if (mediaData.data?.media?.length > 0) {
            const images = mediaData.data.media.filter(m => m.mime_type === 'image/jpeg');
            if (images.length > 0) {
              // Priority 1: Filename suggests it's a pill/capsule/tablet
              const pillImg = images.find(img => /(pill|tablet|capsule|cap|tab|-01|-02)/i.test(img.name));
              if (pillImg) return pillImg.url;

              // Priority 2: If multiple images exist, the first is usually the carton label, 
              // so pick the last one which is more likely to be the pill.
              if (images.length > 1) return images[images.length - 1].url;

              // Priority 3: Just return what we have
              return images[0].url;
            }
          }
        }
      }
      return null;
    } catch (err) {
      console.warn('Pill image fetch failed:', err.message);
      return null;
    }
  }

  // --- Autocomplete (RxNorm — much better fuzzy/prefix search) ---
  async function fetchAutocompleteSuggestions(query) {
    if (!query || query.length < 2) return [];
    const q = query.replace(/[^a-zA-Z0-9\s-]/g, '').trim();
    const qLower = q.toLowerCase();

    // Fire multiple RxNorm endpoints concurrently for speed
    const [spelling, approx, drugs] = await Promise.allSettled([
      apiFetch(`${RXNORM_BASE}/spellingsuggestions.json?name=${encodeURIComponent(q)}`),
      apiFetch(`${RXNORM_BASE}/approximateTerm.json?term=${encodeURIComponent(q)}&maxEntries=10`),
      apiFetch(`${RXNORM_BASE}/drugs.json?name=${encodeURIComponent(q)}`),
    ]);

    const names = new Map(); // key (uppercase) -> { display, type }

    const addName = (name, type) => {
      if (!name || name.length > 60) return; // skip very long combo names
      const key = name.toUpperCase();
      if (!names.has(key)) names.set(key, { display: name, type });
    };

    // 1. Spelling suggestions — best for typo correction
    if (spelling.status === 'fulfilled') {
      const list = spelling.value?.suggestionGroup?.suggestionList?.suggestion;
      if (list) list.forEach(s => addName(s, 'suggestion'));
    }

    // 2. Approximate term — finds close matches by name similarity
    if (approx.status === 'fulfilled') {
      const candidates = approx.value?.approximateGroup?.candidate;
      if (candidates) candidates.forEach(c => { if (c.name) addName(c.name, 'match'); });
    }

    // 3. Drugs endpoint — brand names for exact/prefix matches
    if (drugs.status === 'fulfilled') {
      const groups = drugs.value?.drugGroup?.conceptGroup;
      if (groups) {
        groups.forEach(g => {
          if (g.conceptProperties) {
            g.conceptProperties.forEach(p => {
              // Extract clean brand name from entries like "ibuprofen 200 MG Oral Tablet [Advil]"
              const bracketMatch = p.name?.match(/\[(.+?)\]/);
              if (bracketMatch) addName(bracketMatch[1], 'brand');
              // Also extract the base ingredient name
              const baseName = p.name?.split(/\s\d/)?.[0]?.trim();
              if (baseName && baseName.length < 40) addName(baseName, 'generic');
            });
          }
        });
      }
    }

    // Also try a quick FDA fallback if RxNorm gave us nothing
    if (names.size === 0) {
      try {
        const fdaData = await apiFetch(`${FDA_BASE}?search=brand_name:${encodeURIComponent(q)}*&limit=8`);
        if (fdaData?.results) {
          fdaData.results.forEach(r => {
            r.openfda?.brand_name?.forEach(n => addName(n, 'brand'));
            r.openfda?.generic_name?.forEach(n => addName(n, 'generic'));
          });
        }
      } catch { /* ignore */ }
    }

    // Sort: prefix matches first, shorter names first, alphabetical
    const sorted = [...names.values()].sort((a, b) => {
      const aPrefix = a.display.toLowerCase().startsWith(qLower) ? 0 : 1;
      const bPrefix = b.display.toLowerCase().startsWith(qLower) ? 0 : 1;
      if (aPrefix !== bPrefix) return aPrefix - bPrefix;
      if (a.display.length !== b.display.length) return a.display.length - b.display.length;
      return a.display.localeCompare(b.display);
    });

    return sorted.slice(0, 8);
  }

  // ===========================
  // SEARCH HANDLER
  // ===========================
  async function performSearch(query) {
    if (!query || !query.trim()) return;
    query = query.trim();

    // Update header search
    headerSearchInput.value = query;
    hideAllAutocomplete();

    // Show loading
    setView('loading');

    const data = await fetchDrugData(query);

    if (data && data.results && data.results.length > 0) {
      currentDrugData = data.results[0];
      renderArticle(currentDrugData, query);
      setView('details');
      document.title = `${getDisplayName(currentDrugData, query)} — Medicare`;
    } else {
      noResultsMsg.textContent = `We couldn't find any FDA data for "${query}". Try a different drug or brand name.`;
      setView('noResults');
    }
  }

  // ===========================
  // DATA EXTRACTION HELPERS
  // ===========================
  function getDisplayName(drug, query) {
    const brand = drug.openfda?.brand_name?.[0];
    const generic = drug.openfda?.generic_name?.[0];
    return brand || generic || query;
  }

  function cleanText(val) {
    if (!val) return null;
    const text = Array.isArray(val) ? val.join(' ') : String(val);
    return text.replace(/\s+/g, ' ').trim() || null;
  }

  function toTitleCase(str) {
    if (!str) return '';
    return str.toLowerCase().replace(/\b\w/g, c => c.toUpperCase());
  }

  // ===========================
  // RENDER ARTICLE
  // ===========================
  function renderArticle(drug, query) {
    const name = getDisplayName(drug, query);
    articleTitle.textContent = toTitleCase(name);

    // Extract all sections
    const sections = buildSections(drug);

    // Render TOC
    renderTOC(sections);

    // Render content
    renderContent(sections, drug);

    // Render infobox
    renderInfobox(drug, name);

    // Setup intersection observer for TOC highlighting
    setupTOCObserver();
  }

  function buildSections(drug) {
    const sections = [];

    const tryAdd = (id, title, icon, fields, isWarning) => {
      for (const field of fields) {
        const val = cleanText(drug[field]);
        if (val) {
          sections.push({ id, title, icon, content: val, field, isWarning: !!isWarning });
          return;
        }
      }
    };

    // Summary / Description
    tryAdd('summary', 'Summary', 'description', ['description', 'spl_product_data_elements']);

    // Indications & Usage
    tryAdd('indications', 'Indications & Usage', 'medical_services', ['indications_and_usage', 'purpose']);

    // Dosage & Administration
    tryAdd('dosage', 'Dosage & Administration', 'medication', ['dosage_and_administration', 'dosage_forms_and_strengths']);

    // Active Ingredients
    tryAdd('ingredients', 'Active Ingredients', 'science', ['active_ingredient', 'inactive_ingredient']);

    // Warnings
    tryAdd('warnings', 'Warnings & Precautions', 'warning', ['warnings', 'boxed_warning', 'warnings_and_cautions'], true);

    // Adverse Reactions
    tryAdd('adverse', 'Adverse Reactions', 'report_problem', ['adverse_reactions']);

    // Drug Interactions
    tryAdd('interactions', 'Drug Interactions', 'sync_alt', ['drug_interactions']);

    // Contraindications
    tryAdd('contraindications', 'Contraindications', 'block', ['contraindications'], true);

    // Use in Specific Populations
    tryAdd('populations', 'Use in Specific Populations', 'group', ['use_in_specific_populations', 'pregnancy', 'nursing_mothers', 'pediatric_use', 'geriatric_use']);

    // Clinical Pharmacology
    tryAdd('pharmacology', 'Clinical Pharmacology', 'biotech', ['clinical_pharmacology', 'mechanism_of_action', 'pharmacodynamics', 'pharmacokinetics']);

    // Storage & Handling
    tryAdd('storage', 'Storage & Handling', 'inventory_2', ['storage_and_handling', 'how_supplied']);

    // Patient Information
    tryAdd('patient-info', 'Patient Information', 'person', ['information_for_patients', 'patient_medication_information']);

    // Ask Doctor
    tryAdd('ask-doctor', 'Consult Your Doctor', 'stethoscope', ['ask_doctor', 'ask_doctor_or_pharmacist']);

    // Keep out of reach of children
    tryAdd('child-safety', 'Child Safety', 'child_care', ['keep_out_of_reach_of_children', 'when_using']);

    return sections;
  }

  // ===========================
  // RENDER TOC
  // ===========================
  function renderTOC(sections) {
    tocNav.innerHTML = sections.map(s => `
      <a class="toc-link" href="#${s.id}" data-section="${s.id}">
        <span class="material-symbols-outlined">${s.icon}</span>
        <span>${s.title}</span>
      </a>
    `).join('');
  }

  // ===========================
  // RENDER CONTENT SECTIONS
  // ===========================
  function renderContent(sections, drug) {
    let html = '';

    sections.forEach(s => {
      html += `<section class="article-section" id="${s.id}">`;
      html += `<h2>${s.title}</h2>`;

      // Warning sections get an alert banner
      if (s.isWarning && s.content.length > 100) {
        const shortWarning = s.content.substring(0, 250).trim();
        html += `
          <div class="alert-banner">
            <span class="material-symbols-outlined">warning</span>
            <div>
              <h3>Important Safety Information</h3>
              <p>${shortWarning}${s.content.length > 250 ? '...' : ''}</p>
            </div>
          </div>`;
        if (s.content.length > 250) {
          html += `<p>${s.content}</p>`;
        }
      } else {
        // Format content — split into paragraphs if long
        const paragraphs = s.content.split(/\.\s+(?=[A-Z])/);
        if (paragraphs.length > 1 && s.content.length > 400) {
          paragraphs.forEach(p => {
            const text = p.trim();
            if (text) html += `<p>${text}${text.endsWith('.') ? '' : '.'}</p>`;
          });
        } else {
          html += `<p>${s.content}</p>`;
        }
      }

      html += `</section>`;
    });

    // If we also have extra fields not in sections, add them
    const otherFields = ['precautions', 'overdosage', 'abuse_and_dependence', 'clinical_studies', 'references'];
    otherFields.forEach(field => {
      const val = cleanText(drug[field]);
      if (val && !sections.some(s => s.field === field)) {
        const title = field.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
        html += `<section class="article-section" id="${field}">
          <h2>${title}</h2>
          <p>${val}</p>
        </section>`;
      }
    });

    articleContent.innerHTML = html;
  }

  // ===========================
  // RENDER INFOBOX
  // ===========================
  function renderInfobox(drug, name) {
    const openfda = drug.openfda || {};
    const brandName = openfda.brand_name?.join(', ') || 'N/A';
    const genericName = openfda.generic_name?.join(', ') || 'N/A';
    const substance = openfda.substance_name?.join(', ') || 'N/A';
    const manufacturer = openfda.manufacturer_name?.join(', ') || 'N/A';
    const route = openfda.route?.join(', ') || 'N/A';
    const productType = openfda.product_type?.join(', ') || 'N/A';
    const rxOtc = openfda.product_type?.[0]?.includes('OTC') ? 'Over-the-Counter' : openfda.product_type?.[0]?.includes('PRESCRIPTION') ? 'Prescription' : 'N/A';
    const splId = openfda.spl_id?.[0] || null;
    const ndcCodes = openfda.product_ndc?.slice(0, 3)?.join(', ') || 'N/A';
    const pharmClass = openfda.pharm_class_epc?.join(', ') || openfda.pharm_class_moa?.join(', ') || null;

    let html = `<div class="infobox-card">`;

    // Header
    html += `<div class="infobox-header"><h3>${toTitleCase(name)}</h3></div>`;

    // Image Container
    html += `<div id="infoboxImageContainer" class="infobox-image-container" style="display: none;"></div>`;

    // Clinical Data
    html += `<div class="infobox-section">
      <h4>Clinical Data</h4>
      <table class="infobox-table">
        <tr><th>Brand Name</th><td>${toTitleCase(brandName)}</td></tr>
        <tr><th>Generic Name</th><td>${toTitleCase(genericName)}</td></tr>
        <tr><th>Manufacturer</th><td>${toTitleCase(manufacturer)}</td></tr>
        <tr><th>Route</th><td>${toTitleCase(route)}</td></tr>
        <tr><th>Type</th><td>${rxOtc}</td></tr>
      </table>
    </div>`;

    // Substance / Pharmacology
    html += `<div class="infobox-section">
      <h4>Substance Data</h4>
      <table class="infobox-table">
        <tr><th>Substance</th><td>${toTitleCase(substance)}</td></tr>
        <tr><th>NDC Codes</th><td>${ndcCodes}</td></tr>
        ${pharmClass ? `<tr><th>Pharm Class</th><td>${pharmClass}</td></tr>` : ''}
        ${splId ? `<tr><th>SPL ID</th><td style="font-size:12px;word-break:break-all">${splId}</td></tr>` : ''}
      </table>
    </div>`;

    html += `</div>`;
    drugInfobox.innerHTML = html;

    // Fetch and append image asynchronously
    fetchPillImage(name).then(imageUrl => {
      const container = document.getElementById('infoboxImageContainer');
      if (imageUrl && container) {
        container.innerHTML = `<img src="${imageUrl}" alt="Pill image for ${name}" class="infobox-pill-image" />`;
        container.style.display = 'block';
      }
    });
  }

  // ===========================
  // TOC INTERSECTION OBSERVER
  // ===========================
  function setupTOCObserver() {
    const sectionEls = articleContent.querySelectorAll('.article-section');
    if (!sectionEls.length) return;

    const observer = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          const id = entry.target.id;
          tocNav.querySelectorAll('.toc-link').forEach(link => {
            link.classList.toggle('active', link.dataset.section === id);
          });
        }
      });
    }, {
      rootMargin: '-80px 0px -60% 0px',
      threshold: 0.1
    });

    sectionEls.forEach(el => observer.observe(el));
  }

  // ===========================
  // AUTOCOMPLETE
  // ===========================
  function showAutocomplete(dropdown, suggestions) {
    if (!suggestions.length) {
      dropdown.classList.remove('visible');
      dropdown.innerHTML = '';
      return;
    }
    const currentInput = (dropdown === heroAutocomplete ? heroSearchInput : headerSearchInput).value.trim().toLowerCase();

    // Map type -> icon and label
    const typeConfig = {
      brand: { icon: 'medication', label: 'Brand' },
      generic: { icon: 'science', label: 'Generic' },
      suggestion: { icon: 'spellcheck', label: 'Did you mean?' },
      match: { icon: 'search', label: 'Match' },
    };

    dropdown.innerHTML = suggestions.map((s, i) => {
      const name = s.display || s;
      const type = s.type || 'match';
      const displayName = toTitleCase(name);
      const cfg = typeConfig[type] || typeConfig.match;

      // Bold the matching portion
      const idx = displayName.toLowerCase().indexOf(currentInput);
      let highlighted = displayName;
      if (idx >= 0) {
        const before = displayName.slice(0, idx);
        const match = displayName.slice(idx, idx + currentInput.length);
        const after = displayName.slice(idx + currentInput.length);
        highlighted = `${before}<strong>${match}</strong>${after}`;
      }
      return `
        <div class="autocomplete-item" data-index="${i}" data-name="${name}">
          <span class="material-symbols-outlined">${cfg.icon}</span>
          <span class="ac-name">${highlighted}</span>
          <span class="ac-tag ac-tag--${type}">${cfg.label}</span>
        </div>
      `;
    }).join('');
    dropdown.classList.add('visible');
    highlightedIndex = -1;
  }

  function hideAllAutocomplete() {
    heroAutocomplete.classList.remove('visible');
    headerAutocomplete.classList.remove('visible');
    highlightedIndex = -1;
  }

  function handleAutocompleteInput(input, dropdown) {
    clearTimeout(autocompleteTimer);
    const query = input.value.trim();
    if (query.length < 2) {
      dropdown.classList.remove('visible');
      return;
    }
    autocompleteTimer = setTimeout(async () => {
      const suggestions = await fetchAutocompleteSuggestions(query);
      showAutocomplete(dropdown, suggestions);
    }, 200);
  }

  function handleAutocompleteKeydown(e, input, dropdown) {
    const items = dropdown.querySelectorAll('.autocomplete-item');
    if (!items.length || !dropdown.classList.contains('visible')) {
      if (e.key === 'Enter') {
        e.preventDefault();
        performSearch(input.value);
      }
      return;
    }

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      highlightedIndex = Math.min(highlightedIndex + 1, items.length - 1);
      items.forEach((it, i) => it.classList.toggle('highlighted', i === highlightedIndex));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      highlightedIndex = Math.max(highlightedIndex - 1, -1);
      items.forEach((it, i) => it.classList.toggle('highlighted', i === highlightedIndex));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (highlightedIndex >= 0 && items[highlightedIndex]) {
        const name = items[highlightedIndex].dataset.name;
        input.value = name;
        performSearch(name);
      } else {
        performSearch(input.value);
      }
    } else if (e.key === 'Escape') {
      hideAllAutocomplete();
    }
  }

  function handleAutocompleteClick(dropdown) {
    dropdown.addEventListener('click', (e) => {
      const item = e.target.closest('.autocomplete-item');
      if (item) {
        const name = item.dataset.name;
        heroSearchInput.value = name;
        headerSearchInput.value = name;
        performSearch(name);
      }
    });
  }

  // ===========================
  // EVENT BINDINGS
  // ===========================
  function init() {
    // Hero search
    heroSearchInput.addEventListener('input', () => handleAutocompleteInput(heroSearchInput, heroAutocomplete));
    heroSearchInput.addEventListener('keydown', (e) => handleAutocompleteKeydown(e, heroSearchInput, heroAutocomplete));
    handleAutocompleteClick(heroAutocomplete);

    // Header search
    headerSearchInput.addEventListener('input', () => handleAutocompleteInput(headerSearchInput, headerAutocomplete));
    headerSearchInput.addEventListener('keydown', (e) => handleAutocompleteKeydown(e, headerSearchInput, headerAutocomplete));
    handleAutocompleteClick(headerAutocomplete);

    // Search button
    btnSearch.addEventListener('click', () => performSearch(heroSearchInput.value));

    // Surprise Me button
    const btnSurprise = document.getElementById('btnSurprise');
    if (btnSurprise) {
      btnSurprise.addEventListener('click', () => {
        const drugs = [
          'Ibuprofen', 'Acetaminophen', 'Lisinopril', 'Levothyroxine', 
          'Metformin', 'Amlodipine', 'Metoprolol', 'Albuterol', 
          'Omeprazole', 'Losartan', 'Gabapentin', 'Sertraline', 
          'Simvastatin', 'Atorvastatin', 'Amoxicillin', 'Azithromycin', 
          'Hydrochlorothiazide', 'Furosemide', 'Pantoprazole', 'Prednisone'
        ];
        const randomDrug = drugs[Math.floor(Math.random() * drugs.length)];
        heroSearchInput.value = randomDrug;
        performSearch(randomDrug);
      });
    }

    // Header brand → go home
    headerBrand.addEventListener('click', (e) => {
      e.preventDefault();
      heroSearchInput.value = '';
      headerSearchInput.value = '';
      setView('search');
    });

    // Header clear button
    headerClearBtn.addEventListener('click', () => {
      headerSearchInput.value = '';
      headerSearchInput.focus();
    });

    // Back to home from no results
    btnBackHome.addEventListener('click', () => {
      heroSearchInput.value = '';
      headerSearchInput.value = '';
      setView('search');
    });

    // Close autocomplete on outside click
    document.addEventListener('click', (e) => {
      if (!e.target.closest('.hero-search') && !e.target.closest('.header-search')) {
        hideAllAutocomplete();
      }
    });

    // Escape to go home or close modal
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        const aboutModal = document.getElementById('aboutModal');
        const disclaimerModal = document.getElementById('disclaimerModal');
        
        if (aboutModal && aboutModal.classList.contains('active')) {
          aboutModal.classList.remove('active');
        } else if (disclaimerModal && disclaimerModal.classList.contains('active')) {
          disclaimerModal.classList.remove('active');
        } else if (currentView !== 'search') {
          heroSearchInput.value = '';
          headerSearchInput.value = '';
          setView('search');
        }
      }
    });

    // ===========================
    // ABOUT MODAL
    // ===========================
    const aboutLink = document.getElementById('aboutMedicareLink');
    const aboutModal = document.getElementById('aboutModal');
    const closeAboutBtn = document.getElementById('closeAboutModal');

    if (aboutLink && aboutModal && closeAboutBtn) {
      aboutLink.addEventListener('click', (e) => {
        e.preventDefault();
        aboutModal.classList.add('active');
      });

      closeAboutBtn.addEventListener('click', () => {
        aboutModal.classList.remove('active');
      });

      // Close when clicking outside the modal content
      aboutModal.addEventListener('click', (e) => {
        if (e.target === aboutModal) {
          aboutModal.classList.remove('active');
        }
      });
    }

    // ===========================
    // DISCLAIMERS MODAL
    // ===========================
    const disclaimersLink = document.getElementById('disclaimersLink');
    const disclaimerModal = document.getElementById('disclaimerModal');
    const closeDisclaimerBtn = document.getElementById('closeDisclaimerModal');

    if (disclaimersLink && disclaimerModal && closeDisclaimerBtn) {
      disclaimersLink.addEventListener('click', (e) => {
        e.preventDefault();
        disclaimerModal.classList.add('active');
      });

      closeDisclaimerBtn.addEventListener('click', () => {
        disclaimerModal.classList.remove('active');
      });

      // Close when clicking outside the modal content
      disclaimerModal.addEventListener('click', (e) => {
        if (e.target === disclaimerModal) {
          disclaimerModal.classList.remove('active');
        }
      });
    }

    // Initial view
    setView('search');
  }

  // Boot
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
