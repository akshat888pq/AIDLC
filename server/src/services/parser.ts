import fs from 'fs/promises';
import path from 'path';
import pdfParse from 'pdf-parse';
import mammoth from 'mammoth';
import * as XLSX from 'xlsx';

export async function parseFile(filePath: string, mimeType: string): Promise<string> {
  const ext = path.extname(filePath).toLowerCase();

  switch (ext) {
    case '.pdf':
      return parsePdf(filePath);
    case '.docx':
      return parseDocx(filePath);
    case '.xlsx':
    case '.xls':
    case '.csv':
      return parseSpreadsheet(filePath);
    case '.md':
    case '.txt':
    case '.markdown':
      return parseText(filePath);
    default:
      if (mimeType.startsWith('text/')) {
        return parseText(filePath);
      }
      throw new Error(`Unsupported file type: ${ext}`);
  }
}

async function parsePdf(filePath: string): Promise<string> {
  const buffer = await fs.readFile(filePath);
  const data = await pdfParse(buffer);
  return data.text;
}

async function parseDocx(filePath: string): Promise<string> {
  const buffer = await fs.readFile(filePath);
  const result = await mammoth.extractRawText({ buffer });
  return result.value;
}

function parseSpreadsheet(filePath: string): string {
  const workbook = XLSX.readFile(filePath);
  const lines: string[] = [];

  for (const sheetName of workbook.SheetNames) {
    lines.push(`\n--- Sheet: ${sheetName} ---\n`);
    const sheet = workbook.Sheets[sheetName];
    const csv = XLSX.utils.sheet_to_csv(sheet);
    lines.push(csv);
  }

  return lines.join('\n');
}

async function parseText(filePath: string): Promise<string> {
  return fs.readFile(filePath, 'utf-8');
}
