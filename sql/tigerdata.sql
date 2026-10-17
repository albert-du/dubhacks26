-- TigerData (Timescale) schema for Dump metrics.
-- No personal data lives here: only dumpster ids, counts, and timestamps.

create extension if not exists timescaledb;

create table if not exists upload_events (
  time        timestamptz not null,
  dumpster_id text        not null,
  kind        text        not null,  -- image | video
  bytes       bigint      not null
);
select create_hypertable('upload_events', 'time', if_not_exists => true);
create index if not exists upload_events_room on upload_events (dumpster_id, time desc);

create table if not exists engagement_events (
  time        timestamptz not null,
  dumpster_id text        not null,
  type        text        not null   -- join | enroll | vote | sticker | view
);
select create_hypertable('engagement_events', 'time', if_not_exists => true);

-- Live upload velocity for stage dashboards.
create materialized view if not exists upload_velocity_1m
with (timescaledb.continuous) as
select time_bucket('1 minute', time) as bucket,
       dumpster_id,
       count(*)   as uploads,
       sum(bytes) as bytes
  from upload_events
 group by bucket, dumpster_id
with no data;

select add_continuous_aggregate_policy('upload_velocity_1m',
  start_offset => interval '1 hour',
  end_offset   => interval '1 minute',
  schedule_interval => interval '1 minute',
  if_not_exists => true);

-- Metrics themselves are ephemeral-ish: keep 14 days.
select add_retention_policy('upload_events', interval '14 days', if_not_exists => true);
select add_retention_policy('engagement_events', interval '14 days', if_not_exists => true);

-- Countdown / cleanup execution queue. The worker's source of truth is Mongo's expiresAt;
-- this table is the audit trail proving each room was purged on time.
create table if not exists cleanup_queue (
  dumpster_id text primary key,
  run_at      timestamptz not null,
  executed_at timestamptz
);

create table if not exists cleanup_runs (
  time            timestamptz not null,
  dumpster_id     text        not null,
  media_deleted   int         not null,
  vectors_deleted int         not null,
  objects_deleted int         not null,
  reason          text        not null  -- expired | host | orphan
);
select create_hypertable('cleanup_runs', 'time', if_not_exists => true);

-- VEYZL/compliance check: anything overdue by more than 10 minutes is a violation.
create or replace view overdue_cleanups as
select dumpster_id, run_at, now() - run_at as overdue_by
  from cleanup_queue
 where executed_at is null and run_at < now() - interval '10 minutes';
