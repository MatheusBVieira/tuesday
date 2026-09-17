import type { Person } from '../../shared/types';
import { AVATAR_COLORS, resolveColor } from '../../shared/colors';
import { fold } from '../../shared/values';
import { badRequest, db, emitGlobalChange, insertId, notFound, tx, type Actor } from './common';

interface PersonRow {
  id: number;
  name: string;
  email: string | null;
  color: string;
  is_agent: number;
}

const toPerson = (r: PersonRow): Person => ({
  id: r.id,
  name: r.name,
  email: r.email,
  color: r.color,
  isAgent: r.is_agent === 1,
});

export function listPeople(): Person[] {
  return (db().prepare('SELECT * FROM people ORDER BY is_agent, id').all() as PersonRow[]).map(toPerson);
}

export function getPerson(id: number): Person | null {
  const row = db().prepare('SELECT * FROM people WHERE id = ?').get(id) as PersonRow | undefined;
  return row ? toPerson(row) : null;
}

export function getMeta(key: string): string | null {
  const row = db().prepare('SELECT value FROM meta WHERE key = ?').get(key) as { value: string } | undefined;
  return row?.value ?? null;
}

export function setMeta(key: string, value: string): void {
  db().prepare('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, value);
}

function metaPersonId(key: string): number | null {
  const value = Number(getMeta(key));
  return Number.isInteger(value) && getPerson(value) ? value : null;
}

export const getMeId = () => metaPersonId('me_id');
export const getClaudeId = () => metaPersonId('claude_id');

export function setMe(personId: number, actor: Actor): void {
  const person = getPerson(personId);
  if (!person) throw notFound('Pessoa não encontrada.');
  if (person.isAgent) throw badRequest('Escolha uma pessoa, não um agente.');
  setMeta('me_id', String(personId));
  emitGlobalChange(actor);
}

export function createPerson(
  input: { name: string; color?: string | null; email?: string | null; isAgent?: boolean },
  actor: Actor,
): Person {
  const name = input.name.trim().slice(0, 80);
  if (!name) throw badRequest('Informe o nome da pessoa.');
  const count = (db().prepare('SELECT COUNT(*) AS n FROM people').get() as { n: number }).n;
  const color = resolveColor(input.color) ?? AVATAR_COLORS[count % AVATAR_COLORS.length];
  const id = insertId(
    'INSERT INTO people (name, email, color, is_agent) VALUES (?, ?, ?, ?)',
    name,
    input.email?.trim() || null,
    color,
    input.isAgent ? 1 : 0,
  );
  emitGlobalChange(actor);
  return getPerson(id)!;
}

export function updatePerson(id: number, patch: { name?: string; color?: string | null; email?: string | null }, actor: Actor): Person {
  const current = getPerson(id);
  if (!current) throw notFound('Pessoa não encontrada.');
  const name = patch.name !== undefined ? patch.name.trim().slice(0, 80) : current.name;
  if (!name) throw badRequest('O nome não pode ficar vazio.');
  const color = patch.color !== undefined ? (resolveColor(patch.color) ?? current.color) : current.color;
  const email = patch.email !== undefined ? patch.email?.trim() || null : current.email;
  db().prepare('UPDATE people SET name = ?, color = ?, email = ? WHERE id = ?').run(name, color, email, id);
  emitGlobalChange(actor);
  return getPerson(id)!;
}

export function deletePerson(id: number, actor: Actor): void {
  if (!getPerson(id)) throw notFound('Pessoa não encontrada.');
  if (id === getMeId()) throw badRequest('Esta pessoa é "você" neste computador e não pode ser removida.');
  if (id === getClaudeId()) throw badRequest('O Claude é o autor das ações feitas pelo MCP e não pode ser removido.');
  tx(() => {
    const rows = db()
      .prepare(
        `SELECT v.item_id, v.column_id, v.value FROM item_values v
         JOIN board_columns c ON c.id = v.column_id WHERE c.type = 'people'`,
      )
      .all() as { item_id: number; column_id: number; value: string }[];
    const update = db().prepare('UPDATE item_values SET value = ? WHERE item_id = ? AND column_id = ?');
    const remove = db().prepare('DELETE FROM item_values WHERE item_id = ? AND column_id = ?');
    for (const row of rows) {
      const ids = JSON.parse(row.value) as number[];
      if (!ids.includes(id)) continue;
      const next = ids.filter((x) => x !== id);
      if (next.length) update.run(JSON.stringify(next), row.item_id, row.column_id);
      else remove.run(row.item_id, row.column_id);
    }
    db().prepare('DELETE FROM people WHERE id = ?').run(id);
  });
  emitGlobalChange(actor);
}

/** Encontra uma pessoa pelo id ou nome (sem diferenciar acentos/caixa; aceita primeiro nome se for único). */
export function resolvePerson(ref: number | string, people: Person[] = listPeople()): Person {
  const raw = String(ref).trim();
  if (typeof ref === 'number' || /^\d+$/.test(raw)) {
    const byId = people.find((p) => p.id === Number(raw));
    if (byId) return byId;
  }
  const key = fold(raw);
  const exact = people.filter((p) => fold(p.name) === key);
  if (exact.length === 1) return exact[0];
  const partial = people.filter((p) => {
    const name = fold(p.name);
    return name.startsWith(key) || name.split(/\s+/).includes(key);
  });
  if (exact.length === 0 && partial.length === 1) return partial[0];
  const known = people.map((p) => p.name).join(', ') || '(nenhuma)';
  if (exact.length > 1 || partial.length > 1) throw badRequest(`"${raw}" corresponde a mais de uma pessoa. Pessoas cadastradas: ${known}.`);
  throw badRequest(`Pessoa "${raw}" não encontrada. Pessoas cadastradas: ${known}.`);
}
