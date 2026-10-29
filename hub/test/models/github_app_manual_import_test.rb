require "test_helper"

class GithubAppManualImportTest < ActiveSupport::TestCase
  %w[User Organization].each do |owner_type|
    test "imports and polls an installation for a #{owner_type} App owner with an underscore in its login" do
      attributes = import_attributes
      app = app_payload(attributes).merge(
        "owner" => { "id" => 321, "login" => "operator_acme", "type" => owner_type }
      )
      stub_import(attributes, app:)

      configuration = authorized_setup.import!(**attributes)
      configuration.synchronize_repositories!

      assert_equal "operator_acme", configuration.reload.owner_login
      assert_equal owner_type, configuration.owner_type
      assert_equal 321, configuration.owner_github_id
      assert_equal "pinned", configuration.installation_policy
      assert_equal 8642, configuration.installation_id
      assert_equal 654, configuration.installation_account_github_id
      assert_equal "Organization", configuration.installation_owner_type
      assert_equal "active", configuration.installation_state
    end
  end

  test "imports one explicitly approved cross-account installation and its selected repositories" do
    setup = authorized_setup
    attributes = import_attributes
    stub_import(attributes)
    stub_github_repositories([ repository_payload(9081, "customer/selected") ])
    unrelated = repositories.create(github_id: 9082, name_with_owner: "customer/unselected")

    configuration = setup.import!(**attributes)

    assert_equal attributes.fetch(:app_id).to_i, configuration.github_app_id
    assert_equal attributes.fetch(:installation_id).to_i, configuration.installation_id
    assert_equal "pinned", configuration.installation_policy
    assert_equal 321, configuration.owner_github_id
    assert_equal 654, configuration.installation_account_github_id
    assert_equal "customer", configuration.installation_account_login
    assert_equal "Organization", configuration.installation_owner_type
    assert_equal "active", configuration.installation_state
    assert_equal [ 9081 ], Repository.active.pluck(:github_id)
    assert_equal "removed", unrelated.reload.installation_state
    assert_not setup.authorized?
    assert_not setup.installation_authorized?
    event = SecurityAuditEvent.where(action: "github_app_setup.import").sole
    assert_equal "succeeded", event.outcome
    assert_equal "bootstrap", event.context.fetch("source")
    assert_nil event.user_id
    assert_no_secrets(event.attributes.to_s, attributes)
  end

  test "rejects missing bootstrap authorization before any GitHub request" do
    setup = GithubAppSetup.new(session: {}, bootstrap_secret: github_app_configurations.bootstrap_secret)

    assert_rejected_import(setup)
    assert_not_requested :get, "#{GITHUB_API_URL}/app"
  end

  test "a wrong bootstrap secret cannot authorize manual import" do
    setup = GithubAppSetup.new(session: {}, bootstrap_secret: github_app_configurations.bootstrap_secret)

    assert_raises(GithubAppSetup::InvalidState) { setup.authorize!("wrong") }
    assert_rejected_import(setup)
    assert_not_requested :get, "#{GITHUB_API_URL}/app"
  end

  test "expired bootstrap authorization cannot import an App" do
    setup = authorized_setup

    travel GithubAppSetup::MAXIMUM_AGE + 1.second do
      assert_rejected_import(setup)
    end
    assert_not_requested :get, "#{GITHUB_API_URL}/app"
  end

  test "an existing configuration cannot be replaced using an earlier setup authorization" do
    setup = authorized_setup
    configuration = github_app_configurations.create

    assert_raises(GithubAppSetup::InvalidState) { setup.import!(**import_attributes) }

    assert_equal [ configuration.id ], GithubAppConfiguration.pluck(:id)
    assert_equal "owner", configuration.reload.installation_policy
    assert_not_requested :get, "#{GITHUB_API_URL}/app"
  end

  test "manual import requires exact explicit confirmation before contacting GitHub" do
    setup = authorized_setup

    assert_rejected_import(setup, confirmed: "true")
    assert_not_requested :get, "#{GITHUB_API_URL}/app"
  end

  test "invalid PEM is rejected without persisting or returning supplied secrets" do
    setup = authorized_setup

    error = assert_rejected_import(setup, private_key: "invalid-private-key-material")

    assert_equal :invalid_private_key, error.reason
    assert_not_requested :get, "#{GITHUB_API_URL}/app"
  end

  test "an App and client ID mismatch reports a fixed failure reason" do
    attributes = import_attributes
    app = app_payload(attributes).merge("client_id" => "Iv1.other")
    stub_import(attributes, app:)

    error = assert_rejected_import(authorized_setup)

    assert_equal :app_mismatch, error.reason
  end

  test "malformed submitted IDs cannot be coerced into an approved App or installation" do
    assert_rejected_import(authorized_setup, installation_id: "8642-other")

    assert_not_requested :get, "#{GITHUB_API_URL}/app"
  end

  test "imports App and installation IDs at the signed bigint upper bound" do
    attributes = import_attributes.merge(app_id: "9223372036854775807", installation_id: "9223372036854775807")
    stub_import(attributes)

    configuration = authorized_setup.import!(**attributes)

    assert_equal 9_223_372_036_854_775_807, configuration.reload.github_app_id
    assert_equal 9_223_372_036_854_775_807, configuration.installation_id
  end

  %i[app_id installation_id].each do |attribute|
    test "rejects a submitted #{attribute} above the signed bigint range before contacting GitHub" do
      assert_rejected_import(authorized_setup, **{ attribute => "9223372036854775808" })

      assert_not_requested :any, %r{\A#{Regexp.escape(GITHUB_API_URL)}/}
    end
  end

  {
    "another App" => { "id" => 908 },
    "a malformed App owner" => { "owner" => { "id" => "321", "login" => "github", "type" => "Organization" } },
    "an unsupported App owner type" => { "owner" => { "id" => 321, "login" => "github", "type" => "Enterprise" } },
    "an unsafe user login" => { "owner" => { "id" => 321, "login" => "operator/enterprise", "type" => "User" } },
    "a login without an alphanumeric first character" => {
      "owner" => { "id" => 321, "login" => "_operator", "type" => "User" }
    },
    "an underscore in an App slug" => { "slug" => "invalid_app" }
  }.each do |description, changes|
    test "rejects #{description} returned by authenticated App lookup" do
      attributes = import_attributes
      stub_import(attributes, app: app_payload(attributes).merge(changes))

      assert_rejected_import(authorized_setup)
      assert_not_requested :get, "#{GITHUB_API_URL}/app/installations/#{attributes.fetch(:installation_id)}"
    end
  end

  {
    "another installation ID" => { id: 8643 },
    "another installation App" => { app_id: 908 },
    "a suspended installation" => { suspended_at: "2026-10-26T19:00:00Z" },
    "a malformed installation account" => { account: { id: 654, login: "customer", type: "Enterprise" } }
  }.each do |description, changes|
    test "rejects #{description} before saving any connection" do
      attributes = import_attributes
      stub_import(attributes, installation: installation_payload(attributes).merge(changes))

      assert_rejected_import(authorized_setup)
      assert_not_requested :post, "#{GITHUB_API_URL}/app/installations/#{attributes.fetch(:installation_id)}/access_tokens"
    end
  end

  test "failed App authentication returns a safe error and saves nothing" do
    attributes = import_attributes
    stub_request(:get, "#{GITHUB_API_URL}/app")
      .to_return(status: 401, body: JSON.generate(message: attributes.fetch(:client_secret)))

    error = assert_rejected_import(authorized_setup)

    assert_equal :github_authentication_failed, error.reason
  end

  test "a late repository lookup failure leaves configuration repositories and success audit unchanged" do
    attributes = import_attributes
    setup = authorized_setup
    repository = repositories.create
    stub_import(attributes)
    stub_request(:get, "#{GITHUB_API_URL}/installation/repositories")
      .with(query: { page: "1", per_page: "100" })
      .to_return(status: 500, body: JSON.generate(message: attributes.fetch(:webhook_secret)))

    assert_no_difference("SecurityAuditEvent.where(outcome: 'succeeded').count") do
      assert_rejected_import(setup)
    end

    assert_equal "active", repository.reload.installation_state
    assert setup.authorized?
  end

  private

  def authorized_setup
    GithubAppSetup.new(session: {}, bootstrap_secret: github_app_configurations.bootstrap_secret).tap do |setup|
      setup.authorize!(github_app_configurations.bootstrap_secret)
    end
  end

  def import_attributes
    {
      app_id: "907", client_id: "Iv1.manual", client_secret: "manual-client-secret",
      private_key: github_app_configurations.test_private_key,
      webhook_secret: "manual-webhook-secret", installation_id: "8642", confirmed: "1"
    }
  end

  def app_payload(attributes)
    github_app_configurations.manifest_credentials.merge(
      "id" => attributes.fetch(:app_id).to_i, "client_id" => attributes.fetch(:client_id)
    )
  end

  def installation_payload(attributes)
    {
      id: attributes.fetch(:installation_id).to_i, app_id: attributes.fetch(:app_id).to_i,
      account: { id: 654, login: "customer", type: "Organization" }, suspended_at: nil
    }
  end

  def stub_import(attributes, app: app_payload(attributes), installation: installation_payload(attributes))
    stub_request(:get, "#{GITHUB_API_URL}/app")
      .with { |request| request.headers["Authorization"].to_s.start_with?("Bearer ") }
      .to_return(status: 200, body: JSON.generate(app), headers: { "Content-Type" => "application/json" })
    stub_request(:get, "#{GITHUB_API_URL}/app/installations/#{attributes.fetch(:installation_id)}")
      .to_return(status: 200, body: JSON.generate(installation), headers: { "Content-Type" => "application/json" })
    stub_github_installation_token(installation_id: attributes.fetch(:installation_id))
    stub_github_repositories([])
  end

  def assert_rejected_import(setup, **overrides)
    attributes = import_attributes.merge(overrides)
    error = nil
    assert_no_difference("GithubAppConfiguration.count") do
      error = assert_raises(GithubAppSetup::Error) { setup.import!(**attributes) }
    end
    assert_no_secrets(error.message, attributes)
    error
  end

  def assert_no_secrets(text, attributes)
    attributes.values_at(:client_secret, :private_key, :webhook_secret).each do |secret|
      assert_not_includes text, secret
    end
  end
end
