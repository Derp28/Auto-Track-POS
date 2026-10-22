import { query, withTransaction } from '../db.js';
import { supplierDto } from '../lib/dto.js';
import { conflict, notFound } from '../lib/errors.js';
import { logAudit } from '../lib/ledger.js';
import { asObject, email, text } from '../lib/validation.js';

function normalize(input) {
  return {
    name: text(input.name, 'name', { max: 120 }),
    contactName: text(input.contactName, 'contactName', { optional: true, max: 120 }),
    phone: text(input.phone, 'phone', { optional: true, max: 40 }),
    email: email(input.email, 'email', { optional: true }),
    address: text(input.address, 'address', { optional: true, max: 300 }),
    notes: text(input.notes, 'notes', { optional: true, max: 500 }),
  };
}

export async function listSuppliers({ includeInactive = false } = {}) {
  const { rows } = await query(
    'SELECT * FROM suppliers WHERE ($1::boolean OR active) ORDER BY lower(name)',
    [includeInactive],
  );
  return rows.map(supplierDto);
}

export async function getSupplier(supplierId) {
  const { rows } = await query('SELECT * FROM suppliers WHERE id = $1', [supplierId]);
  if (!rows[0]) throw notFound('Supplier not found.');
  return supplierDto(rows[0]);
}

export async function createSupplier(body, actor) {
  const data = normalize(asObject(body));
  return withTransaction(async (client) => {
    const duplicate = await client.query('SELECT 1 FROM suppliers WHERE lower(name) = lower($1)', [data.name]);
    if (duplicate.rowCount) throw conflict('A supplier with that name already exists.', 'DUPLICATE_SUPPLIER');
    const { rows } = await client.query(
      `INSERT INTO suppliers (name, contact_name, phone, email, address, notes, created_by, updated_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $7) RETURNING *`,
      [data.name, data.contactName, data.phone, data.email, data.address, data.notes, actor.id],
    );
    await logAudit(client, { actorId: actor.id, action: 'SUPPLIER_CREATED', entityType: 'supplier', entityId: rows[0].id, details: { name: data.name } });
    return supplierDto(rows[0]);
  });
}

export async function updateSupplier(supplierId, body, actor) {
  const data = normalize(asObject(body));
  return withTransaction(async (client) => {
    const current = await client.query('SELECT * FROM suppliers WHERE id = $1 FOR UPDATE', [supplierId]);
    if (!current.rows[0]) throw notFound('Supplier not found.');
    const duplicate = await client.query('SELECT 1 FROM suppliers WHERE lower(name) = lower($1) AND id <> $2', [data.name, supplierId]);
    if (duplicate.rowCount) throw conflict('A supplier with that name already exists.', 'DUPLICATE_SUPPLIER');
    const { rows } = await client.query(
      `UPDATE suppliers SET name = $2, contact_name = $3, phone = $4, email = $5, address = $6, notes = $7,
         updated_by = $8, updated_at = now() WHERE id = $1 RETURNING *`,
      [supplierId, data.name, data.contactName, data.phone, data.email, data.address, data.notes, actor.id],
    );
    await logAudit(client, { actorId: actor.id, action: 'SUPPLIER_UPDATED', entityType: 'supplier', entityId: supplierId, details: { name: data.name } });
    return supplierDto(rows[0]);
  });
}

export async function setSupplierActive(supplierId, active, actor) {
  return withTransaction(async (client) => {
    const current = await client.query('SELECT * FROM suppliers WHERE id = $1 FOR UPDATE', [supplierId]);
    if (!current.rows[0]) throw notFound('Supplier not found.');
    const { rows } = await client.query(
      'UPDATE suppliers SET active = $2, updated_by = $3, updated_at = now() WHERE id = $1 RETURNING *',
      [supplierId, active, actor.id],
    );
    await logAudit(client, {
      actorId: actor.id,
      action: active ? 'SUPPLIER_RESTORED' : 'SUPPLIER_ARCHIVED',
      entityType: 'supplier',
      entityId: supplierId,
      details: { name: current.rows[0].name },
    });
    return supplierDto(rows[0]);
  });
}
