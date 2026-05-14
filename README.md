# OpenLander Demo Stack

A tiny full-stack demo app for OpenLander.

It is intentionally small, fast to build, and dependency-rich enough to show the
OpenLander value proposition: give an agent one Git repo, and it can deploy the
app plus managed Postgres and Redis.

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
Use the default branch. Let OpenLander provision the required Postgres and Redis services.
```

Expected result:

1. OpenLander creates a deploy plan.
2. The plan detects `pg` and `redis` package dependencies.
3. OpenLander provisions or reuses Postgres and Redis.
4. Runtime env vars are injected into the app.
5. The app boots and `/health` returns OK.

## Environment variables

| Name           | Required | Description                                  |
| -------------- | -------- | -------------------------------------------- |
| `DATABASE_URL` | yes      | PostgreSQL connection string                 |
| `REDIS_URL`    | yes      | Redis connection string                      |
| `PORT`         | no       | HTTP port. Defaults to `3000`.               |

`.env.example` leaves connection strings empty on purpose. OpenLander should
inject real values during deployment.

## Local development

```bash
npm install
npm run build
docker compose up --build
```

Then open <http://localhost:3000>.

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
OpenLander can reason about a real app, provision dependencies, inject env vars,
and show a useful health signal after deploy.
