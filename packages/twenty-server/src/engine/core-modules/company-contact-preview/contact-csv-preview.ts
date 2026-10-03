export const CONTACT_PREVIEW_LIMITS = Object.freeze({
  bytes: 1024 * 1024,
  rows: 500,
  columns: 64,
  cellCharacters: 4096,
});

export type ContactPreviewDestination =
  | 'name.firstName'
  | 'name.lastName'
  | 'emails.primaryEmail';
export type ContactPreviewMapping = {
  columnIndex: number;
  destination: ContactPreviewDestination;
};
export type ContactPreviewFields = {
  name?: { firstName?: string; lastName?: string };
  emails?: { primaryEmail: string };
};
export type ContactCsvPreview = {
  version: 1;
  mode: 'preview-only';
  executable: false;
  nativeValidationRequired: true;
  unsupportedDestinations: readonly ['phones'];
  columns: { columnIndex: number; header: string }[];
  unmappedColumns: { columnIndex: number; header: string }[];
  rows: {
    sourceRecord: number;
    sourceLine: number;
    fields: ContactPreviewFields;
    issues: { destination: ContactPreviewDestination; code: 'invalid-email' | 'invalid-name' }[];
  }[];
};

export class ContactCsvPreviewError extends Error {
  constructor() {
    super('Contact CSV preview refused');
    this.name = 'ContactCsvPreviewError';
  }
}

const refuse = (): never => { throw new ContactCsvPreviewError(); };
type CsvRecord = { cells: string[]; sourceLine: number };

// This finite dialect accepts comma, LF/CRLF, quoted newlines and doubled quotes.
// It does not skip blank records, infer a header row, or repair malformed input.
const parseCsv = (text: string): CsvRecord[] => {
  const records: CsvRecord[] = [];
  let cells: string[] = [];
  let cell = '';
  let state: 'start' | 'plain' | 'quoted' | 'closed' = 'start';
  let line = 1;
  let sourceLine = 1;
  const pushCell = () => {
    if (cells.length >= CONTACT_PREVIEW_LIMITS.columns) refuse();
    cells.push(cell);
    cell = '';
    state = 'start';
  };
  const pushRecord = () => {
    pushCell();
    if (records.length >= CONTACT_PREVIEW_LIMITS.rows + 1) refuse();
    records.push({ cells, sourceLine });
    cells = [];
    sourceLine = line + 1;
  };
  for (let index = 0; index < text.length; index++) {
    const character = text[index];
    if (character === '\r' && text[index + 1] !== '\n') refuse();
    if (state === 'quoted') {
      if (character === '"') {
        if (text[index + 1] === '"') { cell += '"'; index++; }
        else state = 'closed';
      } else {
        if (character === '\r') { cell += '\r\n'; index++; line++; }
        else { cell += character; if (character === '\n') line++; }
      }
    } else if (character === ',' ) pushCell();
    else if (character === '\n' || character === '\r') {
      pushRecord();
      if (character === '\r') index++;
      line++;
    } else if (character === '"' && state === 'start') state = 'quoted';
    else {
      if (state === 'closed' || character === '"') refuse();
      cell += character;
      state = 'plain';
    }
    if (cell.length > CONTACT_PREVIEW_LIMITS.cellCharacters) refuse();
  }
  if (state === 'quoted') refuse();
  if (cell.length || cells.length || state !== 'start') pushRecord();
  return records;
};

