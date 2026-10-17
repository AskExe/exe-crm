# Fresh native workspace bootstrap regression

The reviewed CRM snapshot `4c926c3f60e9ebe323aa115984ffcf45502bd92b` fails its bootstrap against its own current migrations: `core.application.sourcePath` and `workspaceId` are required, but the bootstrap inserts neither. The original failure leaves no workspace, and the native health contract remains not ready. A locally built exact-source image was retained as immutable failing evidence; it is not a deployable release.

The canonical `ApplicationService.createWorkspaceCustomApplication` sets `sourcePath: 'workspace-custom'`, the workspace UUID, version `1.0.0`, and `canBeUninstalled:false`. The application-to-workspace foreign key is immediate. Migration `1770050200000` already makes the opposite workspace-to-custom-application foreign key initially deferred. Bootstrap therefore inserts the workspace first and its matching application second in the existing transaction, without changing schema constraints or assigning native/central grants.

Run the owned regression with dependencies installed and the exact reviewed baseline image built from its Git archive:

```sh
CRM_NATIVE_MIGRATION_IMAGE=sha256:1d4a87a7e27afb86ee67da816ea8a84140a37ca03d85f420f3a673521bbf6f58 node scripts/test-workspace-bootstrap-native.mjs
```

The script requires the baseline source-SHA image label, a 20 GiB free-disk floor, and Docker. It creates a UUID internal network and disposable pinned PostgreSQL 16 container with no published ports. Its native application DSN is not a database administrator. It runs the image's actual common migrations, reproduces the original compiled bootstrap failure and empty rollback, transpiles the current service, and exercises it against that same schema. It checks application/workspace links and canonical fields, the synthetic admin link, and exact replay without owner replacement. All owned containers, network and private temporary files are removed.

The successful regression establishes schema compatibility and transactional bootstrap behavior. It does not establish native web startup, workspace activation, company SSO, paid license authority, cross-company API isolation, restore, or capacity. Those remain separate native-stack checks; no unhealthy baseline image is promoted. Context7's repository-configured stdio server supplied the primary TypeORM QueryRunner transaction/parameter documentation during this repair.
