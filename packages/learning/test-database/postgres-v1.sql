
      create table replica_learning.records (
        seq bigint generated always as identity primary key,
        stream text collate "C" not null,
        id text collate "C" not null,
        scope_key text collate "C" not null,
        occurred_at text collate "C",
        episode_id text collate "C",
        operation text collate "C",
        digest text collate "C" not null,
        body text not null,
        unique (stream, id)
      );
      create index records_by_scope on replica_learning.records (stream, scope_key, seq);
      create index records_by_scope_id on replica_learning.records (stream, scope_key, id);
      create index records_by_episode on replica_learning.records (stream, scope_key, episode_id);
      create index records_by_time on replica_learning.records (stream, scope_key, occurred_at);
      create index records_by_operation on replica_learning.records (stream, scope_key, operation);
      create table replica_learning.memory_versions (
        seq bigint generated always as identity primary key,
        id text collate "C" not null,
        version integer not null,
        scope_key text collate "C" not null,
        updated_at text collate "C",
        operation text collate "C",
        digest text collate "C" not null,
        body text not null,
        unique (id, version)
      );
      create index memory_versions_by_scope on replica_learning.memory_versions (scope_key, seq);
      create index memory_versions_by_scope_id on replica_learning.memory_versions (scope_key, id);
      create index memory_versions_by_time on replica_learning.memory_versions (scope_key, updated_at);
      create index memory_versions_by_operation on replica_learning.memory_versions (scope_key, operation);
