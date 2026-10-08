import { type Stats } from 'node:fs';
import { PrivateNativeActionUnavailable } from 'src/engine/core-modules/company-native-bootstrap/private-native-action-reader';
import { assertStockObservedFileProjection } from 'src/engine/core-modules/company-native-bootstrap/private-native-stock-storage-model';

// Inert post-read projection controls, not real Linux handle/permission proof.
const original = {
  dev: 1,
  ino: 2,
  uid: 1000,
  gid: 1000,
  mode: 0o100600,
  size: 1387,
  nlink: 1,
  mtimeMs: 10,
} as Stats;
const hash = 'a'.repeat(64);
describe('fixed stock post-read observation', () => {
  it('accepts exact held and current named bytes/identity', () => {
    expect(() =>
      assertStockObservedFileProjection(
        original,
        { ...original },
        { ...original },
        1387,
        1387,
        hash,
        hash,
      ),
    ).not.toThrow();
  });
  it.each([
    ['held hardlink', { nlink: 2 }, {}],
    ['named hardlink', {}, { nlink: 2 }],
    ['held growth', { size: 1388 }, {}],
    ['named growth', {}, { size: 1388 }],
    ['held time change', { mtimeMs: 11 }, {}],
    ['named time change', {}, { mtimeMs: 11 }],
    ['named replacement', {}, { ino: 3 }],
  ] as const)(
    'refuses %s introduced after the initial file check',
    (_name, held, named) => {
      expect(() =>
        assertStockObservedFileProjection(
          original,
          { ...original, ...held },
          { ...original, ...named },
          1387,
          1387,
          hash,
          hash,
        ),
      ).toThrow(PrivateNativeActionUnavailable);
    },
  );
  it('refuses short reads and altered bytes', () => {
    expect(() =>
      assertStockObservedFileProjection(
        original,
        original,
        original,
        1387,
        1386,
        hash,
        hash,
      ),
    ).toThrow(PrivateNativeActionUnavailable);
    expect(() =>
      assertStockObservedFileProjection(
        original,
        original,
        original,
        1387,
        1387,
        'b'.repeat(64),
        hash,
      ),
    ).toThrow(PrivateNativeActionUnavailable);
  });
});
