require "test_helper"

class CanvasApi::TemplatesControllerTest < ActionDispatch::IntegrationTest
  setup do
    host! "replica.localhost:19500"
    @previous_store = Rails.configuration.x.artifact_store
    @previous_root = Rails.configuration.x.artifact_root
    @root = Rails.root.join("storage/canvas-templates-test-#{SecureRandom.hex(5)}")
    Rails.configuration.x.artifact_store = "local"
    Rails.configuration.x.artifact_root = @root
    github_app_configurations.create_installed
    @payload = repository_payload(2001, "github/prototype")
    stub_github_sign_in(repositories: [ @payload ], permissions: { 2001 => "pull" })
    post github_authentication_path
    state = Rack::Utils.parse_query(URI(response.location).query).fetch("state")
    get github_authentication_callback_path, params: { code: "code", state: }
    @repository = Repository.find_by!(github_id: 2001)
    token = "rp_#{SecureRandom.urlsafe_base64(32)}"
    @grant = CanvasGrant.create! \
      repository: @repository,
      user: User.find_by!(github_id: 1001),
      token_digest: Digest::SHA256.hexdigest(token),
      expires_at: 7.days.from_now
    @headers = { "Authorization" => "Bearer #{token}" }
  end

  teardown do
    Rails.configuration.x.artifact_store = @previous_store
    Rails.configuration.x.artifact_root = @previous_root
    FileUtils.rm_rf(@root)
  end

  test "a saved read-only connection gets only the latest successful default branch catalog" do
    owner = prototypes.create(repository: @repository, branch_name: "main")
    older = builds.create_successful(prototype: owner, number: 1)
    write_manifest(older, "old")
    selected = builds.create_successful(prototype: owner, number: 2, commit_sha: "b" * 40)
    write_manifest(selected, "welcome", path: "/settings?q=1#details")
    pending = builds.create(prototype: owner, number: 3, commit_sha: "c" * 40)
    owner.update!(current_build: pending)
    other = prototypes.create(repository: @repository, branch_name: "prototype/other")
    write_manifest(builds.create_successful(prototype: other), "private-branch")
    get "/api/canvas/templates", headers: @headers

    assert_response :success
    payload = JSON.parse(response.body)
    assert_equal \
      [ { "id" => "default", "name" => "Default", "route" => "/" },
        { "id" => "welcome", "name" => "Welcome", "route" => "/settings?q=1#details" } ],
      payload.fetch("templates")
    assert_equal I18n.t("replica_browses.show.branch_instructions"), payload.fetch("promptInstructions")
    assert_equal I18n.t("prototype_prompts.viewed_page", route: "%{route}"),
      payload.fetch("templatePageInstructions")
    assert_equal I18n.t("templates.detail.landing_page_instructions", route: "%{route}"),
      payload.fetch("templateLandingPageInstructions")
    assert payload.fetch("copy").is_a?(Hash)
    assert_equal "private, no-store", response.headers["Cache-Control"]
    assert_nil @grant.reload.last_active_at
    assert_nil owner.reload.registered_at
  end

  test "Default remains available without a successful Build and after the default branch changes" do
    get "/api/canvas/templates", headers: @headers
    assert_response :success
    assert_equal [ "default" ], JSON.parse(response.body).fetch("templates").pluck("id")

    owner = prototypes.create(repository: @repository, branch_name: "main")
    write_manifest(builds.create_successful(prototype: owner), "old-default-branch")
    @repository.update!(default_branch: "trunk")
    get "/api/canvas/templates", headers: @headers
    assert_response :success
    assert_equal [ "default" ], JSON.parse(response.body).fetch("templates").pluck("id")
  end

  test "a corrupt selected manifest is unavailable rather than silently replaced by Default" do
    owner = prototypes.create(repository: @repository, branch_name: "main")
    build = builds.create_successful(prototype: owner)
    ArtifactStore.current.write \
      "#{build.artifact_prefix}/templates.json",
      source: StringIO.new("{broken")
    get "/api/canvas/templates", headers: @headers

    assert_response :service_unavailable
  end

  test "browser sign-in is not a canvas credential and a saved grant cannot select another repository" do
    get "/api/canvas/templates"
    assert_response :unauthorized
    get "/api/canvas/templates", params: { repository_github_id: "9999" }, headers: @headers
    assert_response :not_found
    @grant.destroy!
    get "/api/canvas/templates", headers: @headers
    assert_response :unauthorized
  end

  test "repository access loss and permission lookup failure do not expose cached templates" do
    [ [ nil, :forbidden ], [ :failure, :service_unavailable ] ].each do |permission, expected|
      stub_github_permissions([ @payload ], { 2001 => permission })
      Rails.cache.clear
      get "/api/canvas/templates", headers: @headers
      assert_response expected
    end
  end

  private

  def write_manifest(build, id, path: "/")
    entry = { id:, name: id == "welcome" ? "Welcome" : id,
      category: "Editorial", description: "A starting page.", path: }
    ArtifactStore.current.write \
      "#{build.artifact_prefix}/templates.json",
      source: StringIO.new(JSON.generate(version: 1, templates: [ entry ]))
  end
end
