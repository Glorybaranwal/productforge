/**
 * RFC 4180 CSV cells. Quotes when needed, and neutralises spreadsheet formulas: a cell starting
 * with = + - @ or a tab/CR is prefixed with ' so text can't run as a formula if the file is
 * opened in Excel or Sheets before it's imported anywhere.
 */
export function csvCell(value: string | number | null | undefined): string {
  let text = value === null || value === undefined ? "" : String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export const csvRow = (cells: (string | number | null | undefined)[]) =>
  cells.map(csvCell).join(",");

/** Rows joined with CRLF and a trailing line break, as RFC 4180 and Jira's importer expect. */
export const csvFile = (rows: string[]) => `${rows.join("\r\n")}\r\n`;
