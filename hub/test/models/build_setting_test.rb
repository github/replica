require "test_helper"

class BuildSettingTest < ActiveSupport::TestCase
  setup do
    @actor = users.create
    @actor.update!(hub_admin: true)
    @session = @actor.sessions.create!(fresh_authorized_at: Time.current)
  end

  test "a schema loaded installation reads the default without persisting it" do
    assert_no_difference "BuildSetting.count" do
      setting = BuildSetting.current
      assert_equal 1, setting.id
      assert_equal 150, setting.maximum_package_mib
      assert_equal 150.megabytes, setting.maximum_bytes
      assert_operator setting.maximum_download_bytes, :>, setting.maximum_bytes
      assert_operator setting.maximum_download_bytes, :<, setting.maximum_bytes + 10.megabytes
    end
  end

  test "a confirmed model change persists the singleton and audits the live administrator and Session" do
    setting = change("275")

    assert_equal 275, setting.reload.maximum_package_mib
    assert_equal 275.megabytes, BuildSetting.current.maximum_bytes
    assert_equal [ 1 ], BuildSetting.pluck(:id)
    event = SecurityAuditEvent.where(action: "build_settings.update").sole
    assert_equal "succeeded", event.outcome
    assert_equal @actor.id, event.user_id
    assert_equal @session.id, event.context.fetch("session_id")
    assert_not event.repository_scoped?
    previous_bound = setting.maximum_download_bytes
    change("300")
    assert_operator BuildSetting.current.maximum_download_bytes, :>, previous_bound
  end

  test "invalid values cannot truncate to integers or replace a saved limit" do
    change("200")
    [ nil, "", "0", "-1", "1.5", "150MiB", "1e2", "2.0", 1.5, "9223372036854775808" ].each do |value|
      assert_no_difference "SecurityAuditEvent.where(action: 'build_settings.update').count" do
        assert_raises(ActiveRecord::RecordInvalid, value.inspect) { change(value) }
      end
      assert_equal 200, BuildSetting.current.maximum_package_mib, value.inspect
    end
  end

  test "authorization rereads persisted role identity Session ownership and freshness" do
    change("200")
    stale_actor = User.find(@actor.id)
    @actor.update!(hub_admin: false)
    assert_raises(BuildSetting::ChangeDenied) { change("300", actor: stale_actor) }
    @actor.update_columns(hub_admin: true, github_id: nil)
    assert_raises(BuildSetting::ChangeDenied) { change("300", actor: stale_actor) }
    @actor.update_columns(github_id: stale_actor.github_id)
    @session.update!(fresh_authorized_at: 5.minutes.ago)
    assert_raises(FreshAuthorization::Invalid) { change("300") }
    other_session = users.create(github_id: 1002, login: "mona").sessions.create!(fresh_authorized_at: Time.current)
    assert_raises(BuildSetting::ChangeDenied) { change("300", browser_session: other_session) }
    @session.destroy!
    assert_raises(BuildSetting::ChangeDenied) { change("300") }
    assert_equal 200, BuildSetting.current.maximum_package_mib
  end

  test "an audit failure rolls back the setting change" do
    change("200")
    Current.security_audit_context = { payload: "not allowed" }

    assert_raises(ActiveRecord::RecordInvalid) { change("300") }

    assert_equal 200, BuildSetting.current.maximum_package_mib
  ensure
    Current.reset
  end

  private

  def change(maximum_package_mib, actor: @actor, browser_session: @session)
    BuildSetting.change!(actor:, browser_session:, maximum_package_mib:)
  end
end
