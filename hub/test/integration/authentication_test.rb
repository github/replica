require "test_helper"

class AuthenticationTest < ActionDispatch::IntegrationTest
  test "public home reveals only generic sign-in information without setup" do
    get root_path

    assert_response :success
    assert_includes response.body, I18n.t("home.index.sign_in")
    assert_not_includes response.body, "not_installed"
    assert_not_includes response.body, "installation_id"
  end

  test "OAuth start fails generically when Hub is not configured" do
    post github_authentication_path

    assert_redirected_to root_path
    follow_redirect!
    assert_includes response.body, I18n.t("authentication.failure")
  end

  test "returns to Create with its query after signing in through the public home" do
    github_app_configurations.create_installed
    repository = repository_payload(1379291646, "github/prototype")
    stub_github_sign_in(repositories: [ repository ], permissions: { 1379291646 => "pull" })
    destination = "#{repository_new_prototype_path(1379291646)}?template=default&brief=hello%20world"

    get destination

    assert_redirected_to root_path
    follow_redirect! headers: { "Accept" => "application/json" }
    assert_response :success

    post github_authentication_path
    state = Rack::Utils.parse_query(URI(response.location).query).fetch("state")
    get github_authentication_callback_path, params: { code: "code", state: }

    assert_redirected_to destination
    follow_redirect! headers: { "Accept" => "application/json" }
    assert_response :success
    assert_equal "new", response.parsed_body.fetch("data").fetch("selectedSection")

    delete session_path
    sign_in_to_hub
    assert_redirected_to repositories_path
  end

  test "a saved Create destination still requires repository access after sign-in" do
    github_app_configurations.create_installed
    installed = [
      repository_payload(1379291646, "github/private").merge("private" => true),
      repository_payload(2002, "github/readable").merge("private" => true)
    ]
    stub_github_sign_in(repositories: installed, permissions: { 1379291646 => nil, 2002 => "pull" })
    destination = repository_new_prototype_path(1379291646)

    get destination
    assert_redirected_to root_path
    follow_redirect! headers: { "Accept" => "application/json" }
    post github_authentication_path
    state = Rack::Utils.parse_query(URI(response.location).query).fetch("state")
    get github_authentication_callback_path, params: { code: "code", state: }

    assert_redirected_to destination
    follow_redirect!
    assert_response :not_found
    assert_not_includes response.body, "github/private"
  end

  [ "new", "returning" ].each do |visitor|
    test "does not replay a signed-out POST and keeps the #{visitor} user's default destination" do
      github_app_configurations.create_installed
      users.create(welcome_sign_in_pending: false) if visitor == "returning"
      repository = repository_payload(1379291646, "github/prototype")
      stub_github_sign_in(repositories: [ repository ], permissions: { 1379291646 => "pull" })

      post poll_repository_path(1379291646)

      assert_redirected_to root_path
      follow_redirect! headers: { "Accept" => "application/json" }
      post github_authentication_path
      state = Rack::Utils.parse_query(URI(response.location).query).fetch("state")
      get github_authentication_callback_path, params: { code: "code", state: }

      assert_redirected_to(visitor == "new" ? welcome_path : repositories_path)
    end
  end

  {
    "external URL" => "https://outside.example/repositories/1379291646/new",
    "protocol-relative URL" => "//outside.example/repositories/1379291646/new",
    "backslash" => "/\\outside.example/repositories/1379291646/new",
    "control character" => "/repositories/1379291646/new\n",
    "space" => "/repositories/1379291646/new?brief=hello world",
    "relative path" => "repositories/1379291646/new",
    "non-string value" => [ "/repositories/1379291646/new" ]
  }.each do |description, destination|
    test "rejects a saved authentication destination with #{description}" do
      github_app_configurations.create_installed
      repository = repository_payload(2001, "github/prototype")
      stub_github_sign_in(repositories: [ repository ], permissions: { 2001 => "pull" })

      with_saved_authentication_destination(destination) { post github_authentication_path }
      state = Rack::Utils.parse_query(URI(response.location).query).fetch("state")
      get github_authentication_callback_path, params: { code: "code", state: }

      assert_redirected_to welcome_path
    end
  end

  test "a saved destination does not bypass sign-in admission without repository access" do
    github_app_configurations.create_installed
    repository = repository_payload(2001, "github/private")
    stub_github_sign_in(repositories: [ repository ], permissions: { 2001 => nil })

    get repository_new_prototype_path(2001)
    assert_redirected_to root_path
    follow_redirect!
    post github_authentication_path
    state = Rack::Utils.parse_query(URI(response.location).query).fetch("state")
    assert_no_difference "Session.count" do
      get github_authentication_callback_path, params: { code: "code", state: }
    end

    assert_redirected_to root_path
    follow_redirect!
    assert_includes response.body, I18n.t("authentication.access_denied")
    assert_not_includes response.body, repository.fetch("full_name")
  end

  [ %w[none pull], %w[pull none] ].each do |permissions|
    test "signs in a new reader when private repository permissions arrive as #{permissions.join(" then ")}" do
      github_app_configurations.create_installed
      installed = [
        repository_payload(2001, "github/first-private").merge("private" => true),
        repository_payload(2002, "github/second-private").merge("private" => true)
      ]
      stub_github_sign_in \
        repositories: installed,
        permissions: installed.map { _1.fetch("id") }.zip(permissions).to_h
      checked_permissions = []
      installed.zip(permissions).each do |repository, permission|
        permission_request = stub_request \
          :get,
          "#{GITHUB_API_URL}/repos/#{repository.fetch("full_name")}/collaborators/octocat/permission"
        permission_request.to_return do
          checked_permissions << permission
          {
            status: 200,
            body: JSON.generate(permission:, user: { id: 1001 }),
            headers: { "Content-Type" => "application/json" }
          }
        end
      end

      assert_difference [ "User.count", "Session.count" ], 1 do
        assert_no_difference "ShareLinkCreatorRevocation.count" do
          sign_in_to_hub
        end
      end

      assert_equal permissions, checked_permissions
      assert_equal 1001, Session.sole.user.github_id
      assert_not Session.sole.user.hub_admin?
    end
  end

  test "rejects a new identity when every private repository returns successful none permission" do
    github_app_configurations.create_installed
    installed = [
      repository_payload(2001, "github/first-private").merge("private" => true),
      repository_payload(2002, "github/second-private").merge("private" => true)
    ]
    stub_github_sign_in(repositories: installed, permissions: { 2001 => "none", 2002 => "none" })
    post github_authentication_path
    state = Rack::Utils.parse_query(URI(response.location).query).fetch("state")

    assert_no_difference [ "User.count", "Session.count", "ShareLinkCreatorRevocation.count" ] do
      get github_authentication_callback_path, params: { code: "code", state: }
    end

    assert_redirected_to root_path
    follow_redirect!
    assert_includes response.body, I18n.t("authentication.access_denied")
    installed.each do |repository|
      assert_requested \
        :get,
        "#{GITHUB_API_URL}/repos/#{repository.fetch("full_name")}/collaborators/octocat/permission",
        times: 1
      assert_not_includes response.body, repository.fetch("full_name")
    end
    get repositories_path
    assert_redirected_to root_path
  end

  test "sign-in revokes an existing creator's links only for the private repository with confirmed access loss" do
    seed "repositories/github_prototype"
    SharingSetting.create!(id: 1, public_sharing_enabled: true)
    creator = users.octocat
    denied = repositories.github_prototype
    readable = repositories.create(github_id: 2002, name_with_owner: "github/readable-private")
    prototype = prototypes.create(repository: readable)
    build = builds.create_successful(prototype:)
    lost_link = ShareLink.create_public! \
      prototype: prototypes.welcome, build: builds.welcome, created_by: creator, label: "Lost access"
    retained_link = ShareLink.create_public! \
      prototype:, build:, created_by: creator, label: "Retained access"
    installed = [ denied, readable ].map do |repository|
      repository_payload(repository.github_id, repository.name_with_owner).merge("private" => true)
    end
    stub_github_sign_in(repositories: installed, permissions: { denied.github_id => "none", readable.github_id => "pull" })

    assert_no_difference "User.count" do
      assert_difference [ "Session.count", "ShareLinkCreatorRevocation.count" ], 1 do
        sign_in_to_hub
      end
    end

    assert_equal creator, Session.sole.user
    assert lost_link.reload.revoked_at
    assert_not lost_link.available?
    assert retained_link.reload.available?
    revocation = ShareLinkCreatorRevocation.sole
    assert_equal creator, revocation.user
    assert_equal denied, revocation.repository
    assert_equal 1, revocation.revision
  end

  test "keeps malformed GitHub identity failures generic" do
    github_app_configurations.create_installed
    stub_github_oauth_user(github_id: 0)
    stub_github_installation_token
    stub_github_repositories([])

    post github_authentication_path
    state = Rack::Utils.parse_query(URI(response.location).query).fetch("state")
    get github_authentication_callback_path, params: { code: "code", state: }

    assert_redirected_to root_path
    follow_redirect!
    assert_includes response.body, I18n.t("authentication.failure")
    assert_not_includes response.body, I18n.t("authentication.access_denied")
  end

  test "creates no Hub session when GitHub rejects user authentication" do
    github_app_configurations.create_installed
    stub_github_oauth_user
    user_request = stub_request(:get, "#{GITHUB_API_URL}/user")
      .to_return \
        status: 403,
        body: JSON.generate(message: "Forbidden"),
        headers: { "Content-Type" => "application/json" }

    post github_authentication_path
    state = Rack::Utils.parse_query(URI(response.location).query).fetch("state")

    assert_no_difference "Session.count" do
      get github_authentication_callback_path, params: { code: "code", state: }
    end

    assert_requested user_request
    assert_redirected_to root_path
    follow_redirect!
    assert_includes response.body, I18n.t("authentication.failure")
    assert_not_includes response.body, I18n.t("authentication.access_denied")

    get repositories_path

    assert_redirected_to root_path
  end

  test "protected repository pages redirect anonymous browsers" do
    repositories.create

    get repositories_path

    assert_redirected_to root_path
  end

  test "sign out revokes the database session" do
    github_app_configurations.create_installed
    repository = repositories.create
    repository_payload = {
      "id" => repository.github_id,
      "full_name" => repository.name_with_owner,
      "default_branch" => repository.default_branch
    }
    stub_github_sign_in \
      repositories: [ repository_payload ],
      permissions: { repository.github_id => "pull" }
    post github_authentication_path
    state = Rack::Utils.parse_query(URI(response.location).query).fetch("state")
    get github_authentication_callback_path, params: { code: "code", state: }
    assert_redirected_to welcome_path
    browser_session = Session.last

    delete session_path

    assert_redirected_to root_path
    assert_not Session.exists?(browser_session.id)
  end

  private

  # Seeds forged server-side state without adding a public return-to parameter or bypassing OAuth.
  def with_saved_authentication_destination(destination)
    original = GithubAuthenticationsController.instance_method(:create)
    GithubAuthenticationsController.define_method(:create) do
      session[:authentication_return_to] = destination
      original.bind_call(self)
    end
    yield
  ensure
    GithubAuthenticationsController.define_method(:create, original) if original
  end
end
