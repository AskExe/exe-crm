import type { FlatWorkspaceMember } from 'src/engine/core-modules/user/types/flat-workspace-member.type';

import { captureContactPreviewData } from '../company-contact-preview/contact-preview-snapshot';

export class CompanyMemberContextError extends Error {
  constructor() { super('Company member context unavailable'); this.name = 'CompanyMemberContextError'; }
}
const refuse = (): never => { throw new CompanyMemberContextError(); };
const uuid = (value: unknown): value is string => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value);
const requiredText = ['colorScheme', 'locale', 'timeZone', 'dateFormat', 'timeFormat', 'numberFormat'] as const;
const nullableText = ['avatarUrl', 'userEmail', 'searchVector', 'nameFirstName', 'nameLastName'] as const;
const timestampColumns = ['createdAt', 'updatedAt', 'deletedAt'] as const;
const ownData = (object: unknown, key: string): unknown => {
  if (!object || typeof object !== 'object' || Array.isArray(object) || ![Object.prototype, null].includes(Object.getPrototypeOf(object))) return refuse();
  const descriptor = Object.getOwnPropertyDescriptor(object, key);
  if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) return refuse();
  return descriptor.value;
};
const timestamp = (value: unknown, nullable: boolean): string | null => {
  if (value === null && nullable) return null;
  // Only the three declared timestamp columns admit native PG Date instances.
  // Never call a row's Date.toJSON/toISOString hook or accept a Date subclass.
  if (!value || typeof value !== 'object' || Object.getPrototypeOf(value) !== Date.prototype || Reflect.ownKeys(value).length !== 0) return refuse();
  let milliseconds: number;
  try { milliseconds = Date.prototype.getTime.call(value); } catch { return refuse(); }
  if (!Number.isFinite(milliseconds) || !Number.isInteger(milliseconds) || Math.abs(milliseconds) > 8640000000000000) return refuse();
  return Date.prototype.toISOString.call(value);
};

// This converts a complete native raw member row, not a reduced auth principal.
// Bounds are transport limits; no defaults, relations or authority are created.
export const companyMemberToFlat = (
  raw: unknown,
  binding: { workspace_member_id: string; user_id: string },
): FlatWorkspaceMember => {
  try {
    const memberId = ownData(binding, 'workspace_member_id');
    const userId = ownData(binding, 'user_id');
    if (!uuid(memberId) || !uuid(userId) || ownData(raw, 'id') !== memberId || ownData(raw, 'userId') !== userId) return refuse();
    if (!raw || typeof raw !== 'object' || Array.isArray(raw) || ![Object.prototype, null].includes(Object.getPrototypeOf(raw))) return refuse();
    const descriptors = Object.getOwnPropertyDescriptors(raw);
    const keys = Reflect.ownKeys(descriptors);
    if (keys.length > 64 || keys.some(key => typeof key !== 'string' || !/^[A-Za-z][A-Za-z0-9_]{0,79}$/.test(key) || ['__proto__', 'constructor', 'prototype', 'name'].includes(key))) return refuse();
    const scalar: Record<string, unknown> = {};
    for (const key of keys as string[]) {
      const descriptor = descriptors[key];
      if (!descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) return refuse();
      scalar[key] = (timestampColumns as readonly string[]).includes(key)
        ? timestamp(descriptor.value, key === 'deletedAt') : descriptor.value;
    }
    // BaseWorkspaceEntity + WorkspaceMemberWorkspaceEntity scalar fields.
    // Nullability follows current native metadata, not TypeScript-only narrowing.
    for (const key of requiredText) if (typeof ownData(scalar, key) !== 'string') return refuse();
    for (const key of nullableText) { const value = ownData(scalar, key); if (value !== null && typeof value !== 'string') return refuse(); }
    for (const key of timestampColumns) ownData(scalar, key);
    const position = ownData(scalar, 'position');
    const calendarStartDay = ownData(scalar, 'calendarStartDay');
    if (typeof position !== 'number' || !Number.isFinite(position) || !Number.isSafeInteger(calendarStartDay)) return refuse();
    scalar.name = { firstName: scalar.nameFirstName, lastName: scalar.nameLastName };
    // Keep ALL original scalar columns, including actor/custom plain data. Any
    // undeclared Date, class, getter, cycle or oversize data still refuses.
    return captureContactPreviewData(scalar, 65536, 4096).value as FlatWorkspaceMember;
  } catch { return refuse(); }
};
