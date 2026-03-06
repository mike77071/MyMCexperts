import tesseract from 'node-tesseract-ocr';
import { execFile } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import fs from 'fs';
import logger from '../lib/logger';

const execFileAsync = promisify(execFile);

async function convertPdfToImages(filePath: string, outputDir: string): Promise<string[]> {
  // Convert each PDF page to PNG at 300 DPI for best OCR accuracy
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

async function ocrImages(imagePaths: string[]): Promise<string> {
  const pageTexts = await Promise.all(
    imagePaths.map((imgPath) =>
      tesseract.recognize(imgPath, {
        lang: 'eng',
        oem: 3,  // LSTM neural net — most accurate engine in Tesseract 5
        psm: 6,  // Assume a single uniform block of text
      })
    )
  );
  return pageTexts.join('\n\n--- PAGE BREAK ---\n\n');
}

export async function extractTextWithOCR(pdfFilePath: string): Promise<string> {
  const tempDir = fs.mkdtempSync('/tmp/snf-ocr-');
  logger.info({ event: 'ocr_start', file: path.basename(pdfFilePath) });

  try {
    const imagePaths = await convertPdfToImages(pdfFilePath, tempDir);
    logger.info({ event: 'ocr_pages_converted', pageCount: imagePaths.length });

    const text = await ocrImages(imagePaths);
    logger.info({ event: 'ocr_complete', chars: text.length });

    return text;
  } finally {
    // Always clean up temp images, even on error
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}
