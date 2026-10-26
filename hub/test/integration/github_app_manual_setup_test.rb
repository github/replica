require "test_helper"
require "stringio"

class GithubAppManualSetupTest < ActionDispatch::IntegrationTest
  test "manual setup form requires bootstrap authorization" do
    with_bootstrap_secret do
      get manual_setup_path

      assert_response :not_found
      post manual_setup_path, params: manual_parameters

      assert_response :not_found
      assert_not GithubAppConfiguration.configured?
      assert_not_requested :get, "#{GITHUB_API_URL}/app"
    end
  end

  test "authorized unconfigured bootstrap can view the manual form and instructions" do
    with_bootstrap_secret do
      post setup_path, params: { bootstrap_secret: github_app_configurations.bootstrap_secret }

      get manual_setup_path, as: :json

      assert_response :success
      data = JSON.parse(response.body).fetch("data")
      assert_equal manual_setup_path, data.fetch("submitPath")
      assert_equal %w[app_id client_id client_secret webhook_secret installation_id],
        data.fetch("fields").map { _1.fetch("name") }
      assert_predicate data.fetch("keyLabel"), :present?
      assert_predicate data.fetch("instructions"), :present?
      assert_not_includes response.body, github_app_configurations.bootstrap_secret
    end
  end

  test "expired bootstrap authorization cannot display manual credentials form" do
    with_bootstrap_secret do
      post setup_path, params: { bootstrap_secret: github_app_configurations.bootstrap_secret }

      travel GithubAppSetup::MAXIMUM_AGE + 1.second do
        get manual_setup_path
        assert_response :not_found
      end
    end
  end

  test "a configuration created after bootstrap authorization closes the manual form and submission" do
    with_bootstrap_secret do
      post setup_path, params: { bootstrap_secret: github_app_configurations.bootstrap_secret }
      configuration = github_app_configurations.create

      get manual_setup_path
      assert_response :not_found
      assert_no_difference("GithubAppConfiguration.count") do
        post manual_setup_path, params: manual_parameters
      end
      assert_response :not_found
      assert_equal configuration.id, GithubAppConfiguration.current.id
      assert_not_requested :get, "#{GITHUB_API_URL}/app"
    end
  end

  test "multipart manual import completes the selected cross-account installation without another installation callback" do
    with_bootstrap_secret do
      post setup_path, params: { bootstrap_secret: github_app_configurations.bootstrap_secret }
      stub_manual_import

      post manual_setup_path, params: manual_parameters

      assert_redirected_to install_setup_path
      configuration = GithubAppConfiguration.current
      assert_equal "pinned", configuration.installation_policy
      assert_equal 8642, configuration.installation_id
      assert_equal 654, configuration.installation_account_github_id
      assert_equal github_app_configurations.test_private_key, configuration.private_key
      assert_equal [ "customer/selected" ], Repository.active.pluck(:name_with_owner)
      follow_redirect!

      assert_response :success
      assert_includes response.body, "github_app_setup/install"
      assert_no_secrets(response.body)
    end
  end

  test "failed manual import returns a safe editable form without saving credentials" do
    with_bootstrap_secret do
      post setup_path, params: { bootstrap_secret: github_app_configurations.bootstrap_secret }
      stub_request(:get, "#{GITHUB_API_URL}/app")
        .to_return(status: 401, body: JSON.generate(message: "manual-client-secret manual-webhook-secret"))

      post manual_setup_path, params: manual_parameters

      assert_response :unprocessable_entity
      assert_includes response.body, "github_app_setup/manual"
      assert_not GithubAppConfiguration.configured?
      assert_no_secrets(response.body)
      assert_no_secrets(flash.to_hash.to_s)
    end
  end

  private

  def manual_parameters
    upload = Rack::Test::UploadedFile.new \
      StringIO.new(github_app_configurations.test_private_key),
      "application/x-pem-file",
      original_filename: "github-app.pem"
    {
      app_id: "907", client_id: "Iv1.manual", client_secret: "manual-client-secret",
      webhook_secret: "manual-webhook-secret", installation_id: "8642", private_key: upload, confirmed: "1"
    }
  end

  def stub_manual_import
    app = github_app_configurations.manifest_credentials.merge("id" => 907, "client_id" => "Iv1.manual")
    stub_request(:get, "#{GITHUB_API_URL}/app")
      .to_return(status: 200, body: JSON.generate(app), headers: { "Content-Type" => "application/json" })
    stub_request(:get, "#{GITHUB_API_URL}/app/installations/8642")
      .to_return \
        status: 200,
        body: JSON.generate(
          id: 8642, app_id: 907, account: { id: 654, login: "customer", type: "Organization" }, suspended_at: nil
        ),
        headers: { "Content-Type" => "application/json" }
    stub_github_installation_token(installation_id: 8642)
    stub_github_repositories([ repository_payload(9081, "customer/selected") ])
  end

  def assert_no_secrets(text)
    [
      "manual-client-secret", "manual-webhook-secret", github_app_configurations.test_private_key,
      github_app_configurations.bootstrap_secret
    ].each { |secret| assert_not_includes text, secret }
  end

  def with_bootstrap_secret
    original = ENV["REPLICA_BOOTSTRAP_SECRET"]
    ENV["REPLICA_BOOTSTRAP_SECRET"] = github_app_configurations.bootstrap_secret
    yield
  ensure
    ENV["REPLICA_BOOTSTRAP_SECRET"] = original
  end
end
