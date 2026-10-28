require "test_helper"

class GithubAppConfiguration::DiagnosticsTest < ActiveSupport::TestCase
  test "reports transferred ownership without changing saved App or installation state" do
    configuration = github_app_configurations.create_installed
    repository = repositories.create
    stub_github_app \
      configuration:, owner: { id: 654, login: "new-team", type: "Organization" }

    result = configuration.diagnostics.call

    assert_equal "configured", result.configuration
    assert_equal "owner changed; waiting for synchronization", result.app
    assert_equal "needs rechecking", result.installation
    assert_equal 321, configuration.reload.owner_github_id
    assert_equal "active", repository.reload.installation_state
  end

  test "reports a missing remote installation without mutating the last saved status" do
    configuration = github_app_configurations.create_installed
    stub_github_app(configuration:)
    stub_request(:get, "#{GITHUB_API_URL}/app/installations/456")
      .to_return(status: 404, body: "{}")

    result = configuration.diagnostics.call

    assert_equal "reachable", result.app
    assert_equal "not installed", result.installation
    assert_equal "active", configuration.reload.installation_state
  end
end
