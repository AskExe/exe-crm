// Bounded canonical JSON projection BEFORE whole-object serialization. Native
// flat metadata/context is plain data; executable/class/opaque output is denied.
export class ContactPreviewInvariantError extends Error {
  constructor() { super('Contact metadata preview invariant refused'); this.name = 'ContactPreviewInvariantError'; }
}
export const invariant = (): never => { throw new ContactPreviewInvariantError(); };
export const CONTACT_METADATA_PREVIEW_LIMITS = Object.freeze({
  metadataFields: 512, metadataObjects: 512, snapshotBytes: 1024 * 1024,
  nativeRowBytes: 64 * 1024, nativeTotalBytes: 1024 * 1024,
  previewBytes: 4 * 1024 * 1024, depth: 16, nodes: 65536, stringCharacters: 16384,
});
export const captureContactPreviewData = <T>(value: T, maxBytes: number, maxNodes = CONTACT_METADATA_PREVIEW_LIMITS.nodes) => {
  let bytes = 0; let nodes = 0;
  const visiting = new Set<object>();
  const add = (count: number) => { bytes += count; if (bytes > maxBytes) invariant(); };
  const string = (text: string) => {
    if (text.length > CONTACT_METADATA_PREVIEW_LIMITS.stringCharacters) invariant();
    add(2);
    for (const character of text) {
      const code = character.charCodeAt(0);
      if (character === '"' || character === '\\') add(2);
      else if (code < 32) add(6);
      else { if (character.length === 1 && code >= 0xd800 && code <= 0xdfff) invariant(); add(Buffer.byteLength(character)); }
    }
    return text;
  };
  const walk = (input: unknown, depth: number, inArray = false): unknown => {
    if (++nodes > maxNodes || depth > CONTACT_METADATA_PREVIEW_LIMITS.depth) return invariant();
    if (input === undefined) { if (inArray) return invariant(); return undefined; }
    if (input === null) { add(4); return null; }
    if (typeof input === 'string') return string(input);
    if (typeof input === 'boolean') { add(input ? 4 : 5); return input; }
    if (typeof input === 'number') {
      if (!Number.isFinite(input) || Number.isInteger(input) && !Number.isSafeInteger(input)) return invariant();
      add(String(input).length); return input;
    }
    if (typeof input !== 'object' || visiting.has(input)) return invariant();
    const array = Array.isArray(input);
    if (Object.getPrototypeOf(input) !== (array ? Array.prototype : Object.prototype) && Object.getPrototypeOf(input) !== null) return invariant();
    visiting.add(input);
    const descriptors = Object.getOwnPropertyDescriptors(input);
    const keys = Reflect.ownKeys(descriptors);
    if (keys.some(key => typeof key !== 'string')) return invariant();
    add(2);
    let result: unknown;
    if (array) {
      const length = descriptors.length?.value;
      if (!Number.isInteger(length) || length < 0 || length > 1024 || keys.length !== length + 1) return invariant();
      const items: unknown[] = [];
      for (let index = 0; index < length; index++) {
        const descriptor = descriptors[String(index)];
        if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) return invariant();
        if (index) add(1); items.push(walk(descriptor.value, depth + 1, true));
      }
      result = items;
    } else {
      if (keys.length > 1024) return invariant();
      const object: Record<string, unknown> = {};
      for (const [index, key] of (keys as string[]).sort().entries()) {
        const descriptor = descriptors[key];
        if (!descriptor.enumerable || !Object.hasOwn(descriptor, 'value') || ['__proto__', 'constructor', 'prototype'].includes(key)) return invariant();
        if (index) add(1); string(key); add(1);
        object[key] = walk(descriptor.value, depth + 1);
      }
      result = object;
    }
    visiting.delete(input);
    return Object.freeze(result);
  };
  const captured = walk(value, 0) as T;
  // All values/properties/size/depth have already been admitted, without getters.
  const json = JSON.stringify(captured);
  if (json === undefined || Buffer.byteLength(json) > maxBytes) return invariant();
  return { value: captured, json, bytes: Buffer.byteLength(json) };
};
