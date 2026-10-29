/**
 * Export the on-screen 80 mm receipt as a one-page PDF.
 *
 * The receipt is serialized with the app's own stylesheet, rasterized at 3x,
 * and embedded as a compressed image. Nothing is loaded from the network, so
 * the export works offline. The intermediate image is a data: URL, which the
 * app's img-src CSP allows.
 */

const MM_TO_PT = 72 / 25.4;
const PAGE_WIDTH_MM = 80;
const RASTER_SCALE = 3;

function round(value) {
  return Number(value.toFixed(4));
}

function stylesheetText() {
  const parts = [];
  for (const sheet of document.styleSheets) {
    let rules;
    try {
      rules = sheet.cssRules;
    } catch {
      continue;
    }
    if (!rules) continue;
    for (const rule of rules) parts.push(rule.cssText);
  }
  return parts.join('\n');
}

function toBase64(text) {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  const step = 0x8000;
  for (let index = 0; index < bytes.length; index += step) {
    binary += String.fromCharCode(...bytes.subarray(index, index + step));
  }
  return btoa(binary);
}

function base64Bytes(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function receiptSvg(element, width, height) {
  const clone = element.cloneNode(true);
  clone.style.boxShadow = 'none';
  clone.style.margin = '0';
  const style = document.createElement('style');
  style.textContent = `${stylesheetText()}\n.receipt-print{box-shadow:none!important;margin:0!important;}`;
  const frame = document.createElement('div');
  frame.setAttribute(
    'style',
    `width:${width}px;background:#fff;color:#111;font-family:var(--font-sans,system-ui),sans-serif;`,
  );
  frame.append(style, clone);
  const body = new XMLSerializer().serializeToString(frame);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><foreignObject x="0" y="0" width="${width}" height="${height}">${body}</foreignObject></svg>`;
}

function loadImage(dataUrl) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('The receipt image could not be prepared.'));
    image.src = dataUrl;
  });
}

async function encodePixels(canvas) {
  const context = canvas.getContext('2d');
  const { width, height } = canvas;
  let pixels;
  try {
    pixels = context.getImageData(0, 0, width, height).data;
  } catch {
    throw new Error('The receipt image could not be read.');
  }
  if (typeof CompressionStream === 'function') {
    const rgb = new Uint8Array(width * height * 3);
    for (let source = 0, target = 0; source < pixels.length; source += 4) {
      rgb[target] = pixels[source];
      rgb[target + 1] = pixels[source + 1];
      rgb[target + 2] = pixels[source + 2];
      target += 3;
    }
    const stream = new Blob([rgb]).stream().pipeThrough(new CompressionStream('deflate'));
    const compressed = new Uint8Array(await new Response(stream).arrayBuffer());
    return { width, height, filter: 'FlateDecode', colorSpace: 'DeviceRGB', bits: 8, data: compressed };
  }
  const jpeg = canvas.toDataURL('image/jpeg', 0.95);
  return {
    width,
    height,
    filter: 'DCTDecode',
    colorSpace: 'DeviceRGB',
    bits: 8,
    data: base64Bytes(jpeg.split(',')[1] || ''),
  };
}

function buildPdf(image, pageWidth, pageHeight) {
  const parts = [];
  const offsets = [];
  const encoder = new TextEncoder();
  let size = 0;
  const write = (value) => {
    const bytes = typeof value === 'string' ? encoder.encode(value) : value;
    parts.push(bytes);
    size += bytes.length;
  };
  const object = (id, body) => {
    offsets[id] = size;
    write(`${id} 0 obj\n${body}\nendobj\n`);
  };

  write('%PDF-1.4\n');
  write(new Uint8Array([0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a]));
  object(1, '<< /Type /Catalog /Pages 2 0 R >>');
  object(2, '<< /Type /Pages /Kids [3 0 R] /Count 1 >>');
  object(
    3,
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${round(pageWidth)} ${round(pageHeight)}] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>`,
  );
  offsets[4] = size;
  write(
    `4 0 obj\n<< /Type /XObject /Subtype /Image /Width ${image.width} /Height ${image.height} /ColorSpace /${image.colorSpace} /BitsPerComponent ${image.bits} /Filter /${image.filter} /Length ${image.data.length} >>\nstream\n`,
  );
  write(image.data);
  write('\nendstream\nendobj\n');
  const content = `q ${round(pageWidth)} 0 0 ${round(pageHeight)} 0 0 cm /Im0 Do Q`;
  object(5, `<< /Length ${content.length} >>\nstream\n${content}\nendstream`);
  const xref = size;
  write('xref\n0 6\n0000000000 65535 f \n');
  for (let id = 1; id <= 5; id += 1) {
    write(`${String(offsets[id]).padStart(10, '0')} 00000 n \n`);
  }
  write(`trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  return new Blob(parts, { type: 'application/pdf' });
}

function saveBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = String(filename || 'receipt.pdf').replace(/[^a-zA-Z0-9._-]+/g, '-');
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function downloadReceiptPdf(element, filename = 'receipt.pdf') {
  if (!element) throw new Error('The receipt is not ready to export.');
  const rect = element.getBoundingClientRect();
  if (rect.width < 1 || rect.height < 1) throw new Error('The receipt is not visible to export.');
  const width = Math.ceil(rect.width);
  const height = Math.ceil(rect.height);
  const image = await loadImage(`data:image/svg+xml;base64,${toBase64(receiptSvg(element, width, height))}`);
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(width * RASTER_SCALE);
  canvas.height = Math.round(height * RASTER_SCALE);
  const context = canvas.getContext('2d');
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  const payload = await encodePixels(canvas);
  const pageWidth = PAGE_WIDTH_MM * MM_TO_PT;
  const pageHeight = pageWidth * (height / width);
  const blob = buildPdf(payload, pageWidth, pageHeight);
  saveBlob(blob, filename);
  return { bytes: blob.size, pageWidth, pageHeight };
}
