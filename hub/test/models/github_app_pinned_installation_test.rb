require "test_helper"

class GithubAppPinnedInstallationTest < ActiveSupport::TestCase
  test "polling refreshes only the pinned installation and its selected repositories" do
    configuration = pinned_configuration
    stub_github_app(configuration:)
    stub_selected_installation
    stub_github_installation_token
    stub_github_repositories([ repository_payload(2001, "customer/selected") ])

    configuration.synchronize_repositories!

    assert_equal 456, configuration.reload.installation_id
    assert_equal 654, configuration.installation_account_github_id
    assert_equal "active", configuration.installation_state
    assert_equal [ "customer/selected" ], Repository.active.pluck(:name_with_owner)
    assert_not_requested :get, "#{GITHUB_API_URL}/orgs/github/installation"
  end

  test "a missing pinned installation denies access without adopting the owner's installation or deleting data" do
    configuration = pinned_configuration
    repository = repositories.create
    build = builds.create_successful(prototype: prototypes.create(repository:))
    stub_github_app(configuration:)
    stub_request(:get, "#{GITHUB_API_URL}/app/installations/456").to_return(status: 404, body: "{}")
    stub_github_account_installation \
      account: { id: 321, login: "github", type: "Organization" }, installation_id: 789

    configuration.synchronize_repositories!

    assert_equal 456, configuration.reload.installation_id
    assert_equal 654, configuration.installation_account_github_id
    assert_equal "removed", configuration.installation_state
    assert_not Repository.active.exists?(repository.id)
    assert Build.exists?(build.id)
    assert Prototype.exists?(build.prototype_id)
    assert_equal "removed", repository.reload.installation_state
    assert_not_requested :get, "#{GITHUB_API_URL}/orgs/github/installation"
    assert_not_requested :post, "#{GITHUB_API_URL}/app/installations/789/access_tokens"
  end

  test "a suspended pinned installation denies access and retains its saved data" do
    configuration = pinned_configuration
    repository = repositories.create
    build = builds.create_successful(prototype: prototypes.create(repository:))
    stub_github_app(configuration:)
    stub_selected_installation(suspended_at: Time.current.iso8601)

    configuration.synchronize_repositories!

    assert_equal "suspended", configuration.reload.installation_state
    assert_equal 456, configuration.installation_id
    assert_not Repository.active.exists?(repository.id)
    assert Build.exists?(build.id)
    assert_not_requested :post, "#{GITHUB_API_URL}/app/installations/456/access_tokens"
  end

  test "polling rejects a changed account for the saved pinned installation" do
    configuration = pinned_configuration
    repository = repositories.create
    stub_selected_installation(account: { id: 321, login: "github", type: "Organization" })

    assert_raises(GithubAppConfiguration::Installation::OwnerMismatch) do
      configuration.installation.synchronize!
    end

    assert_equal 654, configuration.reload.installation_account_github_id
    assert_equal "active", repository.reload.installation_state
  end

  test "transferring App ownership preserves the independently pinned connection" do
    configuration = pinned_configuration
    repository = repositories.create
    stub_github_app(configuration:, owner: { id: 987, login: "new-owner", type: "User" })

    configuration.ownership.refresh!

    assert_equal 987, configuration.reload.owner_github_id
    assert_equal "User", configuration.owner_type
    assert_equal "pinned", configuration.installation_policy
    assert_equal 456, configuration.installation_id
    assert_equal 654, configuration.installation_account_github_id
    assert_equal "active", configuration.installation_state
    assert_equal "active", repository.reload.installation_state
  end

  test "a signed removal for the pinned account disables access and finishes its receipt without deleting builds" do
    configuration = pinned_configuration
    repository = repositories.create
    build = builds.create_successful(prototype: prototypes.create(repository:))
    body = JSON.generate(
      action: "deleted", installation: {
        id: 456, app_id: configuration.github_app_id,
        account: { id: 654, login: "customer", type: "Organization" }
      }
    )
    signature = "sha256=#{OpenSSL::HMAC.hexdigest("SHA256", configuration.webhook_secret, body)}"

    GithubWebhook.process! \
      configuration:, body:, signature:, event: "installation", delivery_id: SecureRandom.uuid

    assert_equal "removed", configuration.reload.installation_state
    assert_equal 456, configuration.installation_id
    assert_equal "removed", repository.reload.installation_state
    assert Build.exists?(build.id)
    assert WebhookDelivery.sole.processed?
  end

  {
    "a new installation" => [ "installation", "created", 789 ],
    "a removal of another installation" => [ "installation", "deleted", 789 ],
    "another installation's repository selection" => [ "installation_repositories", "added", 789 ],
    "the pinned ID with another account" => [ "installation", "suspend", 456 ]
  }.each do |description, (event, action, installation_id)|
    test "signed #{description} cannot create a trusted receipt or spend an admission quota" do
      configuration = pinned_configuration
      repository = repositories.create
      body = JSON.generate(
        action:, installation: {
          id: installation_id, app_id: configuration.github_app_id,
          account: { id: 321, login: "github", type: "Organization" }, suspended_at: nil
        }
      )
      admitted = false
      signature = "sha256=#{OpenSSL::HMAC.hexdigest("SHA256", configuration.webhook_secret, body)}"

      assert_no_difference([ "WebhookDelivery.count", "WebhookRedelivery.count" ]) do
        GithubWebhook.process! \
          configuration:, body:, signature:, event:, delivery_id: SecureRandom.uuid do
            admitted = true
            true
          end
      end

      assert_not admitted
      assert_equal 456, configuration.reload.installation_id
      assert_equal 654, configuration.installation_account_github_id
      assert_equal "active", configuration.installation_state
      assert_equal "active", repository.reload.installation_state
    end
  end

  test "diagnostics reports a selected cross-account installation as reachable" do
    configuration = pinned_configuration
    stub_github_app(configuration:)
    stub_selected_installation

    result = configuration.diagnostics.call

    assert_equal "reachable", result.app
    assert_equal "reachable", result.installation
  end

  %w[removed suspended].each do |installation_state|
    test "a #{installation_state} pinned installation excludes repository recovery but permits lifecycle recovery" do
      configuration = pinned_configuration
      entries = %w[push workflow_run installation].each_with_index.map do |event, index|
        entry = WebhookRedelivery.record_pending! \
          configuration:, guid: SecureRandom.uuid, event:, installation_id: configuration.installation_id,
          delivered_at: Time.current, attempt_id: 8001 + index
        entry.update!(due_at: Time.current)
        entry
      end
      configuration.update!(installation_state:)
      request = stub_request(:post, "#{GITHUB_API_URL}/app/hook/deliveries/8003/attempts")
        .to_return(status: 202, body: "")

      entries.each { _1.redeliver!(configuration:) }

      entries.first(2).each do |entry|
        assert_equal "failed", entry.reload.state
        assert_equal "installation_changed", entry.failure_code
        assert_equal 0, entry.attempts
      end
      assert_equal "waiting", entries.last.reload.state
      assert_requested request, times: 1
      [ 8001, 8002 ].each do |attempt_id|
        assert_not_requested :post, "#{GITHUB_API_URL}/app/hook/deliveries/#{attempt_id}/attempts"
      end
    end
  end

  test "remote recovery metadata for another installation cannot create pinned recovery work" do
    configuration = pinned_configuration
    metadata = {
      "id" => 8001, "guid" => SecureRandom.uuid, "event" => "installation", "action" => "created",
      "installation_id" => 789, "status_code" => 503, "delivered_at" => Time.current.iso8601
    }

    assert_no_difference([ "WebhookRedelivery.count", "WebhookDelivery.count" ]) do
      WebhookRedelivery.record_remote!(configuration:, metadata:)
    end
  end

  test "diagnostics does not accept another App at the selected installation endpoint" do
    configuration = pinned_configuration
    stub_github_app(configuration:)
    stub_selected_installation(app_id: 999)

    result = configuration.diagnostics.call

    assert_not_equal "reachable", result.installation
  end

  test "credential recovery verifies the App owner rather than its selected installation account" do
    configuration = pinned_configuration
    stub_github_app(configuration:)
    confirmation = GithubAppConfiguration::Administration::RECOVERY_PHRASE

    configuration.administration.recover_credentials! \
      confirmation:, client_secret: "replacement-secret",
      private_key: github_app_configurations.test_private_key

    assert_equal "replacement-secret", configuration.reload.client_secret
    assert_equal 654, configuration.installation_account_github_id
    stub_github_app(configuration:, owner: { id: 654, login: "customer", type: "Organization" })

    assert_raises(GithubAppConfiguration::Rotator::IdentityMismatch) do
      configuration.administration.recover_credentials! \
        confirmation:, client_secret: "untrusted-secret",
        private_key: github_app_configurations.test_private_key
    end

    assert_equal "replacement-secret", configuration.reload.client_secret
  end

  private

  def pinned_configuration
    github_app_configurations.create_installed \
      installation_policy: "pinned", installation_account_github_id: 654,
      installation_account_login: "customer", installation_owner_type: "Organization"
  end

  def stub_selected_installation(**overrides)
    payload = {
      id: 456, app_id: 123, account: { id: 654, login: "customer", type: "Organization" }, suspended_at: nil
    }.merge(overrides)
    stub_request(:get, "#{GITHUB_API_URL}/app/installations/456")
      .to_return(status: 200, body: JSON.generate(payload), headers: { "Content-Type" => "application/json" })
  end
end
