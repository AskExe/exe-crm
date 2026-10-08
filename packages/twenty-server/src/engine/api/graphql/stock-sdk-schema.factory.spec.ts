import 'reflect-metadata';
import { buildSchema, isScalarType, printSchema } from 'graphql';

import { ScalarsExplorerService } from 'src/engine/api/graphql/services/scalars-explorer.service';
import { StockSdkSchemaFactory } from 'src/engine/api/graphql/stock-sdk-schema.factory';
import { StockWorkspaceSchemaPartsService } from 'src/engine/api/graphql/stock-workspace-schema-parts.service';
import { WorkspaceSchemaFactory } from 'src/engine/api/graphql/workspace-schema.factory';
import { SdkClientGenerationService } from 'src/engine/core-modules/sdk-client/sdk-client-generation.service';
import { type FlatWorkspace } from 'src/engine/core-modules/workspace/types/flat-workspace.type';
import { createEmptyFlatEntityMaps } from 'src/engine/metadata-modules/flat-entity/constant/create-empty-flat-entity-maps.constant';

const workspace = {
  id: '123e4567-e89b-42d3-a456-426614174000',
  databaseSchema: 'workspace_owned',
  metadataVersion: 7,
} as FlatWorkspace;
const typeDefs =
  'scalar DateTime\ntype Query { record: Record }\ntype Record { id: ID! createdAt: DateTime }';

// Real schema/scalar/cache assembly with inert native metadata acquisition.
// These controls do not qualify the SQL provider graph or workspace DDL.
function setup() {
  const scalars = new ScalarsExplorerService();
  const generator = {
    generateSchema: jest.fn().mockResolvedValue(buildSchema(typeDefs)),
  };
  const cache = {
    getMetadataVersion: jest.fn().mockResolvedValue(undefined),
    setMetadataVersion: jest.fn().mockResolvedValue(undefined),
    getGraphQLTypeDefs: jest.fn().mockResolvedValue(undefined),
    getGraphQLUsedScalarNames: jest.fn().mockResolvedValue(undefined),
    setGraphQLTypeDefs: jest.fn().mockResolvedValue(undefined),
    setGraphQLUsedScalarNames: jest.fn().mockResolvedValue(undefined),
  };
  const metadata = {
    getOrRecomputeManyOrAllFlatEntityMaps: jest.fn().mockResolvedValue({
      flatObjectMetadataMaps: createEmptyFlatEntityMaps(),
      flatFieldMetadataMaps: createEmptyFlatEntityMaps(),
      flatIndexMaps: createEmptyFlatEntityMaps(),
      flatApplicationMaps: createEmptyFlatEntityMaps(),
    }),
  };
  const feature = { isFeatureEnabled: jest.fn().mockResolvedValue(true) };
  const dataSource = {
    getDataSourcesMetadataFromWorkspaceId: jest.fn().mockResolvedValue([{}]),
  };
  const args = [
    scalars,
    generator,
    cache,
    metadata,
    feature,
    dataSource,
  ] as unknown as ConstructorParameters<
    typeof StockWorkspaceSchemaPartsService
  >;
  const parts = new StockWorkspaceSchemaPartsService(...args);
  const resolver = {
    create: jest.fn().mockResolvedValue({ Query: { record: () => null } }),
  };
  const ordinaryArgs = [
    scalars,
    generator,
    resolver,
    cache,
    metadata,
    feature,
    dataSource,
  ] as unknown as ConstructorParameters<typeof WorkspaceSchemaFactory>;
  return {
    scalars,
    generator,
    cache,
    metadata,
    feature,
    dataSource,
    resolver,
    stock: new StockSdkSchemaFactory(parts, scalars),
    ordinary: new WorkspaceSchemaFactory(...ordinaryArgs),
  };
}

describe('shared stock SDK schema printing', () => {
  it('prints the same actual schema/scalars while only ordinary factory assembles request resolvers', async () => {
    const item = setup();
    const stock = await item.stock.createGraphQLSchema(workspace);
    expect(item.resolver.create).not.toHaveBeenCalled();
    const ordinary = await item.ordinary.createGraphQLSchema(workspace);
    expect(printSchema(stock)).toBe(printSchema(ordinary));
    const stockScalar = stock.getType('DateTime');
    const ordinaryScalar = ordinary.getType('DateTime');
    if (!isScalarType(stockScalar) || !isScalarType(ordinaryScalar))
      throw new Error('Expected native DateTime scalar');
    const sample = new Date('2026-10-09T00:00:00.000Z');
    expect(stockScalar.serialize(sample)).toEqual(
      ordinaryScalar.serialize(sample),
    );
    expect(stockScalar.parseValue(sample.toISOString())).toEqual(
      ordinaryScalar.parseValue(sample.toISOString()),
    );
    expect(item.resolver.create).toHaveBeenCalledTimes(1);
    expect(item.cache.setMetadataVersion).toHaveBeenCalledWith(workspace.id, 7);
    expect(item.cache.setGraphQLTypeDefs).toHaveBeenCalledWith(
      workspace.id,
      7,
      printSchema(buildSchema(typeDefs)),
      undefined,
    );
  });
  it('keeps native cached schema/version/scalar read path without regenerating', async () => {
    const item = setup();
    item.cache.getMetadataVersion.mockResolvedValue(11);
    item.cache.getGraphQLTypeDefs.mockResolvedValue(typeDefs);
    item.cache.getGraphQLUsedScalarNames.mockResolvedValue(['DateTime', 'ID']);
    const schema = await item.stock.createGraphQLSchema(workspace);
    expect(printSchema(schema)).toContain('createdAt: DateTime');
    expect(item.generator.generateSchema).not.toHaveBeenCalled();
    expect(item.cache.setMetadataVersion).not.toHaveBeenCalled();
    expect(item.cache.getGraphQLTypeDefs).toHaveBeenCalledWith(
      workspace.id,
      11,
      undefined,
    );
  });
  it('preserves schema-absent early return without metadata or resolvers', async () => {
    const item = setup();
    const absent = { ...workspace, databaseSchema: null } as FlatWorkspace;
    expect(printSchema(await item.stock.createGraphQLSchema(absent))).toBe('');
    expect(printSchema(await item.ordinary.createGraphQLSchema(absent))).toBe(
      '',
    );
    expect(
      item.metadata.getOrRecomputeManyOrAllFlatEntityMaps,
    ).not.toHaveBeenCalled();
    expect(item.resolver.create).not.toHaveBeenCalled();
  });
  it('propagates native metadata failure before schema/cache publication', async () => {
    const item = setup();
    const primary = new Error('controlled');
    item.metadata.getOrRecomputeManyOrAllFlatEntityMaps.mockRejectedValue(
      primary,
    );
    await expect(item.stock.createGraphQLSchema(workspace)).rejects.toBe(
      primary,
    );
    expect(item.cache.setGraphQLTypeDefs).not.toHaveBeenCalled();
    expect(item.generator.generateSchema).not.toHaveBeenCalled();
  });
  it('retains ordinary Nest SDK injection of WorkspaceSchemaFactory', () => {
    expect(
      Reflect.getMetadata('self:paramtypes', SdkClientGenerationService),
    ).toEqual(
      expect.arrayContaining([{ index: 3, param: WorkspaceSchemaFactory }]),
    );
  });
});
