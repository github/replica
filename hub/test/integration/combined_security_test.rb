require "test_helper"
require_relative "../support/security_rate_limit_store"

class CombinedSecurityTest < ActionDispatch::IntegrationTest
  include SecurityRateLimitStore

  setup do
    use_security_rate_limit_store
    @configuration = github_app_configurations.create_installed
    @actor = users.create(hub_admin: true)
    @target = users.create(github_id: 1002, login: "mona")
    stub_github_oauth_user
    sign_in
    @session = @actor.sessions.sole
    stub_request(:patch, "#{GITHUB_API_URL}/app/hook/config").to_return(status: 200, body: "{}")
    stub_request(:get, "#{GITHUB_API_URL}/app")
      .to_return(status: 200, body: JSON.generate(github_app_configurations.manifest_credentials))
    Rails.cache.clear
  end

  teardown { restore_security_rate_limit_store }

  test "the actual administrator controllers share one budget and halt every exhausted action" do
    operations = admin_operations
    operations.each(&:call)
    assert @target.reload.hub_admin?
    assert SharingSetting.enabled?
    assert_equal "idle", @configuration.reload.webhook_rotation_state
    assert Session.exists?(@session.id)
    assert GithubAppConfiguration.exists?(@configuration.id)
    patch hub_admin_path(@target), params: { confirmed: "1", operation: "revoke" }, as: :json
    assert_equal 10, Rails.cache.read("rate-limit:security:hub_admin:#{@actor.id}")
    assert_no_difference("FreshAuthorization.count") do
      operations.each do |operation|
        operation.call
        assert_security_throttle(60)
      end
    end
    assert_not @target.reload.hub_admin?
    assert SharingSetting.enabled?
    assert Session.exists?(@session.id)
    assert_equal "idle", @configuration.reload.webhook_rotation_state
    assert_requested :patch, "#{GITHUB_API_URL}/app/hook/config", times: 1
  end

  test "ordinary users reach every normal administrator denial without spending a budget" do
    @actor.update!(hub_admin: false)
    @session.update!(fresh_authorized_at: nil)
    assert_no_difference("FreshAuthorization.count") do
      admin_operations.each do |operation|
        operation.call
        assert_response :forbidden
      end
    end
    assert_nil Rails.cache.read("rate-limit:security:hub_admin:#{@actor.id}")
    assert_not_requested :patch, "#{GITHUB_API_URL}/app/hook/config"
    assert_not_requested :get, "#{GITHUB_API_URL}/app"
  end

  test "administrator reads use the same nonced Hub policy without spending the mutation budget" do
    paths = [ hub_admins_path, edit_hub_admin_path(@target), sharing_settings_path,
      session_revocation_path, github_app_path, reset_github_app_path,
      edit_github_app_credentials_path, github_app_webhook_rotation_path, security_audit_path ]
    nonces = paths.map do |path|
      get path
      assert_response :success
      nonce = css_select("meta[name='csp-nonce']").first["content"]
      assert_equal \
        HubContentSecurityPolicy.build(development: false).build(Object.new, nonce, %w[script-src]),
        response.headers["Content-Security-Policy"]
      css_select("script").each { assert_equal nonce, _1["nonce"] }
      assert_select "script[nonce]", text: /SUPERGLUE_INITIAL_PAGE_STATE=/
      nonce
    end
    assert_equal paths.size, nonces.uniq.size
    assert_nil Rails.cache.read("rate-limit:security:hub_admin:#{@actor.id}")
  end

  test "a cutoff during GitHub verification blocks administrator admission and new Session issuance" do
    waiting = open_session
    waiting.post github_authentication_path
    state = Rack::Utils.parse_query(URI(waiting.response.location).query).fetch("state")
    stub_request(:get, "#{GITHUB_API_URL}/user").to_return do
      SessionRevocation.end_all!(actor: @actor, browser_session: @session)
      { status: 200, body: JSON.generate(id: @actor.github_id, login: "must-not-be-saved") }
    end
    waiting.get github_authentication_callback_path, params: { code: "code", state: }
    assert_empty Session.all
    assert_equal "octocat", @actor.reload.login
    assert_equal I18n.t("authentication.sessions_ended"), waiting.request.flash[:alert]
  end

  test "a cutoff during a fresh callback cannot fall through to login or renew proof" do
    @session.update!(fresh_authorized_at: nil)
    post github_app_webhook_rotation_path, params: confirmation.merge(operation: "start")
    challenge = FreshAuthorization.last
    post fresh_authorization_path(challenge.public_id)
    state = Rack::Utils.parse_query(URI(response.location).query).fetch("state")
    operator_session = @actor.sessions.create!(fresh_authorized_at: Time.current)
    stub_request(:get, "#{GITHUB_API_URL}/user").to_return do
      SessionRevocation.end_all!(actor: @actor, browser_session: operator_session)
      { status: 200, body: JSON.generate(id: @actor.github_id, login: @actor.login) }
    end
    get github_authentication_callback_path, params: { code: "code", state: }
    assert_empty Session.all
    assert_empty FreshAuthorization.all
    assert_equal I18n.t("fresh_authorization.failure"), flash[:alert]
    assert_not_requested :patch, "#{GITHUB_API_URL}/app/hook/config"
  end

  test "emergency recovery preserves a prior cutoff live credentials and sharing tombstones" do
    SharingSetting.change!(actor: @actor, browser_session: @session, operation: "enable")
    repository = repositories.create
    prototype = prototypes.create(repository:)
    build = builds.create_successful(prototype:)
    link = ShareLink.create_public!(prototype:, build:, created_by: @actor, label: "Review")
    SharingSetting.change!(actor: @actor, browser_session: @session, operation: "disable")
    SessionRevocation.end_all!(actor: @actor, browser_session: @session)
    sign_in
    fresh_session = @actor.sessions.sole
    generation = SessionRevocation.current.generation
    revision = SharingSetting.revision
    @configuration.administration.recover_credentials! \
      confirmation: GithubAppConfiguration::Administration::RECOVERY_PHRASE,
      client_secret: "replacement", private_key: github_app_configurations.test_private_key
    assert Session.exists?(fresh_session.id)
    assert_nil fresh_session.reload.fresh_authorized_at
    assert_equal generation, SessionRevocation.current.generation
    assert_equal revision, SharingSetting.revision
    assert_not SharingSetting.enabled?
    assert link.reload.revoked_at
    assert_not link.available?
  end

  private

  def admin_operations
    [
      -> { patch hub_admin_path(@target), params: { confirmed: "1", operation: "designate" }, as: :json },
      -> { patch sharing_settings_path, params: { confirmed: "1", operation: "enable" }, as: :json },
      -> { post github_app_webhook_rotation_path, params: confirmation.merge(operation: "start"), as: :json },
      -> { delete github_app_webhook_rotation_path, params: confirmation, as: :json },
      -> { patch github_app_credentials_path, params: confirmation.merge(private_key: "not-an-upload"), as: :json },
      -> { post session_revocation_path, as: :json },
      -> { delete github_app_path, params: confirmation.merge(confirmation: "wrong"), as: :json },
      -> { post copilot_connection_path, params: { confirmed: "1" }, as: :json },
      -> { delete copilot_connection_path, params: { confirmed: "1" }, as: :json }
    ]
  end

  def sign_in
    post github_authentication_path
    state = Rack::Utils.parse_query(URI(response.location).query).fetch("state")
    get github_authentication_callback_path, params: { code: "code", state: }
  end

  def confirmation
    @configuration.reload
    { confirmed: "1", configuration_id: @configuration.id.to_s,
      expected_version: @configuration.lock_version.to_s }
  end
end
