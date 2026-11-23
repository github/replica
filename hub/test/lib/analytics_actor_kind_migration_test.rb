require "test_helper"
require Rails.root.join("db/migrate/20261110110000_add_actor_kind_to_analytics_events").to_s

class AnalyticsActorKindMigrationTest < ActiveSupport::TestCase
  class UpgradeRecord < ActiveRecord::Base
    self.abstract_class = true
  end

  test "backfills legacy actor kinds without changing actor identities" do
    UpgradeRecord.establish_connection(adapter: "sqlite3", database: ":memory:")
    connection = UpgradeRecord.connection
    connection.create_table(:analytics_events) do |table|
      table.string :name, null: false
      table.string :source_key, null: false
      table.string :actor_id
    end
    connection.create_table(:prototypes) do |table|
      table.integer :registration_task_connection_id
    end
    connection.execute <<~SQL
      INSERT INTO prototypes (id, registration_task_connection_id)
      VALUES (1, NULL), (2, 3002)
    SQL
    connection.execute <<~SQL
      INSERT INTO analytics_events (id, name, source_key, actor_id)
      VALUES
        (1, 'prototype_registered', 'prototype/1/registered', 'person-actor-id'),
        (2, 'prototype_registered', 'prototype/2/registered', 'workload-actor-id'),
        (3, 'review_comment_created', 'comment/3/created', NULL)
    SQL

    migration = AddActorKindToAnalyticsEvents.new
    migration.suppress_messages { migration.exec_migration(connection, :up) }

    rows = connection.select_all(
      "SELECT actor_id, actor_kind FROM analytics_events ORDER BY id"
    ).to_a
    assert_equal [
      { "actor_id" => "person-actor-id", "actor_kind" => "person" },
      { "actor_id" => "workload-actor-id", "actor_kind" => "workload" },
      { "actor_id" => nil, "actor_kind" => "system" }
    ], rows
  ensure
    UpgradeRecord.connection_pool.disconnect!
  end
end
