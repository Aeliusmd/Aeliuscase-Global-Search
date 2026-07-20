import { getDb } from '@/lib/mongodb';

export interface AuditEvent {
  userId: string;
  query: string;
  accessedCaseNumbers: string[];
  toolCalled: string;
  ip: string;
}

const CASE_NUMBER_KEYS = new Set(['caseNumber', 'fileNumber', 'caseRef']);

/** Extracts only case references from tool output; all other case PII is ignored. */
export function collectCaseNumbers(value: unknown): string[] {
  const found = new Set<string>();
  const seen = new Set<object>();

  function visit(current: unknown, depth: number): void {
    if (depth > 8 || found.size >= 100 || current === null || current === undefined) return;
    if (Array.isArray(current)) {
      for (const item of current) visit(item, depth + 1);
      return;
    }
    if (typeof current !== 'object' || seen.has(current)) return;
    seen.add(current);

    for (const [key, child] of Object.entries(current)) {
      if (CASE_NUMBER_KEYS.has(key) && typeof child === 'string') {
        const normalized = child.trim().slice(0, 100);
        if (normalized) found.add(normalized);
      } else {
        visit(child, depth + 1);
      }
    }
  }

  visit(value, 0);
  return [...found];
}

let auditIndexPromise: Promise<unknown> | undefined;

async function writeAudit(event: AuditEvent): Promise<void> {
  const db = await getDb();
  const collection = db.collection('audit');
  auditIndexPromise ??= collection.createIndex({ userId: 1, timestamp: -1 });
  await auditIndexPromise;
  await collection.insertOne({
    userId: event.userId,
    query: event.query.slice(0, 2_000),
    accessedCaseNumbers: [...new Set(event.accessedCaseNumbers)].slice(0, 100),
    toolCalled: event.toolCalled.slice(0, 200),
    timestamp: new Date(),
    ip: event.ip.slice(0, 100),
  });
}

/**
 * Audit persistence must never delay or break the user response. Deliberately
 * logs only a static failure message so event data cannot leak into logs.
 */
export function recordAudit(event: AuditEvent): void {
  void writeAudit(event).catch(() => {
    console.error('[audit] Failed to persist audit event.');
  });
}
