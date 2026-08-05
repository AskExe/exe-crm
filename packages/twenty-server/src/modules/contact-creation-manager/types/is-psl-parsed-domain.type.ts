import { type ParsedDomain, type parse } from 'psl';

export const isParsedDomain = (
  result: ReturnType<typeof parse>,
): result is ParsedDomain =>
  // ParsedDomain has no 'error' key; ErrorResult always has 'error'.
  // Using the 'in' operator gives both a runtime-safe check and a TS type
  // narrowing that avoids accessing a property that doesn't exist on
  // ParsedDomain (which has no 'error' field in the psl package's own types).
  !('error' in result) && Object.prototype.hasOwnProperty.call(result, 'sld');
