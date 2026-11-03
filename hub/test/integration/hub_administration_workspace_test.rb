require "test_helper"

class HubAdministrationWorkspaceTest < ActionDispatch::IntegrationTest
  setup do
    github_app_configurations.create_installed
    @actor = users.create(hub_admin: true)
    @target = users.create(github_id: 1002, login: "mona")
    stub_github_oauth_user
    post github_authentication_path
    state = Rack::Utils.parse_query(URI(response.location).query).fetch("state")
    get github_authentication_callback_path, params: { code: "code", state: }
  end

  test "every administration page has the shared sidebar without needing repositories" do
    assert_empty Repository.all
    pages = {
      security_audit_path => "audit",
      hub_admins_path => "admins",
      edit_hub_admin_path(@target) => "admins",
      sharing_settings_path => "sharing",
      session_revocation_path => "sessions",
      github_app_path => "github",
      reset_github_app_path => "github",
      edit_github_app_credentials_path => "github",
      github_app_webhook_rotation_path => "github",
      copilot_connection_path => "copilot"
    }
    assert_no_difference([ "FreshAuthorization.count", "User.where(hub_admin: true).count" ]) do
      pages.each do |path, section|
        get path, as: :json
        assert_response :success
        workspace = data.fetch("administrationWorkspace")
        assert_equal section, workspace.fetch("selectedSection"), path
        assert_equal @actor.login, workspace.fetch("currentUser").fetch("login")
        assert_equal I18n.t("application.name"), workspace.fetch("productName")
        assert_equal I18n.t("repository_workspace.theme_system"), workspace.fetch("systemThemeLabel")
        assert_equal I18n.t("repository_workspace.theme_light"), workspace.fetch("lightThemeLabel")
        assert_equal I18n.t("repository_workspace.theme_dark"), workspace.fetch("darkThemeLabel")
        assert_equal %w[github copilot admins sharing sessions], workspace.fetch("administrationLinks").pluck("section")
        assert_equal security_audit_path, workspace.fetch("securityAuditPath")
        assert_nil workspace.fetch("repository")
        assert_not workspace.key?("selectedRepositoryId")
        assert_not workspace.key?("repositories")
        assert_equal "private, no-store", response.headers["Cache-Control"]
      end
    end
    assert_not_requested :get, %r{/installation/repositories|/repositories/\d+}
  end

  test "fresh administrator verification stays in the initiating Hub section" do
    @actor.sessions.sole.update!(fresh_authorized_at: nil)
    patch sharing_settings_path, params: { confirmed: "1", operation: "enable" }
    challenge = FreshAuthorization.last
    assert_redirected_to fresh_authorization_path(challenge.public_id)
    get fresh_authorization_path(challenge.public_id), as: :json
    assert_response :success
    assert_equal "sharing", data.fetch("administrationWorkspace").fetch("selectedSection")
    assert_not SharingSetting.enabled?
  end

  test "revocation keeps the safe account shell without administration navigation" do
    @actor.update!(hub_admin: false)
    [ hub_admins_path, sharing_settings_path, session_revocation_path, github_app_path, copilot_connection_path ].each do |path|
      get path, as: :json
      assert_response :forbidden
      assert_nil data.fetch("administrationWorkspace")
      workspace = data.fetch("authenticatedWorkspace")
      assert_equal @actor.login, workspace.fetch("currentUser").fetch("login")
      assert_equal repositories_path, workspace.fetch("repositoriesPath")
      assert_equal I18n.t("hub_administration_workspace.hub_navigation"), workspace.fetch("navigationLabel")
      assert_not workspace.key?("links")
      assert_not workspace.key?("scopeLabel")
      assert_empty workspace.fetch("administrationLinks")
      assert_nil workspace.fetch("securityAuditPath")
      assert_nil workspace.fetch("repository")
    end
    get security_audit_path
    assert_response :not_found
  end

  test "Hub pages use a real readable repository without granting repository admin controls" do
    payload = repository_payload(2001, "github/prototype")
    repository = repositories.create(github_id: 2001, name_with_owner: payload.fetch("full_name"))
    stub_github_installation_token
    stub_github_permissions([ payload ], { 2001 => "pull" })
    get sharing_settings_path, params: { repository_github_id: repository.route_id }, as: :json
    assert_response :success
    workspace = data.fetch("administrationWorkspace")
    navigation = workspace.fetch("repository")
    assert_equal repository.route_id.to_s, navigation.fetch("selectedRepositoryId")
    assert_equal I18n.t("repository_workspace.repositories"), navigation.fetch("repositoryMenuLabel")
    assert_equal repository_path(repository.route_id), navigation.fetch("prototypesPath")
    assert_nil navigation.fetch("analyticsPath")
    assert_equal security_audit_path, workspace.fetch("securityAuditPath")
    assert_equal sharing_settings_path(repository_github_id: repository.route_id),
      workspace.fetch("administrationLinks").find { _1.fetch("section") == "sharing" }.fetch("path")
  end

  test "an inaccessible repository hint does not select another repository or gate Hub content" do
    get sharing_settings_path, params: { repository_github_id: 9999 }, as: :json
    assert_response :success
    workspace = data.fetch("administrationWorkspace")
    assert_nil workspace.fetch("repository")
    assert_equal I18n.t("hub_administration_workspace.repository_unavailable"),
      workspace.fetch("repositoryUnavailableMessage")
    assert_equal security_audit_path, workspace.fetch("securityAuditPath")
  end

  test "ending sessions removes the account and privileged shell from the result" do
    post session_revocation_path, params: { confirmed: "1" }, as: :json
    assert_response :success
    assert data.fetch("signedOut")
    assert_nil data.fetch("administrationWorkspace")
    assert_nil data.fetch("authenticatedWorkspace")
    assert_not_includes response.body, '"currentUser"'
    get hub_admins_path
    assert_redirected_to root_path
  end

  private

  def data
    JSON.parse(response.body).fetch("data")
  end
end
