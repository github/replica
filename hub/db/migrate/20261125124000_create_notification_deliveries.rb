class CreateNotificationDeliveries < ActiveRecord::Migration[8.1]
  def change
    create_table :notification_settings do |t|
      t.boolean :enabled, null: false, default: true
      t.timestamps
    end
    add_check_constraint :notification_settings, "id = 1", name: "notification_settings_singleton"

    create_table :notification_preferences do |t|
      t.references :recipient, null: false, index: { unique: true },
        foreign_key: { to_table: :github_identities, on_delete: :cascade }
      t.boolean :enabled, null: false, default: true
      t.timestamps
    end

    create_table :notification_mutes do |t|
      t.references :recipient, null: false, foreign_key: { to_table: :github_identities, on_delete: :cascade }
      t.references :prototype, null: false, foreign_key: { on_delete: :cascade }
      t.timestamps
    end
    add_index :notification_mutes, %i[recipient_id prototype_id], unique: true

    create_table :notification_deliveries do |t|
      t.references :notification, null: false, index: { unique: true }, foreign_key: { on_delete: :cascade }
      t.string :provider_key, null: false
      t.string :state, null: false, default: "pending"
      t.integer :attempts, null: false, default: 0
      t.datetime :due_at, null: false
      t.datetime :enqueue_claim_expires_at
      t.string :lease_token
      t.string :failure_code
      t.datetime :delivered_at
      t.timestamps
    end
    add_index :notification_deliveries, %i[state due_at]
    add_check_constraint \
      :notification_deliveries,
      "state IN ('pending', 'delivering', 'retryable', 'succeeded', 'failed', 'canceled')",
      name: "notification_deliveries_state"
    add_check_constraint :notification_deliveries, "attempts >= 0", name: "notification_deliveries_attempts"

    remove_check_constraint \
      :fresh_authorizations,
      "purpose IN ('never_expiring_share', 'analytics_destination', 'hub_admin_management', " \
        "'sharing_settings', 'session_revocation', 'github_app_reset', 'github_app_credentials', " \
        "'github_app_webhook', 'github_app_finish_webhook', 'copilot_connection', 'copilot_disconnection')",
      name: "fresh_authorizations_purpose"
    add_check_constraint \
      :fresh_authorizations,
      "purpose IN ('never_expiring_share', 'analytics_destination', 'hub_admin_management', " \
        "'sharing_settings', 'session_revocation', 'github_app_reset', 'github_app_credentials', " \
        "'github_app_webhook', 'github_app_finish_webhook', 'copilot_connection', " \
        "'copilot_disconnection', 'notification_delivery')",
      name: "fresh_authorizations_purpose"
  end
end
