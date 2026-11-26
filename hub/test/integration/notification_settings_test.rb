require "test_helper"
require_relative "../support/authorization_continuation_helpers"

class NotificationSettingsTest < ActionDispatch::IntegrationTest
  include AuthorizationContinuationHelpers

  class SettingsProvider
    def key = "private-provider-key"
    def label = "Team notifications"
    def eligible?(recipient:) = true
    def deliver!(recipient:, messages:, preferences_url:); end
  end

  setup do
    host! "replica.localhost:19500"
    NotificationDelivery.provider = SettingsProvider.new
    github_app_configurations.create_installed
    @payload = repository_payload(2001, "github/prototype")
    stub_github_sign_in(repositories: [ @payload ], permissions: { 2001 => "read" })
    sign_in_to_hub
    @user = User.find_by!(github_id: 1001)
    @session = @user.sessions.sole
    @identity = GithubIdentity.record!(github_id: @user.github_id, login: @user.login, avatar_url: nil)
    @build = builds.create_successful \
      prototype: prototypes.create(repository: Repository.find_by!(github_id: 2001), author: @user)
  end

  teardown do
    NotificationDelivery.provider = nil
  end

  test "without an adapter settings are absent while Inbox remains available" do
    NotificationDelivery.provider = nil
    get notification_settings_path
    assert_response :not_found
    patch notification_settings_path, params: { enabled: "0" }
    assert_response :not_found
    patch mute_path, params: { muted: "1" }
    assert_response :not_found
    @user.update!(hub_admin: true)
    patch notification_delivery_setting_path, params: { operation: "disable", confirmed: "1" }
    assert_response :not_found
    get notifications_path, as: :json
    assert_response :success
    assert_not_includes response.body, '"notificationSettingsPath":"/notification_settings"'
  end

  test "personal settings default on and ignore a submitted recipient identity" do
    other = GithubIdentity.record!(github_id: 1003, login: "hubot", avatar_url: nil)
    other_preference = NotificationPreference.for_identity(other)
    get notification_settings_path, as: :json
    assert_response :success
    assert_not_includes response.body, "private-provider-key"
    assert NotificationPreference.for_identity(@identity).enabled?

    patch notification_settings_path, params: { enabled: "0", recipient_id: other.id, github_id: other.github_id }
    assert_response :redirect
    assert_not NotificationPreference.for_identity(@identity).enabled?
    assert other_preference.reload.enabled?
    assert NotificationSetting.enabled?

    patch notification_settings_path, params: { enabled: "false" }
    assert_response :bad_request
    assert_not NotificationPreference.for_identity(@identity).enabled?
  end

  test "prototype mute changes affect only the signed in identity and require fresh repository permission" do
    other = GithubIdentity.record!(github_id: 1003, login: "hubot", avatar_url: nil)
    patch mute_path, params: { muted: "1", recipient_id: other.id }
    assert_response :redirect
    assert NotificationMute.exists?(recipient: @identity, prototype: @build.prototype)
    assert_not NotificationMute.exists?(recipient: other, prototype: @build.prototype)
    patch mute_path, params: { muted: "1" }
    assert_response :redirect
    assert_equal 1, NotificationMute.where(recipient: @identity, prototype: @build.prototype).count

    stub_github_permissions([ @payload ], { 2001 => "none" })
    patch mute_path, params: { muted: "0" }
    assert_response :not_found
    assert NotificationMute.exists?(recipient: @identity, prototype: @build.prototype)

    stub_github_permissions([ @payload ], { 2001 => "read" })
    patch mute_path, params: { muted: "yes" }
    assert_response :bad_request
    patch mute_path, params: { muted: "0" }
    assert_response :redirect
    assert_not NotificationMute.exists?(recipient: @identity, prototype: @build.prototype)
  end

  test "ordinary users cannot toggle deployment delivery or obtain an authorization challenge" do
    @session.update!(fresh_authorized_at: nil)
    assert_no_difference [ "NotificationSetting.count", "FreshAuthorization.count" ] do
      patch notification_delivery_setting_path, params: { operation: "disable", confirmed: "1" }
      assert_response :forbidden
    end
    assert NotificationSetting.enabled?
    assert_raises(NotificationSetting::ChangeDenied) do
      NotificationSetting.change!(actor: @user, browser_session: @session, enabled: false)
    end
    assert NotificationSetting.enabled?
  end

  test "the deployment switch uses fresh authorization and rechecks the Hub role on continuation" do
    @user.update!(hub_admin: true)
    @session.update!(fresh_authorized_at: nil)
    patch notification_delivery_setting_path, params: { operation: "disable", confirmed: "1" }
    challenge = FreshAuthorization.last
    assert_equal "notification_delivery", challenge.purpose
    assert_equal @session.id, challenge.credential_id
    assert NotificationSetting.enabled?
    form = verify_pending_action(challenge, path: notification_delivery_setting_path, method: "patch")
    @user.update!(hub_admin: false)
    continue_pending_action(form)
    assert_response :forbidden
    assert NotificationSetting.enabled?
  end

  test "deployment disable cancels pending and retryable deliveries and reenable queues only new activity" do
    @user.update!(hub_admin: true)
    @session.update!(fresh_authorized_at: Time.current)
    actor = users.create(github_id: 1002, login: "mona")
    root = ReviewComment.create! \
      prototype: @build.prototype, build: @build, user: @user, body: "Review this",
      anchor: {
        "schemaVersion" => 1, "kind" => "element",
        "route" => { "pathname" => "/", "search" => "", "hash" => "" },
        "selector" => "#save", "accessibleName" => "Save", "tagName" => "button", "selectedText" => "",
        "rect" => { "x" => 20, "y" => 30, "width" => 100, "height" => 32 },
        "viewport" => { "width" => 1280, "height" => 720, "scrollX" => 0, "scrollY" => 0 },
        "elementOffset" => { "x" => 0.5, "y" => 0.5 }
      }
    2.times { root.thread.create_reply!(user: actor, body: "Before disabling") }
    NotificationDelivery.last.update!(state: "retryable")
    ids = NotificationDelivery.ids

    patch notification_delivery_setting_path, params: { operation: "disable", confirmed: "1" }
    assert_response :redirect
    assert_not NotificationSetting.enabled?
    assert_equal [ "canceled" ], NotificationDelivery.where(id: ids).distinct.pluck(:state)
    root.thread.create_reply!(user: actor, body: "While disabled")
    patch notification_delivery_setting_path, params: { operation: "enable", confirmed: "1" }
    assert_response :redirect
    NotificationDelivery.recover!
    assert_equal ids.sort, NotificationDelivery.ids.sort
    root.thread.create_reply!(user: actor, body: "After reenabling")
    assert_equal 4, Notification.for_user(@user).count
    assert_equal [ Notification.last.id ], NotificationDelivery.where(state: "pending").pluck(:notification_id)
  end

  private

  def mute_path
    repository_prototype_notification_mute_path(@build.prototype.repository.route_id, @build.prototype)
  end
end
