import { createHash } from 'node:crypto';

import type { DataArgProcessorService } from 'src/engine/api/common/common-args-processors/data-arg-processor/data-arg-processor.service';
import type { WorkspaceAuthContext } from 'src/engine/core-modules/auth/types/workspace-auth-context.type';
import type { FlatEntityMaps } from 'src/engine/metadata-modules/flat-entity/types/flat-entity-maps.type';
import type { FlatFieldMetadata } from 'src/engine/metadata-modules/flat-field-metadata/types/flat-field-metadata.type';
import type { FlatObjectMetadata } from 'src/engine/metadata-modules/flat-object-metadata/types/flat-object-metadata.type';

// Runtime import is local so controlled tests need no native SDK or Nest wiring.
import {
  ContactCsvPreviewError,
  parseContactCsvSource,
} from './contact-csv-preview';
import {
  captureContactPreviewData,
  ContactPreviewInvariantError,
  CONTACT_METADATA_PREVIEW_LIMITS,
  invariant,
} from './contact-preview-snapshot';

export type ContactMetadataMapping = {
  columnIndex: number;
  fieldId: string;
  subfield?: string;
  encoding: 'text' | 'number' | 'decimal' | 'boolean' | 'json' | 'null';
};
export type ContactMetadataContext = {
  authContext: Extract<WorkspaceAuthContext, { type: 'user' }>;
  flatObjectMetadata: FlatObjectMetadata;
  flatFieldMetadataMaps: FlatEntityMaps<FlatFieldMetadata>;
  flatObjectMetadataMaps: FlatEntityMaps<FlatObjectMetadata>;
};
const refuse = (): never => {
  throw new ContactCsvPreviewError();
};
const digest = (value: string | Uint8Array) =>
  createHash('sha256').update(value).digest('hex');
const compositeKeys: Record<string, readonly string[]> = {
  FULL_NAME: ['firstName', 'lastName'],
  EMAILS: ['primaryEmail', 'additionalEmails'],
  PHONES: [
    'primaryPhoneNumber',
    'primaryPhoneCountryCode',
    'primaryPhoneCallingCode',
    'additionalPhones',
  ],
  LINKS: ['primaryLinkUrl', 'primaryLinkLabel', 'secondaryLinks'],
  ADDRESS: [
    'addressStreet1',
    'addressStreet2',
    'addressCity',
    'addressPostcode',
    'addressState',
    'addressCountry',
    'addressLat',
    'addressLng',
  ],
  CURRENCY: ['amountMicros', 'currencyCode'],
};
const scalarTypes = [
  'TEXT',
  'NUMBER',
  'NUMERIC',
  'BOOLEAN',
  'DATE',
  'DATE_TIME',
  'SELECT',
  'RATING',
  'MULTI_SELECT',
  'ARRAY',
  'RAW_JSON',
  'UUID',
];
const forbiddenNames = [
  'id',
  'deletedAt',
  'position',
  'searchVector',
  'createdAt',
  'updatedAt',
  'createdBy',
  'updatedBy',
];
const encodings = ['text', 'number', 'decimal', 'boolean', 'json', 'null'];

