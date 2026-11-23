require "test_helper"
require_relative "../support/security_rate_limit_store"

class SecurityRateLimitsTest < ActionDispatch::IntegrationTest
  include SecurityRateLimitStore

  setup do
    host! "replica.localhost:19500"
    use_security_rate_limit_store
    travel_to Time.current.change(usec: 0)
    github_app_configurations.create_installed
    @payloads = [ repository_payload(2001, "github/prototype"), repository_payload(2002, "github/other") ]
    stub_github_sign_in(repositories: @payloads, permissions: { 2001 => "admin", 2002 => "admin" })
    post github_authentication_path
    state = Rack::Utils.parse_query(URI(response.location).query).fetch("state")
    get github_authentication_callback_path, params: { code: "code", state: }
    @user = User.find_by!(github_id: 1001)
    @repositories = @payloads.map { Repository.find_by!(github_id: _1.fetch("id")) }
    @prototypes = @repositories.map { prototypes.create(repository: _1) }
    @builds = @prototypes.map { builds.create_successful(prototype: _1) }
    @roots = @builds.map do |build|
      ReviewComment.create!(prototype: build.prototype, build:, user: @user, body: "First comment", anchor:)
    end
    @token = "rp_#{SecureRandom.urlsafe_base64(32)}"
    CanvasGrant.create! \
      user: @user, repository: @repositories.last, token_digest: Digest::SHA256.hexdigest(@token),
      expires_at: 7.days.from_now
    @canvas_headers = { "Authorization" => "Bearer #{@token}" }
    Rails.cache.clear
  end

  teardown do
    restore_security_rate_limit_store
    travel_back
  end

  test "sixty comment mutations span repositories and browser and canvas credentials" do
    30.times do
      post comment_path(0), params: { review_comment: { build_number: 1, body: "New comment", anchor: } }, as: :json
      assert_response :created
      post "#{comment_path(1, canvas: true)}/#{@roots.last.id}/replies",
        params: { review_comment: { body: "Reply" } }, headers: @canvas_headers, as: :json
      assert_response :created
    end
    assert_no_difference("ReviewComment.count") do
      post comment_path(0), params: { review_comment: { build_number: 1, body: "Rejected", anchor: } }, as: :json
      assert_security_throttle(60)
      post "#{comment_path(1, canvas: true)}/#{@roots.last.id}/replies",
        params: { review_comment: { body: "Rejected" } }, headers: @canvas_headers, as: :json
      assert_security_throttle(60)
    end

    3.times do
      get comment_path(0), as: :json
      assert_response :success
      post "#{comment_path(0)}/#{@roots.first.id}/read",
        params: { review_thread_read: { activity_version: @roots.first.reload.activity_version } }, as: :json
      assert_response :success
    end
    post repository_analytics_destinations_path(2001), params: { destination: analytics_input }, as: :json
    assert_response :see_other

    travel 60.seconds
    post "#{comment_path(1, canvas: true)}/#{@roots.last.id}/replies",
      params: { review_comment: { body: "After expiry" } }, headers: @canvas_headers, as: :json
    assert_response :created
  end

  test "edits deletions reactions and resolution cannot escape an exhausted comment budget" do
    60.times do |index|
      patch "#{comment_path(0)}/#{@roots.first.id}", params: { review_comment: { body: "Edit #{index}" } }, as: :json
      assert_response :success
    end
    %w[replies reactions resolution].each do |suffix|
      post "#{comment_path(0)}/#{@roots.first.id}/#{suffix}", params: {
        review_comment: { body: "Rejected" },
        review_comment_reaction: { content: "heart", activity_version: @roots.first.reload.activity_version }
      }, as: :json
      assert_security_throttle(60)
      post "#{comment_path(1, canvas: true)}/#{@roots.last.id}/#{suffix}",
        params: { review_comment: { body: "Rejected" } }, headers: @canvas_headers, as: :json
      assert_security_throttle(60)
    end
    delete "#{comment_path(0)}/#{@roots.first.id}", as: :json
    assert_security_throttle(60)
    patch "#{comment_path(1, canvas: true)}/#{@roots.last.id}",
      params: { review_comment: { body: "Rejected" } }, headers: @canvas_headers, as: :json
    assert_security_throttle(60)
    assert_not @roots.first.reload.deleted_at
  end

  test "a different user has a separate comment allowance even on the same canvas route" do
    60.times { patch "#{comment_path(0)}/#{@roots.first.id}", params: { review_comment: { body: "Edit" } }, as: :json }
    other = users.create(github_id: 1002, login: "mona")
    stub_github_permissions(@payloads, { 2001 => "pull", 2002 => "pull" }, github_id: 1002, login: "mona")
    token = "rp_#{SecureRandom.urlsafe_base64(32)}"
    CanvasGrant.create! \
      user: other, repository: @repositories.last, token_digest: Digest::SHA256.hexdigest(token),
      expires_at: 7.days.from_now
    post "#{comment_path(1, canvas: true)}/#{@roots.last.id}/replies",
      params: { review_comment: { body: "Another user" } }, headers: { "Authorization" => "Bearer #{token}" }, as: :json
    assert_response :created
  end

  test "anonymous invalid task disconnects are limited by source before denial audits" do
    delete session_path
    statuses = []
    70.times do |index|
      delete "/api/tasks/connection", headers: {
        "REMOTE_ADDR" => "192.0.2.10", "Authorization" => "Bearer invalid-#{index}"
      }
      statuses << response.status
    end

    assert_includes statuses, 429
    assert_operator SecurityAuditEvent.where(action: "task_connection.destroy", outcome: "denied").count, :<=, 60
    assert_no_difference "SecurityAuditEvent.where(action: 'task_connection.destroy', outcome: 'denied').count" do
      delete "/api/tasks/connection", headers: {
        "REMOTE_ADDR" => "192.0.2.10", "Authorization" => "Bearer another-invalid"
      }
      assert_response :too_many_requests
    end
    delete "/api/tasks/connection", headers: {
      "REMOTE_ADDR" => "192.0.2.11", "Authorization" => "Bearer invalid"
    }
    assert_response :unauthorized
  end

  test "all analytics operations share five mutations per minute across repositories" do
    post repository_analytics_destinations_path(2001), params: { destination: analytics_input }, as: :json
    assert_response :see_other
    first = @repositories.first.analytics_destinations.sole
    post repository_analytics_destinations_path(2002), params: { destination: analytics_input }, as: :json
    assert_response :see_other
    second = @repositories.last.analytics_destinations.sole
    first_path = repository_analytics_destination_path(2001, first)
    second_path = repository_analytics_destination_path(2002, second)
    patch first_path, params: { operation: "pause" }, as: :json
    assert_response :see_other
    patch first_path, params: { operation: "resume" }, as: :json
    assert_response :see_other
    delete second_path, as: :json
    assert_response :see_other
    assert_no_difference("Analytics::Destination.count") do
      post repository_analytics_destinations_path(2002), params: { destination: analytics_input }, as: :json
      assert_security_throttle(60)
    end
    patch first_path, params: { operation: "pause" }, as: :json
    assert_security_throttle(60)
    delete first_path, as: :json
    assert_security_throttle(60)
    assert first.reload.enabled?
    get repository_analytics_path(2001), as: :json
    assert_response :success
    travel 60.seconds
    delete first_path, as: :json
    assert_response :see_other
  end

  test "workflow installation spends five requests per ten minutes across repositories before external work" do
    @repositories.each do |repository|
      stub_request(:get, "https://api.github.com/repos/#{repository.github_path}/contents/.github/workflows/replica.yml")
        .with(query: { "ref" => "main" }).to_return(status: 503, body: "{}")
    end
    5.times do |index|
      post repository_workflow_installation_path(@repositories[index % 2].github_id), as: :json
      assert_response :see_other
    end
    post repository_workflow_installation_path(2002), as: :json
    assert_security_throttle(600)
    assert_requested :get, %r{/contents/\.github/workflows/replica\.yml}, times: 5
    travel 10.minutes
    post repository_workflow_installation_path(2001), as: :json
    assert_response :see_other
    assert_requested :get, %r{/contents/\.github/workflows/replica\.yml}, times: 6
  end

  test "authorization and fresh challenges do not permit writes or spend analytics allowance" do
    credential = @user.sessions.sole
    credential.update!(fresh_authorized_at: nil)
    6.times do
      post repository_analytics_destinations_path(2001), params: { destination: analytics_input }, as: :json
      assert_response :see_other
    end
    assert_empty Analytics::Destination.all
    assert_nil Rails.cache.read("rate-limit:security:analytics_destinations:#{@user.id}")
    credential.update!(fresh_authorized_at: Time.current)
    stub_github_permissions(@payloads, { 2001 => "pull", 2002 => "pull" })
    post repository_analytics_destinations_path(2001), params: { destination: analytics_input }, as: :json
    assert_response :not_found
    assert_nil Rails.cache.read("rate-limit:security:analytics_destinations:#{@user.id}")
  end

  test "bulk additions and removals share ten requests and resume only after the window" do
    @user.update!(hub_admin: true)
    target = users.create(github_id: 1002, login: "mona")
    10.times do |index|
      if index.even?
        post hub_admins_path, params: { user_ids: [ target.id.to_s ], confirmed: "1" }, as: :json
      else
        patch hub_admin_path(target), params: { operation: "revoke", confirmed: "1" }, as: :json
      end
      assert_response :see_other
      assert_equal index.even?, target.reload.hub_admin?
    end
    patch hub_admin_path(target), params: { operation: "designate", confirmed: "1" }, as: :json
    assert_security_throttle(60)
    post hub_admins_path, params: { user_ids: [ target.id.to_s ], confirmed: "1" }, as: :json
    assert_security_throttle(60)
    assert_not target.reload.hub_admin?
    get hub_admins_path, as: :json
    assert_response :success
    travel 60.seconds
    patch hub_admin_path(target), params: { operation: "designate", confirmed: "1" }, as: :json
    assert_response :see_other
    assert target.reload.hub_admin?
  end

  private

  def comment_path(index, canvas: false)
    prefix = canvas ? "/api/canvas" : ""
    "#{prefix}/repositories/#{@repositories[index].route_id}/prototypes/#{@prototypes[index].id}/review_comments"
  end

  def analytics_input
    { provider: "segment", region: "us", history: "new", credentials: { write_key: "test-key" },
      event_types: [ Analytics::Event::TYPES.first ] }
  end

  def anchor
    { schemaVersion: 1, kind: "element", route: { pathname: "/", search: "", hash: "" },
      selector: "#save", accessibleName: "Save", tagName: "button", selectedText: "",
      rect: { x: 20, y: 30, width: 100, height: 32 },
      viewport: { width: 1280, height: 720, scrollX: 0, scrollY: 0 }, elementOffset: { x: 0.5, y: 0.5 } }
  end
end
