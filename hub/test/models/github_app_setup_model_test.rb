require "test_helper"

class GithubAppSetupModelTest < ActiveSupport::TestCase
  test "requires a non-empty bootstrap secret" do
    setup = GithubAppSetup.new(session: {}, bootstrap_secret: "")

    assert_raises(GithubAppSetup::InvalidState) { setup.authorize!("") }
  end

  test "accepts a short manual bootstrap secret" do
    setup = GithubAppSetup.new(session: {}, bootstrap_secret: "manual")

    setup.authorize!("manual")

    assert setup.authorized?
  end

  test "builds a private manifest with one-use state" do
    session = {}
    setup = GithubAppSetup.new(session:, bootstrap_secret: github_app_configurations.bootstrap_secret)
    setup.authorize!(github_app_configurations.bootstrap_secret)

    registration = setup.registration
    data = JSON.parse(registration.fetch(:manifest))

    assert_match(%r{\Ahttps://github\.com/settings/apps/new\?state=}, registration.fetch(:url))
    assert_equal false, data.fetch("public")
    expected_permissions = {
      "actions" => "read",
      "administration" => "read",
      "contents" => "write",
      "pull_requests" => "write",
      "workflows" => "write"
    }
    assert_equal \
      expected_permissions,
      data.fetch("default_permissions")
    assert_not data.key?("default_events")
    assert_not data.key?("hook_attributes")
  end

  test "builds the registration manifest without replacing an open registration state" do
    session = {}
    setup = GithubAppSetup.new(session:, bootstrap_secret: github_app_configurations.bootstrap_secret)
    setup.authorize!(github_app_configurations.bootstrap_secret)
    setup.registration
    state = session.fetch(:github_app_manifest_state)

    manifest = JSON.parse(setup.registration_manifest)

    assert_equal state, session.fetch(:github_app_manifest_state)
    assert_equal "Replica Hub", manifest.fetch("name")
  end

  test "includes webhooks for a public HTTPS origin" do
    original = Rails.configuration.x.hub_origin
    Rails.configuration.x.hub_origin = "https://replica.example.com"
    session = {}
    setup = GithubAppSetup.new(session:, bootstrap_secret: github_app_configurations.bootstrap_secret)
    setup.authorize!(github_app_configurations.bootstrap_secret)

    data = JSON.parse(setup.registration.fetch(:manifest))

    assert_equal %w[push workflow_run], data.fetch("default_events")
    assert_equal "https://replica.example.com/github/webhooks", data.dig("hook_attributes", "url")
  ensure
    Rails.configuration.x.hub_origin = original
  end

  test "targets an organization manifest endpoint" do
    session = {}
    setup = GithubAppSetup.new(session:, bootstrap_secret: github_app_configurations.bootstrap_secret)
    setup.authorize!(github_app_configurations.bootstrap_secret, organization: "github")

    assert_match \
      %r{\Ahttps://github\.com/organizations/github/settings/apps/new\?state=},
      setup.registration.fetch(:url)
  end

  test "rejects an invalid organization login" do
    setup = GithubAppSetup.new \
      session: {},
      bootstrap_secret: github_app_configurations.bootstrap_secret

    assert_raises(GithubAppSetup::InvalidState) do
      setup.authorize!(github_app_configurations.bootstrap_secret, organization: "not/a/login")
    end
  end

  test "exchanges credentials once and clears setup authorization" do
    session = {}
    setup = GithubAppSetup.new(session:, bootstrap_secret: github_app_configurations.bootstrap_secret)
    setup.authorize!(github_app_configurations.bootstrap_secret)
    registration = setup.registration
    state = URI.decode_www_form(URI(registration.fetch(:url)).query).to_h.fetch("state")
    exchanger = ->(_code) { github_app_configurations.manifest_credentials }
    setup = GithubAppSetup.new \
      session:,
      bootstrap_secret: github_app_configurations.bootstrap_secret,
      exchanger: exchanger

    configuration = setup.exchange!(code: "temporary", state:)

    assert_equal 123, configuration.github_app_id
    assert setup.installation_authorized?

    assert_raises(GithubAppSetup::InvalidState) do
      setup.exchange!(code: "temporary", state:)
    end
  end

  test "generates a local webhook secret when GitHub returns none" do
    session = {}
    credentials = github_app_configurations.manifest_credentials.merge("webhook_secret" => nil)
    setup = GithubAppSetup.new \
      session:,
      bootstrap_secret: github_app_configurations.bootstrap_secret,
      exchanger: ->(_code) { credentials }
    setup.authorize!(github_app_configurations.bootstrap_secret)
    state = URI.decode_www_form(URI(setup.registration.fetch(:url)).query).to_h.fetch("state")

    configuration = setup.exchange!(code: "temporary", state:)

    assert_predicate configuration.webhook_secret, :present?
  end

  test "rejects a mismatched state before exchange" do
    setup = GithubAppSetup.new \
      session: {},
      bootstrap_secret: github_app_configurations.bootstrap_secret
    setup.authorize!(github_app_configurations.bootstrap_secret)
    setup.registration

    assert_raises(GithubAppSetup::InvalidState) do
      setup.exchange!(code: "temporary", state: "wrong")
    end
  end
end