const validateMapping = (input: unknown, width: number): ContactPreviewMapping[] => {
  if (!Array.isArray(input) || Object.getPrototypeOf(input) !== Array.prototype) refuse();
  const descriptors = Object.getOwnPropertyDescriptors(input);
  const length = descriptors.length.value;
  if (typeof length !== 'number' || length < 1 || length > 3 || Reflect.ownKeys(descriptors).length !== length + 1) refuse();
  const verifiedEntries: unknown[] = [];
  for (let index = 0; index < length; index++) {
    const descriptor = descriptors[String(index)];
    if (!descriptor || !Object.hasOwn(descriptor, 'value') || !descriptor.enumerable) refuse();
    verifiedEntries.push(descriptor.value);
  }
  const columns = new Set<number>();
  const destinations = new Set<string>();
  return verifiedEntries.map((item: unknown) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) refuse();
    const value = item as Record<string, unknown>;
    if (![Object.prototype, null].includes(Object.getPrototypeOf(value)) || Reflect.ownKeys(value).length !== 2 || Object.keys(value).sort().join(',') !== 'columnIndex,destination' || Object.values(Object.getOwnPropertyDescriptors(value)).some(descriptor => !Object.hasOwn(descriptor, 'value'))) refuse();
    const { columnIndex, destination } = value;
    if (typeof columnIndex !== 'number' || !Number.isInteger(columnIndex) || columnIndex < 0 || columnIndex >= width || columns.has(columnIndex)) refuse();
    if (typeof destination !== 'string' || !['name.firstName', 'name.lastName', 'emails.primaryEmail'].includes(destination) || destinations.has(destination)) refuse();
    columns.add(columnIndex);
    destinations.add(destination);
    return { columnIndex, destination: destination as ContactPreviewDestination };
  });
};

// Deliberately a conservative ASCII subset of native Zod unicodeEmail validation.
// No identity is inferred, and native validation is still required before any write.
const supportedEmail = (email: string) =>
  email === '' || (email.length <= 254 && /^[A-Za-z0-9!#$%&'*+\/=?^_`{|}~-]+(?:\.[A-Za-z0-9!#$%&'*+\/=?^_`{|}~-]+)*@[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)+$/.test(email) && email.split('@')[0].length <= 64 && email.split('@')[1].split('.').every(label => label.length <= 63));

export const parseContactCsvSource = (bytes: Uint8Array) => {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength === 0 || bytes.byteLength > CONTACT_PREVIEW_LIMITS.bytes) refuse();
  let text: string;
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
  catch { return refuse(); }
  if (text.includes('\0')) refuse();
  const records = parseCsv(text);
  const header = records[0];
  if (!header || header.cells.some(value => !value.trim() || value.length > 128 || /[\u0000-\u001f\u007f]/.test(value))) refuse();
  const columns = header.cells.map((header, columnIndex) => ({ columnIndex, header }));
  if (records.slice(1).some(record => record.cells.length !== header.cells.length)) refuse();
  return { columns, records: records.slice(1).map((record, index) => ({ ...record, sourceRecord: index + 2 })) };
};

export const previewContactCsv = (bytes: Uint8Array, explicitMapping: unknown): ContactCsvPreview => {
  const { columns, records: sourceRows } = parseContactCsvSource(bytes);
  const mapping = validateMapping(explicitMapping, columns.length);
  const records = [{ cells: [], sourceLine: 1 }, ...sourceRows];
  const rows = records.slice(1).map((record, index) => {
    const fields: ContactPreviewFields = {};
    const issues: ContactCsvPreview['rows'][number]['issues'] = [];
    for (const entry of mapping) {
      const value = record.cells[entry.columnIndex];
      if (entry.destination === 'emails.primaryEmail') {
        if (!supportedEmail(value)) issues.push({ destination: entry.destination, code: 'invalid-email' });
        else fields.emails = { primaryEmail: value.toLowerCase() };
      } else {
        if (value.length > 256 || /[\u0000-\u001f\u007f]/.test(value)) issues.push({ destination: entry.destination, code: 'invalid-name' });
        else {
          fields.name ??= {};
          if (entry.destination === 'name.firstName') fields.name.firstName = value;
          else fields.name.lastName = value;
        }
      }
    }
    return { sourceRecord: index + 2, sourceLine: record.sourceLine, fields, issues };
  });
  return { version: 1, mode: 'preview-only', executable: false, nativeValidationRequired: true, unsupportedDestinations: ['phones'], columns, unmappedColumns: columns.filter(column => !mapping.some(entry => entry.columnIndex === column.columnIndex)), rows };
};
