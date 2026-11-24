require "test_helper"

class TemplatesTest < ActionDispatch::IntegrationTest
  setup do
    host! "replica.localhost:19500"
    @previous_store = Rails.configuration.x.artifact_store
    @previous_root = Rails.configuration.x.artifact_root
    @root = Rails.root.join("storage/templates-test-#{SecureRandom.hex(5)}")
    Rails.configuration.x.artifact_store = "local"
    Rails.configuration.x.artifact_root = @root
    github_app_configurations.create_installed
    @payload = repository_payload(2001, "github/prototype")
    stub_github_sign_in(repositories: [ @payload ], permissions: { 2001 => "pull" })
    post github_authentication_path
    state = Rack::Utils.parse_query(URI(response.location).query).fetch("state")
    get github_authentication_callback_path, params: { code: "code", state: }
    @repository = Repository.find_by!(github_id: 2001)
    @owner = prototypes.create(repository: @repository, branch_name: "main")
    @template = { id: "welcome", name: "Welcome", category: "Editorial",
      description: "A journal.", path: "/settings?q=1#details" }
  end

  teardown do
    Rails.configuration.x.artifact_store = @previous_store
    Rails.configuration.x.artifact_root = @previous_root
    FileUtils.rm_rf(@root)
  end

  test "always lists Default without a build alert when its preview is unavailable" do
    get repository_new_prototype_path(@repository.route_id), as: :json
    assert_response :success
    data = page_data
    assert_equal [ "default" ], data.fetch("templates").pluck("id")
    assert_equal "Create", data.fetch("newPrototypeLabel")
    assert_equal "new", data.fetch("selectedSection")
    assert_equal "Templates", data.fetch("catalog").fetch("heading")
    assert_not data.key?("browseReplicaPath")
    assert_not data.key?("buildNotice")
    assert_not data.fetch("templates").first.key?("screenshotSrc")
    get repository_template_path(@repository.route_id, "default"), as: :json
    assert_response :success
    assert_not page_data.key?("controlsIdentity")
    assert_empty @repository.analytics_events.where(name: "template_previewed")
  end

  test "Create offers picker and catalog routes and screenshots from one successful snapshot" do
    build = successful_build
    pending = builds.create(prototype: @owner, number: 2, commit_sha: "b" * 40)
    @owner.update!(current_build: pending)
    get repository_new_prototype_path(@repository.route_id), as: :json
    assert_response :success
    templates = page_data.fetch("templates")
    assert_equal [ "/", @template.fetch(:path) ], templates.pluck("route")
    assert_equal repository_template_screenshot_path(@repository.route_id, "welcome", build.id, "desktop"),
      templates.last.fetch("screenshotSrc")
    assert_equal repository_template_screenshot_path(@repository.route_id, "welcome", build.id, "desktop", theme: "dark"),
      templates.last.fetch("darkScreenshotSrc")
    assert_equal repository_template_path(@repository.route_id, "welcome"), templates.last.fetch("path")
    assert_equal I18n.t("templates.index.search"), page_data.fetch("catalog").fetch("searchLabel")
    assert_equal I18n.t("new_prototypes.show.template_label"), page_data.fetch("copy").fetch("templateLabel")
    assert_equal I18n.t("new_prototypes.show.preview_unavailable"), page_data.fetch("copy").fetch("previewUnavailable")
    assert_equal I18n.t("prototype_prompts.viewed_page", route: "%{route}"),
      page_data.fetch("templatePageInstructions")
    assert_equal I18n.t("templates.detail.landing_page_instructions", route: "%{route}"),
      page_data.fetch("templateLandingPageInstructions")
    assert_equal "copilot", page_data.fetch("submissionMode")
  end

  test "the old Templates listing redirects to Create without reading artifact metadata" do
    build = builds.create_successful(prototype: @owner)
    write(build, "templates.json", "{broken")

    get repository_templates_path(@repository.route_id)
    assert_redirected_to repository_new_prototype_path(@repository.route_id)
    get repository_templates_path(@repository.route_id), as: :json
    assert_redirected_to repository_new_prototype_path(@repository.route_id)
  end

  test "new prototype keeps Default without a successful Build and after default branch renaming" do
    get repository_new_prototype_path(@repository.route_id), as: :json
    assert_response :success
    assert_equal [ "default" ], page_data.fetch("templates").pluck("id")
    assert_equal "/", page_data.fetch("templates").first.fetch("route")
    assert_not page_data.fetch("templates").first.key?("screenshotSrc")

    successful_build
    @repository.update!(default_branch: "trunk")
    get repository_new_prototype_path(@repository.route_id), as: :json
    assert_response :success
    assert_equal [ "default" ], page_data.fetch("templates").pluck("id")
    assert_not page_data.fetch("templates").first.key?("screenshotSrc")
  end

  test "controls identity follows the template and viewer but not its selected Build or route" do
    build = successful_build
    path = repository_template_path(@repository.route_id, "welcome")
    get path, as: :json
    assert_response :success
    identity = page_data.fetch("controlsIdentity")
    assert_match(/\A[0-9a-f]{64}\z/, identity)
    helper = Object.new.extend(PreviewControlsHelper)
    viewer_id = User.find_by!(github_id: 1001).id
    expected_identity = helper.preview_controls_identity \
      @owner,
      context: [ "authenticated", viewer_id, "template", "welcome" ]
    assert_equal expected_identity, identity
    assert_not_equal helper.preview_controls_identity(@owner, context: [ "authenticated", viewer_id ]),
      identity
    other_viewer_identity = helper.preview_controls_identity \
      @owner,
      context: [ "authenticated", viewer_id + 1, "template", "welcome" ]
    assert_not_equal other_viewer_identity, identity

    successful_build(number: 2, commit_sha: "b" * 40)
    get path, params: { return_path: "/settings?tab=profile", view: "minimized" }, as: :json
    assert_response :success
    assert_equal identity, page_data.fetch("controlsIdentity")
    assert_not_equal build.number, page_data.fetch("selectedBuild").fetch("number")
    get repository_template_path(@repository.route_id, "default"), as: :json
    assert_response :success
    default_identity = page_data.fetch("controlsIdentity")
    assert_not_equal identity, default_identity
    get repository_replica_browse_path(@repository.route_id), as: :json
    assert_response :success
    assert_equal default_identity, page_data.fetch("controlsIdentity")
    assert_nil @owner.reload.registered_at
    assert_empty ReviewComment.all
    assert_empty ShareLink.all
  end

  test "records one template preview per repository, viewer and template per UTC day" do
    viewer = User.find_by!(github_id: 1001)
    events = @repository.analytics_events.where(name: "template_previewed")
    path = repository_template_path(@repository.route_id, "welcome")
    build = successful_build
    other_payload = repository_payload(2002, "example/another-prototype")

    Time.use_zone("Pacific Time (US & Canada)") do
      travel_to Time.utc(2026, 9, 15, 23, 59) do
        get path, as: :json
        assert_response :success
        first = events.sole
        assert_equal Analytics.actor_id(user: viewer), first.actor_id
        expected = { "repository_id" => @repository.id, "prototype_id" => @owner.id, "build_id" => build.id }
        assert_equal expected, first.properties

        successful_build(number: 2, commit_sha: "b" * 40)
        get path, params: { return_path: "/settings?tab=profile" }, as: :json
        assert_response :success
        assert_equal first, events.sole

        other = repositories.create \
          github_id: other_payload.fetch("id"),
          name_with_owner: other_payload.fetch("full_name"),
          default_branch: "main"
        owner = prototypes.create(repository: other, branch_name: "main")
        stub_github_permissions([ other_payload ], { 2002 => "pull" })
        successful_build(prototype: owner)
        get repository_template_path(other.route_id, "welcome"), as: :json
        assert_response :success
        assert_equal other.id, other.analytics_events.where(name: "template_previewed").sole.properties.fetch("repository_id")

        assert_difference -> { events.count }, 1 do
          get repository_template_path(@repository.route_id, "default"), as: :json
        end
        assert_response :success
      end

      travel_to Time.utc(2026, 9, 16) do
        assert_difference -> { events.count }, 1 do
          get path, as: :json
        end
        assert_response :success

        delete session_path
        stub_github_oauth_user(github_id: 1002, login: "another-reader")
        stub_github_permissions \
          [ @payload, other_payload ],
          { 2001 => "pull", 2002 => "pull" },
          github_id: 1002,
          login: "another-reader"
        sign_in_to_hub(github_id: 1002)
        assert_difference -> { events.count }, 1 do
          get path, as: :json
        end
        assert_response :success
        assert_equal Analytics.actor_id(user: User.find_by!(github_id: 1002)), events.order(:id).last.actor_id
      end
    end
  end

  test "serves a template preview even if its analytics write fails" do
    build = successful_build
    original = Analytics::Event.method(:record!)
    attempted = false
    Analytics::Event.define_singleton_method(:record!) do |**attributes|
      if attributes[:name] == "template_previewed"
        attempted = true
        raise ActiveRecord::StatementInvalid, "database is locked"
      end

      original.call(**attributes)
    end

    get repository_template_path(@repository.route_id, "welcome"), as: :json
    assert_response :success
    assert_equal build.number, page_data.fetch("selectedBuild").fetch("number")
    assert attempted
  ensure
    Analytics::Event.define_singleton_method(:record!, original) if original
  end

  test "template controls require the same current preview session and repository read access" do
    build = successful_build
    get preview_build_authorization_path(build.id), params: { return_path: @template.fetch(:path) }
    assert_response :redirect
    grant = Rack::Utils.parse_query(URI(response.location).query).fetch("grant")
    host! "b#{build.id}.preview.replica.localhost:19500"
    get "/__replica/authorize", params: { grant: }
    assert_response :redirect
    get PreviewPathRouting::PUBLIC_CONTROLS_PATH
    assert_response :success

    stub_github_permissions([ @payload ], { 2001 => nil })
    Rails.cache.clear
    get PreviewPathRouting::PUBLIC_CONTROLS_PATH
    assert_response :not_found
    stub_github_permissions([ @payload ], { 2001 => :failure })
    Rails.cache.clear
    get PreviewPathRouting::PUBLIC_CONTROLS_PATH
    assert_response :service_unavailable

    Session.delete_all
    get PreviewPathRouting::PUBLIC_CONTROLS_PATH
    assert_response :redirect
  end

  test "uses one latest successful snapshot for metadata screenshots and preview destinations" do
    build = successful_build
    pending = builds.create(prototype: @owner, number: 2, commit_sha: "b" * 40)
    @owner.update!(current_build: pending)
    get repository_new_prototype_path(@repository.route_id), as: :json
    assert_response :success
    data = page_data
    assert_equal %w[default welcome], data.fetch("templates").pluck("id")
    assert_equal repository_template_screenshot_path(@repository.route_id, "welcome", build.id, "desktop"),
      data.fetch("templates").last.fetch("screenshotSrc")
    assert_not data.key?("buildNotice")

    get repository_template_path(@repository.route_id, "welcome"),
      params: { build: pending.number, before: "invalid" }, as: :json
    assert_response :success
    data = page_data
    assert_equal "Welcome", data.fetch("prototypeName")
    assert_equal "welcome", data.fetch("templateId")
    assert_equal "Branch from here", data.fetch("forkLabel")
    assert_equal I18n.t("templates.detail.landing_page_instructions", route: "%{route}"),
      data.fetch("templateLandingPageInstructions")
    assert_equal "#{PreviewOrigin.current.url(build.id)}settings?q=1#details",
      data.fetch("selectedBuild").fetch("previewUrl")
    assert_equal "new", data.fetch("selectedSection")
    assert_equal false, data.fetch("minimizedPreview")
    assert_not data.key?("newerBuildLabel")
    %w[prototypeId author reviewComments shareLinksPath detailsEditPath buildOptions].each do |key|
      assert_not data.key?(key), key
    end
  end

  test "serves retained template and Default screenshots only from the authorized default owner" do
    build = successful_build
    %w[default welcome].each do |id|
      get repository_template_screenshot_path(@repository.route_id, id, build.id, "desktop")
      assert_response :success
      assert_equal "image/png", response.media_type
      assert_equal "private, no-store", response.headers["Cache-Control"]
    end

    get repository_template_screenshot_path(@repository.route_id, "unknown", build.id, "desktop")
    assert_response :not_found
    other = prototypes.create(repository: @repository, branch_name: "prototype/other")
    other_build = builds.create_successful(prototype: other)
    get repository_template_screenshot_path(@repository.route_id, "default", other_build.id, "desktop")
    assert_response :not_found
    get repository_template_path(@repository.route_id, "unknown"), as: :json
    assert_response :not_found
    assert_empty @repository.analytics_events.where(name: "template_previewed")
  end

  test "serves dark Default and template captures and keeps legacy screenshots available" do
    build = successful_build
    %w[default welcome].each do |id|
      path = repository_template_screenshot_path(@repository.route_id, id, build.id, "desktop")
      get path, params: { theme: "dark" }
      assert_response :success
      assert_equal "#{id} desktop", response.body

      directory = id == "default" ? "screenshots" : "screenshots/templates/#{id}"
      write(build, "#{directory}/desktop-dark.png", "#{id} dark desktop")
      get path, params: { theme: "dark" }
      assert_response :success
      assert_equal "#{id} dark desktop", response.body
      get path
      assert_response :success
      assert_equal "#{id} desktop", response.body
      get path, params: { theme: "unknown" }
      assert_response :bad_request
    end
  end

  test "opens declared routes through default-Build authorization and the live preview" do
    {
      "/café/v2.0?tab=é#details" => "/caf%C3%A9/v2.0?tab=%C3%A9#details",
      "/docs/" => "/docs/",
      "/#{'a' * 2047}" => "/#{'a' * 2047}",
      "/?q=#{'é' * 340}aaaa" => "/?q=#{'%C3%A9' * 340}aaaa"
    }.each.with_index(1) do |(declared, serialized), number|
      host! "replica.localhost:19500"
      build = successful_build \
        template: @template.merge(path: declared),
        number:,
        commit_sha: number.to_s(16).rjust(40, "0")
      write(build, "dist/index.html", "<!doctype html><h1>Template entry</h1>")
      get repository_template_path(@repository.route_id, "welcome"), as: :json
      assert_response :success, declared
      assert_equal \
        "#{PreviewOrigin.current.url(build.id)}#{declared.delete_prefix('/')}",
        page_data.fetch("selectedBuild").fetch("previewUrl")

      get preview_build_authorization_path(build.id), params: { return_path: serialized }
      assert_response :redirect
      grant = Rack::Utils.parse_query(URI(response.location).query).fetch("grant")
      host! "b#{build.id}.preview.replica.localhost:19500"
      get "/__replica/authorize", params: { grant: }
      assert_redirected_to serialized
      get \
        serialized.split("#", 2).first,
        headers: { "HTTP_ACCEPT" => "text/html", "HTTP_SEC_FETCH_DEST" => "iframe" }
      assert_response :success
      assert_includes response.body, "Template entry"
      assert_includes response.body, PreviewPathRouting::PUBLIC_BRIDGE_PATH
      assert_includes response.body, PreviewPathRouting::PUBLIC_CONTROLS_PATH
      get PreviewPathRouting::PUBLIC_CONTROLS_PATH
      assert_response :success
      assert_equal "private, no-store", response.headers["Cache-Control"]
      get PreviewPathRouting::PUBLIC_BRIDGE_PATH
      assert_response :success
      assert_includes response.body, 'const REVIEW_ENABLED = "false" !== "false"'
    end
  end

  test "legacy artifacts show Default and corrupt manifests fail explicitly" do
    build = builds.create_successful(prototype: @owner)
    get repository_new_prototype_path(@repository.route_id), as: :json
    assert_response :success
    assert_equal [ "default" ], page_data.fetch("templates").pluck("id")
    write(build, "templates.json", "{broken")
    get repository_new_prototype_path(@repository.route_id), as: :json
    assert_response :service_unavailable
    get repository_template_path(@repository.route_id, "welcome"), as: :json
    assert_response :service_unavailable
  end

  test "Default detail and legacy Browse both open root without applying prototype settings" do
    build = successful_build
    @owner.update!(start_page: "/ignored")
    [ repository_template_path(@repository.route_id, "default"),
      repository_replica_browse_path(@repository.route_id) ].each do |path|
      get path, params: { build: "ignored", before: "invalid" }, as: :json
      assert_response :success
      assert_equal "Default", page_data.fetch("prototypeName")
      assert_equal "Branch from here", page_data.fetch("forkLabel")
      assert_not page_data.key?("templateLandingPageInstructions")
      assert_equal PreviewOrigin.current.url(build.id), page_data.fetch("selectedBuild").fetch("previewUrl")
      assert_equal "new", page_data.fetch("selectedSection")
    end
  end

  test "template links reopen an explicit route minimized on the latest successful default Build" do
    previous = successful_build
    @owner.update!(start_page: "/ignored")
    destination = "/settings?tab=profile#details"
    path = repository_template_path(@repository.route_id, "welcome")
    params = { return_path: destination, build: previous.number, before: "invalid", view: "minimized" }
    get path, params:, as: :json
    assert_response :success
    assert_equal "#{PreviewOrigin.current.url(previous.id)}#{destination.delete_prefix('/')}",
      page_data.fetch("selectedBuild").fetch("previewUrl")

    latest = successful_build(number: 2, commit_sha: "b" * 40)
    get path, params:, as: :json
    assert_response :success
    data = page_data
    assert_equal latest.number, data.fetch("selectedBuild").fetch("number")
    assert_equal "#{PreviewOrigin.current.url(latest.id)}#{destination.delete_prefix('/')}",
      data.fetch("selectedBuild").fetch("previewUrl")
    assert_equal "welcome", data.fetch("templateId")
    assert_equal path, data.fetch("branchPath")
    assert_equal true, data.fetch("minimizedPreview")
    assert_equal I18n.t("prototypes.show.prototype_link"), data.fetch("previewUrlLabel")
    assert_equal I18n.t("prototypes.show.minimize_hub"), data.fetch("minimizeHubLabel")
    assert_equal I18n.t("prototypes.show.maximize_hub"), data.fetch("maximizeHubLabel")
    assert_equal I18n.t("templates.detail.landing_page_instructions", route: "%{route}"),
      data.fetch("templateLandingPageInstructions")
    %w[reviewComments reviewCommentsPath reviewCommentsCable openInNewTabLabel].each do |key|
      assert_not data.key?(key), key
    end

    get path, params: { return_path: "/" }, as: :json
    assert_response :success
    assert_equal PreviewOrigin.current.url(latest.id), page_data.fetch("selectedBuild").fetch("previewUrl")
    assert_nil @owner.reload.registered_at
    assert_empty ReviewComment.all
    assert_empty ShareLink.all
  end

  test "Default links honor explicit routes without importing prototype start pages or landing instructions" do
    build = successful_build
    @owner.update!(start_page: "/ignored")
    destination = "/#/about?tab=profile"
    [ repository_template_path(@repository.route_id, "default"),
      repository_replica_browse_path(@repository.route_id) ].each do |path|
      get path, params: { return_path: destination, view: "minimized" }, as: :json
      assert_response :success
      assert_equal "#{PreviewOrigin.current.url(build.id)}#{destination.delete_prefix('/')}",
        page_data.fetch("selectedBuild").fetch("previewUrl")
      assert_equal true, page_data.fetch("minimizedPreview")
      assert_not page_data.key?("templateLandingPageInstructions")
    end
  end

  test "template details reject invalid return paths even before a successful Build exists" do
    invalid_paths = [ "", "settings", "https://example.com/settings", "//example.com/settings",
      "/settings\\profile", "/settings name", "/settings\tprofile", "/settings\nprofile",
      "/#\u0001", "/#\u00A0", "/" + "a" * 2_048, [ "/settings" ], { route: "/settings" } ]
    invalid_paths.each do |return_path|
      get repository_template_path(@repository.route_id, "default"), params: { return_path: }, as: :json
      assert_response :not_found, return_path.inspect
    end
    successful_build
    invalid_paths.each do |return_path|
      get repository_template_path(@repository.route_id, "welcome"), params: { return_path: }, as: :json
      assert_response :not_found, return_path.inspect
    end
    assert_empty @repository.analytics_events.where(name: "template_previewed")
  end

  test "requires current access for list detail and screenshots and fails closed" do
    build = successful_build
    paths = [ repository_new_prototype_path(@repository.route_id),
      repository_templates_path(@repository.route_id),
      repository_template_path(@repository.route_id, "welcome"),
      repository_template_screenshot_path(@repository.route_id, "welcome", build.id, "desktop") ]
    [ [ nil, :not_found ], [ :failure, :service_unavailable ] ].each do |permission, expected|
      stub_github_permissions([ @payload ], { 2001 => permission })
      Rails.cache.clear
      paths.each do |path|
        get path, params: { return_path: "/settings?tab=profile#details", view: "minimized" }, as: :json
        assert_response expected
      end
    end
    assert_empty @repository.analytics_events.where(name: "template_previewed")
  end

  private

  def page_data
    JSON.parse(response.body).fetch("data")
  end

  def successful_build(template: @template, prototype: @owner, **attributes)
    builds.create_successful(prototype:, **attributes).tap do |build|
      write(build, "templates.json", JSON.generate(version: 1, templates: [ template ]))
      %w[desktop narrow].each do |size|
        write(build, "screenshots/#{size}.png", "default #{size}")
        write(build, "screenshots/templates/welcome/#{size}.png", "welcome #{size}")
      end
    end
  end

  def write(build, name, content)
    ArtifactStore.current.write("#{build.artifact_prefix}/#{name}", source: StringIO.new(content))
  end
end
