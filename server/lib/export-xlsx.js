import ExcelJS from 'exceljs';

const MONEY_FORMAT = '#,##0.00';
const PERCENT_FORMAT = '0.00"%"';
const INTEGER_FORMAT = '#,##0';
const HEADER_FILL = '1F3A4D';
const HEADER_TEXT = 'FFFFFFFF';
const TOTAL_FILL = 'E8EEF3';
const ALT_FILL = 'F7F9FA';

function safeSheetName(name, fallback = 'Sheet') {
  const cleaned = String(name || '')
    .replace(/[\\/?*[\]:]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 31);
  return cleaned || fallback;
}

function excelValue(column, value) {
  if (value === null || value === undefined) return null;
  if (column.type === 'money' || column.type === 'percent') {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric / 100 : null;
  }
  if (column.type === 'integer') {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : null;
  }
  return String(value);
}

function totalValue(column, totals, index) {
  if (index === 0 && totals[column.key] === undefined) return 'Total';
  return excelValue(column, totals[column.key]);
}

function applyColumnFormats(sheet, columns) {
  columns.forEach((column, index) => {
    const target = sheet.getColumn(index + 1);
    if (column.type === 'money') target.numFmt = MONEY_FORMAT;
    if (column.type === 'percent') target.numFmt = PERCENT_FORMAT;
    if (column.type === 'integer') target.numFmt = INTEGER_FORMAT;
  });
}