// JSON encodings never repair invalid input, discard duplicate keys, or accept
// prototype setters. Native validators still determine each field's schema.
export const parseContactMappingJson = (raw: string): unknown => {
  let position = 0;
  const space = () => {
    while (/[ \t\r\n]/.test(raw[position] ?? '') && position < raw.length)
      position++;
  };
  const string = () => {
    const start = position++;
    while (position < raw.length) {
      if (raw[position] === '\\') {
        position += 2;
        continue;
      }
      if (raw[position++] === '"')
        return JSON.parse(raw.slice(start, position)) as string;
    }
    return refuse();
  };
  const value = (depth: number): unknown => {
    if (depth > 12) return refuse();
    space();
    if (raw[position] === '"') return string();
    if (raw[position] === '{' || raw[position] === '[') {
      const object = raw[position++] === '{';
      const result: Record<string, unknown> | unknown[] = object
        ? Object.create(null)
        : [];
      const seen = new Set<string>();
      const end = object ? '}' : ']';
      space();
      if (raw[position] === end) {
        position++;
        return result;
      }
      while (position < raw.length) {
        space();
        if (object) {
          if (raw[position] !== '"') return refuse();
          const key = string();
          space();
          if (
            seen.has(key) ||
            ['__proto__', 'constructor', 'prototype'].includes(key) ||
            raw[position++] !== ':'
          )
            return refuse();
          seen.add(key);
          (result as Record<string, unknown>)[key] = value(depth + 1);
        } else (result as unknown[]).push(value(depth + 1));
        space();
        const separator = raw[position++];
        if (separator === end) return result;
        if (separator !== ',') return refuse();
      }
      return refuse();
    }
    const token =
      /^(?:true|false|null|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)/.exec(
        raw.slice(position),
      );
    if (!token) return refuse();
    position += token[0].length;
    const result: unknown = JSON.parse(token[0]);
    if (
      typeof result === 'number' &&
      (!Number.isFinite(result) ||
        (Number.isInteger(result) && !Number.isSafeInteger(result)))
    )
      return refuse();
    return result;
  };
  const result = value(0);
  space();
  if (position !== raw.length) return refuse();
  return result;
};
const mappings = (input: unknown, width: number): ContactMetadataMapping[] => {
  if (
    !Array.isArray(input) ||
    Object.getPrototypeOf(input) !== Array.prototype ||
    input.length > 64
  )
    return refuse();
  const descriptors = Object.getOwnPropertyDescriptors(input);
  if (Reflect.ownKeys(descriptors).length !== input.length + 1) return refuse();
  const columns = new Set<number>();
  const targets = new Set<string>();
  return Array.from({ length: input.length }, (_, index) => {
    const descriptor = descriptors[String(index)];
    if (
      !descriptor ||
      !Object.prototype.hasOwnProperty.call(descriptor, 'value') ||
      !descriptor.enumerable
    )
      return refuse();
    const entry: unknown = descriptor.value;
    if (
      !entry ||
      typeof entry !== 'object' ||
      Object.getPrototypeOf(entry) !== Object.prototype
    )
      return refuse();
    const properties = Object.getOwnPropertyDescriptors(entry);
    const keys = Reflect.ownKeys(properties);
    if (
      keys.length < 3 ||
      keys.length > 4 ||
      keys.some(
        (key) =>
          typeof key !== 'string' ||
          !['columnIndex', 'fieldId', 'subfield', 'encoding'].includes(key) ||
          !Object.prototype.hasOwnProperty.call(properties[key], 'value'),
      )
    )
      return refuse();
    const columnIndex = properties.columnIndex?.value;
    const fieldId = properties.fieldId?.value;
    const subfield = properties.subfield?.value;
    const encoding = properties.encoding?.value;
    if (
      !Number.isInteger(columnIndex) ||
      columnIndex < 0 ||
      columnIndex >= width ||
      columns.has(columnIndex) ||
      typeof fieldId !== 'string' ||
      !/^[a-zA-Z0-9_-]{1,80}$/.test(fieldId) ||
      (subfield !== undefined &&
        (typeof subfield !== 'string' ||
          !/^[a-zA-Z][a-zA-Z0-9]{0,63}$/.test(subfield))) ||
      !encodings.includes(encoding)
    )
      return refuse();
    const target = fieldId + '.' + (subfield ?? '');
    if (
      targets.has(target) ||
      [...targets].some(
        (existing) =>
          existing.split('.')[0] === fieldId &&
          (!subfield || existing === fieldId + '.'),
      )
    )
      return refuse();
    columns.add(columnIndex);
    targets.add(target);
    return {
      columnIndex,
      fieldId,
      ...(subfield === undefined ? {} : { subfield }),
      encoding,
    };
  });
};
const decode = (
  raw: string,
  encoding: ContactMetadataMapping['encoding'],
): unknown => {
  if (encoding === 'text') return raw;
  if (encoding === 'null') {
    if (raw !== 'null') return refuse();
    return null;
  }
  if (encoding === 'boolean') {
    if (!['true', 'false'].includes(raw)) return refuse();
    return raw === 'true';
  }
  if (encoding === 'decimal') {
    if (!/^-?(?:0|[1-9]\d*)(?:\.\d+)?$/.test(raw)) return refuse();
    return raw;
  }
  if (encoding === 'number') {
    if (!/^-?(?:0|[1-9]\d*)(?:\.\d+)?$/.test(raw)) return refuse();
    return parseContactMappingJson(raw);
  }
  return parseContactMappingJson(raw);
};

