import tesseract from 'node-tesseract-ocr';
import { execFile } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import fs from 'fs';
import logger from '../lib/logger';

const execFileAsync = promisify(execFile);

/**
 * Check if ImageMagick `convert` (or `magick`) is available on the system.
 * Used for optional advanced preprocessing on bad scans.
 */
let _imageMagickBinary: string | null | undefined; // undefined = unchecked
async function getImageMagickBinary(): Promise<string | null> {
  if (_imageMagickBinary !== undefined) return _imageMagickBinary;

  for (const bin of ['magick', 'convert']) {
    try {
      await execFileAsync(bin, ['--version']);
      _imageMagickBinary = bin;
      logger.info({ event: 'imagemagick_found', binary: bin });
      return bin;
    } catch {
      // not available
    }
  }
  _imageMagickBinary = null;
  logger.info({ event: 'imagemagick_not_found', note: 'OCR will still work but without advanced preprocessing' });
  return null;
}

/**
 * Convert PDF pages to PNG images at 300 DPI using Poppler's pdftoppm.
 * 300 DPI is the sweet spot for Tesseract — higher wastes time, lower loses accuracy.
 */
async function convertPdfToImages(filePath: string, outputDir: string): Promise<string[]> {
  await execFileAsync('pdftoppm', [
    '-png',
    '-r', '300',
    filePath,
    path.join(outputDir, 'page'),
  ]);

  return fs
    .readdirSync(outputDir)
    .filter((f) => f.endsWith('.png'))
    .sort() // pages must be in order
    .map((f) => path.join(outputDir, f));
}

/**
 * Preprocess images with ImageMagick for better OCR on bad scans.
 * Applies: normalize contrast → sharpen → convert to grayscale → threshold to B&W.
 * Leptonica (built into Tesseract) handles basic binarization, but ImageMagick
 * can rescue images that are too faded/noisy for Leptonica alone.
 *
 * Returns paths to preprocessed images (or originals if ImageMagick unavailable).
 */
async function preprocessImages(imagePaths: string[], outputDir: string): Promise<string[]> {
  const magickBin = await getImageMagickBinary();
  if (!magickBin) return imagePaths; // skip preprocessing, Tesseract/Leptonica will do its best

  const preprocessedDir = path.join(outputDir, 'preprocessed');
  fs.mkdirSync(preprocessedDir, { recursive: true });

  const preprocessed: string[] = [];

  for (const imgPath of imagePaths) {
    const outPath = path.join(preprocessedDir, path.basename(imgPath));
    try {
      const args = magickBin === 'magick'
        ? ['convert', imgPath] // ImageMagick 7 uses `magick convert`
        : [imgPath];           // ImageMagick 6 uses `convert` directly

      await execFileAsync(magickBin, [
        ...args,
        '-normalize',               // Stretch contrast to full range
        '-sharpen', '0x1',          // Mild sharpen to crisp up text edges
        '-colorspace', 'Gray',      // Convert to grayscale
        '-threshold', '60%',        // Binarize — Leptonica's Otsu can be too conservative on faded scans
        '-density', '300',          // Maintain 300 DPI metadata
        outPath,
      ]);
      preprocessed.push(outPath);
    } catch (err) {
      // If preprocessing fails for one page, use original
      logger.warn({ event: 'imagemagick_preprocess_failed', page: path.basename(imgPath), error: String(err) });
      preprocessed.push(imgPath);
    }
  }

  logger.info({ event: 'images_preprocessed', pageCount: preprocessed.length });
  return preprocessed;
}

/**
 * Run Tesseract OCR on images with Leptonica-optimized settings.
 *
 * Key Tesseract/Leptonica flags:
 * - oem 3: LSTM neural net engine (most accurate in Tesseract 5)
 * - psm 6: Assume a single uniform block of text (best for full-page contract scans)
 * - dpi 300: Tell Tesseract the image resolution so Leptonica skips its own (often wrong) DPI detection
 *
 * Leptonica preprocessing (built into Tesseract, always active):
 * - Otsu adaptive thresholding (binarization)
 * - Connected-component noise removal
 * - Deskewing (straightens rotated scans)
 */
async function ocrImages(imagePaths: string[]): Promise<string> {
  const pageTexts: string[] = [];

  // Process pages sequentially to avoid slamming CPU on large contracts
  for (let i = 0; i < imagePaths.length; i++) {
    const text = await tesseract.recognize(imagePaths[i], {
      lang: 'eng',
      oem: 3,   // LSTM neural net — most accurate engine in Tesseract 5
      psm: 6,   // Assume a single uniform block of text
      dpi: 300,  // Explicit DPI so Leptonica doesn't guess wrong
      tessedit_char_whitelist: '', // empty = allow all characters
    });
    pageTexts.push(text);

    if ((i + 1) % 5 === 0) {
      logger.info({ event: 'ocr_page_progress', page: i + 1, total: imagePaths.length });
    }
  }

  return pageTexts.join('\n\n--- PAGE BREAK ---\n\n');
}

/**
 * Full OCR pipeline: PDF → images → preprocess → Tesseract+Leptonica → text
 *
 * Pipeline:
 * 1. pdftoppm converts PDF pages to 300 DPI PNGs
 * 2. ImageMagick (if available) normalizes/sharpens/binarizes for bad scans
 * 3. Tesseract 5 + Leptonica runs OCR with LSTM engine
 * 4. Leptonica handles deskewing, adaptive thresholding, noise removal internally
 */
export async function extractTextWithOCR(pdfFilePath: string): Promise<string> {
  const tempDir = fs.mkdtempSync('/tmp/snf-ocr-');
  logger.info({ event: 'ocr_start', file: path.basename(pdfFilePath) });

  try {
    // Step 1: PDF → PNG at 300 DPI
    const rawImages = await convertPdfToImages(pdfFilePath, tempDir);
    logger.info({ event: 'ocr_pages_converted', pageCount: rawImages.length });

    // Step 2: ImageMagick preprocessing (normalize, sharpen, binarize)
    // Falls back to raw images if ImageMagick is not installed
    const processedImages = await preprocessImages(rawImages, tempDir);

    // Step 3: Tesseract + Leptonica OCR
    const text = await ocrImages(processedImages);
    logger.info({ event: 'ocr_complete', chars: text.length, pages: rawImages.length });

    return text;
  } finally {
    // Always clean up temp images, even on error
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}