function addSummarySheet(workbook, report) {
  const sheet = workbook.addWorksheet('Summary', {
    properties: { defaultRowHeight: 18 },
    views: [{ showGridLines: false }],
  });
  sheet.columns = [{ width: 34 }, { width: 88 }];

  const title = sheet.addRow([report.shopName]);
  title.font = { bold: true, size: 18, color: { argb: 'FF1F3A4D' } };
  title.height = 26;
  sheet.mergeCells(title.number, 1, title.number, 2);

  const reportTitle = sheet.addRow([report.title]);
  reportTitle.font = { bold: true, size: 13, color: { argb: 'FF23313C' } };
  sheet.mergeCells(reportTitle.number, 1, reportTitle.number, 2);

  const subtitle = sheet.addRow([report.subtitle]);
  subtitle.font = { size: 10, color: { argb: 'FF5E6A72' } };
  subtitle.alignment = { wrapText: true, vertical: 'top' };
  subtitle.height = 30;
  sheet.mergeCells(subtitle.number, 1, subtitle.number, 2);

  sheet.addRow([]);
  const generated = sheet.addRow(['Generated', report.generatedAtDisplay]);
  generated.getCell(1).font = { bold: true };
  generated.getCell(2).alignment = { wrapText: true };
  const timezone = sheet.addRow(['Shop timezone', report.timezone]);
  timezone.getCell(1).font = { bold: true };

  sheet.addRow([]);
  const filtersHeading = sheet.addRow(['Filters']);
  filtersHeading.font = { bold: true, size: 11, color: { argb: 'FF1F3A4D' } };
  for (const filter of report.filterLabels) {
    const row = sheet.addRow(['', filter]);
    row.getCell(2).alignment = { wrapText: true };
  }

  sheet.addRow([]);
  const metricsHeading = sheet.addRow(['Metric', 'Value']);
  metricsHeading.font = { bold: true, color: { argb: HEADER_TEXT } };
  metricsHeading.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${HEADER_FILL}` } };
  metricsHeading.height = 22;
  for (const item of report.summary) {
    const row = sheet.addRow([item.label, item.value]);
    row.getCell(1).font = { bold: true };
    row.getCell(2).alignment = { wrapText: true };
    row.height = 20;
    row.eachCell((cell) => {
      cell.border = { bottom: { style: 'hair', color: { argb: 'FFD8DEE4' } } };
    });
  }

  if (report.notes.length) {
    sheet.addRow([]);
    const notesHeading = sheet.addRow(['Notes']);
    notesHeading.font = { bold: true, size: 11, color: { argb: 'FF1F3A4D' } };
    for (const note of report.notes) {
      const row = sheet.addRow(['', note]);
      row.getCell(2).alignment = { wrapText: true, vertical: 'top' };
      row.height = 30;
    }
  }

  const footer = sheet.addRow(['', `Rows exported: ${report.rowCount}`]);
  footer.getCell(2).font = { italic: true, color: { argb: 'FF6B7780' } };
  sheet.views = [{ showGridLines: false }];
}

function addDataSheet(workbook, report, exportSheet) {
  const sheet = workbook.addWorksheet(safeSheetName(exportSheet.name), {
    views: [{ state: 'frozen', ySplit: 1, showGridLines: false }],
    pageSetup: {
      orientation: 'landscape',
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0,
      paperSize: 9,
      margins: { left: 0.25, right: 0.25, top: 0.4, bottom: 0.4, header: 0.2, footer: 0.2 },
    },
    headerFooter: {
      oddFooter: `&L${report.shopName} - ${report.title}&RPage &P of &N`,
    },
    properties: { defaultRowHeight: 18 },
  });
  sheet.columns = exportSheet.columns.map((column) => ({
    header: column.header,
    key: column.key,
    width: column.width || 14,
  }));

  const header = sheet.getRow(1);
  header.height = 30;
  header.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: HEADER_TEXT }, size: 9 };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${HEADER_FILL}` } };
    cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
    cell.border = {
      bottom: { style: 'thin', color: { argb: 'FF102733' } },
    };
  });

  if (exportSheet.rows.length) {
    sheet.autoFilter = {
      from: { row: 1, column: 1 },
      to: { row: 1, column: exportSheet.columns.length },
    };
  }

  exportSheet.rows.forEach((row, rowIndex) => {
    const values = exportSheet.columns.map((column) => excelValue(column, row[column.key]));
    const added = sheet.addRow(values);
    added.height = 18;
    added.eachCell((cell, columnNumber) => {
      const column = exportSheet.columns[columnNumber - 1];
      cell.font = { size: 9, color: { argb: 'FF24313A' } };
      cell.alignment = {
        wrapText: true,
        vertical: 'top',
        horizontal: column.type === 'money' || column.type === 'integer' || column.type === 'percent'
          ? 'right'
          : 'left',
      };
      if (rowIndex % 2 === 1) {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${ALT_FILL}` } };
      }
      cell.border = {
        bottom: { style: 'hair', color: { argb: 'FFDDE3E8' } },
      };
    });
  });

  if (exportSheet.totals && exportSheet.rows.length) {
    const values = exportSheet.columns.map((column, index) =>
      totalValue(column, exportSheet.totals, index),
    );
    const added = sheet.addRow(values);
    added.height = 20;
    added.eachCell((cell, columnNumber) => {
      const column = exportSheet.columns[columnNumber - 1];
      cell.font = { bold: true, size: 9, color: { argb: 'FF1F2D36' } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${TOTAL_FILL}` } };
      cell.alignment = {
        wrapText: true,
        vertical: 'top',
        horizontal: column.type === 'money' || column.type === 'integer' || column.type === 'percent'
          ? 'right'
          : 'left',
      };
      cell.border = {
        top: { style: 'thin', color: { argb: 'FFB9C5CE' } },
      };
    });
  }

  applyColumnFormats(sheet, exportSheet.columns);
  return sheet;
}

export async function buildXlsx(report) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Auto-Track POS';
  workbook.lastModifiedBy = 'Auto-Track POS';
  workbook.created = new Date(report.generatedAt);
  workbook.modified = new Date(report.generatedAt);
  workbook.subject = report.title;
  workbook.description = `${report.shopName} ${report.title}`;
  workbook.calcProperties.fullCalcOnLoad = true;

  addSummarySheet(workbook, report);
  for (const exportSheet of report.sheets) {
    addDataSheet(workbook, report, exportSheet);
  }

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}
