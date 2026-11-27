require "test_helper"
require "tmpdir"
require_relative "../support/share_link_lifetime_helpers"

class SharedBuildsTest < ActionDispatch::IntegrationTest
  include ShareLinkLifetimeHelpers
  setup do
    @previous_artifact_store = Rails.configuration.x.artifact_store
    @previous_artifact_root = Rails.configuration.x.artifact_root
    @artifact_root = Pathname(Dir.mktmpdir("replica-share-preview-"))
    Rails.configuration.x.artifact_store = "local"
    Rails.configuration.x.artifact_root = @artifact_root
    host! "replica.localhost:19500"
    seed "repositories/github_prototype"
    @repository = repositories.github_prototype
    @prototype = prototypes.welcome
    @build = builds.welcome
    actor = users.octocat
    actor.update!(hub_admin: true)
    browser_session = actor.sessions.create!(fresh_authorized_at: Time.current)
    SharingSetting.change!(actor:, browser_session:, operation: "enable")
    @share_link = ShareLink.create_public! \
      prototype: @prototype,
      build: @build,
      created_by: users.octocat,
      label: "Partner review",
      expiration: "seven_days"
    write_build_files
  end

  test "disabling permanently stops anonymous pages assets controls and pending handoffs" do
    authorize_share_preview
    host! "replica.localhost:19500"
    pending = SharePreviewGrant.issue!(share_link: @share_link)
    actor = users.octocat
    actor.update!(hub_admin: true)
    session = actor.sessions.create!(fresh_authorized_at: Time.current)
    SharingSetting.change!(actor:, browser_session: session, operation: "disable")
    SharingSetting.change!(actor:, browser_session: session, operation: "enable")

    get shared_build_path(@share_link.public_id)
    assert_response :not_found
    get share_preview_authorization_path(@share_link.public_id)
    assert_response :not_found
    host! "s#{@build.id}.preview.replica.localhost:19500"
    get "/__replica/authorize", params: { grant: pending }
    assert_response :not_found
    [ "/", "/assets/app.js", "/settings", PreviewPathRouting::PUBLIC_CONTROLS_PATH ].each do |path|
      get path
      assert_response :not_found
      assert_equal "private, no-store", response.headers["Cache-Control"]
    end
    assert @share_link.reload.revoked_at
  end

  test "disabling during artifact preparation returns no public content" do
    authorize_share_preview
    actor = users.octocat
    actor.update!(hub_admin: true)
    session = actor.sessions.create!(fresh_authorized_at: Time.current)
    original = ArtifactStore::Local.instance_method(:read)
    ArtifactStore::Local.define_method(:read) do |*args, **kwargs|
      result = original.bind_call(self, *args, **kwargs)
      SharingSetting.change!(actor:, browser_session: session, operation: "disable")
      result
    end
    get "/"
    assert_response :not_found
    assert_empty response.body
  ensure
    ArtifactStore::Local.define_method(:read, original) if original
  end

  %w[never thirty_days].each do |expiration|
    test "enabling the maximum lifetime immediately blocks an existing #{expiration} share and its preview credentials" do
      @share_link.update_columns \
        created_at: 8.days.ago,
        expires_at: expiration == "never" ? nil : 30.days.from_now
      pending = with_share_link_maximum_lifetime(nil) do
        authorize_share_preview
        get "/"
        assert_response :success
        SharePreviewGrant.issue!(share_link: @share_link)
      end

      with_share_link_maximum_lifetime(7.days) do
        ShareLink.enforce_maximum_lifetime!
        host! "replica.localhost:19500"
        get shared_build_path(@share_link.public_id)
        assert_response :not_found
        get share_preview_authorization_path(@share_link.public_id)
        assert_response :not_found
        host! "s#{@build.id}.preview.replica.localhost:19500"
        get "/__replica/authorize", params: { grant: pending }
        assert_response :not_found
        [ "/", "/assets/app.js", "/settings", PreviewPathRouting::PUBLIC_CONTROLS_PATH ].each do |path|
          get path
          assert_response :not_found
          assert_equal "private, no-store", response.headers["Cache-Control"]
        end
      end
      host! "replica.localhost:19500"
      get shared_build_path(@share_link.public_id)
      assert_response :not_found
      host! "s#{@build.id}.preview.replica.localhost:19500"
      get "/assets/app.js"
      assert_response :not_found
    end
  end

  test "a previously issued cookie and pending handoff stop at the exact creation time cap" do
    travel_to Time.current.change(usec: 0) do
      @share_link.update_columns(created_at: 7.days.ago + 1.minute, expires_at: nil)
      authorize_share_preview
      pending = SharePreviewGrant.issue!(share_link: @share_link)
      deadline = @share_link.created_at + 7.days
      with_share_link_maximum_lifetime(7.days) do
        get "/assets/app.js"
        assert_response :success
        travel_to deadline
        get "/assets/app.js"
        assert_response :not_found
        get PreviewPathRouting::PUBLIC_CONTROLS_PATH
        assert_response :not_found
        get "/__replica/authorize", params: { grant: pending }
        assert_response :not_found
        host! "replica.localhost:19500"
        get shared_build_path(@share_link.public_id)
        assert_response :not_found
      end
    end
  end

  teardown do
    Rails.configuration.x.artifact_store = @previous_artifact_store
    Rails.configuration.x.artifact_root = @previous_artifact_root
    FileUtils.rm_rf(@artifact_root)
  end

  test "shows a public share without GitHub sign-in" do
    get shared_build_path(@share_link.public_id)

    assert_response :success
    assert_includes response.body, "Partner review"
    assert_includes response.body, share_preview_authorization_path(@share_link.public_id)
    assert_not_includes response.body, @repository.name_with_owner
    assert_equal "private, no-store", response.headers["Cache-Control"]
    assert_equal "no-referrer", response.headers["Referrer-Policy"]
    nonce = css_select("meta[name='csp-nonce']").first["content"]
    assert_equal \
      HubContentSecurityPolicy.build(development: false).build(Object.new, nonce, %w[script-src]),
      response.headers["Content-Security-Policy"]
    assert_select "script[nonce]", text: /SUPERGLUE_INITIAL_PAGE_STATE=/

    get shared_build_path(@share_link.public_id), headers: { "User-Agent" => "PreviewBot/1.0" }
    assert_response :success
    assert_empty @repository.analytics_events.where(name: "shared_preview_opened")
  end

  test "anonymous share pages and preview files do not observe creator permission loss" do
    creator = @share_link.created_by
    permission_url = "#{GITHUB_API_URL}/repos/#{@repository.name_with_owner}/collaborators/#{creator.login}/permission"
    lookup = stub_request(:get, permission_url).to_return \
      status: 200,
      body: JSON.generate(permission: "none", user: { id: creator.github_id }),
      headers: { "Content-Type" => "application/json" }

    get shared_build_path(@share_link.public_id), as: :json
    assert_response :success
    authorize_share_preview
    get "/assets/app.js"
    assert_response :success
    assert_not_requested lookup
    assert_nil @share_link.reload.revoked_at
  end

  test "a public share keeps its original Build after retirement and branch name reuse" do
    @prototype.update!(current_build: @build)
    @repository.branch_presence.record_missing!(
      branch_name: @prototype.branch_name,
      observed: @repository.branch_presence.observations.fetch(@prototype.branch_name)
    )
    replacement = prototypes.create(repository: @repository, branch_name: @prototype.branch_name)
    builds.create_successful(prototype: replacement, commit_sha: "b" * 40)

    get shared_build_path(@share_link.public_id)
    assert_response :success
    assert_equal @build, @share_link.reload.build
    authorize_share_preview
    get "/assets/app.js"
    assert_response :success
    assert_equal "console.log('shared')", response.body
  end

  test "deployment session revocation leaves an existing public preview and unused handoff usable" do
    get share_preview_authorization_path(@share_link.public_id)
    handoff = Rack::Utils.parse_query(URI(response.location).query).fetch("grant")
    host! "s#{@build.id}.preview.replica.localhost:19500"
    get "/__replica/authorize", params: { grant: handoff }
    get "/"
    assert_response :success
    unused = SharePreviewGrant.issue!(share_link: @share_link)
    actor = users.octocat
    browser_session = actor.sessions.sole
    revision = SharingSetting.revision

    SessionRevocation.end_all!(actor:, browser_session:)

    get "/"
    assert_response :success
    assert_not_includes response.body, PreviewFilesController::BRIDGE_TAG.strip
    get "/__replica/authorize", params: { grant: unused }
    assert_response :redirect
    assert @share_link.reload.available?
    assert_equal revision, SharingSetting.revision
    assert SharingSetting.enabled?
  end

  test "authorizes and serves the exact shared Build without the review bridge" do
    get share_preview_authorization_path(@share_link.public_id)

    assert_response :redirect
    event = @repository.analytics_events.where(name: "shared_preview_opened").sole
    assert_nil event.actor_id
    expected = { "repository_id" => @repository.id, "prototype_id" => @prototype.id, "build_id" => @build.id }
    assert_equal expected, event.properties
    grant = Rack::Utils.parse_query(URI(response.location).query).fetch("grant")
    assert_equal \
      "s#{@build.id}.preview.replica.localhost",
      URI(response.location).host

    host! "s#{@build.id}.preview.replica.localhost:19500"
    get "/__replica/authorize", params: { grant: }

    assert_redirected_to "/"
    assert_match(/replica_share_preview=/, response.headers.fetch("Set-Cookie"))
    assert_match(/httponly/i, response.headers.fetch("Set-Cookie"))
    refute_match(/;\s*domain=/i, response.headers.fetch("Set-Cookie"))
    assert_not_includes response.headers.fetch("Set-Cookie"), "#{LocalDevelopment.session_cookie_key}="

    get "/"

    assert_response :success
    assert_includes response.body, "Shared preview"
    assert_not_includes response.body, PreviewFilesController::BRIDGE_TAG.strip
    assert_includes response.body, PreviewControlsRespondable::CONTROLS_TAG.strip
    assert_equal \
      "frame-ancestors http://replica.localhost:19500; worker-src blob:",
      response.headers["Content-Security-Policy"]
    assert_nil response.headers["Content-Security-Policy-Report-Only"]
    assert_nil response.headers["X-Frame-Options"]
    assert_equal "private, no-store", response.headers["Cache-Control"]
    assert_equal "no-referrer", response.headers["Referrer-Policy"]
    assert_equal "nosniff", response.headers["X-Content-Type-Options"]
    assert_not_includes response.body, "SUPERGLUE_INITIAL_PAGE_STATE"
    assert_select "meta[name='csp-nonce']", count: 0

    get PreviewPathRouting::PUBLIC_CONTROLS_PATH,
      headers: { "HTTP_ACCEPT" => "*/*", "HTTP_SEC_FETCH_DEST" => "script" }
    assert_response :success
    assert_equal "text/javascript", response.media_type
    assert_equal "private, no-store", response.headers["Cache-Control"]
    assert_equal "same-origin", response.headers["Cross-Origin-Resource-Policy"]
    assert_not_includes response.body, @repository.name_with_owner
    assert_not_includes response.body, "replica:preview:"
    assert_not_includes response.body, "replica:canvas:"

    get "/assets/app.js", headers: { "HTTP_ACCEPT" => "*/*", "HTTP_SEC_FETCH_DEST" => "script" }

    assert_response :success
    assert_equal "console.log('shared')", response.body

    get "/settings", headers: { "HTTP_ACCEPT" => "text/html", "HTTP_SEC_FETCH_DEST" => "document" }

    assert_response :success
    assert_includes response.body, "Shared preview"
    assert_not_includes response.body, PreviewFilesController::BRIDGE_TAG.strip
  end

  test "does not expose the review bridge on a shared preview host" do
    authorize_share_preview

    get PreviewPathRouting::PUBLIC_BRIDGE_PATH,
      headers: { "HTTP_ACCEPT" => "*/*", "HTTP_SEC_FETCH_DEST" => "script" }

    assert_response :not_found
  end

  test "controls requests cannot bypass public share availability" do
    host! "s#{@build.id}.preview.replica.localhost:19500"
    get PreviewPathRouting::PUBLIC_CONTROLS_PATH
    assert_response :not_found
    host! "replica.localhost:19500"
    authorize_share_preview
    get PreviewPathRouting::PUBLIC_CONTROLS_PATH
    assert_response :success
    @share_link.destroy!
    get PreviewPathRouting::PUBLIC_CONTROLS_PATH
    assert_response :not_found
  end

  test "public controls identities contain no private metadata and are separated by share" do
    get shared_build_path(@share_link.public_id), as: :json
    data = JSON.parse(response.body).fetch("data")
    assert_match(/\A[0-9a-f]{64}\z/, data.fetch("controlsIdentity"))
    assert_equal "http://s#{@build.id}.preview.replica.localhost:19500", data.fetch("controlsOrigin")
    other = ShareLink.create_public! \
      prototype: @prototype,
      build: @build,
      created_by: users.octocat,
      label: "Another review"
    get shared_build_path(other.public_id), as: :json
    assert_not_equal data.fetch("controlsIdentity"),
      JSON.parse(response.body).fetch("data").fetch("controlsIdentity")
    assert_not_includes response.body, @repository.name_with_owner
    assert_not_includes response.body, @prototype.branch_name
  end

  test "serves storage-incompatible shared document routes without adding the review bridge" do
    authorize_share_preview

    [ "/caf%C3%A9/v2.0", "/docs/", "/a//b", "/#{'a' * 300}", "/#{'a' * 1100}",
      "/#{'nested/' * 24}page" ].each do |path|
      get path, headers: { "HTTP_ACCEPT" => "text/html", "HTTP_SEC_FETCH_DEST" => "iframe" }
      assert_response :success, path
      assert_includes response.body, "Shared preview"
      assert_not_includes response.body, PreviewFilesController::BRIDGE_TAG.strip
    end

    get "/caf%C3%A9.png", headers: { "HTTP_ACCEPT" => "*/*", "HTTP_SEC_FETCH_DEST" => "image" }
    assert_response :not_found

    [ "/bad%0a", "/%2e%2e/secret", "/.replica-internal/file", "/%2fexample.com" ].each do |path|
      get path, headers: { "HTTP_ACCEPT" => "text/html", "HTTP_SEC_FETCH_DEST" => "iframe" }
      assert_response :not_found, path
    end
  end

  test "starts public previews on the saved route and preserves explicit destinations" do
    @prototype.update!(start_page: "/settings?tab=profile#details")
    events = @repository.analytics_events.where(name: "shared_preview_opened")
    [ [ nil, "/settings?tab=profile#details" ], [ "/specific?q=1#comment", "/specific?q=1#comment" ],
      [ "/", "/" ], [ nil, "/settings?tab=profile#details" ] ].each do |return_path, expected|
      host! "replica.localhost:19500"
      assert_difference -> { events.count }, 1 do
        get share_preview_authorization_path(@share_link.public_id), params: { return_path: }
      end
      assert_response :redirect
      grant = Rack::Utils.parse_query(URI(response.location).query).fetch("grant")
      host! "s#{@build.id}.preview.replica.localhost:19500"
      assert_no_difference -> { events.count } do
        get "/__replica/authorize", params: { grant: }
      end
      assert_redirected_to expected
    end
  end

  test "public shells forward explicit routes and reject external destinations" do
    get shared_build_path(@share_link.public_id, return_path: "/specific#details"), as: :json
    assert_response :success
    url = JSON.parse(response.body).fetch("data").fetch("previewUrl")
    assert_equal "/specific#details", Rack::Utils.parse_query(URI(url).query).fetch("return_path")

    get share_preview_authorization_path(@share_link.public_id, return_path: "//example.com")
    assert_response :not_found
    assert_empty @repository.analytics_events.where(name: "shared_preview_opened")
  end

  test "issues a usable public preview grant even if its analytics write fails" do
    original = Analytics::Event.method(:record!)
    attempted = false
    Analytics::Event.define_singleton_method(:record!) do |**attributes|
      if attributes[:name] == "shared_preview_opened"
        attempted = true
        raise ActiveRecord::StatementInvalid, "database is locked"
      end

      original.call(**attributes)
    end

    authorize_share_preview
    assert attempted
    get "/"
    assert_response :success
  ensure
    Analytics::Event.define_singleton_method(:record!, original) if original
  end

  test "rejects control characters and whitespace forwarded through public shells" do
    [ "/\t/example.com", "/path\0", "/path\x1f", "/path\x7f", "/path with spaces" ].each do |return_path|
      get shared_build_path(@share_link.public_id, return_path:), as: :json
      assert_response :success
      url = JSON.parse(response.body).fetch("data").fetch("previewUrl")

      assert_no_difference "SharePreviewGrant.count" do
        get url
        assert_response :not_found
        assert_nil response.location
      end
    end
  end

  test "stops an existing preview cookie after deletion or expiration" do
    authorize_share_preview
    @share_link.destroy!

    get "/"

    assert_response :not_found

    host! "replica.localhost:19500"
    replacement = ShareLink.create_public! \
      prototype: @prototype,
      build: @build,
      created_by: users.mona,
      label: "Short review",
      expiration: "one_day"
    get share_preview_authorization_path(replacement.public_id)
    grant = Rack::Utils.parse_query(URI(response.location).query).fetch("grant")
    host! "s#{@build.id}.preview.replica.localhost:19500"
    get "/__replica/authorize", params: { grant: }

    travel 2.days
    get "/"

    assert_response :not_found
  end

  test "returns not found while the repository is removed and works after reinstall" do
    @repository.update! installation_state: "removed", removed_at: Time.current

    get shared_build_path(@share_link.public_id)

    assert_response :not_found

    @repository.update! installation_state: "active", removed_at: nil

    get shared_build_path(@share_link.public_id)

    assert_response :success
  end

  test "returns not found while the GitHub App installation is unavailable" do
    GithubAppConfiguration.current.update!(installation_state: "removed")

    get shared_build_path(@share_link.public_id)

    assert_response :not_found
  end

  test "rejects a share grant on a different Build host" do
    other_build = builds.create_successful \
      prototype: @prototype,
      number: 2,
      commit_sha: "b" * 40
    get share_preview_authorization_path(@share_link.public_id)
    grant = Rack::Utils.parse_query(URI(response.location).query).fetch("grant")
    host! "s#{other_build.id}.preview.replica.localhost:19500"

    get "/__replica/authorize", params: { grant: }

    assert_response :not_found
    assert SharePreviewGrant.find_valid(grant, build_id: @build.id)
  end

  test "returns not found for expired and unknown links" do
    travel 8.days

    get shared_build_path(@share_link.public_id)
    assert_response :not_found

    get shared_build_path(SecureRandom.uuid)
    assert_response :not_found
  end

  private

  def authorize_share_preview
    get share_preview_authorization_path(@share_link.public_id)
    grant = Rack::Utils.parse_query(URI(response.location).query).fetch("grant")
    host! "s#{@build.id}.preview.replica.localhost:19500"
    get "/__replica/authorize", params: { grant: }
    assert_redirected_to "/"
  end

  def write_build_files
    ArtifactStore.current.write \
      "#{@build.artifact_prefix}/dist/index.html",
      source: StringIO.new("<!doctype html><title>Shared preview</title>")
    ArtifactStore.current.write \
      "#{@build.artifact_prefix}/dist/assets/app.js",
      source: StringIO.new("console.log('shared')")
  end
end
