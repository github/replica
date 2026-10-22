require "test_helper"
require Rails.root.join("db/migrate/20261021195500_add_installation_account_to_github_app_configurations").to_s

class GithubAppInstallationAccountMigrationTest < ActiveSupport::TestCase
  class UpgradeRecord < ActiveRecord::Base
    self.abstract_class = true
  end

  test "upgrading preserves saved installations and records their accounts" do
    UpgradeRecord.establish_connection(adapter: "sqlite3", database: ":memory:")
    connection = UpgradeRecord.connection
    connection.create_table(:github_app_configurations) do |table|
      table.bigint :owner_github_id, null: false
      table.bigint :installation_id
    end
    connection.execute <<~SQL
      INSERT INTO github_app_configurations (owner_github_id, installation_id)
      VALUES (321, 456), (654, NULL)
    SQL
    migration = AddInstallationAccountToGithubAppConfigurations.new
    migration.define_singleton_method(:connection) { connection }
    migration.suppress_messages { migration.up }

    installations = connection.select_rows <<~SQL
      SELECT owner_github_id, installation_id, installation_account_github_id
      FROM github_app_configurations ORDER BY id
    SQL
    assert_equal [ [ 321, 456, 321 ], [ 654, nil, nil ] ], installations
  ensure
    UpgradeRecord.connection_pool.disconnect!
  end
end
