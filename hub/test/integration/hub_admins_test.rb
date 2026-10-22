require "test_helper"
require_relative "../support/authorization_continuation_helpers"

class HubAdminsTest < ActionDispatch::IntegrationTest
  include AuthorizationContinuationHelpers

  setup do
    github_app_configurations.create_installed
    @payload = repository_payload(2001, "github/prototype")
    stub_github_sign_in(repositories: [ @payload ], permissions: { 2001 => "admin" })
    post github_authentication_path
    state = Rack::Utils.parse_query(URI(response.location).query).fetch("state")
    get github_authentication_callback_path, params: { code: "code", state: }
    @actor = User.find_by!(github_id: 1001)
    @actor.update!(hub_admin: true)
    @session = @actor.sessions.sole
    @target = users.create(github_id: 1002, login: "mona")
    @path = hub_admin_path(@target)
  end

  test "administrators browse only administrators and can confirm an explicit target" do
    get security_audit_path, as: :json
    assert_equal hub_admins_path, data.fetch("hubAdminsPath")
    get hub_admins_path, as: :json
    assert_response :success
    assert_equal [ @actor.id ], data.fetch("users").map { _1.fetch("id") }
    assert_equal candidates_hub_admins_path, data.fetch("addAdministrator").fetch("searchPath")
    assert_equal "Add administrator", data.fetch("addLabel")
    assert_equal "1 administrator", data.fetch("administratorsLabel")
    assert_equal "Search by name or login", data.fetch("addAdministrator").fetch("searchPlaceholder")
    assert_equal "private, no-store", response.headers["Cache-Control"]
    get edit_hub_admin_path(@target), as: :json
    assert_equal "mona", data.fetch("target").fetch("login")
    assert_equal "designate", data.fetch("operation")
    assert_nil data.fetch("blockedLabel")
    assert_not @target.reload.hub_admin?
  end

  test "confirmed designation and removal keep actor and target distinct in the audit" do
    change("designate", user: { hub_admin: false }, user_id: @actor.id, github_id: 999)
    assert_redirected_to hub_admins_path
    assert @target.reload.hub_admin?
    event = SecurityAuditEvent.where(action: "hub_admin.designate").last
    assert_equal "succeeded", event.outcome
    assert_equal @actor.id, event.user_id
    assert_equal @target.id, event.context.fetch("target_user_id")
    assert_equal @session.id, event.context.fetch("session_id")
    assert_equal "browser", event.context.fetch("source")
    assert_not event.repository_scoped?
    assert_not_includes event.context.to_s, "999"
    change("revoke")
    assert_not @target.reload.hub_admin?
  end

  test "ordinary users and revoked administrators cannot mutate or create challenges" do
    @actor.update!(hub_admin: false)
    @session.update!(fresh_authorized_at: 5.minutes.ago)
    assert_no_difference("FreshAuthorization.count") do
      get hub_admins_path
      assert_response :forbidden
      assert_not_includes response.body, "mona"
      get edit_hub_admin_path(@target)
      assert_response :forbidden
      change("designate")
    end
    assert_not @target.reload.hub_admin?
    assert_equal "denied", SecurityAuditEvent.where(action: "hub_admin.designate").last.outcome
    assert_response :forbidden
    assert_includes response.body, I18n.t("hub_admins.errors.not_authorized")
  end

  test "stale browser proof continues the original role change exactly once" do
    @session.update!(fresh_authorized_at: 5.minutes.ago)
    assert_no_difference -> { User.where(hub_admin: true).count } do
      change("designate")
    end
    challenge = FreshAuthorization.last
    assert_redirected_to fresh_authorization_path(challenge.public_id)
    assert_equal "hub_admin_management", challenge.purpose
    assert_equal @session.id, challenge.credential_id
    assert_equal edit_hub_admin_path(@target), challenge.return_to
    assert_equal @target.id, SecurityAuditEvent.where(action: "hub_admin.designate").last.context["target_user_id"]
    form = verify_pending_action(challenge, path: @path, method: "patch")
    assert_not @target.reload.hub_admin?
    continue_pending_action(form, operation: "revoke", confirmed: "0", user_id: @actor.id)
    assert @target.reload.hub_admin?
    assert_equal I18n.t("hub_admins.changed"), flash[:notice]
    assert_nil challenge.reload.pending_action
    assert challenge.continued_at
    assert_no_difference("SecurityAuditEvent.where(action: 'hub_admin.designate', outcome: 'succeeded').count") do
      continue_pending_action(form)
    end
    assert @target.reload.hub_admin?
  end

  test "another Session's proof and submitted timestamps do not authorize this browser" do
    @actor.sessions.create!(fresh_authorized_at: Time.current)
    @session.update!(fresh_authorized_at: nil)
    change("designate", fresh_authorized_at: Time.current.iso8601, session_id: Session.last.id)
    assert_redirected_to fresh_authorization_path(FreshAuthorization.last.public_id)
    assert_not @target.reload.hub_admin?
  end

  test "administrator removal continues after fresh authorization" do
    @target.update!(hub_admin: true)
    @session.update!(fresh_authorized_at: 5.minutes.ago)
    change("revoke")
    assert_redirected_to fresh_authorization_path(FreshAuthorization.last.public_id)
    assert @target.reload.hub_admin?
    assert_equal "hub_admin_management", FreshAuthorization.last.purpose
    assert_equal "denied", SecurityAuditEvent.where(action: "hub_admin.revoke").last.outcome
    form = verify_pending_action(FreshAuthorization.last, path: @path, method: "patch")
    continue_pending_action(form)
    assert_not @target.reload.hub_admin?
  end

  test "management works without repository access and self removal still shows its result" do
    stub_github_permissions([ @payload ], { 2001 => nil })
    get hub_admins_path, as: :json
    assert_response :success
    change("designate")
    assert @target.reload.hub_admin?
    patch hub_admin_path(@actor), params: { operation: "revoke", confirmed: "1" }, as: :json
    assert_response :success
    assert_empty data.fetch("users")
    assert_nil data.fetch("auditPath")
    assert_equal I18n.t("hub_admins.changed"), data.fetch("notice")
    get hub_admins_path, as: :json
    assert_response :forbidden
    assert_empty data.fetch("users")
    assert_nil data.fetch("auditPath")
  end

  test "a cancelled or deleted challenge and role revocation during verification cannot mutate" do
    @session.update!(fresh_authorized_at: nil)
    change("designate")
    delete fresh_authorization_path(FreshAuthorization.last.public_id)
    assert_not @target.reload.hub_admin?
    change("designate")
    challenge = FreshAuthorization.last
    post fresh_authorization_path(challenge.public_id)
    state = Rack::Utils.parse_query(URI(response.location).query).fetch("state")
    challenge.destroy!
    get github_authentication_callback_path, params: { code: "code", state: }
    assert_not FreshAuthorization.fresh?(@session)
    change("designate")
    challenge = FreshAuthorization.last
    post fresh_authorization_path(challenge.public_id)
    state = Rack::Utils.parse_query(URI(response.location).query).fetch("state")
    @actor.update!(hub_admin: false)
    get github_authentication_callback_path, params: { code: "code", state: }
    change("designate")
    assert_not @target.reload.hub_admin?
    assert_response :forbidden
  end

  test "confirmation and a recognized operation are required even with fresh proof" do
    patch @path, params: { operation: "designate" }
    assert_equal I18n.t("hub_admins.errors.confirmation_required"), flash[:alert]
    change("unknown")
    assert_not @target.reload.hub_admin?
    assert_equal I18n.t("hub_admins.errors.confirmation_required"), flash[:alert]
    assert_empty FreshAuthorization.all
  end

  test "final administrator removal is blocked in the page and direct endpoint" do
    get edit_hub_admin_path(@actor), as: :json
    assert_equal I18n.t("hub_admins.errors.last_admin"), data.fetch("blockedLabel")
    patch hub_admin_path(@actor), params: { operation: "revoke", confirmed: "1" }
    assert @actor.reload.hub_admin?
    assert_equal I18n.t("hub_admins.errors.last_admin"), flash[:alert]
    assert_equal "denied", SecurityAuditEvent.where(action: "hub_admin.revoke").last.outcome
  end

  test "self removal takes effect immediately without invalidating repository permissions" do
    @target.update!(hub_admin: true)
    patch hub_admin_path(@actor), params: { operation: "revoke", confirmed: "1" }
    assert_response :success
    assert_not @actor.reload.hub_admin?
    get security_audit_path
    assert_response :not_found
    get repository_path(2001)
    assert_response :success
    get hub_admins_path
    assert_response :forbidden
  end

  test "missing deleted and local targets receive explicit denials" do
    @target.destroy!
    change("designate")
    assert_equal I18n.t("hub_admins.errors.invalid_target"), flash[:alert]
    @actor.update_columns(github_id: nil)
    patch hub_admin_path(@actor), params: { operation: "designate", confirmed: "1" }
    assert_redirected_to root_path
    assert_not User.exists?(@target.id)
  end

  test "repeated confirmation reports the current role instead of silently succeeding" do
    change("designate")
    change("designate")
    assert_equal I18n.t("hub_admins.errors.role_changed"), flash[:alert]
    assert @target.reload.hub_admin?
  end

  test "Hub roles do not grant repository pages audit records or preview access" do
    change("designate")
    stub_github_permissions([ @payload ], { 2001 => nil })
    get repository_path(2001)
    assert_response :not_found
    get repository_security_audit_path(2001)
    assert_response :not_found
    get security_audit_path
    assert_response :success
    prototype = prototypes.create(repository: Repository.find_by!(github_id: 2001))
    build = builds.create_successful(prototype:)
    get preview_build_authorization_path(build)
    assert_response :not_found
  end

  test "signed out and deleted browser Sessions cannot change roles" do
    @session.destroy!
    change("designate")
    assert_redirected_to root_path
    assert_not @target.reload.hub_admin?
    assert_equal "denied", SecurityAuditEvent.where(action: "hub_admin.designate").last.outcome
  end

  test "role changes preserve browser forgery protection" do
    previous = ActionController::Base.allow_forgery_protection
    ActionController::Base.allow_forgery_protection = true
    change("designate")
    assert_response :unprocessable_entity
    assert_not @target.reload.hub_admin?
    assert_empty FreshAuthorization.all
  ensure
    ActionController::Base.allow_forgery_protection = previous
  end

  test "administrator pagination is bounded and rejects invalid cursors" do
    50.times { |index| users.create(github_id: 10_000 + index, login: "user-#{index}", hub_admin: true) }
    get hub_admins_path, as: :json
    assert_equal 50, data.fetch("users").length
    assert_equal "51 administrators", data.fetch("administratorsLabel")
    get data.fetch("nextPath"), as: :json
    assert_equal [ @actor.id ], data.fetch("users").map { _1.fetch("id") }
    assert_equal "51 administrators", data.fetch("administratorsLabel")
    get hub_admins_path, params: { before: "invalid" }
    assert_equal I18n.t("hub_admins.errors.invalid_target"), flash[:alert]
  end

  test "candidate search matches login and name but excludes administrators and escapes wildcards" do
    @target.update!(name: "Mona Lisa")
    get candidates_hub_admins_path, params: { query: "MONA" }, as: :json
    assert_response :success
    assert_equal [ @target.id ], JSON.parse(response.body).fetch("users").map { _1.fetch("id") }
    assert_equal "private, no-store", response.headers["Cache-Control"]
    get candidates_hub_admins_path, params: { query: "Lisa" }, as: :json
    assert_equal [ @target.id ], JSON.parse(response.body).fetch("users").map { _1.fetch("id") }
    get candidates_hub_admins_path, params: { query: "%" }, as: :json
    assert_empty JSON.parse(response.body).fetch("users")
    get candidates_hub_admins_path, as: :json
    assert_equal [ @target.id ], JSON.parse(response.body).fetch("users").map { _1.fetch("id") }
    @target.update!(hub_admin: true)
    get candidates_hub_admins_path, as: :json
    assert_empty JSON.parse(response.body).fetch("users")
    @target.update_columns(hub_admin: false, github_id: nil)
    get candidates_hub_admins_path, as: :json
    assert_empty JSON.parse(response.body).fetch("users")
  end

  test "candidate search matches literal percent underscores and backslashes" do
    @target.update!(name: "100% Mona_Lisa\\Sprite")
    users.create(github_id: 1003, login: "pixel", name: "100 percent MonaXLisaXSprite")
    [ "%", "_", "\\", "100% Mona", "Mona_Lisa", "Lisa\\Sprite" ].each do |query|
      get candidates_hub_admins_path, params: { query: }, as: :json
      assert_response :success
      assert_equal [ @target.id ], JSON.parse(response.body).fetch("users").map { _1.fetch("id") }
    end
  end

  test "candidate search is bounded and invalid input is an explicit failure" do
    @target.update!(hub_admin: true)
    candidates = 70.times.map do |index|
      users.create(github_id: 10_000 + index, login: "pixel-#{index.to_s.rjust(2, '0')}", name: "Pixel Sprite #{index}")
    end
    get candidates_hub_admins_path, as: :json
    assert_response :success
    assert_equal candidates.first(50).map(&:id), JSON.parse(response.body).fetch("users").map { _1.fetch("id") }
    assert JSON.parse(response.body).fetch("more")
    get candidates_hub_admins_path, params: { query: "PIXEL-69" }, as: :json
    assert_response :success
    assert_equal [ candidates.last.id ], JSON.parse(response.body).fetch("users").map { _1.fetch("id") }
    assert_not JSON.parse(response.body).fetch("more")
    get candidates_hub_admins_path, params: { query: "Sprite 69" }, as: :json
    assert_equal [ candidates.last.id ], JSON.parse(response.body).fetch("users").map { _1.fetch("id") }
    get candidates_hub_admins_path, params: { query: { login: "mona" } }, as: :json
    assert_response :unprocessable_entity
    assert JSON.parse(response.body).fetch("errors").present?
  end

  test "confirmed selections designate all selected existing users without repository access" do
    other = users.create(github_id: 1003, login: "other")
    stub_github_permissions([ @payload ], { 2001 => nil })
    post hub_admins_path, params: { user_ids: [ @target.id, other.id ], confirmed: "1", actor_id: other.id }
    assert_redirected_to hub_admins_path
    assert @target.reload.hub_admin?
    assert other.reload.hub_admin?
    events = SecurityAuditEvent.where(action: "hub_admin.designate", outcome: "succeeded")
    assert_equal [ @target.id, other.id ], events.map { _1.context.fetch("target_user_id") }
    assert events.all? { _1.user_id == @actor.id && _1.context["session_id"] == @session.id }
    get hub_admins_path, as: :json
    assert_equal [ other.id, @target.id, @actor.id ], data.fetch("users").map { _1.fetch("id") }
  end

  test "invalid selections and missing confirmation do not start challenges or change any roles" do
    @session.update!(fresh_authorized_at: nil)
    assert_no_difference("FreshAuthorization.count") do
      [ nil, [], @target.id.to_s, [ "bad" ], [ @target.id, @target.id ], Array.new(51, "1") ].each do |ids|
        post hub_admins_path, params: { user_ids: ids, confirmed: "1" }
        assert_equal I18n.t("hub_admins.errors.invalid_selection"), flash[:alert]
      end
      post hub_admins_path, params: { user_ids: [ @target.id ] }
      assert_equal I18n.t("hub_admins.errors.confirmation_required"), flash[:alert]
    end
    assert_not @target.reload.hub_admin?
  end

  test "an already designated member rejects the whole selection with an explicit error" do
    post hub_admins_path, params: { user_ids: [ @target.id, @actor.id ], confirmed: "1" }
    assert_redirected_to hub_admins_path
    assert_equal I18n.t("hub_admins.errors.role_changed"), flash[:alert]
    assert_not @target.reload.hub_admin?
    assert_empty SecurityAuditEvent.where(action: "hub_admin.designate", outcome: "succeeded")
    assert_equal "denied", SecurityAuditEvent.where(action: "hub_admin.designate").last.outcome
  end

  test "bulk addition continues only the saved selection after this browser verifies" do
    @actor.sessions.create!(fresh_authorized_at: Time.current)
    @session.update!(fresh_authorized_at: nil)
    post hub_admins_path, params: {
      user_ids: [ @target.id ], confirmed: "1", fresh_authorized_at: Time.current.iso8601
    }
    challenge = FreshAuthorization.last
    assert_redirected_to fresh_authorization_path(challenge.public_id)
    assert_equal hub_admins_path, challenge.return_to
    assert_equal "hub_admin_management", challenge.purpose
    assert_equal @session.id, challenge.credential_id
    form = verify_pending_action(challenge, path: hub_admins_path, method: "post")
    assert_not @target.reload.hub_admin?
    other = users.create(github_id: 1003, login: "other")
    continue_pending_action(form, user_ids: [ other.id ], confirmed: "0")
    assert @target.reload.hub_admin?
    assert_not other.reload.hub_admin?
  end

  test "revoked administrators cannot search users or submit bulk selections" do
    @actor.update!(hub_admin: false)
    @session.update!(fresh_authorized_at: nil)
    assert_no_difference("FreshAuthorization.count") do
      get candidates_hub_admins_path, as: :json
      assert_response :forbidden
      assert_not_includes response.body, "mona"
      assert JSON.parse(response.body).fetch("errors").present?
      post hub_admins_path, params: { user_ids: [ @target.id ], confirmed: "1" }, as: :json
      assert_response :forbidden
      assert_nil data.fetch("addAdministrator")
    end
    assert_not @target.reload.hub_admin?
  end

  test "bulk additions preserve browser forgery protection" do
    previous = ActionController::Base.allow_forgery_protection
    ActionController::Base.allow_forgery_protection = true
    post hub_admins_path, params: { user_ids: [ @target.id ], confirmed: "1" }
    assert_response :unprocessable_entity
    assert_not @target.reload.hub_admin?
  ensure
    ActionController::Base.allow_forgery_protection = previous
  end

  private

  def change(operation, **extra)
    patch @path, params: { operation:, confirmed: "1" }.merge(extra)
  end

  def data
    JSON.parse(response.body).fetch("data")
  end
end
