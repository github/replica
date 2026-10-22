require "test_helper"

class GithubAppConfiguration::TokensTest < ActiveSupport::TestCase
  test "creates a short-lived RS256 App token" do
    configuration = github_app_configurations.create
    token = configuration.tokens.app
    public_key = OpenSSL::PKey::RSA.new(github_app_configurations.test_private_key).public_key
    payload, headers = JWT.decode(token, public_key, true, algorithm: "RS256")

    assert_equal "RS256", headers.fetch("alg")
    assert_equal "Iv1.test", payload.fetch("iss")
    assert_operator payload.fetch("exp") - payload.fetch("iat"), :<=, 10.minutes.to_i
  end

  test "requests and reuses an installation token" do
    configuration = github_app_configurations.create_installed
    client = Object.new
    requests = 0
    installations = Object.new
    installations.define_singleton_method(:create_token) do |id, token:|
      requests += 1
      raise "wrong installation" if id != 456

      { "token" => "installation-token", "expires_at" => 1.hour.from_now.iso8601 }
    end
    client.define_singleton_method(:installations) { installations }
    configuration.define_singleton_method(:github_client) { client }

    assert_equal "installation-token", configuration.tokens.installation
    assert_equal "installation-token", configuration.tokens.installation
    assert_equal 1, requests
  end

  test "does not reuse a token after installation status changes" do
    configuration = github_app_configurations.create_installed
    client = Object.new
    installations = Object.new
    installations.define_singleton_method(:create_token) do |*_args, **_options|
      { "token" => "installation-token", "expires_at" => 1.hour.from_now.iso8601 }
    end
    client.define_singleton_method(:installations) { installations }
    configuration.define_singleton_method(:github_client) { client }
    configuration.tokens.installation
    configuration.update!(installation_state: "suspended", suspended_at: Time.current)

    assert_raises(GithubClient::InvalidResponse) { configuration.tokens.installation }
  end

  test "rejects blank and expired installation tokens" do
    [
      { "token" => "", "expires_at" => 1.hour.from_now.iso8601 },
      { "token" => "installation-token", "expires_at" => 1.minute.ago.iso8601 }
    ].each do |payload|
      GithubAppConfiguration.delete_all
      configuration = github_app_configurations.create_installed
      installations = Object.new
      installations.define_singleton_method(:create_token) { |*_args, **_options| payload }
      client = Object.new
      client.define_singleton_method(:installations) { installations }
      configuration.define_singleton_method(:github_client) { client }

      assert_raises(GithubClient::InvalidResponse) { configuration.tokens.installation }
    end
  end

  test "creates a new Copilot token for every request with only the Copilot permission, never the cached installation token" do
    configuration = github_app_configurations.create_installed
    stub_github_installation_token
    configuration.tokens.installation
    stub_github_copilot_token("copilot-token-1", "copilot-token-2")

    assert_equal %w[copilot-token-1 copilot-token-2], [ configuration.tokens.copilot, configuration.tokens.copilot ]
  end

  test "rejects a Copilot token that GitHub reports with any other permission, even metadata, or without the Copilot permission" do
    configuration = github_app_configurations.create_installed
    [
      { organization_copilot_requests: "read", metadata: "read" },
      { organization_copilot_requests: "read", contents: "read" },
      { metadata: "read" }
    ].each do |permissions|
      stub_github_copilot_token("copilot-token", permissions:)

      assert_raises(GithubClient::InvalidResponse, permissions.inspect) { configuration.tokens.copilot }
    end
  end

  test "maps only GitHub's permission-not-granted response to a missing Copilot permission" do
    configuration = github_app_configurations.create_installed
    permission_missing = {
      message: "The permissions requested are not granted to this installation."
    }
    stub_github_copilot_token(error_status: 422, error_body: permission_missing)

    assert_raises(GithubAppConfiguration::Tokens::CopilotPermissionMissing) do
      configuration.tokens.copilot
    end

    stub_github_copilot_token \
      error_status: 422,
      error_body: {
        message: "Validation Failed",
        errors: [ { resource: "InstallationToken", code: "abuse" } ]
      }

    error = assert_raises(GithubClient::Error) { configuration.tokens.copilot }
    assert_equal 422, error.status
  end

  test "returns no Copilot token after a transient installation suspension while GitHub creates it" do
    configuration = github_app_configurations.create_installed
    request = stub_request(:post, "#{GITHUB_API_URL}/app/installations/456/access_tokens")
      .with(body: { permissions: { organization_copilot_requests: "read" } })
      .to_return do
        configuration.update!(installation_state: "suspended")
        configuration.update!(installation_state: "active")
        {
          status: 201,
          body: JSON.generate(
            token: "copilot-token",
            expires_at: 1.hour.from_now.iso8601,
            permissions: { organization_copilot_requests: "read" }
          ),
          headers: { "Content-Type" => "application/json" }
        }
      end

    assert_raises(GithubAppConfiguration::Superseded) { configuration.tokens.copilot }
    assert_requested request
  end
end
