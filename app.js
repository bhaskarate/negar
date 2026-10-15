(() => {
  'use strict';

  const SUPPORTED_EXTENSIONS = new Set(['pdf', 'png', 'jpg', 'jpeg', 'tif', 'tiff', 'bmp', 'webp']);
  const DPI_DEFAULT = 250;
  const state = { files: [], outputs: [], busy: false, nextId: 1, worker: null, ocrPageIndex: 0, ocrPageCount: 1 };

  const $ = (id) => document.getElementById(id);
  const els = {
    fileInput: $('file-input'), dropZone: $('drop-zone'), browseButton: $('browse-button'),
    fileCount: $('file-count'), queueArea: $('queue-area'), fileList: $('file-list'), clearButton: $('clear-button'),
    processButton: $('process-button'), progressPanel: $('progress-panel'), progressLabel: $('progress-label'),
    progressPercent: $('progress-percent'), progressBar: $('progress-bar'), progressDetail: $('progress-detail'),
    notice: $('notice'), resultsArea: $('results-area'), resultsList: $('results-list'), downloadZip: $('download-zip'),
    dpi: $('dpi'), dpiValue: $('dpi-value'), splitPages: $('split-pages'), cutOptions: $('cut-options'),
    cutMode: $('cut-mode'), manualCutBox: $('manual-cut-box'), cutPosition: $('cut-position'), cutValue: $('cut-value'),
    deskew: $('deskew'), cropMargins: $('crop-margins'), marginBox: $('margin-box'), margin: $('margin'),
    marginValue: $('margin-value'), language: $('language')
  };

  if (window.pdfjsLib) {
    pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, (char) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[char]);
  }

  function formatBytes(bytes) {
    if (!Number.isFinite(bytes) || bytes < 0) return 'Tamanho desconhecido';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  function extensionOf(name) {
    const parts = String(name).toLowerCase().split('.');
    return parts.length > 1 ? parts.pop() : '';
  }

  function readableStatus(file) {
    if (file.status === 'queued') return 'Na fila';
    if (file.status === 'working') return file.statusText || 'Processando…';
    if (file.status === 'done') return `Concluído · ${file.pages || 0} páginas`;
    if (file.status === 'error') return file.statusText || 'Falha no processamento';
    return '';
  }

  function iconLabel(file) {
    const ext = extensionOf(file.name);
    if (ext === 'jpeg') return 'JPG';
    if (ext === 'tiff') return 'TIFF';
    return ext.toUpperCase() || 'FILE';
  }

  function renderQueue() {
    const count = state.files.length;
    els.fileCount.textContent = `${count} ${count === 1 ? 'arquivo' : 'arquivos'}`;
    els.queueArea.hidden = count === 0;
    els.processButton.disabled = count === 0 || state.busy;
    els.clearButton.disabled = state.busy;
    els.fileList.innerHTML = state.files.map((file) => {
      const statusClass = file.status === 'error' ? 'error' : file.status === 'done' ? 'done' : '';
      return `<div class="file-row" data-file-id="${file.id}">
        <div class="file-type-icon" aria-hidden="true">${escapeHtml(iconLabel(file))}</div>
        <div class="file-main">
          <div class="file-name" title="${escapeHtml(file.name)}">${escapeHtml(file.name)}</div>
          <div class="file-meta">${formatBytes(file.size)}</div>
          <div class="file-status ${statusClass}">${escapeHtml(readableStatus(file))}</div>
        </div>
        <button class="remove-file" type="button" data-remove="${file.id}" aria-label="Remover ${escapeHtml(file.name)}" ${state.busy ? 'disabled' : ''}>
          <svg viewBox="0 0 20 20" aria-hidden="true"><path d="m5 5 10 10M15 5 5 15"/></svg>
        </button>
      </div>`;
    }).join('');
  }

  function renderOutputs() {
    els.resultsArea.hidden = state.outputs.length === 0;
    els.downloadZip.hidden = state.outputs.length < 2;
    els.resultsList.innerHTML = state.outputs.map((output, index) => {
      const detail = [`${output.pages} páginas`, formatBytes(output.bytes.byteLength)];
      if (output.splitPairs) detail.push(`${output.splitPairs} página(s) dupla(s) dividida(s)`);
      if (output.preserved) detail.push(`${output.preserved} página(s) preservada(s) por segurança`);
      if (output.pagesWithoutText) detail.push(`${output.pagesWithoutText} página(s) sem texto detectável`);
      return `<div class="result-row">
        <div class="file-type-icon" aria-hidden="true">PDF</div>
        <div class="file-main"><div class="file-name">${escapeHtml(output.name)}</div><div class="result-detail">${detail.map(escapeHtml).join(' · ')}</div></div>
        <button class="result-download" type="button" data-download="${index}"><svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 3v9m-4-4 4 4 4-4M4 14v3h12v-3"/></svg> Baixar</button>
      </div>`;
    }).join('');
  }

  function showNotice(message, kind = 'normal') {
    els.notice.hidden = !message;
    els.notice.className = `notice${kind === 'error' ? ' error' : kind === 'success' ? ' success' : ''}`;
    els.notice.textContent = message;
  }

  function setProgress(label, percent, detail) {
    const clamped = Math.max(0, Math.min(100, Math.round(percent)));
    els.progressPanel.hidden = false;
    els.progressLabel.textContent = label;
    els.progressPercent.textContent = `${clamped}%`;
    els.progressBar.style.width = `${clamped}%`;
    if (detail) els.progressDetail.textContent = detail;
  }

  function hideProgress() {
    els.progressPanel.hidden = true;
    els.progressBar.style.width = '0%';
  }

  function settingsFromUi() {
    return {
      dpi: Number(els.dpi.value) || DPI_DEFAULT,
      split: els.splitPages.checked,
      cutMode: els.cutMode.value,
      cut: Number(els.cutPosition.value) || 50,
      deskew: els.deskew.checked,
      crop: els.cropMargins.checked,
      margin: (Number(els.margin.value) || 4) / 100,
      language: els.language.value
    };
  }

  function refreshOptionLabels() {
    els.dpiValue.textContent = `${els.dpi.value} DPI`;
    els.cutValue.textContent = `${els.cutPosition.value}%`;
    els.marginValue.textContent = `${els.margin.value}%`;
    els.manualCutBox.hidden = els.cutMode.value !== 'manual' || !els.splitPages.checked;
    els.cutOptions.hidden = !els.splitPages.checked;
    els.marginBox.hidden = !els.cropMargins.checked;
  }

  function addFiles(fileList) {
    if (state.busy) return;
    const incoming = Array.from(fileList || []);
    if (!incoming.length) return;
    let rejected = 0;
    incoming.forEach((file) => {
      const ext = extensionOf(file.name);
      if (!SUPPORTED_EXTENSIONS.has(ext)) {
        rejected += 1;
        return;
      }
      state.files.push({ id: state.nextId++, file, name: file.name, size: file.size, status: 'queued', statusText: '', outputIndex: null });
    });
    if (rejected) showNotice(`${rejected} arquivo(s) ignorado(s): formato não suportado. Use PDF, PNG, JPG, TIFF, BMP ou WEBP.`, 'error');
    else showNotice('');
    renderQueue();
    els.fileInput.value = '';
  }

  function removeFile(id) {
    if (state.busy) return;
    state.files = state.files.filter((file) => file.id !== id);
    renderQueue();
  }

  function nextFrame() {
    return new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0)));
  }

  function canvasToBlob(canvas) {
    return new Promise((resolve, reject) => {
      canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('Não foi possível converter uma página em imagem.')), 'image/png');
    });
  }

  function newCanvas(width, height) {
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.ceil(width));
    canvas.height = Math.max(1, Math.ceil(height));
    return canvas;
  }

  function grayscaleAt(data, offset) {
    return (data[offset] * 0.299 + data[offset + 1] * 0.587 + data[offset + 2] * 0.114);
  }

  function otsuThreshold(histogram, total) {
    let sum = 0;
    for (let i = 0; i < 256; i += 1) sum += i * histogram[i];
    let sumBackground = 0;
    let weightBackground = 0;
    let maxVariance = -1;
    let threshold = 160;
    for (let i = 0; i < 256; i += 1) {
      weightBackground += histogram[i];
      if (!weightBackground) continue;
      const weightForeground = total - weightBackground;
      if (!weightForeground) break;
      sumBackground += i * histogram[i];
      const meanBackground = sumBackground / weightBackground;
      const meanForeground = (sum - sumBackground) / weightForeground;
      const variance = weightBackground * weightForeground * (meanBackground - meanForeground) ** 2;
      if (variance > maxVariance) {
        maxVariance = variance;
        threshold = i;
      }
    }
    return threshold;
  }

  // Aproxima a detecção de linhas horizontais do script Python por perfil de projeção.
  // A imagem de amostra é pequena para não bloquear o navegador em páginas de alta resolução.
  function estimateSkew(canvas) {
    const maxDim = 650;
    const scale = Math.min(1, maxDim / Math.max(canvas.width, canvas.height));
    const width = Math.max(1, Math.round(canvas.width * scale));
    const height = Math.max(1, Math.round(canvas.height * scale));
    const sample = newCanvas(width, height);
    const sampleCtx = sample.getContext('2d', { willReadFrequently: true });
    sampleCtx.fillStyle = '#fff';
    sampleCtx.fillRect(0, 0, width, height);
    sampleCtx.drawImage(canvas, 0, 0, width, height);
    const pixels = sampleCtx.getImageData(0, 0, width, height).data;
    const histogram = new Uint32Array(256);
    const points = [];
    // Amostragem a cada dois pixels reduz o custo quadrático sem afetar linhas longas.
    for (let y = 1; y < height - 1; y += 2) {
      for (let x = 1; x < width - 1; x += 2) {
        const i = (y * width + x) * 4;
        const gray = Math.round(grayscaleAt(pixels, i));
        histogram[gray] += 1;
      }
    }
    const sampledCount = histogram.reduce((sum, value) => sum + value, 0);
    const threshold = Math.min(205, Math.max(90, otsuThreshold(histogram, sampledCount)));
    for (let y = 1; y < height - 1; y += 2) {
      for (let x = 1; x < width - 1; x += 2) {
        const i = (y * width + x) * 4;
        if (grayscaleAt(pixels, i) < threshold) points.push([x, y]);
      }
    }
    if (points.length < 120) return 0;

    const cx = (width - 1) / 2;
    const cy = (height - 1) / 2;
    let bestAngle = 0;
    let bestScore = -Infinity;
    for (let step = -25; step <= 25; step += 1) {
      const angle = step * 0.2 * Math.PI / 180;
      const cosine = Math.cos(angle);
      const sine = Math.sin(angle);
      const rows = new Uint16Array(height);
      for (let p = 0; p < points.length; p += 1) {
        const [x, y] = points[p];
        const rotatedY = Math.round(sine * (x - cx) + cosine * (y - cy) + cy);
        if (rotatedY >= 0 && rotatedY < height) rows[rotatedY] += 1;
      }
      let score = 0;
      for (let y = 2; y < height - 2; y += 1) {
        const centered = rows[y] - (rows[y - 1] + rows[y + 1]) * 0.25;
        score += centered * centered;
      }
      if (score > bestScore) {
        bestScore = score;
        bestAngle = step * 0.2;
      }
    }
    sample.width = 1;
    sample.height = 1;
    return Math.abs(bestAngle) <= 0.15 ? 0 : bestAngle;
  }

  function straightenCanvas(canvas) {
    const angle = estimateSkew(canvas);
    if (!angle) return canvas;
    const out = newCanvas(canvas.width, canvas.height);
    const ctx = out.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, out.width, out.height);
    ctx.translate(out.width / 2, out.height / 2);
    ctx.rotate(angle * Math.PI / 180);
    ctx.drawImage(canvas, -canvas.width / 2, -canvas.height / 2);
    return out;
  }

  function detectFold(canvas, manualCut = null) {
    const width = canvas.width;
    if (manualCut !== null) return Math.round(width * manualCut / 100);
    const start = Math.floor(width * 0.43);
    const end = Math.floor(width * 0.57);
    const bandWidth = Math.max(1, end - start);
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const data = ctx.getImageData(start, 0, bandWidth, canvas.height).data;
    const ink = new Float32Array(bandWidth);
    for (let x = 0; x < bandWidth; x += 1) {
      let dark = 0;
      for (let y = 0; y < canvas.height; y += 1) {
        const i = (y * bandWidth + x) * 4;
        if (grayscaleAt(data, i) < 180) dark += 1;
      }
      ink[x] = dark / canvas.height;
    }
    // Gaussiano de sigma ~3 px, conforme o script original.
    const radius = Math.max(3, Math.ceil(3 * 3));
    const kernel = [];
    let kernelSum = 0;
    for (let offset = -radius; offset <= radius; offset += 1) {
      const value = Math.exp(-(offset * offset) / (2 * 3 * 3));
      kernel.push(value);
      kernelSum += value;
    }
    let bestIndex = 0;
    let bestValue = Infinity;
    for (let x = 0; x < bandWidth; x += 1) {
      let total = 0;
      for (let offset = -radius; offset <= radius; offset += 1) {
        const sourceX = Math.max(0, Math.min(bandWidth - 1, x + offset));
        total += ink[sourceX] * kernel[offset + radius];
      }
      const value = total / kernelSum;
      if (value < bestValue) {
        bestValue = value;
        bestIndex = x;
      }
    }
    return start + bestIndex;
  }

  function splitCanvas(canvas, settings) {
    const cut = detectFold(canvas, settings.cutMode === 'manual' ? settings.cut : null);
    if (cut < canvas.width * 0.35 || cut > canvas.width * 0.65) {
      throw new Error('A posição de corte ficou fora da região central. Ajuste o corte manual.');
    }
    const left = newCanvas(cut, canvas.height);
    const right = newCanvas(canvas.width - cut, canvas.height);
    left.getContext('2d').drawImage(canvas, 0, 0, cut, canvas.height, 0, 0, cut, canvas.height);
    right.getContext('2d').drawImage(canvas, cut, 0, canvas.width - cut, canvas.height, 0, 0, canvas.width - cut, canvas.height);
    return [left, right];
  }

  function detectContentBounds(canvas) {
    const scale = Math.min(1, 1200 / Math.max(canvas.width, canvas.height));
    const width = Math.max(1, Math.round(canvas.width * scale));
    const height = Math.max(1, Math.round(canvas.height * scale));
    const small = newCanvas(width, height);
    const ctx = small.getContext('2d', { willReadFrequently: true });
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(canvas, 0, 0, width, height);
    const data = ctx.getImageData(0, 0, width, height).data;
    const rowCounts = new Uint32Array(height);
    const colCounts = new Uint32Array(width);
    let darkPixels = 0;
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const i = (y * width + x) * 4;
        if (grayscaleAt(data, i) < 190) {
          rowCounts[y] += 1;
          colCounts[x] += 1;
          darkPixels += 1;
        }
      }
    }
    small.width = 1;
    small.height = 1;
    if (darkPixels < 80) return null;
    const lineLimit = Math.max(2, Math.floor(width * 0.001));
    const columnLimit = Math.max(2, Math.floor(height * 0.001));
    let firstY = -1, lastY = -1, firstX = -1, lastX = -1;
    for (let y = 0; y < height; y += 1) if (rowCounts[y] >= lineLimit) { if (firstY < 0) firstY = y; lastY = y; }
    for (let x = 0; x < width; x += 1) if (colCounts[x] >= columnLimit) { if (firstX < 0) firstX = x; lastX = x; }
    if (firstX < 0 || firstY < 0 || lastX < firstX || lastY < firstY) return null;
    const contentWidth = lastX - firstX + 1;
    const contentHeight = lastY - firstY + 1;
    if (contentWidth < width * 0.12 || contentHeight < height * 0.12) return null;
    if (contentWidth > width * 0.995 && contentHeight > height * 0.995) return null;
    const inverse = 1 / scale;
    const x = Math.max(0, Math.floor(firstX * inverse));
    const y = Math.max(0, Math.floor(firstY * inverse));
    const endX = Math.min(canvas.width, Math.ceil((lastX + 1) * inverse));
    const endY = Math.min(canvas.height, Math.ceil((lastY + 1) * inverse));
    if (endX <= x || endY <= y) return null;
    return { x, y, width: endX - x, height: endY - y };
  }

  function preparePart(sourceCanvas, settings) {
    let canvas = settings.deskew ? straightenCanvas(sourceCanvas) : sourceCanvas;
    if (!settings.crop) return { canvas, reliable: true };
    const bounds = detectContentBounds(canvas);
    if (!bounds) return { canvas, reliable: false };
    const marginPixels = Math.floor(Math.max(bounds.width, bounds.height) * settings.margin);
    const x = Math.max(0, bounds.x - marginPixels);
    const y = Math.max(0, bounds.y - marginPixels);
    const endX = Math.min(canvas.width, bounds.x + bounds.width + marginPixels);
    const endY = Math.min(canvas.height, bounds.y + bounds.height + marginPixels);
    if (endX <= x || endY <= y) return { canvas, reliable: false };
    const cropped = newCanvas(endX - x, endY - y);
    cropped.getContext('2d').drawImage(canvas, x, y, cropped.width, cropped.height, 0, 0, cropped.width, cropped.height);
    return { canvas: cropped, reliable: true };
  }

  async function collectPreparedPage(canvas, settings, pages, counters) {
    const shouldSplit = settings.split && canvas.width > canvas.height;
    const parts = shouldSplit ? splitCanvas(canvas, settings) : [canvas];
    if (shouldSplit) counters.splitPairs += 1;
    for (const part of parts) {
      const prepared = preparePart(part, settings);
      const blob = await canvasToBlob(prepared.canvas);
      pages.push({ blob, width: prepared.canvas.width, height: prepared.canvas.height, reliable: prepared.reliable });
      if (!prepared.reliable) counters.preserved += 1;
    }
  }

  async function preparePdfFile(file, settings, item, counters) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const document = await pdfjsLib.getDocument({ data: bytes }).promise;
    const pages = [];
    try {
      for (let index = 1; index <= document.numPages; index += 1) {
        item.statusText = `Preparando página ${index}/${document.numPages}`;
        renderQueue();
        setProgress(`Preparando ${file.name}`, 5 + 36 * ((index - 1) / document.numPages), `Renderização em ${settings.dpi} DPI · página ${index} de ${document.numPages}`);
        await nextFrame();
        const page = await document.getPage(index);
        const viewport = page.getViewport({ scale: settings.dpi / 72 });
        const canvas = newCanvas(viewport.width, viewport.height);
        const ctx = canvas.getContext('2d', { alpha: false });
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        await page.render({ canvasContext: ctx, viewport, background: 'rgb(255,255,255)' }).promise;
        await collectPreparedPage(canvas, settings, pages, counters);
        page.cleanup();
        canvas.width = 1; canvas.height = 1;
      }
    } finally {
      await document.destroy();
    }
    return pages;
  }

  async function imageFileToCanvases(file) {
    const ext = extensionOf(file.name);
    const canvases = [];
    if ((ext === 'png' || ext === 'webp') && 'ImageDecoder' in window) {
      // ImageDecoder permite preservar quadros de APNG/WebP animado nos navegadores compatíveis.
      try {
        const decoder = new ImageDecoder({ data: await file.arrayBuffer(), type: file.type || (ext === 'png' ? 'image/png' : 'image/webp') });
        await decoder.tracks.ready;
        const track = decoder.tracks.selectedTrack;
        if (track && track.frameCount > 1) {
          for (let index = 0; index < track.frameCount; index += 1) {
            const frame = await decoder.decode({ frameIndex: index });
            const image = frame.image;
            const canvas = newCanvas(image.displayWidth || image.codedWidth, image.displayHeight || image.codedHeight);
            const ctx = canvas.getContext('2d', { alpha: false });
            ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
            ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
            image.close?.();
            canvases.push(canvas);
          }
          decoder.close();
          return canvases;
        }
        decoder.close();
      } catch (_error) {
        // Navegadores sem suporte completo seguem pelo decodificador de imagem comum.
      }
    }
    if (ext === 'tif' || ext === 'tiff') {
      if (!window.UTIF) throw new Error('A biblioteca de leitura TIFF não carregou. Verifique sua conexão e recarregue a página.');
      const buffer = await file.arrayBuffer();
      const ifds = UTIF.decode(buffer);
      if (!ifds || !ifds.length) throw new Error('Não foi possível ler os quadros do TIFF.');
      for (const ifd of ifds) {
        UTIF.decodeImage(buffer, ifd);
        const rgba = UTIF.toRGBA8(ifd);
        const raw = newCanvas(ifd.width, ifd.height);
        raw.getContext('2d', { willReadFrequently: true }).putImageData(new ImageData(new Uint8ClampedArray(rgba), ifd.width, ifd.height), 0, 0);
        const orientationTag = ifd.t274;
        const orientation = Number(Array.isArray(orientationTag) ? orientationTag[0] : orientationTag) || 1;
        if (orientation === 1) {
          canvases.push(raw);
          continue;
        }
        const swapsDimensions = [5, 6, 7, 8].includes(orientation);
        const oriented = newCanvas(swapsDimensions ? raw.height : raw.width, swapsDimensions ? raw.width : raw.height);
        const ctx = oriented.getContext('2d', { alpha: false });
        ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, oriented.width, oriented.height);
        switch (orientation) {
          case 2: ctx.translate(raw.width, 0); ctx.scale(-1, 1); break;
          case 3: ctx.translate(raw.width, raw.height); ctx.rotate(Math.PI); break;
          case 4: ctx.translate(0, raw.height); ctx.scale(1, -1); break;
          case 5: ctx.scale(-1, 1); ctx.rotate(Math.PI / 2); break;
          case 6: ctx.translate(raw.height, 0); ctx.rotate(Math.PI / 2); break;
          case 7: ctx.translate(raw.height, raw.width); ctx.scale(1, -1); ctx.rotate(Math.PI / 2); break;
          case 8: ctx.translate(0, raw.width); ctx.rotate(-Math.PI / 2); break;
          default: break;
        }
        ctx.drawImage(raw, 0, 0);
        raw.width = 1; raw.height = 1;
        canvases.push(oriented);
      }
      return canvases;
    }
    const bitmap = await createImageBitmap(file);
    const canvas = newCanvas(bitmap.width, bitmap.height);
    const ctx = canvas.getContext('2d', { alpha: false });
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(bitmap, 0, 0);
    bitmap.close?.();
    canvases.push(canvas);
    return canvases;
  }

  async function prepareImageFile(file, settings, item, counters) {
    const sourceCanvases = await imageFileToCanvases(file);
    const pages = [];
    for (let index = 0; index < sourceCanvases.length; index += 1) {
      item.statusText = `Preparando quadro ${index + 1}/${sourceCanvases.length}`;
      renderQueue();
      setProgress(`Preparando ${file.name}`, 5 + 36 * ((index + 1) / sourceCanvases.length), `Imagem ${index + 1} de ${sourceCanvases.length}`);
      await nextFrame();
      const canvas = sourceCanvases[index];
      await collectPreparedPage(canvas, settings, pages, counters);
      canvas.width = 1; canvas.height = 1;
    }
    return pages;
  }

  async function makeUniformPages(pages, item, fileName) {
    if (!pages.length) throw new Error('Nenhuma página foi gerada a partir deste arquivo.');
    const width = Math.max(...pages.map((page) => page.width));
    const height = Math.max(...pages.map((page) => page.height));
    const result = [];
    for (let index = 0; index < pages.length; index += 1) {
      const page = pages[index];
      if (page.width === width && page.height === height) {
        result.push(page);
      } else {
        const bitmap = await createImageBitmap(page.blob);
        const canvas = newCanvas(width, height);
        const ctx = canvas.getContext('2d', { alpha: false });
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, width, height);
        const x = Math.floor((width - page.width) / 2);
        const y = Math.floor((height - page.height) / 2);
        ctx.drawImage(bitmap, x, y);
        bitmap.close?.();
        const blob = await canvasToBlob(canvas);
        canvas.width = 1; canvas.height = 1;
        result.push({ blob, width, height, reliable: page.reliable });
      }
      if (index % 3 === 0) {
        item.statusText = `Padronizando páginas ${index + 1}/${pages.length}`;
        renderQueue();
        setProgress(`Preparando ${fileName}`, 42 + 5 * ((index + 1) / pages.length), 'Centralizando as páginas e preservando margens de segurança.');
        await nextFrame();
      }
    }
    return result;
  }

  function extractOcrWords(data) {
    if (Array.isArray(data?.words) && data.words.length) return data.words;
    const words = [];
    for (const block of data?.blocks || []) {
      for (const paragraph of block.paragraphs || []) {
        for (const line of paragraph.lines || []) {
          words.push(...(line.words || []));
        }
      }
    }
    return words;
  }

  async function addInvisibleText(page, pageHeight, scale, words, font, color) {
    for (const word of words || []) {
      const text = String(word.text || '').trim();
      const box = word.bbox;
      if (!text || !box || !Number.isFinite(box.x0) || !Number.isFinite(box.y1)) continue;
      if (word.confidence !== undefined && word.confidence < 0) continue;
      const boxHeight = Math.max(1, box.y1 - box.y0);
      const size = Math.max(3, Math.min(32, boxHeight * scale * 0.88));
      const x = Math.max(0, box.x0 * scale);
      const y = Math.max(0, pageHeight - box.y1 * scale + size * 0.12);
      try {
        page.drawText(`${text} `, { x, y, size, font, color, opacity: 0, lineHeight: size, characterSpacing: 0 });
      } catch (_error) {
        // Um glifo fora do conjunto da fonte padrão não deve impedir a exportação da página.
      }
    }
  }

  async function createSearchablePdf(pages, settings, item, fileName, worker) {
    const PDFDocument = PDFLib.PDFDocument;
    const StandardFonts = PDFLib.StandardFonts;
    const rgb = PDFLib.rgb;
    const pdf = await PDFDocument.create();
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    const textColor = rgb(0, 0, 0);
    const scale = 72 / settings.dpi;
    let pagesWithoutText = 0;

    for (let index = 0; index < pages.length; index += 1) {
      item.statusText = `OCR: página ${index + 1}/${pages.length}`;
      renderQueue();
      setProgress(`Reconhecendo texto em ${fileName}`, 48 + 49 * (index / pages.length), `OCR em ${settings.language.replace('+', ' + ')} · página ${index + 1} de ${pages.length}`);
      await nextFrame();
      const pageImage = pages[index];
      let recognized;
      try {
        state.ocrPageIndex = index;
      state.ocrPageCount = pages.length;
      recognized = await worker.recognize(pageImage.blob, {}, { text: true, blocks: true });
      } catch (error) {
        throw new Error(`Falha no OCR da página ${index + 1}: ${error.message || error}`);
      }
      const imageBytes = new Uint8Array(await pageImage.blob.arrayBuffer());
      const embedded = await pdf.embedPng(imageBytes);
      const pageWidth = pageImage.width * scale;
      const pageHeight = pageImage.height * scale;
      const pdfPage = pdf.addPage([pageWidth, pageHeight]);
      pdfPage.drawImage(embedded, { x: 0, y: 0, width: pageWidth, height: pageHeight });
      const words = extractOcrWords(recognized?.data); 
      if (words.length) {
        await addInvisibleText(pdfPage, pageHeight, scale, words, font, textColor);
      } else {
        pagesWithoutText += 1;
      }
      pageImage.blob = null;
      if (index % 2 === 0) await nextFrame();
    }
    const bytes = await pdf.save({ useObjectStreams: true });
    return { bytes, pages: pages.length, pagesWithoutText };
  }

  async function processSingleFile(item, settings, worker, overallIndex, totalFiles) {
    const ext = extensionOf(item.name);
    const counters = { splitPairs: 0, preserved: 0 };
    item.status = 'working';
    item.statusText = 'Lendo arquivo…';
    renderQueue();
    setProgress(`Abrindo ${item.name}`, 2 + (overallIndex / totalFiles) * 96, 'A leitura e o processamento acontecem neste navegador.');
    await nextFrame();

    const prepared = ext === 'pdf'
      ? await preparePdfFile(item.file, settings, item, counters)
      : await prepareImageFile(item.file, settings, item, counters);
    if (!prepared.length) throw new Error('O arquivo não contém páginas ou quadros legíveis.');
    const uniform = await makeUniformPages(prepared, item, item.name);
    // Descarta a lista temporária antes do OCR; as imagens mantidas são blobs comprimidos.
    prepared.length = 0;
    const created = await createSearchablePdf(uniform, settings, item, item.name, worker);
    const outputStem = item.name.replace(/\.[^.]+$/, '');
    let outputName = `${outputStem}-negar.pdf`;
    let duplicateIndex = 2;
    while (state.outputs.some((output) => output.name === outputName)) {
      outputName = `${outputStem} (${duplicateIndex})-negar.pdf`;
      duplicateIndex += 1;
    }
    return {
      name: outputName,
      bytes: created.bytes,
      pages: created.pages,
      pagesWithoutText: created.pagesWithoutText,
      preserved: counters.preserved,
      splitPairs: counters.splitPairs,
      originalName: item.name
    };
  }

  async function ensureDependencies() {
    const missing = [];
    if (!window.pdfjsLib) missing.push('PDF.js');
    if (!window.PDFLib) missing.push('pdf-lib');
    if (!window.Tesseract) missing.push('Tesseract.js');
    if (!window.JSZip) missing.push('JSZip');
    if (!window.UTIF) missing.push('UTIF');
    if (missing.length) throw new Error(`Não foi possível carregar: ${missing.join(', ')}. Confira sua conexão e recarregue a página.`);
  }

  async function processQueue() {
    if (state.busy || !state.files.length) return;
    try {
      await ensureDependencies();
    } catch (error) {
      showNotice(error.message, 'error');
      return;
    }

    state.busy = true;
    state.outputs = [];
    renderOutputs();
    renderQueue();
    showNotice('');
    const settings = settingsFromUi();
    let worker = null;
    let failures = 0;
    const jobs = [...state.files];

    try {
      setProgress('Carregando OCR…', 1, 'Na primeira utilização, o mecanismo de OCR e os dados de idioma precisam ser carregados.');
      await nextFrame();
      const workerLanguages = settings.language.includes('+') ? settings.language.split('+') : settings.language;
      worker = await Tesseract.createWorker(workerLanguages, 1, {
        logger: (message) => {
          if (message.status === 'recognizing text' && Number.isFinite(message.progress)) {
            const withinDocument = (state.ocrPageIndex + Math.max(0, Math.min(1, message.progress))) / Math.max(1, state.ocrPageCount);
            const pct = 48 + 49 * withinDocument;
            setProgress('Reconhecendo texto…', pct, `OCR em andamento · ${Math.round(message.progress * 100)}% da página atual`);
          } else if (message.status && /loading|initializ|download/i.test(message.status)) {
            setProgress('Carregando OCR…', 3, 'Carregando o mecanismo e o idioma selecionado.');
          }
        }
      });
      // Equivale aos parâmetros usados no Tesseract do script Python: --psm 3 --dpi N.
      await worker.setParameters({ tessedit_pageseg_mode: '3', user_defined_dpi: String(settings.dpi) });
      state.worker = worker;

      for (let index = 0; index < jobs.length; index += 1) {
        const item = jobs[index];
        try {
          const output = await processSingleFile(item, settings, worker, index, jobs.length);
          state.outputs.push(output);
          item.status = 'done';
          item.statusText = `Concluído · ${output.pages} páginas`;
          item.pages = output.pages;
          item.outputIndex = state.outputs.length - 1;
          renderOutputs();
        } catch (error) {
          failures += 1;
          item.status = 'error';
          item.statusText = error?.message || 'Falha desconhecida';
        }
        renderQueue();
        await nextFrame();
      }
    } catch (error) {
      failures += 1;
      showNotice(error?.message || 'Ocorreu um erro ao iniciar o OCR.', 'error');
    } finally {
      if (worker) {
        try { await worker.terminate(); } catch (_error) { /* limpeza */ }
      }
      state.worker = null;
      state.busy = false;
      renderQueue();
      renderOutputs();
      if (state.outputs.length) {
        setProgress('Processamento concluído', 100, `${state.outputs.length} arquivo(s) pronto(s). Os documentos originais não foram alterados.`);
        if (failures) showNotice(`${state.outputs.length} arquivo(s) concluído(s); ${failures} arquivo(s) falharam. Confira as mensagens na fila.`, 'error');
        else showNotice('Tudo pronto. Os PDFs gerados estão disponíveis para baixar.', 'success');
      } else {
        hideProgress();
        if (!els.notice.textContent) showNotice('Nenhum PDF foi gerado. Veja os erros indicados na fila.', 'error');
      }
    }
  }

  function downloadBytes(output) {
    const blob = new Blob([output.bytes], { type: 'application/pdf' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = output.name;
    anchor.style.display = 'none';
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  }

  async function downloadAllAsZip() {
    if (state.busy || state.outputs.length < 2) return;
    if (!window.JSZip) {
      showNotice('A biblioteca ZIP não carregou. Baixe os PDFs individualmente.', 'error');
      return;
    }
    els.downloadZip.disabled = true;
    els.downloadZip.textContent = 'Preparando ZIP…';
    try {
      const zip = new JSZip();
      for (const output of state.outputs) zip.file(output.name, output.bytes);
      const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 4 } });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = 'documentos-negar.zip';
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      setTimeout(() => URL.revokeObjectURL(url), 30000);
    } catch (error) {
      showNotice(`Não foi possível criar o ZIP: ${error.message || error}`, 'error');
    } finally {
      els.downloadZip.disabled = false;
      els.downloadZip.textContent = 'Baixar tudo (.zip)';
    }
  }

  els.browseButton.addEventListener('click', (event) => {
    event.stopPropagation();
    if (!state.busy) els.fileInput.click();
  });
  els.dropZone.addEventListener('click', (event) => {
    if (event.target.closest('button')) return;
    if (!state.busy) els.fileInput.click();
  });
  els.dropZone.addEventListener('keydown', (event) => {
    if ((event.key === 'Enter' || event.key === ' ') && !state.busy) {
      event.preventDefault();
      els.fileInput.click();
    }
  });
  els.fileInput.addEventListener('change', () => addFiles(els.fileInput.files));
  ['dragenter', 'dragover'].forEach((type) => els.dropZone.addEventListener(type, (event) => {
    event.preventDefault();
    if (!state.busy) els.dropZone.classList.add('dragover');
  }));
  ['dragleave', 'drop'].forEach((type) => els.dropZone.addEventListener(type, (event) => {
    event.preventDefault();
    els.dropZone.classList.remove('dragover');
  }));
  els.dropZone.addEventListener('drop', (event) => {
    if (!state.busy) addFiles(event.dataTransfer?.files);
  });
  els.clearButton.addEventListener('click', () => {
    if (state.busy) return;
    state.files = [];
    state.outputs = [];
    renderQueue();
    renderOutputs();
    hideProgress();
    showNotice('');
  });
  els.fileList.addEventListener('click', (event) => {
    const button = event.target.closest('[data-remove]');
    if (button) removeFile(Number(button.dataset.remove));
  });
  els.resultsList.addEventListener('click', (event) => {
    const button = event.target.closest('[data-download]');
    if (button) {
      const output = state.outputs[Number(button.dataset.download)];
      if (output) downloadBytes(output);
    }
  });
  els.downloadZip.addEventListener('click', downloadAllAsZip);
  els.processButton.addEventListener('click', processQueue);
  [els.dpi, els.cutPosition, els.margin, els.cutMode, els.splitPages, els.cropMargins].forEach((control) => {
    control.addEventListener('input', refreshOptionLabels);
    control.addEventListener('change', refreshOptionLabels);
  });

  refreshOptionLabels();
  renderQueue();
  renderOutputs();
})();
