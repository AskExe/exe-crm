import { type ConfigCacheService } from '../../cache/config-cache.service';
import { type ConfigStorageService } from '../../storage/config-storage.service';
import { DatabaseConfigDriver } from '../database-config.driver';

describe('installation license configuration', () => {
  it.each(['EXE_LICENSE_KEY', 'EXE_LICENSE_URL', 'ENTERPRISE_KEY'] as const)(
    'rejects ineffective database overrides for deployment setting %s',
    async (key) => {
      const cacheWrite = jest.fn();
      const storageWrite = jest.fn();
      // Use the actual config metadata and driver; no environment-only mock.
      const driver = new DatabaseConfigDriver(
        { set: cacheWrite } as unknown as ConfigCacheService,
        { set: storageWrite } as unknown as ConfigStorageService,
      );
      await expect(driver.set(key, 'replacement')).rejects.toThrow(
        'environment-only',
      );
      await expect(driver.update(key, 'replacement')).rejects.toThrow(
        'environment-only',
      );
      expect(cacheWrite).not.toHaveBeenCalled();
      expect(storageWrite).not.toHaveBeenCalled();
    },
  );
});
