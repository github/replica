class AddInstallationAccountToGithubAppConfigurations < ActiveRecord::Migration[8.1]
  def up
    add_column :github_app_configurations, :installation_account_github_id, :bigint
    execute <<~SQL
      UPDATE github_app_configurations
      SET installation_account_github_id = owner_github_id
      WHERE installation_id IS NOT NULL
    SQL
    add_check_constraint :github_app_configurations,
      "(installation_id IS NULL AND installation_account_github_id IS NULL) OR " \
        "(installation_id IS NOT NULL AND installation_account_github_id IS NOT NULL " \
        "AND installation_account_github_id > 0)",
      name: "github_app_configurations_installation_account"
  end

  def down
    remove_check_constraint :github_app_configurations, name: "github_app_configurations_installation_account"
    remove_column :github_app_configurations, :installation_account_github_id
  end
end
