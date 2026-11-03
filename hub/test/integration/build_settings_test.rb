require "test_helper"
require_relative "../support/authorization_continuation_helpers"

class BuildSettingsTest < ActionDispatch::IntegrationTest
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

  test "a Hub administrator without repository access can read and change the package limit" do
    stub_github_permissions([ @payload ], { 2001 => nil })

    get build_settings_path, as: :json

    assert_response :success
    assert_equal "private, no-store", response.headers["Cache-Control"]
    change("240", maximum_download_bytes: 1, actor_id: 999)
    assert_redirected_to build_settings_path
    assert_equal 240, BuildSetting.current.maximum_package_mib
    assert_operator BuildSetting.current.maximum_download_bytes, :>, 240.megabytes
    event = SecurityAuditEvent.where(action: "build_settings.update").sole
    assert_equal @actor.id, event.user_id
    assert_equal @session.id, event.context.fetch("session_id")
    get repository_path(2001)
    assert_response :not_found
  end

  test "limits above JavaScript's safe integer range persist and render without rounding" do
    change("9007199254740993")

    assert_redirected_to build_settings_path
    assert_equal 9_007_199_254_740_993, BuildSetting.current.maximum_package_mib
    get build_settings_path, as: :json
    assert_response :success
    assert_equal "9007199254740993", response.parsed_body.fetch("data").fetch("maximumPackageMib")
  end

  test "ordinary users cannot read settings mutate them or create a fresh authorization challenge" do
    @actor.update!(hub_admin: false)
    @session.update!(fresh_authorized_at: nil)

    assert_no_difference [ "BuildSetting.count", "FreshAuthorization.count" ] do
      get build_settings_path, as: :json
      assert_response :forbidden
      change("240")
      assert_response :forbidden
    end
    assert_equal 150, BuildSetting.current.maximum_package_mib
  end

  test "fresh authorization continuation preserves the submitted limit rather than later form input" do
    @session.update!(fresh_authorized_at: 5.minutes.ago)

    assert_no_difference("BuildSetting.count") { change("260") }

    challenge = FreshAuthorization.last
    assert_equal "build_settings", challenge.purpose
    assert_equal @session.id, challenge.credential_id
    assert_equal build_settings_path, challenge.return_to
    assert_redirected_to fresh_authorization_path(challenge.public_id)
    form = verify_pending_action(challenge, path: build_settings_path, method: "patch")
    assert_equal 150, BuildSetting.current.maximum_package_mib

    continue_pending_action(form, maximum_package_mib: "999", confirmed: "1")

    assert_redirected_to build_settings_path
    assert_equal 260, BuildSetting.current.maximum_package_mib
    assert_nil challenge.reload.pending_action
  end

  test "a removed administrator cannot continue a verified setting change" do
    @session.update!(fresh_authorized_at: nil)
    change("260")
    challenge = FreshAuthorization.last
    form = verify_pending_action(challenge, path: build_settings_path, method: "patch")
    @actor.update!(hub_admin: false)

    continue_pending_action(form)

    assert_response :forbidden
    assert_equal 150, BuildSetting.current.maximum_package_mib
  end

  test "confirmation and strict integer validation preserve the saved setting with an alert" do
    change("200")
    patch build_settings_path, params: { maximum_package_mib: "300" }
    assert_redirected_to build_settings_path
    assert flash[:alert].present?
    assert_equal 200, BuildSetting.current.maximum_package_mib
    [ "0", "-1", "1.5", "150MiB", "", "9223372036854775808" ].each do |invalid|
      assert_no_difference "SecurityAuditEvent.where(action: 'build_settings.update', outcome: 'succeeded').count" do
        change(invalid)
      end
      assert_redirected_to build_settings_path
      assert flash[:alert].present?, invalid.inspect
      assert_equal 200, BuildSetting.current.maximum_package_mib
    end
  end

  test "another browser Session cannot supply freshness for this setting change" do
    other = @actor.sessions.create!(fresh_authorized_at: Time.current)
    @session.update!(fresh_authorized_at: nil)

    change("260", session_id: other.id, fresh_authorized_at: Time.current.iso8601)

    assert_equal 150, BuildSetting.current.maximum_package_mib
    assert_equal @session.id, FreshAuthorization.last.credential_id
  end

  private

  def change(maximum_package_mib, **extra)
    patch build_settings_path, params: { maximum_package_mib:, confirmed: "1" }.merge(extra)
  end
end
