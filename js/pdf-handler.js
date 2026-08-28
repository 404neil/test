/**
 * pdf-handler.js
 * Loads a PDF with pdf.js, renders page thumbnails for selection, and
 * extracts text (with OCR fallback via Tesseract.js) and images from
 * chosen pages.
 */

pdfjsLib.GlobalWorkerOptions.workerSrc =
  'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

const MAX_PAGES_SELECTABLE = 10;

class PdfHandler {
  constructor() {
    this.pdfDoc = null;
    this.selectedPages = new Set(); // 1-indexed page numbers
  }

  async loadFile(file) {
    const arrayBuffer = await file.arrayBuffer();
    this.pdfDoc = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    this.selectedPages.clear();
    return this.pdfDoc.numPages;
  }

  /** Render a thumbnail canvas for the given 1-indexed page number. */
  async renderThumbnail(pageNum, canvas) {
    const page = await this.pdfDoc.getPage(pageNum);
    const viewport = page.getViewport({ scale: 1 });
    const scale = 140 / viewport.width;
    const scaledViewport = page.getViewport({ scale });
    canvas.width = scaledViewport.width;
    canvas.height = scaledViewport.height;
    const ctx = canvas.getContext('2d');
    await page.render({ canvasContext: ctx, viewport: scaledViewport }).promise;
  }

  toggleSelection(pageNum) {
    if (this.selectedPages.has(pageNum)) {
      this.selectedPages.delete(pageNum);
      return true;
    }
    if (this.selectedPages.size >= MAX_PAGES_SELECTABLE) {
      return false; // at limit, selection refused
    }
    this.selectedPages.add(pageNum);
    return true;
  }

  getSelectedPagesSorted() {
    return Array.from(this.selectedPages).sort((a, b) => a - b);
  }

  /**
   * Extract text for a page. Falls back to OCR (Tesseract.js) if the page
   * has little or no embedded text (i.e. it's a scanned image).
   */
  async extractPageText(pageNum, { onOcrStart } = {}) {
    const page = await this.pdfDoc.getPage(pageNum);
    const textContent = await page.getTextContent();
    const rawText = textContent.items.map(item => item.str).join(' ').trim();

    if (rawText.length > 20) {
      return { text: rawText, ocr: false };
    }

    // Likely a scanned page — rasterize and OCR it.
    if (onOcrStart) onOcrStart(pageNum);
    const viewport = page.getViewport({ scale: 2 });
    const canvas = document.createElement('canvas');
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;

    const { data } = await Tesseract.recognize(canvas, 'eng');
    return { text: data.text.trim(), ocr: true };
  }

  /**
   * Extract embedded raster images from a page as PNG data URLs.
   * Best-effort: pdf.js exposes images via the page's operator list.
   */
  async extractPageImages(pageNum) {
    const page = await this.pdfDoc.getPage(pageNum);
    const ops = await page.getOperatorList();
    const images = [];

    for (let i = 0; i < ops.fnArray.length; i++) {
      const fn = ops.fnArray[i];
      if (fn === pdfjsLib.OPS.paintImageXObject) {
        const imgName = ops.argsArray[i][0];
        try {
          const img = await new Promise((resolve, reject) => {
            page.objs.get(imgName, resolve);
          });
          if (img && img.width > 40 && img.height > 40) {
            const canvas = document.createElement('canvas');
            canvas.width = img.width;
            canvas.height = img.height;
            const ctx = canvas.getContext('2d');
            const imageData = ctx.createImageData(img.width, img.height);

            // pdf.js image objects may be RGB or RGBA depending on version.
            const srcData = img.data;
            if (srcData.length === img.width * img.height * 4) {
              imageData.data.set(srcData);
            } else if (srcData.length === img.width * img.height * 3) {
              for (let p = 0, s = 0; p < imageData.data.length; p += 4, s += 3) {
                imageData.data[p] = srcData[s];
                imageData.data[p + 1] = srcData[s + 1];
                imageData.data[p + 2] = srcData[s + 2];
                imageData.data[p + 3] = 255;
              }
            } else {
              continue;
            }
            ctx.putImageData(imageData, 0, 0);
            images.push(canvas.toDataURL('image/png'));
          }
        } catch (e) {
          // Skip images pdf.js can't resolve synchronously — non-fatal.
          console.warn('Could not extract image on page', pageNum, e);
        }
      }
    }
    return images;
  }
}

window.PdfHandler = PdfHandler;
window.MAX_PAGES_SELECTABLE = MAX_PAGES_SELECTABLE;
