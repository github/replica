class RenameGithubAppInstallationOwnerType < ActiveRecord::Migration[8.1]
  def change
    remove_check_constraint \
      :github_app_configurations,
      "installation_policy <> 'pinned' OR " \
        "(installation_id IS NOT NULL AND installation_account_github_id IS NOT NULL AND " \
        "installation_account_type IN ('Organization', 'User') AND installation_account_type IS NOT NULL AND " \
        "installation_account_login IS NOT NULL AND length(trim(installation_account_login)) > 0)",
      name: "github_app_configurations_pinned_installation"
    rename_column :github_app_configurations, :installation_account_type, :installation_owner_type
    add_check_constraint \
      :github_app_configurations,
      "installation_policy <> 'pinned' OR " \
        "(installation_id IS NOT NULL AND installation_account_github_id IS NOT NULL AND " \
        "installation_owner_type IN ('Organization', 'User') AND installation_owner_type IS NOT NULL AND " \
        "installation_account_login IS NOT NULL AND length(trim(installation_account_login)) > 0)",
      name: "github_app_configurations_pinned_installation"
  end
end
