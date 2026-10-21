require "test_helper"

class RepositoriesTest < ActionDispatch::IntegrationTest
  setup do
    github_app_configurations.create_installed
  end

  test "selects the first repository the current user may read" do
    visible = repository_payload(2001, "github/visible")
    hidden = repository_payload(2002, "github/hidden")

    stub_github_sign_in \
      repositories: [ visible, hidden ],
      permissions: { 2001 => "pull", 2002 => nil }
    sign_in
    get repositories_path

    assert_redirected_to repository_path(2001)
    assert_equal "private, no-store", response.headers["Cache-Control"]
  end

  test "selects an accessible repository when another check fails" do
    visible = repository_payload(2001, "github/visible")
    failing = repository_payload(2002, "github/failing")

    stub_github_sign_in \
      repositories: [ visible, failing ],
      permissions: { 2001 => "pull", 2002 => :failure }
    sign_in
    get repositories_path

    assert_redirected_to repository_path(2001)
  end

  test "returns not found when no repositories are accessible" do
    hidden = repository_payload(2001, "github/hidden")

    stub_github_sign_in(repositories: [ hidden ], permissions: { 2001 => "pull" })
    sign_in
    stub_github_permissions([ hidden ], { 2001 => nil })
    get repositories_path

    assert_response :not_found
  end

  test "returns not found when GitHub denies one repository" do
    visible = repository_payload(2001, "github/visible")
    hidden = repository_payload(2002, "github/hidden")

    stub_github_sign_in \
      repositories: [ visible, hidden ],
      permissions: { 2001 => "pull", 2002 => nil }
    sign_in
    get repository_path(2002)

    assert_response :not_found
  end

  test "shows the selected repository in the workspace switcher" do
    first = repository_payload(2001, "github/alpha")
    selected = repository_payload(2002, "github/beta")
    removed = repository_payload(2003, "github/removed")

    stub_github_sign_in \
      repositories: [ first, selected, removed ],
      permissions: { 2001 => "pull", 2002 => "pull", 2003 => "pull" }
    sign_in
    Repository.find_by!(github_id: 2003).update! \
      installation_state: "removed",
      removed_at: Time.current
    get repository_path(2002)

    assert_response :success
    assert_includes response.body, "github/alpha"
    assert_includes response.body, "github/beta"
    assert_not_includes response.body, "github/removed"
    assert_includes response.body, I18n.t("repository_workspace.prototypes")
    assert_includes response.body, "/repositories/2002/new"
    assert_includes response.body, I18n.t("notifications.heading")
    assert_includes response.body, notifications_path
  end

  test "shows a new prototype page only for an accessible repository" do
    visible = repository_payload(2001, "github/visible")
    hidden = repository_payload(2002, "github/hidden")
    stub_github_sign_in \
      repositories: [ visible, hidden ],
      permissions: { 2001 => "pull", 2002 => nil }
    sign_in

    get repository_new_prototype_path(2001)

    assert_response :success
    assert_includes response.body, "github/visible"
    assert_includes response.body, I18n.t("new_prototypes.show.heading")
    assert_includes response.body, I18n.t("new_prototypes.show.edit_details")
    assert_includes response.body, I18n.t("repository_workspace.new_prototype")
    assert_includes response.body, "selectedSection"

    get repository_new_prototype_path(2002)

    assert_response :not_found
  end

  test "caches the authorized repository selector list" do
    user = users.create
    alpha = repositories.create(github_id: 2001, name_with_owner: "github/alpha")
    beta = repositories.create(github_id: 2002, name_with_owner: "github/beta")
    configuration = GithubAppConfiguration.current
    stub_github_installation_token
    stub_github_permissions(
      [ repository_payload(2001, alpha.name_with_owner), repository_payload(2002, beta.name_with_owner) ],
      { 2001 => "pull", 2002 => "pull" }
    )
    cache = ActiveSupport::Cache::MemoryStore.new
    controller = RepositoriesController.new

    Current.set(session: Struct.new(:user).new(user)) do
      first = controller.send(:authorized_repositories, configuration, cache:)
      second = controller.send(:authorized_repositories, configuration, cache:)

      assert_equal [ alpha, beta ], first
      assert_equal first, second
    end

    assert_requested :get, %r{/collaborators/octocat/permission}, times: 2
    assert_requested :post, "#{GITHUB_API_URL}/app/installations/456/access_tokens", times: 1
  end

  test "allows a writer to request current branch polling" do
    payload = repository_payload(2001, "github/prototype")
    stub_github_sign_in(repositories: [ payload ], permissions: { 2001 => "push" })
    sign_in
    repository = Repository.find_by!(github_id: 2001)
    configuration = GithubAppConfiguration.current

    assert_enqueued_with \
      job: GithubAppConfiguration::DiscoverBuildsJob,
      args: [ configuration, repository ] do
      post poll_repository_path(repository.github_id)
    end

    assert_response :accepted
  end

  test "does not allow a reader to request build polling" do
    payload = repository_payload(2001, "github/prototype")
    stub_github_sign_in(repositories: [ payload ], permissions: { 2001 => "pull" })
    sign_in

    assert_no_enqueued_jobs do
      post poll_repository_path(2001)
    end

    assert_response :not_found
  end

  private

  def sign_in
    sign_in_to_hub
  end
end
