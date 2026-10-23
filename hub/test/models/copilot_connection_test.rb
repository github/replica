require "test_helper"

class CopilotConnectionTest < ActiveSupport::TestCase
  CLI = Rails.root.join("test/fixtures/files/fake-replica-learning.mjs").to_s

  setup do
    @admin = users.create(hub_admin: true)
    @session = @admin.sessions.create!(fresh_authorized_at: Time.current)
    @previous_cli = ENV["REPLICA_LEARNING_CLI"]
    @previous_token = Rails.configuration.x.copilot_token
    @previous_billing = Rails.configuration.x.copilot_billing
    ENV["REPLICA_LEARNING_CLI"] = CLI
    Rails.configuration.x.copilot_token = "copilot-user-token"
  end

  teardown do
    ENV["REPLICA_LEARNING_CLI"] = @previous_cli
    Rails.configuration.x.copilot_token = @previous_token
    Rails.configuration.x.copilot_billing = @previous_billing
  end

  test "connects for a current administrator with fresh proof and keeps only the token's digest" do
    connection = CopilotConnection.connect!(actor: @admin, browser_session: @session)

    assert_equal @admin, connection.user
    assert_equal Digest::SHA256.hexdigest("copilot-user-token"), connection.token_digest
    stored = CopilotConnection.connection.select_rows("SELECT * FROM copilot_connections").flatten.map(&:to_s)
    assert_not stored.any? { _1.include?("copilot-user-token") }
    assert_equal "copilot-user-token", connection.access_token!
    event = SecurityAuditEvent.where(action: "copilot_connection.connect").sole
    assert_equal [ "succeeded", @admin.id, @session.id ], [ event.outcome, event.user_id, event.context.fetch("session_id") ]
  end

  test "connecting again replaces the connection and names the administrator who connected last" do
    CopilotConnection.connect!(actor: @admin, browser_session: @session)
    other = users.create(github_id: 1_002, login: "hubot", hub_admin: true)
    travel 1.day

    connection = CopilotConnection.connect!(actor: other, browser_session: other.sessions.create!(fresh_authorized_at: Time.current))

    assert_equal [ other ], CopilotConnection.all.map(&:user)
    assert_equal Time.current.to_date, connection.created_at.to_date
  end

  test "connects nothing without a token, and never asks Copilot" do
    Rails.configuration.x.copilot_token = nil
    ENV["REPLICA_LEARNING_CLI"] = "/nonexistent/replica-learning.mjs"

    error = assert_raises(CopilotConnection::ChangeDenied) do
      CopilotConnection.connect!(actor: @admin, browser_session: @session)
    end

    assert_equal :no_token, error.reason
    assert_empty CopilotConnection.all
  end

  test "keeps nothing when Copilot refuses the token, and marks an existing connection refused" do
    Rails.configuration.x.copilot_token = "no-copilot-token"

    assert_raises(CopilotConnection::Refused) { CopilotConnection.connect!(actor: @admin, browser_session: @session) }
    assert_empty CopilotConnection.all

    Rails.configuration.x.copilot_token = "copilot-user-token"
    connection = CopilotConnection.connect!(actor: @admin, browser_session: @session)
    Rails.configuration.x.copilot_token = "no-copilot-token"
    assert_raises(CopilotConnection::Refused) { CopilotConnection.connect!(actor: @admin, browser_session: @session) }

    assert connection.reload.refused?
    assert_equal "failed", SecurityAuditEvent.where(action: "copilot_connection.use").sole.outcome
  end

  test "needs a current administrator with their own Session and fresh GitHub proof" do
    other = users.create(github_id: 1_002, login: "hubot")
    assert_raises(CopilotConnection::ChangeDenied) do
      CopilotConnection.connect!(actor: other, browser_session: other.sessions.create!(fresh_authorized_at: Time.current))
    end
    assert_raises(CopilotConnection::ChangeDenied) do
      CopilotConnection.connect!(actor: @admin, browser_session: other.sessions.create!(fresh_authorized_at: Time.current))
    end

    @session.update!(fresh_authorized_at: 1.hour.ago)
    assert_raises(FreshAuthorization::Invalid) { CopilotConnection.connect!(actor: @admin, browser_session: @session) }
    assert_empty CopilotConnection.all
  end

  test "a refusal applies only to the token Copilot refused, so a replaced token starts fresh" do
    connection = CopilotConnection.connect!(actor: @admin, browser_session: @session)

    assert connection.refuse!
    assert_not connection.refuse!, "a second refusal of the same token changes nothing"
    assert connection.refused?
    assert_not connection.usable?
    assert_raises(CopilotConnection::Refused) { connection.access_token! }

    Rails.configuration.x.copilot_token = "renewed-user-token"
    assert_not connection.refused?
    assert connection.usable?
    assert_equal "renewed-user-token", connection.access_token!

    connection.verified!
    assert_nil connection.reload.refused_at
    assert_equal Digest::SHA256.hexdigest("renewed-user-token"), connection.token_digest
  end

  test "an old token's late refusal cannot replace the current token's refusal" do
    connection = CopilotConnection.connect!(actor: @admin, browser_session: @session)
    earlier = CopilotConnection.find(connection.id)
    Rails.configuration.x.copilot_token = "renewed-user-token"
    connection.refuse!(credential: "renewed-user-token")
    before = connection.reload.attributes

    recorded = earlier.refuse!(credential: "copilot-user-token")
    assert_equal before, connection.reload.attributes
    assert_raises(CopilotConnection::Refused) { connection.access_token! }
    assert_not recorded
  end

  test "an older worker's result cannot overwrite a token result another worker saved" do
    connection = CopilotConnection.connect!(actor: @admin, browser_session: @session)
    earlier_failure = CopilotConnection.find(connection.id)
    earlier_success = CopilotConnection.find(connection.id)
    Rails.configuration.x.copilot_token = "renewed-user-token"
    connection.refuse!(credential: "renewed-user-token")
    before = connection.reload.attributes
    Rails.configuration.x.copilot_token = "copilot-user-token"

    recorded_failure = earlier_failure.refuse!(credential: "copilot-user-token")
    recorded_success = earlier_success.verified!(credential: "copilot-user-token")
    assert_equal before, connection.reload.attributes
    assert_not recorded_failure
    assert_not recorded_success
  end

  test "a late success after successive rotations cannot clear the current token's refusal" do
    connection = CopilotConnection.connect!(actor: @admin, browser_session: @session)
    connection.refuse!
    Rails.configuration.x.copilot_token = "renewed-user-token"
    earlier = CopilotConnection.find(connection.id)
    assert_equal "renewed-user-token", earlier.access_token!
    Rails.configuration.x.copilot_token = "third-fixture-token"
    connection.refuse!(credential: "third-fixture-token")
    before = connection.reload.attributes

    recorded = earlier.verified!(credential: "renewed-user-token")
    assert_equal before, connection.reload.attributes
    assert_raises(CopilotConnection::Refused) { connection.access_token! }
    assert_not recorded
  end

  test "an in-flight success cannot clear a refusal of the same token without an explicit recheck" do
    connection = CopilotConnection.connect!(actor: @admin, browser_session: @session)
    earlier = CopilotConnection.find(connection.id)
    connection.refuse!

    earlier.verified!(credential: "copilot-user-token")
    assert connection.reload.refused?

    checked = CopilotConnection.connect!(actor: @admin, browser_session: @session)
    assert_not checked.refused?
    assert_equal "copilot-user-token", checked.access_token!
  end

  test "a newly configured token can record a refusal or a successful first use" do
    connection = CopilotConnection.connect!(actor: @admin, browser_session: @session)
    Rails.configuration.x.copilot_token = "renewed-user-token"

    assert connection.refuse!(credential: "renewed-user-token")
    assert connection.reload.refused?

    Rails.configuration.x.copilot_token = "third-fixture-token"
    assert connection.verified!(credential: "third-fixture-token")
    assert_not connection.reload.refused?
    assert_equal Digest::SHA256.hexdigest("third-fixture-token"), connection.token_digest
  end

  test "late results cannot recreate a deleted connection or affect its replacement" do
    connection = CopilotConnection.connect!(actor: @admin, browser_session: @session)
    earlier = CopilotConnection.find(connection.id)
    CopilotConnection.disconnect!(actor: @admin, browser_session: @session)

    assert_not earlier.refuse!(credential: "copilot-user-token")
    assert_not earlier.verified!(credential: "copilot-user-token")
    assert_nil CopilotConnection.current

    replacement = CopilotConnection.connect!(actor: @admin, browser_session: @session)
    replacement.refuse!
    assert_not earlier.refuse!(credential: "copilot-user-token")
    assert_not earlier.verified!(credential: "copilot-user-token")
    assert replacement.reload.refused?
  end

  test "a failed explicit check cannot refuse a connection replaced while Copilot answered" do
    connection = CopilotConnection.connect!(actor: @admin, browser_session: @session)
    check = CopilotConnection.method(:check!)
    replacement = nil
    CopilotConnection.define_singleton_method(:check!) do |_token|
      connection.destroy!
      replacement = CopilotConnection.create! \
        user: connection.user,
        token_digest: connection.token_digest,
        verified_at: Time.current
      raise CopilotConnection::Refused, "The earlier check was refused."
    end

    assert_raises(CopilotConnection::Refused) do
      CopilotConnection.connect!(actor: @admin, browser_session: @session)
    end

    assert_equal replacement.id, CopilotConnection.current.id
    assert_not replacement.reload.refused?
    assert_empty SecurityAuditEvent.where(action: "copilot_connection.use")
  ensure
    CopilotConnection.define_singleton_method(:check!, check) if check
    CopilotConnection.private_class_method(:check!)
  end

  test "hands out no token once the operator removes it, an administrator disconnects, or the person who connected stops administering" do
    connection = CopilotConnection.connect!(actor: @admin, browser_session: @session)
    loaded = CopilotConnection.find(connection.id)

    Rails.configuration.x.copilot_token = nil
    assert_not connection.usable?
    assert_raises(CopilotConnection::Refused) { connection.access_token! }

    Rails.configuration.x.copilot_token = "copilot-user-token"
    @admin.update_columns(hub_admin: false)
    assert_raises(CopilotConnection::Refused) { connection.access_token! }

    @admin.update_columns(hub_admin: true)
    CopilotConnection.disconnect!(actor: @admin, browser_session: @session)
    assert_raises(CopilotConnection::Refused) { loaded.access_token! }
  end

  test "with organization billing, connects with a new App token, ignores the operator's token, and keeps only the installation's digest" do
    configuration = github_app_configurations.create_installed
    Rails.configuration.x.copilot_billing = "organization"
    Rails.configuration.x.copilot_token = "no-copilot-token"
    stub_github_copilot_token("copilot-user-token", "app-token-2", "app-token-3")

    connection = CopilotConnection.connect!(actor: @admin, browser_session: @session)

    assert_equal CopilotConnection.digest(configuration.copilot_credential), connection.token_digest
    assert_equal %w[app-token-2 app-token-3], [ connection.access_token!, connection.access_token! ]
  end

  test "with organization billing, Hub has no credential without an active organization installation of its App" do
    Rails.configuration.x.copilot_billing = "organization"

    [ nil, { owner_type: "User" }, { installation_state: "suspended" } ].each do |installation|
      GithubAppConfiguration.delete_all
      github_app_configurations.create_installed(**installation) if installation

      error = assert_raises(CopilotConnection::ChangeDenied, installation.inspect) do
        CopilotConnection.connect!(actor: @admin, browser_session: @session)
      end
      assert_equal :no_token, error.reason, installation.inspect
    end
  end

  test "with organization billing, a recheck refuses the connection when the App lacks the Copilot permission, but not when GitHub fails" do
    github_app_configurations.create_installed
    Rails.configuration.x.copilot_billing = "organization"
    stub_github_copilot_token("copilot-user-token")
    connection = CopilotConnection.connect!(actor: @admin, browser_session: @session)

    stub_github_copilot_token(error_status: 500)
    assert_raises(Learning::Error) { CopilotConnection.connect!(actor: @admin, browser_session: @session) }
    assert_not connection.reload.refused?

    stub_github_copilot_token(error_status: 422, error_body: github_copilot_permission_missing_error)
    assert_raises(CopilotConnection::PermissionMissing) do
      CopilotConnection.connect!(actor: @admin, browser_session: @session)
    end
    assert connection.reload.refused?

    connection.update!(refused_at: nil)
    stub_github_copilot_token \
      error_status: 422,
      error_body: { message: "Validation Failed", errors: [ { code: "abuse" } ] }
    assert_raises(Learning::Error) { CopilotConnection.connect!(actor: @admin, browser_session: @session) }
    assert_not connection.reload.refused?
  end

  test "turning on organization billing leaves a connection made with a token unusable until an administrator connects again" do
    github_app_configurations.create_installed
    connection = CopilotConnection.connect!(actor: @admin, browser_session: @session)
    Rails.configuration.x.copilot_billing = "organization"
    mint = stub_github_copilot_token("copilot-user-token")

    assert_not connection.usable?
    error = assert_raises(CopilotConnection::Refused) { connection.access_token! }
    assert_equal "A Hub administrator must connect Copilot again before Hub bills the organization.", error.message
    assert_not_requested mint

    assert CopilotConnection.connect!(actor: @admin, browser_session: @session).usable?
  end

  test "an in-flight success cannot confirm organization billing for a connection made with a token" do
    github_app_configurations.create_installed
    connection = CopilotConnection.connect!(actor: @admin, browser_session: @session)
    Rails.configuration.x.copilot_billing = "organization"

    assert_not connection.verified!
    assert_not connection.reload.usable?
  end

  test "with organization billing, a refusal belongs to the App installation, and a new installation waits for an administrator to connect it" do
    configuration = github_app_configurations.create_installed
    Rails.configuration.x.copilot_billing = "organization"
    stub_github_copilot_token("copilot-user-token")
    connection = CopilotConnection.connect!(actor: @admin, browser_session: @session)
    assert connection.refuse!

    configuration.update!(installation_id: 789)
    stub_github_copilot_token("renewed-user-token", installation_id: 789)
    assert_not connection.refused?
    assert_not connection.usable?

    reconnected = CopilotConnection.connect!(actor: @admin, browser_session: @session)
    assert_equal "renewed-user-token", reconnected.access_token!
  end

  test "organization billing stays bound to the exact App configuration an administrator confirmed" do
    changes = {
      "replacement configuration" => lambda do |configuration|
        id = configuration.id
        configuration.delete
        github_app_configurations.create_installed(id: id + 100)
      end,
      "App identity" => ->(configuration) { configuration.update_columns(github_app_id: 999) },
      "App client identity" => ->(configuration) { configuration.update_columns(client_id: "Iv1.replacement") },
      "credential revision" => lambda do |configuration|
        configuration.update_columns(credential_revision: configuration.credential_revision + 1)
      end,
      "installation" => ->(configuration) { configuration.update_columns(installation_id: 789) },
      "organization owner" => ->(configuration) { configuration.update_columns(owner_github_id: 654) },
      "organization owner type" => ->(configuration) { configuration.update_columns(owner_type: "User") },
      "suspended installation" => ->(configuration) { configuration.update_columns(installation_state: "suspended") },
      "removed installation" => ->(configuration) { configuration.update_columns(installation_state: "removed") }
    }

    changes.each do |label, change|
      CopilotConnection.delete_all
      GithubAppConfiguration.delete_all
      configuration = github_app_configurations.create_installed
      Rails.configuration.x.copilot_billing = "organization"
      stub_github_copilot_token("copilot-user-token")
      connection = CopilotConnection.connect!(actor: @admin, browser_session: @session)
      WebMock.reset_executed_requests!

      change.call(configuration)
      installation_id = GithubAppConfiguration.current.installation_id
      mint = stub_github_copilot_token("unconfirmed-token", installation_id:)

      assert_not connection.reload.usable?, label
      assert_raises(CopilotConnection::Refused, label) { connection.access_token! }
      assert_not_requested mint
    end
  end

  test "organization billing confirmation survives a non-billing configuration write" do
    configuration = github_app_configurations.create_installed
    Rails.configuration.x.copilot_billing = "organization"
    stub_github_copilot_token("copilot-user-token")
    connection = CopilotConnection.connect!(actor: @admin, browser_session: @session)
    configuration.touch
    stub_github_copilot_token("still-confirmed-token")

    assert connection.reload.usable?
    assert_equal "still-confirmed-token", connection.access_token!
  end

  test "organization billing hands out no token when the connection is refused during minting" do
    github_app_configurations.create_installed
    Rails.configuration.x.copilot_billing = "organization"
    connection = CopilotConnection.create! \
      user: @admin,
      token_digest: CopilotConnection.digest(CopilotConnection.credential),
      verified_at: 1.day.ago
    request = stub_request(:post, "#{GITHUB_API_URL}/app/installations/456/access_tokens")
      .with(body: { permissions: { organization_copilot_requests: "read" } })
      .to_return do
        connection.refuse!
        {
          status: 201,
          body: JSON.generate(
            token: "refused-token",
            expires_at: 1.hour.from_now.iso8601,
            permissions: { organization_copilot_requests: "read" }
          ),
          headers: { "Content-Type" => "application/json" }
        }
      end

    assert_raises(CopilotConnection::Refused) { connection.access_token! }
    assert connection.reload.refused?
    assert_requested request
  end

  test "Hub starts with organization billing and refuses a billing choice it does not know" do
    initializer = Rails.root.join("config/initializers/deployment_configuration.rb")
    Rails.configuration.x.copilot_billing = "organization"
    assert_nothing_raised { load initializer }

    Rails.configuration.x.copilot_billing = "organisation"
    error = assert_raises(RuntimeError) { load initializer }
    assert_match(/\AREPLICA_COPILOT_BILLING must be token_owner or organization: .*organisation/, error.message)
  end

  test "disconnects for a current administrator with fresh proof, and needs a connection to disconnect" do
    CopilotConnection.connect!(actor: @admin, browser_session: @session)

    CopilotConnection.disconnect!(actor: @admin, browser_session: @session)

    assert_empty CopilotConnection.all
    event = SecurityAuditEvent.where(action: "copilot_connection.disconnect").sole
    assert_equal [ "succeeded", @admin.id ], [ event.outcome, event.user_id ]
    error = assert_raises(CopilotConnection::ChangeDenied) do
      CopilotConnection.disconnect!(actor: @admin, browser_session: @session)
    end
    assert_equal :not_connected, error.reason
  end

  test "removing the role of the person who connected Copilot disconnects it" do
    CopilotConnection.connect!(actor: @admin, browser_session: @session)
    other = users.create(github_id: 1_002, login: "hubot", hub_admin: true)
    other_session = other.sessions.create!(fresh_authorized_at: Time.current)

    @admin.change_hub_admin!(actor: other, browser_session: other_session, operation: "revoke")

    assert_empty CopilotConnection.all
    event = SecurityAuditEvent.where(action: "copilot_connection.disconnect").sole
    assert_equal [ other.id, @admin.id ], [ event.user_id, event.context.fetch("target_user_id") ]
  end
end
