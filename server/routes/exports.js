import { Router } from 'express';
import { pool } from '../db.js';
import { badRequest, asyncHandler } from '../lib/errors.js';
import { buildPdf } from '../lib/export-pdf.js';
import { buildXlsx } from '../lib/export-xlsx.js';
import { logAudit } from '../lib/ledger.js';
import { dateOnly, idParam, oneOf } from '../lib/validation.js';
import { requireAction } from '../middleware/auth.js';
import {
  buildExportReport,
  EXPORT_DATASETS,
  EXPORT_FORMATS,
  EXPORT_MOVEMENT_TYPES,
  EXPORT_PURCHASE_STATUSES,
} from '../services/exports.js';

export const exportsRouter = Router();

const CONTENT_TYPES = {
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pdf: 'application/pdf',
};

async function currentBusinessDate() {
  return (await pool.query("SELECT to_char(current_business_date(), 'YYYY-MM-DD') AS d")).rows[0].d;
}

async function exportFilters(req, dataset) {
  const today = await currentBusinessDate();
  const asOf = req.query.asOf ? dateOnly(req.query.asOf, 'asOf') : today;
  const from = req.query.from ? dateOnly(req.query.from, 'from') : asOf;
  const to = req.query.to ? dateOnly(req.query.to, 'to') : asOf;
  if (from > to) throw badRequest('The start date must be on or before the end date.', 'INVALID_RANGE');
  return {
    asOf,
    from,
    to,
    categoryId: dataset === 'inventory' && req.query.categoryId
      ? idParam(req.query.categoryId, 'categoryId')
      : null,
    productId: dataset === 'movements' && req.query.productId
      ? idParam(req.query.productId, 'productId')
      : null,
    type: dataset === 'movements'
      ? oneOf(req.query.type, 'type', EXPORT_MOVEMENT_TYPES, { optional: true, fallback: '' })
      : '',
    status: dataset === 'purchasing'
      ? oneOf(req.query.status, 'status', EXPORT_PURCHASE_STATUSES, { optional: true, fallback: '' })
      : '',
    supplierId: dataset === 'purchasing' && req.query.supplierId
      ? idParam(req.query.supplierId, 'supplierId')
      : null,
  };
}

exportsRouter.get('/:dataset/:format', requireAction('reports:export'), asyncHandler(async (req, res) => {
  const dataset = oneOf(req.params.dataset, 'dataset', EXPORT_DATASETS);
  const format = oneOf(req.params.format, 'format', EXPORT_FORMATS);
  const filters = await exportFilters(req, dataset);
  const report = await buildExportReport({ dataset, filters });
  const buffer = format === 'xlsx' ? await buildXlsx(report) : await buildPdf(report);
  const filename = `${report.filenameBase}.${format}`;

  await logAudit(pool, {
    actorId: req.user.id,
    action: 'REPORT_EXPORTED',
    entityType: 'report_export',
    details: {
      dataset,
      format,
      filters,
      rowCount: report.rowCount,
      filename,
      ip: req.ip,
    },
  });

  res.setHeader('Content-Type', CONTENT_TYPES[format]);
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.setHeader('Content-Length', buffer.length);
  res.setHeader('Cache-Control', 'no-store');
  res.send(buffer);
}));
