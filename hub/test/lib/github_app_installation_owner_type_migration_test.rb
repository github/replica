require "test_helper"
require Rails.root.join("db/migrate/20261026200000_add_pinned_github_app_installations").to_s
require Rails.root.join("db/migrate/20261029190000_rename_github_app_installation_owner_type").to_s

class GithubAppInstallationOwnerTypeMigrationTest < ActiveSupport::TestCase
  class UpgradeRecord < ActiveRecord::Base
    self.abstract_class = true
  end

  test "renaming and rolling back preserve stored configuration and enforce the pinned owner type" do
    UpgradeRecord.establish_connection(adapter: "sqlite3", database: ":memory:")
    connection = UpgradeRecord.connection
    connection.create_table(:github_app_configurations) do |table|
      table.bigint :github_app_id
      table.bigint :owner_github_id
      table.bigint :installation_id
      table.bigint :installation_account_github_id
      table.string :app_slug
      table.string :client_id
      table.string :owner_login
      table.string :owner_type
      table.string :installation_state
      table.bigint :credential_revision
      table.integer :lock_version
      table.text :client_secret
      table.text :private_key
      table.text :webhook_secret
      table.text :previous_webhook_secret
    end
    historical_migration = AddPinnedGithubAppInstallations.new
    historical_migration.suppress_messages { historical_migration.exec_migration(connection, :up) }
    connection.execute <<~SQL
      INSERT INTO github_app_configurations (
        github_app_id, app_slug, client_id, owner_github_id, owner_login, owner_type,
        installation_id, installation_account_github_id, installation_account_login,
        installation_account_type, installation_policy, installation_state, credential_revision,
        lock_version, client_secret, private_key, webhook_secret, previous_webhook_secret
      ) VALUES (
        123, 'replica-hub-test', 'Iv1.test', 321, 'operator_acme', 'User',
        456, 654, 'customer', 'Organization', 'pinned', 'active', 7,
        3, 'stored-client-secret', 'stored-private-key', 'stored-webhook-secret', 'stored-previous-secret'
      )
    SQL
    original = connection.select_one("SELECT * FROM github_app_configurations")
    migration = RenameGithubAppInstallationOwnerType.new

    [
      [ :up, "installation_owner_type" ],
      [ :down, "installation_account_type" ],
      [ :up, "installation_owner_type" ]
    ].each do |direction, column|
      migration.suppress_messages { migration.exec_migration(connection, direction) }

      expected = original.except("installation_account_type").merge(column => "Organization")
      assert_equal expected, connection.select_one("SELECT * FROM github_app_configurations")
      connection.execute("UPDATE github_app_configurations SET #{column} = 'User'")
      assert_equal "User", connection.select_value("SELECT #{column} FROM github_app_configurations")
      [ "'Enterprise'", "NULL" ].each do |invalid_type|
        assert_raises(ActiveRecord::StatementInvalid) do
          connection.execute("UPDATE github_app_configurations SET #{column} = #{invalid_type}")
        end
      end
      connection.execute("UPDATE github_app_configurations SET #{column} = 'Organization'")
    end
  ensure
    UpgradeRecord.connection_pool.disconnect!
  end
end
