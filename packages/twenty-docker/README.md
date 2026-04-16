# twenty-docker

Docker build and compose configuration for the Twenty server + frontend image.

## Build targets

The multi-stage `twenty/Dockerfile` exposes two final targets:

| Target           | Use case                                      | Contents                                      |
| ---------------- | --------------------------------------------- | --------------------------------------------- |
| `twenty`         | **Default** — production                      | Server + frontend. External Postgres + Redis. |
| `twenty-app-dev` | Local experimentation, SDK testing, demos     | Server + frontend + **bundled** Postgres + Redis via s6-overlay. |

### Default build (production)

Build without `--target` (or with `--target twenty`) to get the production image. This is what `docker compose up` uses and what CI / Ansible deploys expect:

```sh
cd <repo-root>
docker build \
  -t twentycrm/twenty:local \
  -f packages/twenty-docker/twenty/Dockerfile \
  .
```

Pair with the production compose (`packages/twenty-docker/docker-compose.yml`), which wires external `db` (Postgres) and `redis` services.

### All-in-one dev build

Pass `--target twenty-app-dev` for the single-container image with bundled Postgres + Redis. Handy for a self-contained local run where you don't want to manage external services. Do NOT pair this with the production compose — the bundled Postgres will collide with the external `db` service.

```sh
cd <repo-root>
docker build \
  --target twenty-app-dev \
  -t twentycrm/twenty:app-dev \
  -f packages/twenty-docker/twenty/Dockerfile \
  .
```

### Why the default matters

Docker builds the **last** stage in the Dockerfile when `--target` is omitted. The `twenty` (production) stage is intentionally the last stage in the file so that `docker build` without flags produces the correct production image. If you add new stages, keep the production `twenty` stage LAST — moving it earlier silently swaps the default and causes runtime errors like `relation "core.workspace" does not exist` when the bundled image's internal Postgres fails to initialize against the production schema.
