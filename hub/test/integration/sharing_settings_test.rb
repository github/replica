require "test_helper"
require_relative "../support/authorization_continuation_helpers"

class SharingSettingsTest < ActionDispatch::IntegrationTest
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
  end

  test "new deployments deny sharing until an administrator explicitly opts in" do
    assert_not SharingSetting.enabled?
    get security_audit_path, as: :json
    assert_equal sharing_settings_path, data.fetch("sharingSettingsPath")
    get sharing_settings_path, as: :json
    assert_response :success
    assert_equal "enable", data.fetch("operation")
    assert_equal "private, no-store", response.headers["Cache-Control"]
    change("enable", public_sharing_enabled: false, actor_id: 999)
    assert_redirected_to sharing_settings_path
    assert SharingSetting.enabled?
    event = SecurityAuditEvent.where(action: "sharing_settings.enable").last
    assert_equal "succeeded", event.outcome
    assert_equal @actor.id, event.user_id
    assert_equal @session.id, event.context.fetch("session_id")
    assert_not event.repository_scoped?
  end

  test "administration works without repository access but grants no repository content" do
    stub_github_permissions([ @payload ], { 2001 => nil })
    get sharing_settings_path
    assert_response :success
    change("enable")
    assert SharingSetting.enabled?
    get repository_path(2001)
    assert_response :not_found
  end

  test "ordinary users and stale roles cannot expose settings or create challenges" do
    @actor.update!(hub_admin: false)
    @session.update!(fresh_authorized_at: nil)
    assert_no_difference [ "SharingSetting.count", "FreshAuthorization.count" ] do
      get sharing_settings_path, as: :json
      assert_response :forbidden
      assert_equal true, data.fetch("accessDenied")
      workspace = data.fetch("authenticatedWorkspace")
      assert_equal @actor.login, workspace.fetch("currentUser").fetch("login")
      assert_nil data.fetch("administrationWorkspace")
      assert_empty workspace.fetch("administrationLinks")
      assert_equal repository_security_audit_path(2001), workspace.fetch("securityAuditPath")
      assert_equal repository_analytics_path(2001), workspace.fetch("repository").fetch("analyticsPath")
      %w[auditPath hubAdminsPath sharingSettingsPath sessionRevocationPath githubAppPath].each do |key|
        assert_nil data.fetch(key)
      end
      %w[statusLabel operation submitPath submitLabel consequence confirmLabel verification].each do |key|
        assert_not data.key?(key), key
      end
      change("enable")
      assert_response :forbidden
    end
    assert_not SharingSetting.enabled?
  end

  test "stale proof continues enabling and disabling public sharing" do
    @session.update!(fresh_authorized_at: 5.minutes.ago)
    assert_no_difference("SharingSetting.count") { change("enable") }
    challenge = FreshAuthorization.last
    assert_equal "sharing_settings", challenge.purpose
    assert_equal @session.id, challenge.credential_id
    assert_equal sharing_settings_path, challenge.return_to
    assert_redirected_to fresh_authorization_path(challenge.public_id)
    form = verify_pending_action(challenge, path: sharing_settings_path, method: "patch")
    assert_not SharingSetting.enabled?
    continue_pending_action(form)
    assert SharingSetting.enabled?
    @session.update!(fresh_authorized_at: nil)
    change("disable")
    assert SharingSetting.enabled?
    assert_equal "sharing_settings", FreshAuthorization.last.purpose
    form = verify_pending_action(FreshAuthorization.last, path: sharing_settings_path, method: "patch")
    continue_pending_action(form)
    assert_not SharingSetting.enabled?
  end

  test "a continued toggle reports a state conflict and cannot be tried again" do
    @session.update!(fresh_authorized_at: nil)
    change("enable")
    challenge = FreshAuthorization.last
    form = verify_pending_action(challenge, path: sharing_settings_path, method: "patch")
    SharingSetting.find_or_create_by!(id: 1).update!(public_sharing_enabled: true)
    continue_pending_action(form)
    assert SharingSetting.enabled?
    assert_equal I18n.t("sharing_settings.errors.state_changed"), flash[:alert]
    assert_nil challenge.reload.pending_action
    assert challenge.continued_at
    SharingSetting.find(1).update!(public_sharing_enabled: false)
    continue_pending_action(form)
    assert_not SharingSetting.enabled?
  end

  test "an administrator removed after verification cannot continue a saved toggle" do
    @session.update!(fresh_authorized_at: nil)
    change("enable")
    challenge = FreshAuthorization.last
    form = verify_pending_action(challenge, path: sharing_settings_path, method: "patch")
    @actor.update!(hub_admin: false)
    continue_pending_action(form)
    assert_response :forbidden
    assert_not SharingSetting.enabled?
    assert_nil challenge.reload.pending_action
  end

  test "another browser Session and submitted freshness cannot authorize this browser" do
    other = @actor.sessions.create!(fresh_authorized_at: Time.current)
    @session.update!(fresh_authorized_at: nil)
    change("enable", session_id: other.id, fresh_authorized_at: Time.current.iso8601)
    assert_not SharingSetting.enabled?
    assert_equal @session.id, FreshAuthorization.last.credential_id
  end

  test "confirmation invalid operations and repeated submissions do not silently succeed" do
    patch sharing_settings_path, params: { operation: "enable" }
    assert_not SharingSetting.enabled?
    assert_equal I18n.t("sharing_settings.errors.confirmation_required"), flash[:alert]
    change("unknown")
    assert_not SharingSetting.enabled?
    change("enable")
    change("enable")
    assert_equal I18n.t("sharing_settings.errors.state_changed"), flash[:alert]
    assert_empty FreshAuthorization.all
  end

  test "deleted Sessions and browser forgery protection prevent toggles" do
    previous = ActionController::Base.allow_forgery_protection
    ActionController::Base.allow_forgery_protection = true
    change("enable")
    assert_response :unprocessable_entity
    assert_not SharingSetting.enabled?
    ActionController::Base.allow_forgery_protection = previous
    @session.destroy!
    change("enable")
    assert_redirected_to root_path
    assert_not SharingSetting.enabled?
  ensure
    ActionController::Base.allow_forgery_protection = previous
  end

  private

  def change(operation, **extra)
    patch sharing_settings_path, params: { operation:, confirmed: "1" }.merge(extra)
  end

  def data
    JSON.parse(response.body).fetch("data")
  end
end
