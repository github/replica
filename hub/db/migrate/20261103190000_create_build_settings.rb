# Stores one administrator-owned import limit and supports the existing authorization flow.
class CreateBuildSettings < ActiveRecord::Migration[8.1]
  PREVIOUS_PURPOSES = "purpose IN ('never_expiring_share', 'analytics_destination', 'hub_admin_management', " \
    "'sharing_settings', 'session_revocation', 'github_app_reset', 'github_app_credentials', " \
    "'github_app_webhook', 'github_app_finish_webhook', 'copilot_connection', 'copilot_disconnection')".freeze

  def change
    create_table :build_settings do |t|
      t.integer :maximum_package_mib, null: false, default: 150
      t.timestamps
    end
    add_check_constraint :build_settings, "id = 1", name: "build_settings_singleton"
    add_check_constraint :build_settings, "maximum_package_mib > 0 AND typeof(maximum_package_mib) = 'integer'",
      name: "build_settings_positive_limit"
    remove_check_constraint :fresh_authorizations, PREVIOUS_PURPOSES, name: "fresh_authorizations_purpose"
    add_check_constraint :fresh_authorizations,
      PREVIOUS_PURPOSES.delete_suffix(")") + ", 'build_settings')",
      name: "fresh_authorizations_purpose"
  end
end
