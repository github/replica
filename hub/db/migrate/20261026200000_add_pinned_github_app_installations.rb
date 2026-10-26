class AddPinnedGithubAppInstallations < ActiveRecord::Migration[8.1]
  def change
    add_column :github_app_configurations, :installation_policy, :string, default: "owner", null: false
    add_column :github_app_configurations, :installation_account_login, :string
    add_column :github_app_configurations, :installation_account_type, :string
    add_check_constraint \
      :github_app_configurations,
      "installation_policy IN ('owner', 'pinned')",
      name: "github_app_configurations_installation_policy"
    add_check_constraint \
      :github_app_configurations,
      "installation_policy <> 'pinned' OR " \
        "(installation_id IS NOT NULL AND installation_account_github_id IS NOT NULL AND " \
        "installation_account_type IN ('Organization', 'User') AND installation_account_type IS NOT NULL AND " \
        "installation_account_login IS NOT NULL AND length(trim(installation_account_login)) > 0)",
      name: "github_app_configurations_pinned_installation"
  end
end
