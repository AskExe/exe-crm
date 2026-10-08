import { DataSource } from 'typeorm';

import { PRIVATE_NATIVE_STOCK_ENTITIES } from 'src/engine/core-modules/company-native-bootstrap/private-native-stock-entities';

class MetadataOnlyDataSource extends DataSource {
  async buildNativeMetadata(): Promise<void> {
    await this.buildMetadatas();
  }
}

describe('isolated stock native entity graph', () => {
  it('builds actual native relations without a connection, migrations or ambient URLs', async () => {
    const database = new MetadataOnlyDataSource({
      type: 'postgres',
      schema: 'core',
      entities: [...PRIVATE_NATIVE_STOCK_ENTITIES],
      synchronize: false,
      migrationsRun: false,
      migrations: [],
    });
    const connect = jest.spyOn(database.driver, 'connect');

    await database.buildNativeMetadata();

    expect(connect).not.toHaveBeenCalled();
    expect(database.isInitialized).toBe(false);
    expect(database.entityMetadatas).toHaveLength(60);
    expect(
      database.entityMetadatas.every((entity) => entity.schema === 'core'),
    ).toBe(true);
    expect(database.entityMetadatas.map((entity) => entity.tableName)).toEqual(
      expect.arrayContaining([
        'workspace',
        'user',
        'userWorkspace',
        'application',
        'dataSource',
        'objectMetadata',
        'fieldMetadata',
        'role',
        'roleTarget',
      ]),
    );
    expect(
      database.entityMetadatas.some((entity) =>
        entity.tableName.startsWith('billing'),
      ),
    ).toBe(false);
    expect(database.migrations).toEqual([]);
    expect(Object.isFrozen(PRIVATE_NATIVE_STOCK_ENTITIES)).toBe(true);
  });
});
