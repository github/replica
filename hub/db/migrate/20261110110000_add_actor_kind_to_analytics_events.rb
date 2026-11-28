class AddActorKindToAnalyticsEvents < ActiveRecord::Migration[8.1]
  def up
    add_column :analytics_events, :actor_kind, :string, null: false, default: "system"
    execute "UPDATE analytics_events SET actor_kind = 'person' WHERE actor_id IS NOT NULL"
    execute <<~SQL
      UPDATE analytics_events SET actor_kind = 'workload'
      WHERE actor_id IS NOT NULL AND name = 'prototype_registered'
        AND EXISTS (
          SELECT 1 FROM prototypes
          WHERE analytics_events.source_key = 'prototype/' || prototypes.id || '/registered'
            AND prototypes.registration_task_connection_id IS NOT NULL
        )
    SQL
    add_check_constraint :analytics_events,
      "(actor_kind = 'system' AND actor_id IS NULL) OR " \
        "(actor_kind IN ('person', 'workload') AND actor_id IS NOT NULL)",
      name: "analytics_events_actor_kind"
  end

  def down
    remove_check_constraint :analytics_events, name: "analytics_events_actor_kind"
    remove_column :analytics_events, :actor_kind
  end
end
