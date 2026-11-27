class AddHubFeatureUsageEvents < ActiveRecord::Migration[8.1]
  EXISTING_TYPES = %w[
    prototype_registered prototype_first_published build_published
    review_comment_created review_reply_added review_thread_resolved review_thread_reopened
  ].freeze
  NEW_TYPES = %w[
    share_link_created shared_preview_opened template_previewed canvas_pairing_approved
    review_reaction_added review_mention_added notification_opened
    learning_run_requested learning_decision_recorded
  ].freeze

  disable_ddl_transaction!

  def up
    update_event_constraint(EXISTING_TYPES + NEW_TYPES) do
      add_column :notifications, :analytics_opened, :boolean, null: false, default: false
    end
  end

  def down
    update_event_constraint(EXISTING_TYPES) do
      remove_column :notifications, :analytics_opened
    end
  end

  private

  # Rails rebuilds the SQLite table to change a check. Disable foreign keys before opening
  # the transaction so dropping the old table does not cascade to queued deliveries.
  def update_event_constraint(types)
    connection.disable_referential_integrity do
      connection.transaction do
        remove_check_constraint :analytics_events, name: "analytics_events_name"
        names = types.map { connection.quote(_1) }.join(", ")
        add_check_constraint :analytics_events, "name IN (#{names})", name: "analytics_events_name"
        yield
        connection.check_all_foreign_keys_valid!
      end
    end
  end
end
