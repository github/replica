require "test_helper"
require_relative "../support/authorization_continuation_helpers"

class SessionRevocationsTest < ActionDispatch::IntegrationTest
  include AuthorizationContinuationHelpers

  setup do
    @original_bootstrap_secret = ENV["REPLICA_BOOTSTRAP_SECRET"]
    ENV["REPLICA_BOOTSTRAP_SECRET"] = "session-cutoff-bootstrap"
    github_app_configurations.create_installed
    @payload = repository_payload(2001, "github/prototype")
    stub_github_sign_in(repositories: [ @payload ], permissions: { 2001 => "admin" })
    sign_in
    @actor = User.find_by!(github_id: 1001)
    @actor.update!(hub_admin: true)
    @session = @actor.sessions.sole
  end

  teardown do
    ENV["REPLICA_BOOTSTRAP_SECRET"] = @original_bootstrap_secret
  end

  test "management explains the operator's own Session and provides admin navigation" do
    get security_audit_path, as: :json
    assert_equal session_revocation_path, data.fetch("sessionRevocationPath")
    get hub_admins_path, as: :json
    assert_equal session_revocation_path, data.fetch("sessionRevocationPath")
    get session_revocation_path, as: :json
    assert_response :success
    assert data.fetch("canRevoke")
    assert_includes data.fetch("ownSession"), "@octocat"
    assert_includes data.fetch("scope"), "Public share links and public previews will not change"
    assert_includes data.fetch("emptyLabel"), "Your own session will still end"
    assert_equal "private, no-store", response.headers["Cache-Control"]
  end

  test "confirmation ends other browsers, canvas access and refresh, pending approvals and this browser" do
    other = open_session
    other.post github_authentication_path
    state = Rack::Utils.parse_query(URI(other.response.location).query).fetch("state")
    other.get github_authentication_callback_path, params: { code: "code", state: }
    approved = pair
    post approve_canvas_pairing_path(approved.fetch("userCode"))
    post canvas_api_pairing_token_path, params: { device_code: approved.fetch("deviceCode") }, as: :json
    access = JSON.parse(response.body).fetch("accessToken")
    pending = pair
    post approve_canvas_pairing_path(pending.fetch("userCode"))

    post session_revocation_path, params: { confirmed: "1" }, as: :json

    assert_response :success
    assert data.fetch("signedOut")
    assert_not data.fetch("canRevoke")
    assert_nil data.fetch("auditPath")
    assert_equal root_path, data.fetch("signInPath")
    assert_includes data.fetch("description"), "Your session has ended"
    assert_includes data.fetch("scope"), "Public share links and public previews have not changed"
    assert_empty Session.all
    assert_nil CanvasGrant.authenticate(access)
    get canvas_api_connection_path, headers: { "Authorization" => "Bearer #{access}" }
    assert_response :unauthorized
    post canvas_api_connection_renewal_path, params: { refresh_token: approved.fetch("refreshToken") }, as: :json
    assert_response :unauthorized
    post canvas_api_pairing_token_path, params: { device_code: pending.fetch("deviceCode") }, as: :json
    assert_equal "expired", JSON.parse(response.body).fetch("status")
    other.get hub_admins_path
    assert_equal root_url, other.response.location
    get session_revocation_path
    assert_redirected_to root_path
    sign_in
    assert_redirected_to repositories_path
    get session_revocation_path
    assert_response :success
    replacement = pair
    post approve_canvas_pairing_path(replacement.fetch("userCode"))
    post canvas_api_pairing_token_path, params: { device_code: replacement.fetch("deviceCode") }, as: :json
    assert_equal "approved", JSON.parse(response.body).fetch("status")
    assert CanvasGrant.authenticate(JSON.parse(response.body).fetch("accessToken"))
    post canvas_api_connection_renewal_path, params: { refresh_token: approved.fetch("refreshToken") }, as: :json
    assert_response :unauthorized
  end

  test "ordinary and revoked administrators cannot create a challenge or end any sessions" do
    @actor.update!(hub_admin: false)
    @session.update!(fresh_authorized_at: nil)
    assert_no_difference("FreshAuthorization.count") do
      assert_no_difference("Session.count") do
        get session_revocation_path, as: :json
        assert_response :forbidden
        assert_nil data.fetch("counts")
        post session_revocation_path, params: { confirmed: "1" }, as: :json
        assert_response :forbidden
        assert_not data.fetch("canRevoke")
      end
    end
    assert_equal "denied", SecurityAuditEvent.where(action: "session_revocation.end_all").last.outcome
  end

  test "exactly five-minute proof continues the confirmed all-session revocation" do
    @session.update!(fresh_authorized_at: 5.minutes.ago)
    assert_no_difference("Session.count") do
      post session_revocation_path, params: { confirmed: "1" }
    end
    challenge = FreshAuthorization.last
    assert_redirected_to fresh_authorization_path(challenge.public_id)
    assert_equal "session_revocation", challenge.purpose
    assert_equal @session.id, challenge.credential_id
    assert_equal session_revocation_path, challenge.return_to
    form = verify_pending_action(challenge, path: session_revocation_path, method: "post")
    assert FreshAuthorization.fresh?(@session)
    continue_pending_action(form)
    assert_response :success
    assert_empty Session.all
  end

  test "confirmation and cancellation stop before freshness checks or authentication changes" do
    @session.update!(fresh_authorized_at: nil)
    assert_no_difference("FreshAuthorization.count") do
      assert_no_difference("Session.count") do
        post session_revocation_path
        assert_equal I18n.t("session_revocation.confirmation_required"), flash[:alert]
        post session_revocation_path, params: { cancelled: "1", confirmed: "1" }
        assert_equal I18n.t("session_revocation.cancelled"), flash[:notice]
      end
    end
    assert_equal 2, SecurityAuditEvent.where(action: "session_revocation.end_all", outcome: "denied").count
  end

  test "another Session and submitted timestamps cannot unlock this browser" do
    @actor.sessions.create!(fresh_authorized_at: Time.current)
    @session.update!(fresh_authorized_at: nil)
    post session_revocation_path, params: {
      confirmed: "1", session_id: Session.last.id, fresh_authorized_at: Time.current.iso8601
    }
    assert_redirected_to fresh_authorization_path(FreshAuthorization.last.public_id)
    assert_equal 2, Session.count
  end

  test "late ordinary OAuth callbacks cannot undo a cutoff and new sign-in still works" do
    waiting = open_session
    waiting.post github_authentication_path
    state = Rack::Utils.parse_query(URI(waiting.response.location).query).fetch("state")
    post session_revocation_path, params: { confirmed: "1" }
    waiting.get github_authentication_callback_path, params: { code: "code", state: }
    assert_equal root_url, waiting.response.location
    assert_empty Session.all
    assert_equal I18n.t("authentication.sessions_ended"), waiting.request.flash[:alert]
    sign_in
    assert_equal 1, Session.count
  end

  test "a late fresh callback cannot unlock a revoked canvas or replace its browser" do
    approved = pair
    post approve_canvas_pairing_path(approved.fetch("userCode"))
    post canvas_api_pairing_token_path, params: { device_code: approved.fetch("deviceCode") }, as: :json
    grant = CanvasGrant.first
    challenge = FreshAuthorization.start!(credential: grant, purpose: "never_expiring_share")
    verifier = open_session
    verifier.post fresh_authorization_path(challenge.public_id)
    state = Rack::Utils.parse_query(URI(verifier.response.location).query).fetch("state")
    post session_revocation_path, params: { confirmed: "1" }
    verifier.get github_authentication_callback_path, params: { code: "code", state: }
    assert_empty Session.all
    assert_nil grant.reload.fresh_authorized_at
    assert grant.revoked_at
  end

  test "cutoff during enrollment verification cannot consume proof or grant a role" do
    waiting = open_session
    waiting.post hub_admin_enrollment_path, params: { bootstrap_secret: ENV.fetch("REPLICA_BOOTSTRAP_SECRET") }
    state = Rack::Utils.parse_query(URI(waiting.response.location).query).fetch("state")
    stub_request(:get, "#{GITHUB_API_URL}/user").to_return do
      SessionRevocation.end_all!(actor: @actor, browser_session: @session)
      { status: 200, body: { id: 1002, login: "mona" }.to_json,
        headers: { "Content-Type" => "application/json" } }
    end

    waiting.get github_authentication_callback_path, params: { code: "code", state: }

    assert_equal 303, waiting.response.status
    assert_equal I18n.t("authentication.sessions_ended"), waiting.flash[:alert]
    assert_empty Session.all
    assert_empty HubAdminEnrollment.all
    assert_not User.where(github_id: 1002, hub_admin: true).exists?
    assert_empty SecurityAuditEvent.where(action: "hub_admin.enroll", outcome: "succeeded")
  end

  test "cutoff during browser and canvas verification cannot stamp or replace either credential" do
    [ :browser, :canvas ].each do |kind|
      sign_in if !Session.exists?(@session.id)
      @session = @actor.sessions.order(:id).last
      approved = pair
      post approve_canvas_pairing_path(approved.fetch("userCode"))
      post canvas_api_pairing_token_path, params: { device_code: approved.fetch("deviceCode") }, as: :json
      grant = CanvasGrant.order(:id).last
      credential = kind == :browser ? @session : grant
      challenge = FreshAuthorization.start!(credential:, purpose: "never_expiring_share")
      verifier = kind == :browser ? self : open_session
      verifier.post fresh_authorization_path(challenge.public_id)
      state = Rack::Utils.parse_query(URI(verifier.response.location).query).fetch("state")
      stub_request(:get, "#{GITHUB_API_URL}/user").to_return do
        SessionRevocation.end_all!(actor: @actor, browser_session: @session)
        { status: 200, body: { id: @actor.github_id, login: @actor.login }.to_json,
          headers: { "Content-Type" => "application/json" } }
      end

      verifier.get github_authentication_callback_path, params: { code: "code", state: }

      assert_equal I18n.t("fresh_authorization.failure"), verifier.flash[:alert]
      assert_empty Session.all
      assert_empty FreshAuthorization.all
      assert_nil grant.reload.fresh_authorized_at
      assert grant.revoked_at
      stub_github_oauth_user
    end
  end

  test "the action keeps browser CSRF protection and has no canvas mutation route" do
    previous = ActionController::Base.allow_forgery_protection
    ActionController::Base.allow_forgery_protection = true
    post session_revocation_path, params: { confirmed: "1" }
    assert_response :unprocessable_entity
    assert Session.exists?(@session.id)
    post "/api/canvas/session_revocation", params: { confirmed: "1" }, as: :json
    assert_response :not_found
  ensure
    ActionController::Base.allow_forgery_protection = previous
  end

  test "an API request waiting on GitHub cannot use its ended canvas credential" do
    approved = pair
    post approve_canvas_pairing_path(approved.fetch("userCode"))
    post canvas_api_pairing_token_path, params: { device_code: approved.fetch("deviceCode") }, as: :json
    token = JSON.parse(response.body).fetch("accessToken")
    Rails.cache.clear
    stub_request(:get, "#{GITHUB_API_URL}/repos/github/prototype/collaborators/octocat/permission").to_return do
      SessionRevocation.end_all!(actor: @actor, browser_session: @session)
      { status: 200, body: { permission: "admin", user: { id: @actor.github_id } }.to_json,
        headers: { "Content-Type" => "application/json" } }
    end

    get canvas_api_connection_path, headers: { "Authorization" => "Bearer #{token}" }

    assert_response :unauthorized
    assert_empty response.body
    assert_empty Session.all
    assert_nil CanvasGrant.authenticate(token)
  end

  test "transport failure shows committed revocation, not a false sign-in-required failure" do
    previous = SessionRevocation.method(:disconnect!)
    SessionRevocation.define_singleton_method(:disconnect!) { |_credentials| raise IOError }
    post session_revocation_path, params: { confirmed: "1" }, as: :json
    assert_response :success
    assert data.fetch("signedOut")
    assert_empty Session.all
    assert_includes data.fetch("alert"), "Credentials were revoked"
    assert_equal "failed", SecurityAuditEvent.where(action: "session_revocation.disconnect").last.outcome
    assert_equal "succeeded", SecurityAuditEvent.where(action: "session_revocation.end_all").last.outcome
  ensure
    SessionRevocation.define_singleton_method(:disconnect!, previous) if previous
  end

  private

  def sign_in
    post github_authentication_path
    state = Rack::Utils.parse_query(URI(response.location).query).fetch("state")
    get github_authentication_callback_path, params: { code: "code", state: }
  end

  def pair
    post canvas_api_pairings_path, params: { repository: "github/prototype", renewable: true }, as: :json
    JSON.parse(response.body)
  end

  def data
    JSON.parse(response.body).fetch("data")
  end
end
