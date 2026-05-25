# OpenLander Demo Stack

A small full-stack demo app for OpenLander managed-service workflows.

This is an advanced demo. For a first OpenLander deploy, use the smaller
[`openlander-demo-app`](https://github.com/openlander-ai/openlander-demo-app)
instead. This stack requires Postgres and Redis connection strings; OpenLander
0.1 may ask you or your agent to provide those values before deployment.

## What it demonstrates

- A single deployable Node.js service
- PostgreSQL connection through `DATABASE_URL`
- Redis connection through `REDIS_URL`
- A browser UI that shows dependency health
- `/health` and `/api/status` endpoints for deployment diagnostics
- A Dockerfile that OpenLander can build without extra configuration

## OpenLander deploy prompt

After connecting your OpenLander MCP server, try:

```text
Deploy https://github.com/openlander-ai/openlander-demo-stack to OpenLander.
Use the default branch. If OpenLander reports missing DATABASE_URL or REDIS_URL,
create or attach project-scoped Postgres and Redis services first, then update
the deploy plan with the connection strings.
```

Expected result:

1. OpenLander creates a deploy plan.
2. The plan detects `pg` and `redis` package dependencies.
3. OpenLander either receives existing connection strings or helps you provision
   project-scoped Postgres and Redis services.
4. Runtime env vars are injected into the app.
5. The app boots and `/health` returns OK.

## Environment variables

| Name           | Required | Description                                  |
| -------------- | -------- | -------------------------------------------- |
| `DATABASE_URL` | yes      | PostgreSQL connection string                 |
| `REDIS_URL`    | yes      | Redis connection string                      |
| `PORT`         | no       | HTTP port. Defaults to `3000`.               |

`.env.example` leaves connection strings empty on purpose. In OpenLander 0.1,
agents should treat missing connection strings as required input unless a
project-scoped managed service has already been created and connected.

## Local development

```bash
npm install
npm run build
docker compose up --build
```

The compose file intentionally uses `expose` instead of host `ports` so
OpenLander can own routing and port assignment. For direct local browser access,
add a temporary override:

```yaml
# docker-compose.local.yml
services:
  app:
    ports:
      - "3000:3000"
```

Then run:

```bash
docker compose -f docker-compose.yml -f docker-compose.local.yml up --build
```

Open <http://localhost:3000>.

## API

```bash
curl http://localhost:3000/health
curl http://localhost:3000/api/status
```

Create a Postgres-backed event:

```bash
curl -X POST http://localhost:3000/api/events \
  -H 'content-type: application/x-www-form-urlencoded' \
  --data 'message=Deployed by OpenLander'
```

## Why this app exists

`nginx:alpine` proves that a container can start. This app proves more:
OpenLander can reason about a real app, inject dependency configuration, and
show a useful health signal after deploy.
