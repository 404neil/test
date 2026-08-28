/**
 * pdf-builder.js
 * Builds a new, reflowed output PDF from translated text plus any images
 * extracted from the original pages. Uses pdf-lib + fontkit so Indic
 * scripts render correctly (the default PDF fonts only cover Latin text).
 *
 * IMPORTANT: this needs an actual Noto Sans font file for whichever
 * script you're targeting, self-hosted in this repo under /fonts/.
 * See README.md for the one-time download step — don't skip it, or
 * Indic-script text will render as blank boxes.
 */

const { PDFDocument, rgb, StandardFonts } = PDFLib;

// Map target language code -> local font file (place these in /fonts/).
const FONT_FILES = {
  'hi-IN': 'fonts/NotoSansDevanagari-Regular.ttf',
  'mr-IN': 'fonts/NotoSansDevanagari-Regular.ttf',
  'bn-IN': 'fonts/NotoSansBengali-Regular.ttf',
  'ta-IN': 'fonts/NotoSansTamil-Regular.ttf',
  'te-IN': 'fonts/NotoSansTelugu-Regular.ttf',
  'gu-IN': 'fonts/NotoSansGujarati-Regular.ttf',
  'kn-IN': 'fonts/NotoSansKannada-Regular.ttf',
  'ml-IN': 'fonts/NotoSansMalayalam-Regular.ttf',
  'pa-IN': 'fonts/NotoSansGurmukhi-Regular.ttf',
  'od-IN': 'fonts/NotoSansOriya-Regular.ttf',
};

let fontkitRegistered = false;

async function loadFontBytesFor(languageCode) {
  const path = FONT_FILES[languageCode];
  if (!path) return null; // no translation / English -> standard font is fine
  const res = await fetch(path);
  if (!res.ok) {
    throw new Error(
      `Missing font file for ${languageCode} at ${path}. ` +
      `Download the matching Noto Sans font and add it to /fonts/ (see README.md).`
    );
  }
  return res.arrayBuffer();
}

function wrapText(text, font, fontSize, maxWidth) {
  const words = text.split(/\s+/);
  const lines = [];
  let line = '';
  for (const word of words) {
    const trial = line ? `${line} ${word}` : word;
    if (font.widthOfTextAtSize(trial, fontSize) > maxWidth && line) {
      lines.push(line);
      line = word;
    } else {
      line = trial;
    }
  }
  if (line) lines.push(line);
  return lines;
}

/**
 * Build a reflowed PDF containing the translated text followed by any
 * extracted images, grouped in a "Figures & Tables" section.
 * @param {string} bodyText - translated (or original) page text
 * @param {string[]} imageDataUrls - PNG data URLs extracted from source pages
 * @param {string} targetLanguageCode - '' for no translation / Latin script
 * @returns {Promise<Uint8Array>} the finished PDF's bytes
 */
async function buildOutputPdf(bodyText, imageDataUrls, targetLanguageCode) {
  const pdfDoc = await PDFDocument.create();

  if (!fontkitRegistered && window.fontkit) {
    pdfDoc.registerFontkit(window.fontkit);
    fontkitRegistered = true;
  }

  let font;
  const fontBytes = await loadFontBytesFor(targetLanguageCode);
  if (fontBytes) {
    font = await pdfDoc.embedFont(fontBytes, { subset: true });
  } else {
    font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  }

  const pageWidth = 595.28; // A4 points
  const pageHeight = 841.89;
  const margin = 56;
  const fontSize = 12;
  const lineHeight = fontSize * 1.5;
  const maxWidth = pageWidth - margin * 2;

  const lines = wrapText(bodyText, font, fontSize, maxWidth);

  let page = pdfDoc.addPage([pageWidth, pageHeight]);
  let y = pageHeight - margin;

  for (const line of lines) {
    if (y < margin + lineHeight) {
      page = pdfDoc.addPage([pageWidth, pageHeight]);
      y = pageHeight - margin;
    }
    page.drawText(line, { x: margin, y, size: fontSize, font, color: rgb(0.1, 0.1, 0.1) });
    y -= lineHeight;
  }

  // Figures & Tables section (images extracted from the original pages).
  if (imageDataUrls.length) {
    page = pdfDoc.addPage([pageWidth, pageHeight]);
    y = pageHeight - margin;
    page.drawText('Figures & Tables (from original)', {
      x: margin, y, size: 14, font, color: rgb(0.1, 0.1, 0.1),
    });
    y -= lineHeight * 2;

    for (const dataUrl of imageDataUrls) {
      const pngBytes = await (await fetch(dataUrl)).arrayBuffer();
      const image = await pdfDoc.embedPng(pngBytes);
      const scale = Math.min(maxWidth / image.width, 320 / image.height, 1);
      const w = image.width * scale;
      const h = image.height * scale;

      if (y - h < margin) {
        page = pdfDoc.addPage([pageWidth, pageHeight]);
        y = pageHeight - margin;
      }
      page.drawImage(image, { x: margin, y: y - h, width: w, height: h });
      y -= h + 24;
    }
  }

  return pdfDoc.save();
}

window.PdfBuilder = { buildOutputPdf };