// Read only exact dependencies through own data descriptors. Workspace-wide
// inventories are not a preview dependency while relation resolution is held.
const ownData = (object: unknown, key: string): unknown => {
  if (
    !object ||
    typeof object !== 'object' ||
    Array.isArray(object) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(object))
  )
    return invariant();
  const descriptor = Object.getOwnPropertyDescriptor(object, key);
  if (
    !descriptor ||
    !descriptor.enumerable ||
    !Object.prototype.hasOwnProperty.call(descriptor, 'value')
  )
    return invariant();
  return descriptor.value;
};
const identifier = (value: unknown): value is string =>
  typeof value === 'string' &&
  value.length > 0 &&
  value.length <= 80 &&
  !['__proto__', 'constructor', 'prototype'].includes(value);
const projectPersonContext = (
  context: ContactMetadataContext,
): ContactMetadataContext => {
  const limit = CONTACT_METADATA_PREVIEW_LIMITS.snapshotBytes;
  const objectCapture = captureContactPreviewData(
    ownData(context, 'flatObjectMetadata'),
    limit,
  );
  const person = objectCapture.value as FlatObjectMetadata;
  if (
    !person ||
    typeof person !== 'object' ||
    Array.isArray(person) ||
    !identifier(person.id) ||
    !identifier(person.universalIdentifier) ||
    !identifier(person.applicationId) ||
    !Array.isArray(person.fieldIds) ||
    person.fieldIds.length > CONTACT_METADATA_PREVIEW_LIMITS.metadataFields ||
    new Set(person.fieldIds).size !== person.fieldIds.length
  )
    return invariant();
  const fieldMaps = ownData(context, 'flatFieldMetadataMaps');
  const identifiers = ownData(fieldMaps, 'universalIdentifierById');
  const fieldValues = ownData(fieldMaps, 'byUniversalIdentifier');
  const projectedFields: FlatEntityMaps<FlatFieldMetadata> = {
    byUniversalIdentifier: {},
    universalIdentifierById: {},
    universalIdentifiersByApplicationId: {},
  };
  let dependencyBytes = objectCapture.bytes;
  for (const id of person.fieldIds) {
    if (!identifier(id)) return invariant();
    const universalIdentifier = ownData(identifiers, id);
    if (
      !identifier(universalIdentifier) ||
      Object.prototype.hasOwnProperty.call(
        projectedFields.byUniversalIdentifier,
        universalIdentifier,
      )
    )
      return invariant();
    const remaining = limit - dependencyBytes;
    if (remaining <= 0) return invariant();
    const fieldCapture = captureContactPreviewData(
      ownData(fieldValues, universalIdentifier),
      remaining,
    );
    const field = fieldCapture.value as FlatFieldMetadata;
    if (
      !field ||
      typeof field !== 'object' ||
      Array.isArray(field) ||
      field.id !== id ||
      field.universalIdentifier !== universalIdentifier ||
      !identifier(field.applicationId) ||
      field.workspaceId !== person.workspaceId ||
      field.objectMetadataId !== person.id
    )
      return invariant();
    dependencyBytes += fieldCapture.bytes;
    projectedFields.byUniversalIdentifier[universalIdentifier] = field;
    projectedFields.universalIdentifierById[id] = universalIdentifier;
    (projectedFields.universalIdentifiersByApplicationId[
      field.applicationId
    ] ??= []).push(universalIdentifier);
  }
  const projectedObjects: FlatEntityMaps<FlatObjectMetadata> = {
    byUniversalIdentifier: { [person.universalIdentifier]: person },
    universalIdentifierById: { [person.id]: person.universalIdentifier },
    universalIdentifiersByApplicationId: {
      [person.applicationId]: [person.universalIdentifier],
    },
  };
  return {
    authContext: ownData(
      context,
      'authContext',
    ) as ContactMetadataContext['authContext'],
    flatObjectMetadata: person,
    flatFieldMetadataMaps: projectedFields,
    flatObjectMetadataMaps: projectedObjects,
  };
};

