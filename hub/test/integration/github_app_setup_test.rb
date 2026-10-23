require "test_helper"

class GithubAppSetupTest < ActionDispatch::IntegrationTest
  test "requires the bootstrap secret before showing the manifest form" do
    with_bootstrap_secret do
      get setup_path

      assert_response :success
      assert_includes response.body, "github_app_setup/show"
      assert_includes response.body, I18n.t("github_app_setup.show.secret_label")
      assert_includes response.body, I18n.t("github_app_setup.show.organization_label")

      post setup_path, params: { bootstrap_secret: "wrong" }

      assert_response :not_found
    end
  end

  test "submits an organization-owned App manifest" do
    with_bootstrap_secret do
      post setup_path, params: {
        bootstrap_secret: github_app_configurations.bootstrap_secret,
        organization: "github"
      }
      follow_redirect!

      assert_includes response.body, "github_app_setup/register"
      assert_includes response.body, "https://github.com/organizations/github/settings/apps/new"
    end
  end

  test "shows the GitHub manifest form after authorization without leaking a CSRF token" do
    with_bootstrap_secret do
      post setup_path, params: { bootstrap_secret: github_app_configurations.bootstrap_secret }
      follow_redirect!

      assert_response :success
      assert_includes response.body, "github_app_setup/register"
      assert_includes response.body, "https://github.com/settings/apps/new"
      assert_includes response.body, "Create the App on GitHub"
      assert_includes response.body, "You choose which repositories it can access."
      assert_includes response.headers["Content-Security-Policy"],
        "form-action 'self' https://github.com"
      assert_select "script[nonce]", text: /SUPERGLUE_INITIAL_PAGE_STATE=/
    end
  end

  test "shows the same prompt after configuration" do
    github_app_configurations.create

      get setup_path

      assert_response :success
      assert_includes response.body, "github_app_setup/show"
      assert_includes response.body, I18n.t("github_app_setup.show.secret_label")
  end

  test "reveals setup is unavailable only after a valid operator secret" do
    github_app_configurations.create

    with_bootstrap_secret do
      post setup_path, params: { bootstrap_secret: github_app_configurations.bootstrap_secret }

      assert_response :not_found
    end
  end

  test "successful browser setup records anonymous global decisions without App secrets" do
    with_bootstrap_secret do
      post setup_path, params: { bootstrap_secret: github_app_configurations.bootstrap_secret }
      event = SecurityAuditEvent.where(action: "github_app_setup.authorize").sole
      assert_equal "succeeded", event.outcome
      assert_nil event.user_id
      assert_nil event.repository_id
      get setup_path, as: :json
      registration = JSON.parse(response.body).fetch("data")
      state = Rack::Utils.parse_query(URI(registration.fetch("submitPath")).query).fetch("state")
      credentials = github_app_configurations.manifest_credentials
      stub_request(:post, "https://api.github.com/app-manifests/temporary/conversions")
        .to_return \
          status: 201, body: JSON.generate(credentials),
          headers: { "Content-Type" => "application/json" }
      get callback_setup_path, params: { code: "temporary", state: }
      assert_response :redirect
      event = SecurityAuditEvent.where(action: "github_app_setup.exchange").sole
      assert_equal "succeeded", event.outcome
      assert_nil event.user_id
      stub_request(:get, "https://api.github.com/app/installations/456")
        .to_return \
          status: 200,
          body: JSON.generate(id: 456, app_id: credentials.fetch("id"), account: credentials.fetch("owner")),
          headers: { "Content-Type" => "application/json" }
      stub_github_installation_token
      stub_github_repositories([])
      get install_setup_path, params: { installation_id: 456 }
      assert_response :success
      event = SecurityAuditEvent.where(action: "github_app_setup.install").sole
      assert_equal "succeeded", event.outcome
      assert_nil event.repository_id
      data = SecurityAuditEvent.all.map(&:attributes).to_s
      [ github_app_configurations.bootstrap_secret, state,
        credentials.fetch("client_secret"), credentials.fetch("pem"),
        credentials.fetch("webhook_secret") ].each do |secret|
        assert_not_includes data, secret
      end
    end
  end

  private

  def with_bootstrap_secret
    original = ENV["REPLICA_BOOTSTRAP_SECRET"]
    ENV["REPLICA_BOOTSTRAP_SECRET"] = github_app_configurations.bootstrap_secret
    yield
  ensure
    ENV["REPLICA_BOOTSTRAP_SECRET"] = original
  end
end
