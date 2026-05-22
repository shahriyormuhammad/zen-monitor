'use server';

import { and, asc, desc, eq, gte, lte, ne, or, sql } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';

import { db, withTenantContext } from '@/lib/db';
import { dynamicsGroupEvents } from '@/lib/db/schema';
import { requireGroupAccess } from '@/lib/auth/tenant-access';

const DYNAMICS_EVENT_TYPES = ['note', 'photo', 'ads', 'price', 'content', 'stock', 'task'] as const;
const DYNAMICS_EVENT_STATUSES = ['open', 'watching', 'done'] as const;

export type DynamicsGroupEventType = (typeof DYNAMICS_EVENT_TYPES)[number];
export type DynamicsGroupEventStatus = (typeof DYNAMICS_EVENT_STATUSES)[number];

export type DynamicsGroupEventView = {
  id: string;
  tenantId: string;
  groupId: string;
  eventDate: string;
  eventType: DynamicsGroupEventType;
  status: DynamicsGroupEventStatus;
  title: string;
  body: string | null;
  assignee: string | null;
  dueDate: string | null;
  checkDate: string | null;
  createdByEmail: string | null;
  createdAt: string;
  updatedAt: string;
};

export type CreateDynamicsGroupEventInput = {
  groupId: string;
  eventDate: string;
  eventType: DynamicsGroupEventType;
  title: string;
  body?: string | null;
  assignee?: string | null;
  dueDate?: string | null;
  checkDate?: string | null;
};

function ensureDate(value: string, fieldName: string) {
  const normalized = value.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    throw new Error(`${fieldName}: дата должна быть в формате YYYY-MM-DD`);
  }
  return normalized;
}

function nullableDate(value: string | null | undefined, fieldName: string) {
  const normalized = value?.trim();
  return normalized ? ensureDate(normalized, fieldName) : null;
}

function cleanText(value: string | null | undefined, limit: number) {
  const normalized = value?.trim() ?? '';
  return normalized ? normalized.slice(0, limit) : null;
}

function assertEventType(value: string): DynamicsGroupEventType {
  if (!DYNAMICS_EVENT_TYPES.includes(value as DynamicsGroupEventType)) {
    throw new Error('Неизвестный тип события');
  }
  return value as DynamicsGroupEventType;
}

function assertStatus(value: string): DynamicsGroupEventStatus {
  if (!DYNAMICS_EVENT_STATUSES.includes(value as DynamicsGroupEventStatus)) {
    throw new Error('Неизвестный статус события');
  }
  return value as DynamicsGroupEventStatus;
}

function serializeEvent(row: typeof dynamicsGroupEvents.$inferSelect): DynamicsGroupEventView {
  return {
    id: row.id,
    tenantId: row.tenantId,
    groupId: row.groupId,
    eventDate: String(row.eventDate),
    eventType: assertEventType(row.eventType),
    status: assertStatus(row.status),
    title: row.title,
    body: row.body,
    assignee: row.assignee,
    dueDate: row.dueDate ? String(row.dueDate) : null,
    checkDate: row.checkDate ? String(row.checkDate) : null,
    createdByEmail: row.createdByEmail,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function listDynamicsGroupEvents(groupId: string, from: string, to: string) {
  const { tenantId } = await requireGroupAccess(groupId);
  const dateFrom = ensureDate(from, 'from');
  const dateTo = ensureDate(to, 'to');

  const rows = await withTenantContext(db, tenantId, (tx) =>
    tx
      .select()
      .from(dynamicsGroupEvents)
      .where(and(
        eq(dynamicsGroupEvents.tenantId, tenantId),
        eq(dynamicsGroupEvents.groupId, groupId),
        or(
          and(gte(dynamicsGroupEvents.eventDate, dateFrom), lte(dynamicsGroupEvents.eventDate, dateTo)),
          and(gte(dynamicsGroupEvents.dueDate, dateFrom), lte(dynamicsGroupEvents.dueDate, dateTo)),
          and(gte(dynamicsGroupEvents.checkDate, dateFrom), lte(dynamicsGroupEvents.checkDate, dateTo)),
          ne(dynamicsGroupEvents.status, 'done'),
        ),
      ))
      .orderBy(asc(dynamicsGroupEvents.eventDate), desc(dynamicsGroupEvents.createdAt)),
  );

  return rows.map(serializeEvent);
}

export async function createDynamicsGroupEvent(input: CreateDynamicsGroupEventInput) {
  const { tenantId, user } = await requireGroupAccess(input.groupId, ['owner', 'admin']);
  const title = cleanText(input.title, 180);
  if (!title) {
    throw new Error('Коротко напишите, что сделали или что нужно сделать');
  }

  const eventType = assertEventType(input.eventType);
  const eventDate = ensureDate(input.eventDate, 'eventDate');
  const dueDate = nullableDate(input.dueDate, 'dueDate');
  const checkDate = nullableDate(input.checkDate, 'checkDate');

  const [row] = await withTenantContext(db, tenantId, (tx) =>
    tx
      .insert(dynamicsGroupEvents)
      .values({
        tenantId,
        groupId: input.groupId,
        eventDate,
        eventType,
        status: eventType === 'task' ? 'open' : 'watching',
        title,
        body: cleanText(input.body, 2000),
        assignee: cleanText(input.assignee, 120),
        dueDate,
        checkDate,
        createdByUserId: user.id,
        createdByEmail: user.email ?? null,
      })
      .returning(),
  );

  if (!row) {
    throw new Error('Событие не создано');
  }

  revalidatePath('/dynamics');
  return serializeEvent(row);
}

export async function updateDynamicsGroupEventStatus(
  groupId: string,
  eventId: string,
  status: DynamicsGroupEventStatus,
) {
  const { tenantId } = await requireGroupAccess(groupId, ['owner', 'admin']);
  const normalizedStatus = assertStatus(status);

  const [row] = await withTenantContext(db, tenantId, (tx) =>
    tx
      .update(dynamicsGroupEvents)
      .set({ status: normalizedStatus, updatedAt: sql`NOW()` })
      .where(and(
        eq(dynamicsGroupEvents.tenantId, tenantId),
        eq(dynamicsGroupEvents.groupId, groupId),
        eq(dynamicsGroupEvents.id, eventId),
      ))
      .returning(),
  );

  if (!row) {
    throw new Error('Событие не найдено');
  }

  revalidatePath('/dynamics');
  return serializeEvent(row);
}
