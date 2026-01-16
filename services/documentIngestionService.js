// services/documentIngestionService.js

const path = require('path');

class DocumentIngestionService {
  static MAX_TEXT_CHARS = 200_000;

  static _cap(text) {
    if (!text) return '';
    const normalized = String(text).replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    return normalized.length > this.MAX_TEXT_CHARS
      ? normalized.slice(0, this.MAX_TEXT_CHARS)
      : normalized;
  }

  static async extractTextFromUpload({ buffer, originalName, mimeType }) {
    const ext = path.extname(originalName || '').toLowerCase();
    const safeMime = (mimeType || '').toLowerCase();

    if (!buffer || !Buffer.isBuffer(buffer)) {
      return { text: '', method: 'none' };
    }

    // PDF
    if (safeMime.includes('pdf') || ext === '.pdf') {
      const pdfParse = require('pdf-parse');
      const data = await pdfParse(buffer);
      return { text: this._cap(data?.text || ''), method: 'pdf-parse' };
    }

    // Plain text
    if (safeMime.startsWith('text/') || ext === '.txt' || ext === '.csv') {
      return { text: this._cap(buffer.toString('utf8')), method: 'utf8' };
    }

    // Excel
    if (
      safeMime.includes('spreadsheet') ||
      safeMime.includes('excel') ||
      ext === '.xlsx' ||
      ext === '.xls'
    ) {
      const xlsx = require('xlsx');
      const workbook = xlsx.read(buffer, { type: 'buffer' });
      const sheetName = workbook.SheetNames?.[0];
      const sheet = sheetName ? workbook.Sheets[sheetName] : null;
      const csv = sheet ? xlsx.utils.sheet_to_csv(sheet) : '';
      return { text: this._cap(csv), method: 'xlsx' };
    }

    // Fallback: try UTF-8
    return { text: this._cap(buffer.toString('utf8')), method: 'utf8-fallback' };
  }
}

module.exports = DocumentIngestionService;

