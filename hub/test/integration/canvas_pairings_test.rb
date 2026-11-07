require "test_helper"

class CanvasPairingsTest < ActionDispatch::IntegrationTest
  setup do
    host! "replica.localhost:19500"
    github_app_configurations.create_installed
    stub_github_sign_in \
      repositories: [ repository_payload(2001, "github/prototype") ],
      permissions: { 2001 => "admin" }
    sign_in
  end

  test "requires browser approval and consumes the device proof only once" do
    post canvas_api_pairings_path, params: { repository: "github/prototype" }, as: :json
    assert_response :created
    assert_equal "1", response.headers["X-Replica-Canvas-Version"]
    pairing = JSON.parse(response.body)
    assert_equal "github/prototype", CanvasPairing.find_by!(user_code: pairing.fetch("userCode"))
      .repository.name_with_owner

    post canvas_api_pairing_token_path, params: { device_code: pairing.fetch("deviceCode") }, as: :json
    assert_equal "pending", JSON.parse(response.body).fetch("status")
    assert_equal "[FILTERED]", request.filtered_parameters.fetch("device_code")
    get "/api/canvas/pairings/#{pairing.fetch('deviceCode')}"
    assert_response :not_found

    get canvas_pairing_path(pairing.fetch("userCode"))
    assert_response :success
    assert_includes response.body, "Approve connection"

    get canvas_pairing_path(pairing.fetch("userCode")), as: :json
    assert_response :success
    approval = JSON.parse(response.body).fetch("data")
    assert_equal "approval", approval.fetch("kind")
    assert_equal pairing.fetch("userCode"), approval.fetch("code")
    assert_equal "github/prototype", approval.fetch("repository")
    assert_equal approve_canvas_pairing_path(pairing.fetch("userCode")),
      approval.fetch("approvePath")
    assert_includes approval.fetch("permissions"), "add the learnings"
    assert_equal CanvasPairing::LEARNINGS_CONSENT_VERSION, approval.fetch("learningsConsentVersion")

    post approve_canvas_pairing_path(pairing.fetch("userCode")),
      params: { learnings_consent_version: approval.fetch("learningsConsentVersion") }
    assert_redirected_to canvas_connections_path

    get canvas_connections_path, as: :json
    assert_response :success
    connections = JSON.parse(response.body).fetch("data")
    assert_equal "connections", connections.fetch("kind")
    assert_empty connections.fetch("grants")
    assert_includes connections.fetch("notice"), "Return to Copilot to finish connecting"

    post canvas_api_pairing_token_path, params: { device_code: pairing.fetch("deviceCode") }, as: :json
    approved = JSON.parse(response.body)
    assert_equal "approved", approved.fetch("status")
    token = approved.fetch("accessToken")
    assert CanvasGrant.authenticate(token)
    assert_nil CanvasGrant.first.fresh_authorized_at
    assert CanvasGrant.first.learnings_consented_at
    assert_not_includes CanvasGrant.first.attributes.to_s, token

    get canvas_connections_path, as: :json
    connections = JSON.parse(response.body).fetch("data")
    assert_equal "github/prototype", connections.fetch("grants").sole.fetch("repository")
    assert_equal canvas_connection_path(CanvasGrant.first),
      connections.fetch("grants").sole.fetch("revokePath")

    post canvas_api_pairing_token_path, params: { device_code: pairing.fetch("deviceCode") }, as: :json
    assert_equal "expired", JSON.parse(response.body).fetch("status")

    delete canvas_connection_path(CanvasGrant.first)
    assert_redirected_to canvas_connections_path
    get canvas_api_prototype_path, params: { branch: "prototype/welcome" },
      headers: { "Authorization" => "Bearer #{token}" }
    assert_response :unauthorized
  end

  test "rejects unsupported plugin interfaces before creating a pairing" do
    assert_no_difference "CanvasPairing.count" do
      post canvas_api_pairings_path, params: { repository: "github/prototype" },
        headers: { "X-Replica-Canvas-Version" => "99" }, as: :json
    end
    assert_response :conflict
    assert_equal "incompatible_canvas_interface", response.parsed_body.fetch("code")
  end

  test "a pairing approved before the approval page mentioned learnings connects without them" do
    post canvas_api_pairings_path, params: { repository: "github/prototype" }, as: :json
    pairing = JSON.parse(response.body)
    CanvasPairing.find_by!(user_code: pairing.fetch("userCode"))
      .update!(user: User.find_by!(github_id: 1001), approved_at: Time.current)

    post canvas_api_pairing_token_path, params: { device_code: pairing.fetch("deviceCode") }, as: :json
    assert_equal "approved", JSON.parse(response.body).fetch("status")
    assert_nil CanvasGrant.sole.learnings_consented_at
  end

  test "an old approval form submitted after deployment connects without learnings" do
    post canvas_api_pairings_path, params: { repository: "github/prototype" }, as: :json
    pairing = JSON.parse(response.body)

    post approve_canvas_pairing_path(pairing.fetch("userCode"))
    assert_redirected_to canvas_connections_path
    assert_nil CanvasPairing.find_by!(user_code: pairing.fetch("userCode")).learnings_consented_at

    post canvas_api_pairing_token_path, params: { device_code: pairing.fetch("deviceCode") }, as: :json
    approved = JSON.parse(response.body)
    assert_equal "approved", approved.fetch("status")
    assert_nil CanvasGrant.sole.learnings_consented_at

    post canvas_api_learnings_recall_path,
      headers: { "Authorization" => "Bearer #{approved.fetch("accessToken")}" }, as: :json
    assert_response :forbidden
    assert_equal "learnings_consent_required", JSON.parse(response.body).fetch("code")
  end

  test "only the current disclosure version grants learnings consent" do
    [ [ "unknown", false ], [ CanvasPairing::LEARNINGS_CONSENT_VERSION, true ] ].each do |version, consented|
      post canvas_api_pairings_path, params: { repository: "github/prototype" }, as: :json
      pairing = JSON.parse(response.body)

      post approve_canvas_pairing_path(pairing.fetch("userCode")),
        params: { learnings_consent_version: version }
      assert_redirected_to canvas_connections_path
      assert_equal consented, CanvasPairing.find_by!(user_code: pairing.fetch("userCode")).learnings_consented_at.present?

      post canvas_api_pairing_token_path, params: { device_code: pairing.fetch("deviceCode") }, as: :json
      approved = JSON.parse(response.body)
      assert_equal "approved", approved.fetch("status")
      assert_equal consented, CanvasGrant.authenticate(approved.fetch("accessToken")).learnings_consented_at.present?
    end
  end

  test "returns a signed-out reviewer to the matching browser approval" do
    post canvas_api_pairings_path, params: { repository: "github/prototype" }, as: :json
    code = JSON.parse(response.body).fetch("userCode")
    delete session_path

    get canvas_pairing_path(code)
    assert_redirected_to root_path
    sign_in_again
    assert_redirected_to canvas_pairing_path(code)
  end

  test "branch status selects the active generation without publishing its retired history" do
    token = connect_canvas
    headers = { "Authorization" => "Bearer #{token}" }
    repository = Repository.find_by!(github_id: 2001)
    original = prototypes.create(repository:, branch_name: "prototype/welcome")
    original.register!(name: "Original")
    old_build = builds.create_successful(prototype: original, commit_sha: "a" * 40)
    original.update!(current_build: old_build)
    repository.branch_presence.record_missing!(
      branch_name: original.branch_name, observed: repository.branch_presence.observations.fetch(original.branch_name)
    )

    get canvas_api_prototype_path, params: { branch: original.branch_name }, headers: headers
    assert_response :not_found
    replacement = prototypes.create(repository:, branch_name: original.branch_name)
    current = builds.create(prototype: replacement, commit_sha: "b" * 40)
    replacement.update!(current_build: current)
    stub_branches(repository)

    get canvas_api_prototype_path, params: { branch: original.branch_name }, headers: headers
    assert_response :success
    details = JSON.parse(response.body)
    assert_equal replacement.id, details.fetch("id")
    assert_equal false, details.fetch("published")
    assert_equal 0, details.fetch("versionCount")
    patch canvas_api_prototype_path, params: {
      branch: original.branch_name, automatic: true, commit_sha: old_build.commit_sha
    }, headers:, as: :json
    assert_response :conflict
    assert_not replacement.reload.registered?
    assert_predicate original.reload, :registered?
  end

  test "polling does not use up pairing creation attempts" do
    store = ActiveSupport::Cache::MemoryStore.new
    Rails.cache.define_singleton_method(:increment) do |*args, **kwargs|
      store.increment(*args, **kwargs)
    end
    begin
      post canvas_api_pairings_path, params: { repository: "github/prototype" }, as: :json
      assert_response :created
      device_code = JSON.parse(response.body).fetch("deviceCode")

      60.times do
        post canvas_api_pairing_token_path, params: { device_code: }, as: :json
        assert_response :success
      end
      post canvas_api_pairing_token_path, params: { device_code: }, as: :json
      assert_response :too_many_requests

      9.times do
        post canvas_api_pairings_path, params: { repository: "github/prototype" }, as: :json
        assert_response :created
      end
      post canvas_api_pairings_path, params: { repository: "github/prototype" }, as: :json
      assert_response :too_many_requests
    ensure
      Rails.cache.singleton_class.remove_method(:increment)
    end
  end

  test "publishes only after registration and a successful imported Build" do
    token = connect_canvas
    repository = Repository.find_by!(github_id: 2001)
    prototype = prototypes.create(repository:, branch_name: "prototype/welcome")
    build = builds.create(prototype:)
    prototype.update!(current_build: build)
    stub_branches(repository)
    headers = { "Authorization" => "Bearer #{token}" }

    get \
      canvas_api_prototype_path,
      params: { branch: prototype.branch_name },
      headers: headers
    assert_response :success
    assert_equal false, JSON.parse(response.body).fetch("published")
    assert_equal({ "commitSha" => build.commit_sha, "state" => build.state },
      JSON.parse(response.body).fetch("currentBuild"))

    patch canvas_api_prototype_path, params: {
      branch: prototype.branch_name, name: "  Welcome  ", description: "  Preview  ",
      start_page: "/welcome?step=1#intro"
    }, headers:, as: :json
    assert_response :success
    assert_equal "Welcome", prototype.reload.name
    assert_equal "/welcome?step=1#intro", prototype.start_page
    assert_equal prototype.start_page, JSON.parse(response.body).fetch("startPage")
    assert_equal true, JSON.parse(response.body).fetch("startPageSet")
    assert_equal User.find_by!(login: "octocat"), prototype.author
    assert_equal false, JSON.parse(response.body).fetch("published")

    builds.create_successful \
      prototype:,
      number: 2,
      commit_sha: "b" * 40
    get \
      canvas_api_prototype_path,
      params: { branch: prototype.branch_name },
      headers: headers
    assert_response :success
    details = JSON.parse(response.body)
    assert_equal true, details.fetch("published")
    assert_equal 1, details.fetch("versionCount")
    assert_includes details.fetch("build").fetch("url"), "build=2"
    assert_equal "queued", details.fetch("buildState")

    patch canvas_api_prototype_path, params: {
      branch: prototype.branch_name, start_page: "https://example.com"
    }, headers:, as: :json
    assert_response :unprocessable_entity
    assert_includes JSON.parse(response.body).fetch("errors").join, "must be a route"
    assert_equal "/welcome?step=1#intro", prototype.reload.start_page

    patch canvas_api_prototype_path, params: {
      branch: prototype.branch_name, start_page: ""
    }, headers:, as: :json
    assert_response :success
    assert_nil prototype.reload.start_page
    assert_equal true, JSON.parse(response.body).fetch("startPageSet")
  end

  test "automatically registers an imported checkout and preserves later metadata edits" do
    stub_github_permissions([ repository_payload(2001, "github/prototype") ], { 2001 => "push" })
    token = connect_canvas
    repository = Repository.find_by!(github_id: 2001)
    prototype = prototypes.create(repository:, branch_name: "prototype/welcome", start_page: "/welcome")
    stub_branches(repository)
    headers = { "Authorization" => "Bearer #{token}" }
    params = { branch: prototype.branch_name, automatic: true, commit_sha: "b" * 40 }

    patch canvas_api_prototype_path, params: params, headers: headers, as: :json
    assert_response :conflict
    assert_equal "successful_build_required", JSON.parse(response.body).fetch("registrationReason")
    assert_not prototype.reload.registered?

    builds.create_successful(prototype:, commit_sha: "b" * 40)
    patch canvas_api_prototype_path, params: params.merge(commit_sha: "a" * 40), headers: headers, as: :json
    assert_response :conflict
    assert_not prototype.reload.registered?

    patch canvas_api_prototype_path, params: params, headers: headers, as: :json
    assert_response :success
    assert_equal true, JSON.parse(response.body).fetch("published")
    assert_equal "prototype/welcome", prototype.reload.name
    assert_equal "/welcome", JSON.parse(response.body).fetch("startPage")
    assert_equal User.find_by!(login: "octocat"), prototype.author
    registered_at = prototype.registered_at

    prototype.register!(name: "Custom title", description: "Keep this description", start_page: "/custom")
    patch canvas_api_prototype_path, params: params, headers: headers, as: :json
    assert_response :success
    assert_equal "Custom title", prototype.reload.name
    assert_equal "Keep this description", prototype.description
    assert_equal "/custom", JSON.parse(response.body).fetch("startPage")
    assert_equal registered_at, prototype.registered_at
    assert_not_requested :get, %r{/compare/}
  end

  test "automatic registration still requires write access and an eligible branch" do
    token = connect_canvas
    repository = Repository.find_by!(github_id: 2001)
    prototype = prototypes.create(repository:, branch_name: "main")
    builds.create_successful(prototype:, commit_sha: "a" * 40)
    stub_branches(repository)
    headers = { "Authorization" => "Bearer #{token}" }
    params = { branch: prototype.branch_name, automatic: true, commit_sha: "a" * 40 }

    patch canvas_api_prototype_path, params: params, headers: headers, as: :json
    assert_response :not_found
    assert_equal "branch_not_reviewable", JSON.parse(response.body).fetch("registrationReason")
    assert_not prototype.reload.registered?

    stub_github_permissions([ repository_payload(2001, "github/prototype") ], { 2001 => "pull" })
    patch canvas_api_prototype_path, params: params, headers: headers, as: :json
    assert_response :forbidden
    assert_equal "write_access_required", JSON.parse(response.body).fetch("registrationReason")
    assert_not prototype.reload.registered?
  end

  test "reports registration reasons without registering during display polls" do
    token = connect_canvas
    repository = Repository.find_by!(github_id: 2001)
    prototype = prototypes.create(repository:, branch_name: "prototype/welcome")
    headers = { "Authorization" => "Bearer #{token}" }
    stub_branches(repository)

    { "pull" => "write_access_required", "triage" => "write_access_required",
      "push" => nil, "maintain" => nil, "admin" => nil }.each do |permission, reason|
      stub_github_permissions([ repository_payload(2001, "github/prototype") ], { 2001 => permission })
      get canvas_api_prototype_path, params: { branch: prototype.branch_name }, headers: headers
      assert_response :success
      details = JSON.parse(response.body)
      if reason
        assert_equal reason, details.fetch("registrationReason")
      else
        assert_nil details.fetch("registrationReason")
      end
      assert_equal reason.nil?, details.fetch("canRegister")
      assert_not prototype.reload.registered?
      next if reason.nil?

      patch canvas_api_prototype_path, params: { branch: prototype.branch_name, name: "Welcome" },
        headers: headers, as: :json
      assert_response :forbidden
      assert_equal reason, JSON.parse(response.body).fetch("registrationReason")
      assert_not prototype.reload.registered?
    end

    stub_github_permissions([ repository_payload(2001, "github/prototype") ], { 2001 => "maintain" })
    patch canvas_api_prototype_path, params: { branch: prototype.branch_name, name: "Welcome" },
      headers: headers, as: :json
    assert_response :success
    assert prototype.reload.registered?
    assert_not_requested :get, %r{/compare/}
  end

  test "distinguishes missing remote heads from excluded and undiscovered branches" do
    token = connect_canvas
    repository = Repository.find_by!(github_id: 2001)
    prototype = prototypes.create(repository:, branch_name: "prototype/deleted")
    headers = { "Authorization" => "Bearer #{token}" }
    stub_branches(repository)
    get canvas_api_prototype_path, params: { branch: prototype.branch_name }, headers: headers
    assert_response :success
    assert_equal "remote_branch_missing", JSON.parse(response.body).fetch("registrationReason")
    assert_equal false, JSON.parse(response.body).fetch("canRegister")

    patch canvas_api_prototype_path, params: { branch: prototype.branch_name, name: "Deleted" },
      headers: headers, as: :json
    assert_response :not_found
    assert_equal "remote_branch_missing", JSON.parse(response.body).fetch("registrationReason")
    assert_not prototype.reload.registered?

    prototypes.create(repository:, branch_name: "previous-default", replica: true)
    [ "main", "replica/install-workflow", "previous-default" ].each do |branch|
      get canvas_api_prototype_path, params: { branch: branch }, headers: headers
      assert_response :not_found
      assert_equal "branch_not_reviewable", JSON.parse(response.body).fetch("registrationReason")
    end

    get canvas_api_prototype_path, params: { branch: "prototype/not-discovered" }, headers: headers
    assert_response :not_found
    assert_not JSON.parse(response.body).key?("registrationReason")
  end

  test "allows root and existing-thread review actions from the canvas" do
    token = connect_canvas
    headers = { "Authorization" => "Bearer #{token}" }
    repository = Repository.find_by!(github_id: 2001)
    prototype = prototypes.create(repository:, branch_name: "prototype/welcome")
    build = builds.create_successful(prototype:)
    user = User.find_by!(github_id: 1001)
    root = ReviewComment.create! \
      prototype:,
      build:,
      user:,
      body: "Review this button.",
      anchor: valid_anchor
    base = "/api/canvas/repositories/#{repository.route_id}/prototypes/#{prototype.id}/review_comments"

    post base, params: {
      review_comment: {
        build_number: build.number,
        body: "A new thread",
        anchor: valid_anchor
      }
    }, headers:, as: :json
    assert_response :created
    created = prototype.review_comments.order(:id).last
    assert_equal "A new thread", created.body
    assert_equal build, created.build
    assert_equal user, created.user

    get base, headers: headers
    assert_response :success
    assert_equal created.id, JSON.parse(response.body).fetch("comments").first.fetch("id")

    post "#{base}/#{root.id}/replies",
      params: { review_comment: { body: "I can fix this." } }, headers:, as: :json
    assert_response :created
    reply = root.replies.sole
    assert_equal user, reply.user

    patch "#{base}/#{reply.id}",
      params: { review_comment: { body: "I fixed this." } }, headers:, as: :json
    assert_response :success
    assert_equal "I fixed this.", reply.reload.body

    post "#{base}/#{root.id}/reactions",
      params: {
        review_comment_reaction: { content: "heart", activity_version: root.reload.activity_version }
      }, headers:, as: :json
    assert_response :created

    post "#{base}/#{root.id}/resolution", headers: headers
    assert_response :success
    assert root.reload.resolved_at

    delete "#{base}/#{root.id}/resolution", headers: headers
    assert_response :success
    assert_nil root.reload.resolved_at

    delete "#{base}/#{created.id}", headers: headers
    assert_response :success
    assert created.reload.deleted_at
    assert_nil created.body
    assert_equal created.id, JSON.parse(response.body).fetch("comments").first.fetch("id")

    post canvas_api_cable_ticket_path, headers: headers
    assert_response :success
    protocol = JSON.parse(response.body).fetch("protocol")
    signed = Base64.urlsafe_decode64(protocol.delete_prefix("replica-canvas."))
    assert_equal CanvasGrant.last.id,
      Rails.application.message_verifier("canvas-cable").verified(signed, purpose: "canvas-cable")

    get "/api/canvas/repositories/#{repository.route_id + 1}/prototypes/#{prototype.id}/review_comments",
      headers: headers
    assert_response :not_found

    delete canvas_api_connection_path, headers: headers
    assert_response :no_content
    get base, headers: headers
    assert_response :unauthorized
  end

  test "cleanup removes expired proofs and revoked grants but keeps active ones" do
    repository = Repository.find_by!(github_id: 2001)
    expired, = CanvasPairing.start!(repository)
    current, = CanvasPairing.start!(repository)
    consumed, = CanvasPairing.start!(repository)
    expired.update_columns(expires_at: 1.minute.ago)
    user = User.find_by!(github_id: 1001)
    consumed.update!(user:, approved_at: Time.current, consumed_at: Time.current)
    previous = CanvasGrant.create! \
      user:,
      repository:,
      token_digest: Digest::SHA256.hexdigest("previous"),
      expires_at: 1.hour.from_now,
      revoked_at: Time.current
    expired_grant = CanvasGrant.create! \
      user:,
      repository:,
      token_digest: Digest::SHA256.hexdigest("expired"),
      expires_at: 1.hour.from_now
    expired_grant.update_columns(created_at: 2.hours.ago, expires_at: 1.hour.ago)
    current_grant = CanvasGrant.create! \
      user:,
      repository:,
      token_digest: Digest::SHA256.hexdigest("current"),
      expires_at: 1.hour.from_now

    CanvasPairing.clear_expired!
    CanvasGrant.clear_expired!

    assert_not CanvasPairing.exists?(expired.id)
    assert_not CanvasPairing.exists?(consumed.id)
    assert CanvasPairing.exists?(current.id)
    assert_not CanvasGrant.exists?(previous.id)
    assert_not CanvasGrant.exists?(expired_grant.id)
    assert CanvasGrant.exists?(current_grant.id)
  end

  test "caches display eligibility but rechecks repository access for edits" do
    original_cache = Rails.cache
    Rails.cache = ActiveSupport::Cache::MemoryStore.new
    repository = Repository.find_by!(github_id: 2001)
    prototype = prototypes.create(repository:, branch_name: "prototype/welcome")
    stub_branches(repository)
    headers = { "Authorization" => "Bearer #{connect_canvas}" }
    branch_url = "https://api.github.com/repos/#{repository.github_path}/branches?page=1&per_page=100"
    permission_url = "https://api.github.com/repos/#{repository.github_path}/collaborators/octocat/permission"

    2.times do
      get canvas_api_prototype_path, params: { branch: prototype.branch_name }, headers: headers
      assert_response :success
      assert_equal true, JSON.parse(response.body).fetch("canRegister")
      assert_nil JSON.parse(response.body).fetch("registrationReason")
    end
    assert_requested :get, branch_url, times: 1
    assert_requested :get, permission_url, times: 4

    stub_github_permissions([ repository_payload(2001, "github/prototype") ], { 2001 => "pull" })
    patch canvas_api_prototype_path, params: {
      branch: prototype.branch_name, name: "Welcome"
    }, headers: headers, as: :json
    assert_response :forbidden
    assert_not prototype.reload.registered?
  ensure
    Rails.cache = original_cache
  end

  private

  def sign_in
    sign_in_to_hub
  end

  def sign_in_again
    post github_authentication_path
    state = Rack::Utils.parse_query(URI(response.location).query).fetch("state")
    get github_authentication_callback_path, params: { code: "code", state: }
  end

  def connect_canvas
    post canvas_api_pairings_path, params: { repository: "github/prototype" }, as: :json
    pairing = JSON.parse(response.body)
    post approve_canvas_pairing_path(pairing.fetch("userCode"))
    post canvas_api_pairing_token_path, params: { device_code: pairing.fetch("deviceCode") }, as: :json
    JSON.parse(response.body).fetch("accessToken")
  end

  def stub_branches(repository)
    stub_request(:get, "https://api.github.com/repos/#{repository.github_path}/branches")
      .with(query: { "page" => "1", "per_page" => "100" })
      .to_return \
        status: 200,
        body: [
          { name: "main", commit: { sha: "a" * 40 } },
          { name: "prototype/welcome", commit: { sha: "b" * 40 } }
        ].to_json,
        headers: { "Content-Type" => "application/json" }
  end

  def valid_anchor
    {
      "schemaVersion" => 1,
      "kind" => "element",
      "route" => { "pathname" => "/", "search" => "", "hash" => "" },
      "selector" => "#save",
      "accessibleName" => "Save",
      "tagName" => "button",
      "selectedText" => "",
      "rect" => { "x" => 20, "y" => 30, "width" => 100, "height" => 32 },
      "viewport" => { "width" => 1280, "height" => 720, "scrollX" => 0, "scrollY" => 0 },
      "elementOffset" => { "x" => 0.5, "y" => 0.5 }
    }
  end
end
