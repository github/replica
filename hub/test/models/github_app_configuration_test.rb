require "test_helper"

class GithubAppConfigurationTest < ActiveSupport::TestCase
  test "encrypts credentials at rest" do
    credentials = github_app_configurations.attributes_for
    configuration = GithubAppConfiguration.install!(credentials)
    stored = GithubAppConfiguration.connection.select_one \
      "SELECT client_secret, private_key, webhook_secret FROM github_app_configurations WHERE id = #{configuration.id}"

    configuration.reload
    %i[client_secret private_key webhook_secret].each do |attribute|
      plaintext = credentials.fetch(attribute)
      ciphertext = stored.fetch(attribute.to_s)
      encrypted = JSON.parse(ciphertext)

      assert_not_includes ciphertext, plaintext
      assert_predicate encrypted.fetch("p"), :present?
      assert_predicate encrypted.fetch("h").fetch("iv"), :present?
      assert_predicate encrypted.fetch("h").fetch("at"), :present?
      assert_equal plaintext, configuration.public_send(attribute)
    end
  end

  test "enforces one row in the database" do
    github_app_configurations.create

    error = assert_raises(ActiveRecord::RecordNotUnique) do
      GithubAppConfiguration.insert_all! \
        [ github_app_configurations.attributes_for.merge(singleton_key: 1) ]
    end

    assert_match(/singleton_key/, error.message)
  end

  test "requires installation identity to match state" do
    configuration = github_app_configurations.new
    configuration.installation_state = "active"

    assert_not configuration.valid?
    assert_includes configuration.errors[:installation_id], "does not match installation state"
  end

  test "does not allow changing a pinned installation ID" do
    configuration = pinned_configuration

    assert_not configuration.update(installation_id: 789)
    assert_includes configuration.errors[:installation_id], "cannot replace a pinned connection"
    assert_equal 456, configuration.reload.installation_id
  end

  test "does not allow changing a pinned installation account ID" do
    configuration = pinned_configuration

    assert_not configuration.update(installation_account_github_id: 987)
    assert_includes configuration.errors[:installation_id], "cannot replace a pinned connection"
    assert_equal 654, configuration.reload.installation_account_github_id
  end

  test "does not allow changing a pinned installation owner type" do
    configuration = pinned_configuration

    assert_not configuration.update(installation_owner_type: "User")
    assert_includes configuration.errors[:installation_id], "cannot replace a pinned connection"
    assert_equal "Organization", configuration.reload.installation_owner_type
  end

  test "does not allow changing the policy of a pinned installation" do
    configuration = pinned_configuration

    assert_not configuration.update(installation_policy: "owner")
    assert_includes configuration.errors[:installation_id], "cannot replace a pinned connection"
    assert_equal "pinned", configuration.reload.installation_policy
  end

  test "allows updating a pinned installation account login and state" do
    configuration = pinned_configuration

    configuration.update!(installation_account_login: "new-customer", installation_state: "removed")

    assert_equal "new-customer", configuration.reload.installation_account_login
    assert_equal "removed", configuration.installation_state
  end

  private

  def pinned_configuration
    github_app_configurations.create_installed \
      installation_policy: "pinned", installation_account_github_id: 654,
      installation_account_login: "customer", installation_owner_type: "Organization"
  end
end
