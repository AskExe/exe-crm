import { makeExecutableSchema } from '@graphql-tools/schema';
import { GraphQLSchema } from 'graphql';
import { gql } from 'graphql-tag';

import { ScalarsExplorerService } from 'src/engine/api/graphql/services/scalars-explorer.service';
import { StockWorkspaceSchemaPartsService } from 'src/engine/api/graphql/stock-workspace-schema-parts.service';
import { type FlatWorkspace } from 'src/engine/core-modules/workspace/types/flat-workspace.type';

// SDK printing needs the same native schema/scalars, but no request resolvers.
// This factory has no auth, HTTP, principal or record-operation providers.
export class StockSdkSchemaFactory {
  constructor(
    private readonly schemaParts: StockWorkspaceSchemaPartsService,
    private readonly scalarsExplorerService: ScalarsExplorerService,
  ) {}

  async createGraphQLSchema(
    workspace: FlatWorkspace,
    applicationId?: string,
  ): Promise<GraphQLSchema> {
    const parts = await this.schemaParts.getSchemaParts(
      workspace,
      applicationId,
    );
    if (!parts) return new GraphQLSchema({});
    return makeExecutableSchema({
      typeDefs: gql`
        ${parts.typeDefs}
      `,
      resolvers: this.scalarsExplorerService.getScalarResolvers(
        parts.usedScalarNames,
      ),
    });
  }
}
