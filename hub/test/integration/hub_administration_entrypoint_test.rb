require "test_helper"

class HubAdministrationEntrypointTest < ActionDispatch::IntegrationTest
  setup do
    github_app_configurations.create_installed
    @payload = repository_payload(2001, "github/prototype")
    stub_github_sign_in(repositories: [ @payload ], permissions: { 2001 => "admin" })
    post github_authentication_path
    state = Rack::Utils.parse_query(URI(response.location).query).fetch("state")
    get github_authentication_callback_path, params: { code: "code", state: }
    @user = User.find_by!(github_id: 1001)
    @repository = Repository.find_by!(github_id: 2001)
    @prototype = prototypes.create(repository: @repository)
    @prototype.register!(name: "Account navigation")
    @build = builds.create_successful(prototype: @prototype)
    default_owner = prototypes.create(repository: @repository, branch_name: "main")
    builds.create_successful(prototype: default_owner)
  end

  test "every repository workspace projects the current administration links" do
    @user.update!(hub_admin: true)
    @user.sessions.sole.update!(fresh_authorized_at: nil)
    paths = [
      repository_path(@repository.route_id),
      repository_new_prototype_path(@repository.route_id),
      repository_prototype_management_path(@repository.route_id),
      repository_prototype_path(@repository.route_id, @prototype),
      repository_prototype_builds_path(@repository.route_id, @prototype),
      repository_prototype_build_path(@repository.route_id, @prototype, @build.number),
      repository_prototype_share_links_path(@repository.route_id, @prototype),
      repository_analytics_path(@repository.route_id),
      repository_template_path(@repository.route_id, "default"),
      repository_replica_browse_path(@repository.route_id),
      repository_security_audit_path(@repository.route_id)
    ]

    assert_no_difference("FreshAuthorization.count") do
      paths.each do |path|
        get path, as: :json
        assert_response :success
        data = JSON.parse(response.body).fetch("data")
        navigation = data["workspace"] || data
        assert_equal %w[github copilot admins sharing sessions], navigation.fetch("administrationLinks").pluck("section"), path
        assert_not navigation.key?("hubAdministrationPath"), path
        assert_not navigation.key?("hubAdministrationLabel"), path
      end
    end
  end

  test "a repository administrator keeps repository audit without Hub administration links" do
    get repository_path(@repository.route_id), as: :json
    assert_response :success
    data = JSON.parse(response.body).fetch("data")
    assert_equal repository_security_audit_path(@repository.route_id), data.fetch("securityAuditPath")
    assert_empty data.fetch("administrationLinks")
  end

  test "a Hub administrator with read-only repository access gets the global audit link" do
    @user.update!(hub_admin: true)
    stub_github_permissions([ @payload ], { 2001 => "pull" })
    get repository_path(@repository.route_id), as: :json
    assert_response :success
    data = JSON.parse(response.body).fetch("data")
    assert_equal security_audit_path, data.fetch("securityAuditPath")
    assert_equal %w[github copilot admins sharing sessions], data.fetch("administrationLinks").pluck("section")
    assert_nil data.fetch("analyticsPath")
  end

  test "an ordinary GitHub reader receives no administration navigation" do
    stub_github_permissions([ @payload ], { 2001 => "pull" })
    get repository_path(@repository.route_id), as: :json
    assert_response :success
    data = JSON.parse(response.body).fetch("data")
    assert_nil data.fetch("securityAuditPath")
    assert_empty data.fetch("administrationLinks")
  end

  test "revocation removes administration navigation and does not bypass the landing guard" do
    @user.update!(hub_admin: true)
    get repository_path(@repository.route_id), as: :json
    assert_not_empty JSON.parse(response.body).fetch("data").fetch("administrationLinks")
    @user.update!(hub_admin: false)
    get repository_path(@repository.route_id), as: :json
    data = JSON.parse(response.body).fetch("data")
    assert_empty data.fetch("administrationLinks")
    assert_equal repository_security_audit_path(@repository.route_id), data.fetch("securityAuditPath")
    get security_audit_path
    assert_response :not_found
  end

  test "Hub administration grants no repository access" do
    @user.update!(hub_admin: true)
    stub_github_permissions([ @payload ], { 2001 => nil })
    get repository_path(@repository.route_id)
    assert_response :not_found
    delete session_path
    get repository_path(@repository.route_id)
    assert_redirected_to root_path
    follow_redirect!
  end
end
