import PDFDocument from 'pdfkit';

const FONT = 'Helvetica';
const FONT_BOLD = 'Helvetica-Bold';
const MARGIN = 28;
const CELL_PADDING = 3;
const HEADER_HEIGHT = 24;
const FOOTER_HEIGHT = 16;

function pdfText(value) {
  return String(value ?? '')
    .replace(/\u20B1/g, 'PHP ')
    .replace(/[\u2013\u2014]/g, '-')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[^\x09\x0A\x0D\x20-\x7E\xA0-\xFF]/g, '?');
}

function formatNumber(value) {
  return new Intl.NumberFormat('en-US').format(Number(value) || 0);
}

function formatMoney(cents, currency) {
  const amount = (Number(cents) || 0) / 100;
  const formatted = new Intl.NumberFormat('en-PH', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
  return `${currency || 'PHP'} ${formatted}`;
}

function formatCell(column, value, report) {
  if (value === null || value === undefined || value === '') return '';
  if (column.type === 'money') return formatMoney(value, report.currency);
  if (column.type === 'percent') return `${((Number(value) || 0) / 100).toFixed(2)}%`;
  if (column.type === 'integer') return formatNumber(value);
  return String(value);
}

function contentBottom(doc) {
  return doc.page.height - doc.page.margins.bottom - FOOTER_HEIGHT;
}

function drawSummary(doc, report) {
  const left = doc.page.margins.left;
  const width = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  let y = doc.page.margins.top;

  doc.font(FONT_BOLD).fontSize(19).fillColor('#1F3A4D');
  doc.text(pdfText(report.shopName), left, y, { width });
  y = doc.y + 3;

  doc.font(FONT_BOLD).fontSize(14).fillColor('#23313C');
  doc.text(pdfText(report.title), left, y, { width });
  y = doc.y + 3;

  doc.font(FONT).fontSize(9).fillColor('#58656E');
  doc.text(pdfText(report.subtitle), left, y, { width, lineGap: 1 });
  y = doc.y + 9;

  const meta = [
    `Generated: ${report.generatedAtDisplay}`,
    `Timezone: ${report.timezone}`,
    ...report.filterLabels,
  ];
  doc.fontSize(8.5).fillColor('#46535C');
  for (const line of meta) {
    doc.text(pdfText(line), left, y, { width });
    y = doc.y + 1;
  }

  y += 10;
  doc.font(FONT_BOLD).fontSize(10).fillColor('#1F3A4D');
  doc.text('Summary', left, y);
  y = doc.y + 5;

  const metricWidth = width;
  for (const item of report.summary) {
    if (y + 18 > contentBottom(doc)) {
      doc.addPage();
      y = doc.page.margins.top;
    }
    doc.font(FONT).fontSize(9).fillColor('#46535C');
    doc.text(pdfText(item.label), left, y, { width: metricWidth * 0.55 });
    doc.font(FONT_BOLD).fontSize(9).fillColor('#1F2D36');
    doc.text(pdfText(item.value), left + metricWidth * 0.55, y, {
      width: metricWidth * 0.45,
      align: 'right',
    });
    y += 17;
    doc.moveTo(left, y - 3).lineTo(left + metricWidth, y - 3).strokeColor('#E1E7EB').lineWidth(0.5).stroke();
  }

  if (report.notes.length) {
    y += 7;
    doc.font(FONT_BOLD).fontSize(9).fillColor('#1F3A4D').text('Notes', left, y);
    y = doc.y + 3;
    doc.font(FONT).fontSize(8).fillColor('#58656E');
    for (const note of report.notes) {
      if (y + 20 > contentBottom(doc)) {
        doc.addPage();
        y = doc.page.margins.top;
      }
      doc.text(pdfText(note), left, y, { width, lineGap: 1 });
      y = doc.y + 3;
    }
  }
}

function columnWidths(columns, width) {
  const weights = columns.map((column) => Math.max(4, Number(column.width) || 14));
  const totalWeight = weights.reduce((sum, value) => sum + value, 0) || 1;
  const widths = weights.map((value) => Math.max(24, (value / totalWeight) * width));
  const total = widths.reduce((sum, value) => sum + value, 0);
  if (total <= 0) return widths;
  return widths.map((value) => (value / total) * width);
}

function drawHeaderRow(doc, columns, widths, x, y, report) {
  const height = HEADER_HEIGHT;
  doc.save();
  doc.rect(x, y, widths.reduce((sum, value) => sum + value, 0), height).fill('#1F3A4D');
  doc.restore();
  let cellX = x;
  doc.font(FONT_BOLD).fontSize(7.2).fillColor('#FFFFFF');
  columns.forEach((column, index) => {
    const cellWidth = widths[index];
    doc.text(pdfText(column.header), cellX + CELL_PADDING, y + CELL_PADDING, {
      width: cellWidth - CELL_PADDING * 2,
      height: height - CELL_PADDING * 2,
      align: column.type === 'money' || column.type === 'integer' || column.type === 'percent'
        ? 'right'
        : 'left',
      lineBreak: true,
      ellipsis: true,
    });
    cellX += cellWidth;
  });
  doc.strokeColor('#102733').lineWidth(0.7).rect(x, y, cellX - x, height).stroke();
  return y + height;
}

function drawFooter(doc, report) {
  const range = doc.bufferedPageRange();
  for (let index = range.start; index < range.start + range.count; index += 1) {
    doc.switchToPage(index);
    doc.page.margins.bottom = 0;
    const y = doc.page.height - 13;
    doc.font(FONT).fontSize(7).fillColor('#68747D');
    doc.text(pdfText(`${report.shopName} | ${report.title} | Generated ${report.generatedAtDisplay}`), MARGIN, y, {
      width: doc.page.width - MARGIN * 2 - 80,
      lineBreak: false,
      ellipsis: true,
    });
    doc.text(`Page ${index - range.start + 1} of ${range.count}`, doc.page.width - MARGIN - 80, y, {
      width: 80,
      align: 'right',
      lineBreak: false,
    });
  }
}

function drawTable(doc, report, exportSheet) {
  const columns = exportSheet.columns.filter((column) => column.pdf !== false);
  if (!columns.length) return;
  const left = doc.page.margins.left;
  const width = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const widths = columnWidths(columns, width);
  let y = doc.page.margins.top;

  doc.font(FONT_BOLD).fontSize(14).fillColor('#1F3A4D');
  doc.text(pdfText(exportSheet.name), left, y, { width });
  y = doc.y + 4;
  doc.font(FONT).fontSize(8).fillColor('#58656E');
  doc.text(`${formatNumber(exportSheet.rows.length)} row${exportSheet.rows.length === 1 ? '' : 's'}`, left, y, { width });
  y = doc.y + 7;

  y = drawHeaderRow(doc, columns, widths, left, y, report);

  if (!exportSheet.rows.length) {
    doc.font(FONT).fontSize(9).fillColor('#58656E').text('No records in this range.', left + CELL_PADDING, y + 9);
    return;
  }

  let alternate = false;
  for (const row of exportSheet.rows) {
    const cells = columns.map((column) => formatCell(column, row[column.key], report));
    let rowHeight = 16;
    columns.forEach((column, index) => {
      const text = pdfText(cells[index]);
      const measured = doc.font(FONT).fontSize(7.2).heightOfString(text, {
        width: widths[index] - CELL_PADDING * 2,
        lineGap: 0.5,
      });
      rowHeight = Math.max(rowHeight, Math.min(52, measured + CELL_PADDING * 2 + 2));
    });

    if (y + rowHeight > contentBottom(doc)) {
      doc.addPage();
      y = doc.page.margins.top;
      doc.font(FONT_BOLD).fontSize(12).fillColor('#1F3A4D');
      doc.text(`${pdfText(exportSheet.name)} (continued)`, left, y, { width });
      y = doc.y + 5;
      y = drawHeaderRow(doc, columns, widths, left, y, report);
    }

    if (alternate) {
      doc.save();
      doc.rect(left, y, width, rowHeight).fill('#F5F8FA');
      doc.restore();
    }
    let cellX = left;
    columns.forEach((column, index) => {
      doc.font(FONT).fontSize(7.2).fillColor('#24313A');
      doc.text(pdfText(cells[index]), cellX + CELL_PADDING, y + CELL_PADDING, {
        width: widths[index] - CELL_PADDING * 2,
        height: rowHeight - CELL_PADDING * 2,
        align: column.type === 'money' || column.type === 'integer' || column.type === 'percent'
          ? 'right'
          : 'left',
        lineBreak: true,
        ellipsis: true,
      });
      cellX += widths[index];
    });
    doc.strokeColor('#DCE3E8').lineWidth(0.4).rect(left, y, width, rowHeight).stroke();
    y += rowHeight;
    alternate = !alternate;
  }

  if (exportSheet.totals) {
    const cells = columns.map((column, index) => {
      if (index === 0 && exportSheet.totals[column.key] === undefined) return 'Total';
      return formatCell(column, exportSheet.totals[column.key], report);
    });
    const height = 20;
    if (y + height > contentBottom(doc)) {
      doc.addPage();
      y = doc.page.margins.top;
      y = drawHeaderRow(doc, columns, widths, left, y, report);
    }
    doc.save();
    doc.rect(left, y, width, height).fill('#E8EEF3');
    doc.restore();
    let cellX = left;
    columns.forEach((column, index) => {
      doc.font(FONT_BOLD).fontSize(7.2).fillColor('#1F2D36');
      doc.text(pdfText(cells[index]), cellX + CELL_PADDING, y + CELL_PADDING, {
        width: widths[index] - CELL_PADDING * 2,
        height: height - CELL_PADDING * 2,
        align: column.type === 'money' || column.type === 'integer' || column.type === 'percent'
          ? 'right'
          : 'left',
        lineBreak: true,
        ellipsis: true,
      });
      cellX += widths[index];
    });
    doc.strokeColor('#B9C5CE').lineWidth(0.7).rect(left, y, width, height).stroke();
  }
}

export function buildPdf(report) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'A4',
      layout: 'landscape',
      margins: { top: MARGIN, right: MARGIN, bottom: MARGIN, left: MARGIN },
      bufferPages: true,
      info: {
        Title: report.title,
        Author: 'Auto-Track POS',
        Subject: `${report.shopName} ${report.title}`,
        Creator: 'Auto-Track POS',
      },
    });
    const chunks = [];
    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    try {
      drawSummary(doc, report);
      for (const exportSheet of report.sheets) {
        doc.addPage();
        drawTable(doc, report, exportSheet);
      }
      drawFooter(doc, report);
      doc.end();
    } catch (error) {
      reject(error);
    }
  });
}
