import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import process from 'node:process';
import { Pool } from 'pg';
import { createClient } from 'redis';

const app = new Hono();
const port = Number.parseInt(process.env.PORT ?? '3000', 10);
const startedAt = new Date();
const instanceId = process.env.OPENLANDER_SERVICE_ID ?? process.env.HOSTNAME ?? 'local-demo';

let pool: Pool | null = null;
let schemaReady = false;
let redisClient: ReturnType<typeof createClient> | null = null;
let stylesCache: string | null = null;

type CheckStatus = {
  ok: boolean;
  latencyMs?: number;
  detail?: string;
  error?: string;
};

type DemoEvent = {
  id: number;
  message: string;
  createdAt: string;
};

type AppStatus = {
  app: {
    name: string;
    instanceId: string;
    uptimeSeconds: number;
    startedAt: string;
    nodeEnv: string;
  };
  database: CheckStatus & { eventCount?: number };
  redis: CheckStatus & { requestCount?: number };
  events: DemoEvent[];
};

function env(name: string): string | null {
  const value = process.env[name]?.trim();
  return value && value.length > 0 ? value : null;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function escapeHtml(value: unknown): string {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

async function getPool(): Promise<Pool> {
  const databaseUrl = env('DATABASE_URL');
  if (!databaseUrl) {
    throw new Error('DATABASE_URL is not set');
  }
  pool ??= new Pool({
    connectionString: databaseUrl,
    max: 4,
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 3_000,
  });
  return pool;
}

async function ensureSchema(): Promise<void> {
  if (schemaReady) return;
  const db = await getPool();
  await db.query(`
    CREATE TABLE IF NOT EXISTS demo_events (
      id SERIAL PRIMARY KEY,
      message TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await db.query(`
    INSERT INTO demo_events (message)
    SELECT 'OpenLander deployed the demo stack.'
    WHERE NOT EXISTS (SELECT 1 FROM demo_events)
  `);
  schemaReady = true;
}

async function getRedisClient(): Promise<ReturnType<typeof createClient>> {
  const redisUrl = env('REDIS_URL');
  if (!redisUrl) {
    throw new Error('REDIS_URL is not set');
  }
  if (!redisClient) {
    redisClient = createClient({ url: redisUrl });
    redisClient.on('error', () => {
      // Connection failures are reported through the status endpoint; keep the
      // process alive so the UI can show a clear dependency error.
    });
    await redisClient.connect();
  } else if (!redisClient.isOpen) {
    await redisClient.connect();
  }
  return redisClient;
}

async function loadStyles(): Promise<string> {
  if (stylesCache) return stylesCache;
  stylesCache = await readFile(join(process.cwd(), 'public', 'styles.css'), 'utf8');
  return stylesCache;
}

async function queryEvents(): Promise<{ events: DemoEvent[]; count: number }> {
  await ensureSchema();
  const db = await getPool();
  const [eventsResult, countResult] = await Promise.all([
    db.query<{ id: number; message: string; created_at: Date }>(`
      SELECT id, message, created_at
      FROM demo_events
      ORDER BY created_at DESC
      LIMIT 8
    `),
    db.query<{ count: string }>('SELECT COUNT(*)::text AS count FROM demo_events'),
  ]);
  return {
    events: eventsResult.rows.map((row) => ({
      id: row.id,
      message: row.message,
      createdAt: row.created_at.toISOString(),
    })),
    count: Number.parseInt(countResult.rows[0]?.count ?? '0', 10),
  };
}

async function collectStatus(options: { incrementCounter: boolean }): Promise<AppStatus> {
  const database: AppStatus['database'] = { ok: false };
  const redis: AppStatus['redis'] = { ok: false };
  let events: DemoEvent[] = [];

  const dbStart = Date.now();
  try {
    const result = await queryEvents();
    events = result.events;
    database.ok = true;
    database.latencyMs = Date.now() - dbStart;
    database.eventCount = result.count;
    database.detail = 'Postgres is reachable and demo_events is ready.';
  } catch (error) {
    database.latencyMs = Date.now() - dbStart;
    database.error = errorMessage(error);
  }

  const redisStart = Date.now();
  try {
    const client = await getRedisClient();
    await client.ping();
    const count = options.incrementCounter
      ? await client.incr('openlander-demo-stack:requests')
      : await client.get('openlander-demo-stack:requests');
    redis.ok = true;
    redis.latencyMs = Date.now() - redisStart;
    redis.requestCount = typeof count === 'number' ? count : Number.parseInt(count ?? '0', 10);
    redis.detail = 'Redis is reachable and request counter is active.';
  } catch (error) {
    redis.latencyMs = Date.now() - redisStart;
    redis.error = errorMessage(error);
  }

  return {
    app: {
      name: 'OpenLander Demo Stack',
      instanceId,
      uptimeSeconds: Math.floor((Date.now() - startedAt.getTime()) / 1000),
      startedAt: startedAt.toISOString(),
      nodeEnv: process.env.NODE_ENV ?? 'development',
    },
    database,
    redis,
    events,
  };
}

function statusClass(check: CheckStatus): string {
  return check.ok ? 'ok' : 'bad';
}

function renderHome(status: AppStatus): string {
  const healthy = status.database.ok && status.redis.ok;
  const events = status.events
    .map(
      (event) => `
        <li>
          <span class="event-id">#${event.id}</span>
          <span>${escapeHtml(event.message)}</span>
          <time>${new Date(event.createdAt).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })}</time>
        </li>
      `,
    )
    .join('');

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>OpenLander Demo Stack</title>
    <link rel="stylesheet" href="/styles.css" />
  </head>
  <body>
    <main class="shell">
      <section class="hero">
        <p class="eyebrow">OpenLander demo stack</p>
        <h1>One deployable app, two managed dependencies.</h1>
        <p class="lede">
          This tiny service proves that OpenLander can deploy a Git repo, provision Postgres and Redis,
          inject runtime connection strings, and surface health in one place.
        </p>
        <div class="hero-actions">
          <a href="/api/status">View JSON status</a>
          <a href="/health">Health endpoint</a>
        </div>
      </section>

      <section class="status-grid" aria-label="Dependency status">
        <article class="status-card ${statusClass(status.database)}">
          <span class="status-dot"></span>
          <p>Postgres</p>
          <strong>${status.database.ok ? 'Connected' : 'Disconnected'}</strong>
          <small>${escapeHtml(status.database.detail ?? status.database.error ?? 'No status')}</small>
          <em>${status.database.latencyMs ?? 0}ms · ${status.database.eventCount ?? 0} events</em>
        </article>
        <article class="status-card ${statusClass(status.redis)}">
          <span class="status-dot"></span>
          <p>Redis</p>
          <strong>${status.redis.ok ? 'Connected' : 'Disconnected'}</strong>
          <small>${escapeHtml(status.redis.detail ?? status.redis.error ?? 'No status')}</small>
          <em>${status.redis.latencyMs ?? 0}ms · ${status.redis.requestCount ?? 0} requests</em>
        </article>
        <article class="status-card ${healthy ? 'ok' : 'bad'}">
          <span class="status-dot"></span>
          <p>Runtime</p>
          <strong>${healthy ? 'Healthy' : 'Needs attention'}</strong>
          <small>Instance ${escapeHtml(status.app.instanceId)}</small>
          <em>${status.app.uptimeSeconds}s uptime · ${escapeHtml(status.app.nodeEnv)}</em>
        </article>
      </section>

      <section class="event-panel">
        <div>
          <p class="eyebrow">Postgres-backed activity</p>
          <h2>Recent demo events</h2>
        </div>
        <form method="post" action="/api/events">
          <input name="message" maxlength="120" placeholder="Write a deploy note..." />
          <button type="submit">Add event</button>
        </form>
        <ul>${events}</ul>
      </section>
    </main>
  </body>
</html>`;
}

app.get('/styles.css', async (c) => {
  const css = await loadStyles();
  return c.text(css, 200, { 'content-type': 'text/css; charset=utf-8' });
});

app.get('/', async (c) => {
  const status = await collectStatus({ incrementCounter: true });
  return c.html(renderHome(status));
});

app.get('/api/status', async (c) => {
  const status = await collectStatus({ incrementCounter: true });
  return c.json(status, status.database.ok && status.redis.ok ? 200 : 503);
});

app.get('/health', async (c) => {
  const status = await collectStatus({ incrementCounter: false });
  return c.json(
    {
      ok: status.database.ok && status.redis.ok,
      database: status.database.ok,
      redis: status.redis.ok,
    },
    status.database.ok && status.redis.ok ? 200 : 503,
  );
});

app.post('/api/events', async (c) => {
  const body = await c.req.parseBody();
  const rawMessage = typeof body['message'] === 'string' ? body['message'] : '';
  const message = rawMessage.trim().slice(0, 120);
  if (message.length > 0) {
    await ensureSchema();
    const db = await getPool();
    await db.query('INSERT INTO demo_events (message) VALUES ($1)', [message]);
  }
  return c.redirect('/');
});

serve(
  {
    fetch: app.fetch,
    port,
    hostname: '0.0.0.0',
  },
  (info) => {
    console.log(`OpenLander Demo Stack listening on http://0.0.0.0:${info.port}`);
  },
);
