// The database: DeckForge's Postgres, shared so one account (and its decks) works on both sites.
// DeckForge owns the `public` tables (users, decks, deck_cards); Arena keeps its own tables in the `arena`
// schema, which DeckForge's Prisma tooling never touches.
//
// Connection settings are the standard Postgres variables, so no password is ever needed or stored:
//   production: PGHOST=/var/run/postgresql PGUSER=arena PGDATABASE=deckforge   (local socket + peer login)
//   development: PGHOST=/tmp/arena-pg PGUSER=arena_dev PGDATABASE=arena_dev    (the server's socket, forwarded over SSH)
import pg from 'pg';

export const DB_ENABLED = !!process.env.PGDATABASE;

// DeckForge's tables (made by Prisma) keep times as UTC in "timestamp without time zone" columns. Every connection
// works in UTC, and those columns are read back as UTC (the driver would otherwise read them as this machine's local time).
pg.types.setTypeParser(pg.types.builtins.TIMESTAMP, (v: string) => new Date(`${v.replace(' ', 'T')}Z`));
// generous connection timeout: in development the database is reached through an SSH tunnel over the VPN
export const pool = new pg.Pool({ max: 8, idleTimeoutMillis: 30_000, connectionTimeoutMillis: 15_000, options: '-c TimeZone=UTC' });
pool.on('error', err => console.error(`database: ${err.message}`));

/** A query with parameters ($1, $2…). Values are never pasted into SQL. */
export async function q<T extends pg.QueryResultRow = any>(text: string, params: unknown[] = []) {
  return (await pool.query<T>(text, params)).rows;
}
export async function one<T extends pg.QueryResultRow = any>(text: string, params: unknown[] = []): Promise<T | undefined> {
  return (await q<T>(text, params))[0];
}

/** Run `fn` in a transaction: everything or nothing. */
export async function tx<T>(fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
  const c = await pool.connect();
  // a connection that drops while it's checked out (between queries) must not take the server down with it
  let broken: Error | null = null;
  const onError = (e: Error) => { broken = e; console.error(`database: connection lost mid-transaction: ${e.message}`); };
  c.on('error', onError);
  try {
    await c.query('begin');
    const out = await fn(c);
    await c.query('commit');
    return out;
  } catch (e) {
    await c.query('rollback').catch(() => {});
    throw e;
  } finally {
    c.off('error', onError);
    c.release(broken ?? undefined);   // a broken connection is thrown away, not reused
  }
}

// Arena's tables, applied in order on start-up. Never edit a step that has shipped: add a new one.
const MIGRATIONS: string[] = [
  `create table arena.profiles (
     user_id text primary key references public.users(id) on delete cascade,
     username text not null,
     username_key text not null unique,            -- lower-case, so names are unique ignoring case
     username_changed_at timestamptz,
     settings jsonb not null default '{}',
     created_at timestamptz not null default now()
   );
   -- one-time email codes (sign-up, a new device, password reset, email change); only a keyed hash is stored
   create table arena.codes (
     id bigserial primary key,
     email text not null,
     purpose text not null check (purpose in ('signup', 'login', 'reset', 'email')),
     code_hash text not null,
     payload jsonb not null default '{}',
     attempts int not null default 0,
     expires_at timestamptz not null,
     created_at timestamptz not null default now()
   );
   create index on arena.codes (email, purpose);
   -- logins: the cookie holds a random token and only its SHA-256 is stored; a password change ends them all
   create table arena.sessions (
     token_hash text primary key,
     user_id text not null references public.users(id) on delete cascade,
     session_version int not null,
     created_at timestamptz not null default now(),
     last_seen timestamptz not null default now(),
     expires_at timestamptz not null,
     user_agent text
   );
   create index on arena.sessions (user_id);
   -- devices that skip the login code for 30 days
   create table arena.devices (
     token_hash text primary key,
     user_id text not null references public.users(id) on delete cascade,
     label text,
     created_at timestamptz not null default now(),
     expires_at timestamptz not null
   );
   create index on arena.devices (user_id);`,
  // 2: the deck you duel with by default ("Dueling with" on the Decks page); cleared if that deck is deleted
  `alter table arena.profiles add column active_deck text references public.decks (id) on delete set null;`,
  // 3: match history (one row per player per match, so each person's history is theirs alone) and the cards each
  //    account summons, activates or Sets most (the Home screen's Decks tile and the Profile page)
  `create table arena.history (
     id           bigserial primary key,
     user_id      text not null references public.users (id) on delete cascade,
     match_id     uuid not null,
     kind         text not null check (kind in ('private', 'bot')),
     bo           smallint not null,
     opponent     text not null,
     opponent_id  text references public.users (id) on delete set null,
     deck_name    text not null,
     deck_id      text references public.decks (id) on delete set null,
     deck_cover   integer,
     result       text not null check (result in ('win', 'loss', 'draw')),
     score_for    smallint not null,
     score_against smallint not null,
     games        smallint not null,
     turns        integer not null,
     reason       text not null,
     started_at   timestamptz not null,
     ended_at     timestamptz not null default now()
   );
   create index on arena.history (user_id, ended_at desc);
   create table arena.card_use (
     user_id text not null references public.users (id) on delete cascade,
     code    integer not null,
     uses    integer not null default 0,
     primary key (user_id, code)
   );`,
  // 4: a match is saved once per player, however many times saving is retried
  `create unique index history_user_match on arena.history (user_id, match_id);`,
  // 5: unranked matches (the server pairs two players up)
  `alter table arena.history drop constraint history_kind_check;
   alter table arena.history add constraint history_kind_check check (kind in ('private', 'unranked', 'bot'));`,
];

export async function migrate() {
  // production's schema is made once by postgres (AUTHORIZATION arena), so the arena login needs no CREATE on the database
  if (!(await q("select 1 from pg_namespace where nspname = 'arena'")).length) await q('create schema arena');
  await q('create table if not exists arena.migrations (version int primary key, applied_at timestamptz not null default now())');
  const done = new Set((await q<{ version: number }>('select version from arena.migrations')).map(r => r.version));
  for (const [i, sql] of MIGRATIONS.entries()) {
    if (done.has(i + 1)) continue;
    await tx(async c => { await c.query(sql); await c.query('insert into arena.migrations (version) values ($1)', [i + 1]); });
    console.log(`database: applied Arena migration ${i + 1}`);
  }
  // expired codes, sessions and devices are cleared out regularly
  const sweep = () => q(`delete from arena.codes where expires_at < now() - interval '1 day';
    delete from arena.sessions where expires_at < now(); delete from arena.devices where expires_at < now();`).catch(() => {});
  sweep();
  setInterval(sweep, 6 * 3600_000).unref();
}