// Only trusted server code supplies context and the actual native process method.
// This helper has no route, writes, authority check, or caller insert payload.
export const previewContactCsvWithMetadata = async (
  bytes: Uint8Array,
  explicitMapping: unknown,
  context: ContactMetadataContext,
  processor: Pick<DataArgProcessorService, 'process'>,
) => {
  const source = parseContactCsvSource(bytes);
  const sourceDigest = digest(bytes);
  const mapping = mappings(explicitMapping, source.columns.length);
  const captured = captureContactPreviewData(
    projectPersonContext(context),
    CONTACT_METADATA_PREVIEW_LIMITS.snapshotBytes,
  );
  const fixed = captured.value;
  const record = (value: unknown) =>
    value !== null && typeof value === 'object' && !Array.isArray(value);
  if (
    !record(fixed) ||
    !record(fixed.authContext) ||
    !record(fixed.flatObjectMetadata) ||
    !record(fixed.flatFieldMetadataMaps) ||
    !record(fixed.flatObjectMetadataMaps) ||
    !record(fixed.flatFieldMetadataMaps.byUniversalIdentifier) ||
    !record(fixed.flatFieldMetadataMaps.universalIdentifierById) ||
    !record(fixed.flatObjectMetadataMaps.byUniversalIdentifier) ||
    !Array.isArray(fixed.flatObjectMetadata.fieldIds)
  )
    return invariant();
  const workspaceId = fixed.authContext.workspace?.id;
  if (
    fixed.authContext.type !== 'user' ||
    !workspaceId ||
    fixed.flatObjectMetadata.workspaceId !== workspaceId ||
    fixed.flatObjectMetadata.nameSingular !== 'person'
  )
    return invariant();
  const identities = [
    fixed.authContext.user?.id,
    fixed.authContext.userWorkspaceId,
    fixed.authContext.workspaceMemberId,
  ];
  if (
    identities.some((id) => typeof id !== 'string' || !id || id.length > 80) ||
    fixed.authContext.workspaceMember?.id !==
      fixed.authContext.workspaceMemberId
  )
    return invariant();
  if (
    fixed.flatObjectMetadata.fieldIds.length >
      CONTACT_METADATA_PREVIEW_LIMITS.metadataFields ||
    Object.keys(fixed.flatFieldMetadataMaps.byUniversalIdentifier).length >
      CONTACT_METADATA_PREVIEW_LIMITS.metadataFields ||
    Object.keys(fixed.flatObjectMetadataMaps.byUniversalIdentifier).length >
      CONTACT_METADATA_PREVIEW_LIMITS.metadataObjects
  )
    return invariant();
  if (
    new Set(fixed.flatObjectMetadata.fieldIds).size !==
    fixed.flatObjectMetadata.fieldIds.length
  )
    return invariant();
  const names = new Set<string>();
  const fields = fixed.flatObjectMetadata.fieldIds.map((id) => {
    if (typeof id !== 'string' || !id || id.length > 80) return invariant();
    const identifier = fixed.flatFieldMetadataMaps.universalIdentifierById[id];
    const field = identifier
      ? fixed.flatFieldMetadataMaps.byUniversalIdentifier[identifier]
      : undefined;
    if (
      !field ||
      field.id !== id ||
      field.workspaceId !== workspaceId ||
      field.objectMetadataId !== fixed.flatObjectMetadata.id
    )
      return invariant();
    if (
      typeof field.name !== 'string' ||
      !field.name ||
      field.name.length > 80 ||
      names.has(field.name) ||
      ['__proto__', 'constructor', 'prototype'].includes(field.name) ||
      typeof field.type !== 'string' ||
      typeof field.isActive !== 'boolean' ||
      typeof field.isSystem !== 'boolean' ||
      typeof field.isUIReadOnly !== 'boolean' ||
      ![true, false, null].includes(field.isNullable)
    )
      return invariant();
    names.add(field.name);
    return field;
  });
  const metadataProjection = captureContactPreviewData(
    {
      flatObjectMetadata: fixed.flatObjectMetadata,
      flatFieldMetadataMaps: fixed.flatFieldMetadataMaps,
      flatObjectMetadataMaps: fixed.flatObjectMetadataMaps,
    },
    CONTACT_METADATA_PREVIEW_LIMITS.snapshotBytes,
  );
  const current = () =>
    captureContactPreviewData(
      projectPersonContext(context),
      CONTACT_METADATA_PREVIEW_LIMITS.snapshotBytes,
    ).json;
  const sameContext = () => {
    if (current() !== captured.json) invariant();
  };
  const supported = (field: FlatFieldMetadata) =>
    field.isActive &&
    !field.isUIReadOnly &&
    !field.isSystem &&
    !forbiddenNames.includes(field.name) &&
    (scalarTypes.includes(field.type) ||
      Object.prototype.hasOwnProperty.call(compositeKeys, field.type));
  const deferredRequiredChecks = fields.flatMap((field) => {
    if (!field.isActive) return [];
    const reasons: string[] = [];
    if (!supported(field)) reasons.push('unsupported-dependency');
    if (field.defaultValue !== undefined && field.defaultValue !== null)
      reasons.push('default-not-evaluated');
    if (Object.prototype.hasOwnProperty.call(compositeKeys, field.type))
      reasons.push('composite-subfield-completeness');
    if (field.isNullable !== true && field.isNullable !== false)
      reasons.push('nullability-unspecified');
    return reasons.map((reason) => ({ fieldId: field.id, reason }));
  });
  const rows = [];
  let candidateBytes = 0;
  let nativeProcessorInvocations = 0;
  for (const record of source.records) {
    const issues: { columnIndex: number | null; code: string }[] = [];
    const warnings: { columnIndex: number | null; code: string }[] = [];
    const input: Record<string, unknown> = Object.create(null);
    for (const entry of mapping) {
      const field = fields.find((item) => item.id === entry.fieldId);
      const unsupported = !field || !supported(field);
      if (unsupported) {
        issues.push({
          columnIndex: entry.columnIndex,
          code:
            field?.type === 'RICH_TEXT'
              ? 'rich-text-resource-validation-held'
              : field?.type === 'RELATION'
                ? 'relation-resolver-required'
                : 'unsupported-field',
        });
        continue;
      }
      if (
        entry.subfield &&
        !compositeKeys[field.type]?.includes(entry.subfield)
      ) {
        issues.push({
          columnIndex: entry.columnIndex,
          code: 'unsupported-subfield',
        });
        continue;
      }
      try {
        const raw = record.cells[entry.columnIndex];
        const decoded = decode(raw, entry.encoding);
        if (entry.encoding !== 'text')
          warnings.push({
            columnIndex: entry.columnIndex,
            code: 'explicit-encoding',
          });
        if (entry.subfield) {
          const composite = (input[field.name] ??=
            Object.create(null)) as Record<string, unknown>;
          composite[entry.subfield] = decoded;
        } else input[field.name] = decoded;
      } catch {
        issues.push({
          columnIndex: entry.columnIndex,
          code: 'invalid-encoding',
        });
      }
    }
    const missingRequired = (record: Record<string, unknown>) =>
      fields
        .filter(
          (field) =>
            supported(field) &&
            field.isNullable === false &&
            (field.defaultValue === undefined || field.defaultValue === null) &&
            (!Object.prototype.hasOwnProperty.call(record, field.name) ||
              record[field.name] === undefined ||
              record[field.name] === null),
        )
        .map((field) => field.id);
    const missingRequiredFieldIds = missingRequired(input);
    if (missingRequiredFieldIds.length)
      issues.push({ columnIndex: null, code: 'required-field-missing' });
    let candidate: unknown = null;
    if (Object.keys(input).length) {
      sameContext();
      const beforeNormalization = captureContactPreviewData(
        input,
        CONTACT_METADATA_PREVIEW_LIMITS.nativeRowBytes,
      ).json;
      let normalized:
        | Awaited<ReturnType<DataArgProcessorService['process']>>
        | undefined;
      nativeProcessorInvocations++;
      let nativeFailed = false;
      try {
        normalized = await processor.process({
          partialRecordInputs: [input],
          ...fixed,
          shouldBackfillPositionIfUndefined: false,
        });
      } catch (error) {
        if (error instanceof ContactPreviewInvariantError) throw error;
        nativeFailed = true;
        issues.push({ columnIndex: null, code: 'native-validation-failed' });
      }
      // Provider/native field errors are recoverable row issues. Drift, opaque
      // types and resource overruns refuse the WHOLE result outside that catch.
      sameContext();
      if (!nativeFailed) {
        if (
          !Array.isArray(normalized) ||
          Object.getPrototypeOf(normalized) !== Array.prototype
        )
          return invariant();
        const descriptors = Object.getOwnPropertyDescriptors(
          normalized as object,
        );
        if (
          Reflect.ownKeys(descriptors).length !== 2 ||
          descriptors.length?.value !== 1 ||
          !descriptors['0']?.enumerable ||
          !Object.prototype.hasOwnProperty.call(descriptors['0'], 'value')
        )
          return invariant();
        // Bound/traverse the WHOLE array before reading its candidate. Index
        // getters, sparse arrays and extra keys must never escape accounting.
        const arrayCapture = captureContactPreviewData(
          normalized,
          CONTACT_METADATA_PREVIEW_LIMITS.nativeRowBytes + 2,
          8193,
        );
        const normalizedRecord = arrayCapture.value[0];
        if (
          !normalizedRecord ||
          typeof normalizedRecord !== 'object' ||
          Array.isArray(normalizedRecord) ||
          Object.keys(normalizedRecord).some(
            (key) => !Object.prototype.hasOwnProperty.call(input, key),
          )
        )
          return invariant();
        const bounded = captureContactPreviewData(
          normalizedRecord,
          CONTACT_METADATA_PREVIEW_LIMITS.nativeRowBytes,
          8192,
        );
        candidateBytes += bounded.bytes;
        if (candidateBytes > CONTACT_METADATA_PREVIEW_LIMITS.nativeTotalBytes)
          return invariant();
        candidate = bounded.value;
        for (const fieldId of missingRequired(
          bounded.value as Record<string, unknown>,
        )) {
          if (!missingRequiredFieldIds.includes(fieldId))
            missingRequiredFieldIds.push(fieldId);
        }
        if (
          missingRequiredFieldIds.length &&
          !issues.some((issue) => issue.code === 'required-field-missing')
        )
          issues.push({ columnIndex: null, code: 'required-field-missing' });
        if (beforeNormalization !== bounded.json)
          warnings.push({ columnIndex: null, code: 'native-normalization' });
      }
    }
    rows.push({
      ...record,
      candidate,
      issues,
      warnings,
      missingRequiredFieldIds,
    });
  }
  sameContext();
  const result = {
    version: 1,
    mode: 'preview-only' as const,
    executable: false as const,
    nativeProcessorDelegated: nativeProcessorInvocations > 0,
    nativeProcessorInvocations,
    writeAdmission: false,
    checksNotPerformed: [
      'required-fields',
      'current-authority',
      'object-field-row-write-permissions',
      'same-workspace-relation-resolution',
      'transaction-and-durable-receipt',
    ] as const,
    sourceDigest,
    mappingDigest: digest(JSON.stringify(mapping)),
    metadataDigest: digest(metadataProjection.json),
    contextDigest: digest(captured.json),
    columns: source.columns,
    mapping,
    unmappedColumns: source.columns.filter(
      (column) =>
        !mapping.some((entry) => entry.columnIndex === column.columnIndex),
    ),
    deferredRequiredChecks,
    requiredAnalysis: 'partial-metadata-only' as const,
    rows,
  };
  captureContactPreviewData(
    result,
    CONTACT_METADATA_PREVIEW_LIMITS.previewBytes,
    100000,
  );
  return result;
};
