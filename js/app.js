/**
 * app.js
 * Wires up the UI: API key entry, PDF upload, page selection, processing,
 * and results. Everything runs client-side; the PDF and API key never
 * leave the browser except for direct calls to api.sarvam.ai.
 */

(() => {
  const pdfHandler = new PdfHandler();
  let currentFile = null;
  let apiKeyVerified = false;

  // ---- Element refs ----
  const apiKeyInput = document.getElementById('api-key');
  const toggleKeyBtn = document.getElementById('toggle-key-visibility');
  const keyStatus = document.getElementById('key-status');

  const dropzone = document.getElementById('dropzone');
  const fileInput = document.getElementById('pdf-file');
  const fileStatus = document.getElementById('file-status');

  const stepPages = document.getElementById('step-pages');
  const pageGrid = document.getElementById('page-grid');
  const pageCountStatus = document.getElementById('page-count-status');

  const stepOptions = document.getElementById('step-options');
  const targetLangSelect = document.getElementById('target-lang');
  const outputAudioCheckbox = document.getElementById('output-audio');
  const outputPdfCheckbox = document.getElementById('output-pdf');
  const processBtn = document.getElementById('process-btn');

  const stepProgress = document.getElementById('step-progress');
  const progressStatus = document.getElementById('progress-status');
  const progressBar = document.getElementById('progress-bar');
  const progressFill = document.getElementById('progress-fill');

  const stepResults = document.getElementById('step-results');
  const resultsList = document.getElementById('results-list');
  const startOverBtn = document.getElementById('start-over-btn');

  const errorMessage = document.getElementById('error-message');

  // ---- Helpers ----
  function showError(message) {
    errorMessage.textContent = message;
    errorMessage.classList.remove('hidden');
    errorMessage.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
  function clearError() {
    errorMessage.textContent = '';
    errorMessage.classList.add('hidden');
  }
  function setProgress(pct, message) {
    progressFill.style.width = `${pct}%`;
    progressBar.setAttribute('aria-valuenow', String(pct));
    progressStatus.textContent = message;
  }
  function updateProcessButtonState() {
    const hasPages = pdfHandler.selectedPages.size > 0;
    const hasOutput = outputAudioCheckbox.checked || outputPdfCheckbox.checked;
    processBtn.disabled = !(hasPages && hasOutput);
  }

  // ---- API key ----
  toggleKeyBtn.addEventListener('click', () => {
    const isPassword = apiKeyInput.type === 'password';
    apiKeyInput.type = isPassword ? 'text' : 'password';
    toggleKeyBtn.textContent = isPassword ? 'Hide' : 'Show';
    toggleKeyBtn.setAttribute('aria-pressed', String(isPassword));
  });

  let keyCheckTimer = null;
  apiKeyInput.addEventListener('input', () => {
    apiKeyVerified = false;
    keyStatus.textContent = '';
    keyStatus.className = 'status';
    clearTimeout(keyCheckTimer);
    const value = apiKeyInput.value.trim();
    if (!value) return;
    keyCheckTimer = setTimeout(async () => {
      keyStatus.textContent = 'Checking key…';
      try {
        await window.SarvamApi.verifyApiKey(value);
        apiKeyVerified = true;
        keyStatus.textContent = 'Key looks valid.';
        keyStatus.style.color = 'var(--success)';
      } catch (e) {
        apiKeyVerified = false;
        keyStatus.textContent = e.message || 'Could not verify key.';
        keyStatus.style.color = 'var(--error)';
      }
    }, 700);
  });

  // ---- File upload ----
  async function handleFile(file) {
    clearError();
    if (!file || file.type !== 'application/pdf') {
      showError('Please choose a PDF file.');
      return;
    }
    currentFile = file;
    fileStatus.textContent = `Loading "${file.name}"…`;
    try {
      const numPages = await pdfHandler.loadFile(file);
      fileStatus.textContent = `"${file.name}" — ${numPages} page${numPages === 1 ? '' : 's'} loaded.`;
      await renderPageGrid(numPages);
      stepPages.classList.remove('hidden');
      stepOptions.classList.remove('hidden');
      stepPages.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (e) {
      console.error(e);
      showError('Could not read that PDF. It may be corrupted or password-protected.');
    }
  }

  fileInput.addEventListener('change', (e) => handleFile(e.target.files[0]));

  dropzone.addEventListener('click', () => fileInput.click());
  dropzone.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileInput.click(); }
  });
  ['dragover', 'dragenter'].forEach(evt =>
    dropzone.addEventListener(evt, (e) => { e.preventDefault(); dropzone.classList.add('dragover'); })
  );
  ['dragleave', 'drop'].forEach(evt =>
    dropzone.addEventListener(evt, (e) => { e.preventDefault(); dropzone.classList.remove('dragover'); })
  );
  dropzone.addEventListener('drop', (e) => {
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  });

  // ---- Page grid ----
  async function renderPageGrid(numPages) {
    pageGrid.innerHTML = '';
    for (let i = 1; i <= numPages; i++) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'page-thumb';
      btn.setAttribute('aria-pressed', 'false');
      btn.setAttribute('aria-label', `Page ${i}, not selected`);

      const canvas = document.createElement('canvas');
      btn.appendChild(canvas);
      const label = document.createElement('span');
      label.textContent = `Page ${i}`;
      btn.appendChild(label);

      btn.addEventListener('click', () => onPageToggle(i, btn));
      pageGrid.appendChild(btn);

      // Render thumbnails progressively so the UI isn't blocked.
      pdfHandler.renderThumbnail(i, canvas).catch(() => {});
    }
    updatePageCountStatus();
  }

  function onPageToggle(pageNum, btn) {
    const wasSelected = pdfHandler.selectedPages.has(pageNum);
    const ok = pdfHandler.toggleSelection(pageNum);
    if (!ok) {
      showError(`You can select up to ${window.MAX_PAGES_SELECTABLE} pages per batch. Deselect a page first, or process this batch and start a new one for more pages.`);
      return;
    }
    clearError();
    const nowSelected = !wasSelected;
    btn.classList.toggle('selected', nowSelected);
    btn.setAttribute('aria-pressed', String(nowSelected));
    btn.setAttribute('aria-label', `Page ${pageNum}, ${nowSelected ? 'selected' : 'not selected'}`);
    updatePageCountStatus();
    updateProcessButtonState();
  }

  function updatePageCountStatus() {
    pageCountStatus.textContent = `${pdfHandler.selectedPages.size} of ${window.MAX_PAGES_SELECTABLE} pages selected`;
  }

  outputAudioCheckbox.addEventListener('change', updateProcessButtonState);
  outputPdfCheckbox.addEventListener('change', updateProcessButtonState);

  // ---- Processing ----
  processBtn.addEventListener('click', async () => {
    clearError();
    const apiKey = apiKeyInput.value.trim();
    if (!apiKey) {
      showError('Add your Sarvam API key first.');
      return;
    }

    const pages = pdfHandler.getSelectedPagesSorted();
    const targetLang = targetLangSelect.value;
    const wantAudio = outputAudioCheckbox.checked;
    const wantPdf = outputPdfCheckbox.checked;

    stepProgress.classList.remove('hidden');
    stepResults.classList.add('hidden');
    processBtn.disabled = true;
    stepProgress.scrollIntoView({ behavior: 'smooth', block: 'start' });

    try {
      // 1. Extract text + images from selected pages, in page order.
      setProgress(5, 'Reading selected pages…');
      let combinedText = '';
      let allImages = [];
      for (let i = 0; i < pages.length; i++) {
        const pageNum = pages[i];
        setProgress(5 + (i / pages.length) * 25, `Reading page ${pageNum}…`);
        const { text } = await pdfHandler.extractPageText(pageNum, {
          onOcrStart: (p) => setProgress(5 + (i / pages.length) * 25, `Page ${p} looks scanned — running OCR…`),
        });
        combinedText += (combinedText ? '\n\n' : '') + text;
        const images = await pdfHandler.extractPageImages(pageNum);
        allImages = allImages.concat(images);
      }

      if (!combinedText.trim()) {
        throw new Error('No readable text was found on the selected pages, even after OCR.');
      }

      // 2. Translate, if requested.
      let outputText = combinedText;
      if (targetLang) {
        setProgress(35, `Translating to ${targetLangSelect.selectedOptions[0].textContent}…`);
        outputText = await window.SarvamApi.translateText(apiKey, combinedText, targetLang, {
          onProgress: (done, total) => setProgress(35 + (done / total) * 25, `Translating… (${done + 1}/${total})`),
        });
      }

      const results = [];

      // 3. Build translated PDF, if requested.
      if (wantPdf) {
        setProgress(65, 'Building translated PDF…');
        const pdfBytes = await window.PdfBuilder.buildOutputPdf(outputText, allImages, targetLang);
        const blob = new Blob([pdfBytes], { type: 'application/pdf' });
        results.push({ name: 'translated-document.pdf', blob });
      }

      // 4. Build audio, if requested.
      if (wantAudio) {
        setProgress(78, 'Generating audio…');
        const ttsLang = targetLang || 'en-IN';
        const audioChunks = await window.SarvamApi.textToSpeech(apiKey, outputText, ttsLang, {
          onProgress: (done, total) => setProgress(78 + (done / total) * 18, `Generating audio… (${done + 1}/${total})`),
        });
        const audioBlob = window.AudioUtils.concatenateWavChunks(audioChunks);
        if (audioBlob) results.push({ name: 'read-aloud.wav', blob: audioBlob });
      }

      setProgress(100, 'Done.');
      showResults(results);
    } catch (e) {
      console.error(e);
      showError(e.message || 'Something went wrong while processing. Please try again.');
      stepProgress.classList.add('hidden');
    } finally {
      updateProcessButtonState();
    }
  });

  function showResults(files) {
    resultsList.innerHTML = '';
    for (const { name, blob } of files) {
      const url = URL.createObjectURL(blob);
      const item = document.createElement('div');
      item.className = 'result-item';

      const nameEl = document.createElement('span');
      nameEl.className = 'result-name';
      nameEl.textContent = name;
      item.appendChild(nameEl);

      if (name.endsWith('.wav')) {
        const audio = document.createElement('audio');
        audio.controls = true;
        audio.src = url;
        item.appendChild(audio);
      }

      const link = document.createElement('a');
      link.href = url;
      link.download = name;
      link.className = 'btn-primary';
      link.textContent = 'Download';
      item.appendChild(link);

      resultsList.appendChild(item);
    }
    stepProgress.classList.add('hidden');
    stepResults.classList.remove('hidden');
    stepResults.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  startOverBtn.addEventListener('click', () => {
    stepResults.classList.add('hidden');
    pdfHandler.selectedPages.clear();
    document.querySelectorAll('.page-thumb.selected').forEach(el => {
      el.classList.remove('selected');
      el.setAttribute('aria-pressed', 'false');
    });
    updatePageCountStatus();
    updateProcessButtonState();
    stepPages.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
})();
