import { query, withTransaction } from '../db.js';
import { expenseDto } from '../lib/dto.js';
import { badRequest, notFound } from '../lib/errors.js';
import { logAudit } from '../lib/ledger.js';
import { asObject, dateOnly, integer, oneOf, text } from '../lib/validation.js';

export const EXPENSE_PAID_VIA = ['CASH', 'CARD_EXTERNAL', 'BANK_TRANSFER', 'OTHER'];

function parseExpenseInput(body) {
  const input = asObject(body);
  return {
    expenseDate: dateOnly(input.expenseDate, 'expenseDate'),
    category: text(input.category, 'category', { max: 60 }),
    description: text(input.description, 'description', { max: 200 }),
    amountCents: integer(input.amountCents, 'amountCents', { min: 1, max: 1_000_000_000_000_000 }),
    paidVia: oneOf(input.paidVia, 'paidVia', EXPENSE_PAID_VIA),
  };
}

async function currentBusinessDate(client = null) {
  const runner = client || { query };
  const { rows } = await runner.query("SELECT to_char(current_business_date(), 'YYYY-MM-DD') AS d");
  return rows[0].d;
}

async function assertNotFuture(expenseDate, client = null) {
  const today = await currentBusinessDate(client);
  if (expenseDate > today) {
    throw badRequest('Expense date cannot be in the future.', 'FUTURE_EXPENSE_DATE', {
      expenseDate: 'Use today or an earlier business date.',
    });
  }
}

async function loadExpense(client, id) {
  const { rows } = await client.query(
    `SELECT e.*, cu.display_name AS created_by_name, uu.display_name AS updated_by_name,
            du.display_name AS deleted_by_name
       FROM expenses e
       JOIN users cu ON cu.id = e.created_by
       LEFT JOIN users uu ON uu.id = e.updated_by
       LEFT JOIN users du ON du.id = e.deleted_by
      WHERE e.id = $1`,
    [id],
  );
  return rows[0] || null;
}

export async function listExpenses({ from = null, to = null, limit = 100, includeDeleted = false } = {}) {
  const { rows } = await query(
    `SELECT e.*, cu.display_name AS created_by_name, uu.display_name AS updated_by_name,
            du.display_name AS deleted_by_name
       FROM expenses e
       JOIN users cu ON cu.id = e.created_by
       LEFT JOIN users uu ON uu.id = e.updated_by
       LEFT JOIN users du ON du.id = e.deleted_by
      WHERE ($1::date IS NULL OR e.expense_date >= $1)
        AND ($2::date IS NULL OR e.expense_date <= $2)
        AND ($3::boolean OR e.deleted_at IS NULL)
      ORDER BY e.expense_date DESC, e.id DESC
      LIMIT $4`,
    [from, to, includeDeleted, limit],
  );
  return rows.map(expenseDto);
}

export async function expenseTotals({ from, to }) {
  const { rows } = await query(
    `SELECT COALESCE(SUM(amount_cents), 0) AS total_cents, COUNT(*) AS expense_count
       FROM expenses
      WHERE deleted_at IS NULL AND expense_date >= $1 AND expense_date <= $2`,
    [from, to],
  );
  return {
    totalCents: Number(rows[0].total_cents),
    count: Number(rows[0].expense_count),
  };
}

export async function createExpense(body, actor) {
  const input = parseExpenseInput(body);
  await assertNotFuture(input.expenseDate);
  return withTransaction(async (client) => {
    const inserted = await client.query(
      `INSERT INTO expenses (expense_date, category, description, amount_cents, paid_via, created_by)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [input.expenseDate, input.category, input.description, input.amountCents, input.paidVia, actor.id],
    );
    const id = inserted.rows[0].id;
    await logAudit(client, {
      actorId: actor.id,
      action: 'EXPENSE_RECORDED',
      entityType: 'expense',
      entityId: id,
      details: {
        expenseDate: input.expenseDate,
        category: input.category,
        amountCents: input.amountCents,
        paidVia: input.paidVia,
      },
    });
    return expenseDto(await loadExpense(client, id));
  });
}

export async function updateExpense(id, body, actor) {
  const input = parseExpenseInput(body);
  await assertNotFuture(input.expenseDate);
  return withTransaction(async (client) => {
    const { rows } = await client.query(
      'SELECT * FROM expenses WHERE id = $1 AND deleted_at IS NULL FOR UPDATE',
      [id],
    );
    const before = rows[0];
    if (!before) throw notFound('Expense not found.');
    const { rows: updatedRows } = await client.query(
      `UPDATE expenses
          SET expense_date = $2, category = $3, description = $4, amount_cents = $5,
              paid_via = $6, updated_by = $7, updated_at = now()
        WHERE id = $1 RETURNING *`,
      [id, input.expenseDate, input.category, input.description, input.amountCents, input.paidVia, actor.id],
    );
    const changed = ['expense_date', 'category', 'description', 'amount_cents', 'paid_via'].filter(
      (key) => String(before[key] ?? '') !== String(updatedRows[0][key] ?? ''),
    );
    await logAudit(client, {
      actorId: actor.id,
      action: 'EXPENSE_UPDATED',
      entityType: 'expense',
      entityId: id,
      details: {
        changed,
        expenseDate: input.expenseDate,
        category: input.category,
        amountCents: input.amountCents,
        paidVia: input.paidVia,
      },
    });
    return expenseDto(await loadExpense(client, id));
  });
}

export async function deleteExpense(id, actor) {
  return withTransaction(async (client) => {
    const { rows } = await client.query(
      'SELECT * FROM expenses WHERE id = $1 AND deleted_at IS NULL FOR UPDATE',
      [id],
    );
    const before = rows[0];
    if (!before) throw notFound('Expense not found.');
    await client.query(
      'UPDATE expenses SET deleted_by = $2, deleted_at = now(), updated_at = now() WHERE id = $1',
      [id, actor.id],
    );
    await logAudit(client, {
      actorId: actor.id,
      action: 'EXPENSE_DELETED',
      entityType: 'expense',
      entityId: id,
      details: {
        expenseDate: String(before.expense_date).slice(0, 10),
        category: before.category,
        amountCents: Number(before.amount_cents),
      },
    });
    return { id: String(id), deleted: true };
  });
}
