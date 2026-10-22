require "test_helper"
require "tempfile"
require_relative "../support/authorization_continuation_helpers"

class GithubAppAdministrationTest < ActionDispatch::IntegrationTest
  include AuthorizationContinuationHelpers

  setup do
    @configuration = github_app_configurations.create_installed
    @actor = users.create(hub_admin: true)
    stub_github_oauth_user
    post github_authentication_path
    state = Rack::Utils.parse_query(URI(response.location).query).fetch("state")
    get github_authentication_callback_path, params: { code: "code", state: }
    @session = @actor.sessions.sole
    stub_request(:get, "#{GITHUB_API_URL}/app")
      .to_return(status: 200, body: JSON.generate(github_app_configurations.manifest_credentials))
  end

  test "App administration without repository access exposes no saved credentials" do
    get github_app_path, as: :json
    assert_response :success
    assert_equal @configuration.id, data.fetch("configurationId")
    assert_equal "private, no-store", response.headers["Cache-Control"]
    [ "client-secret", "webhook-secret", github_app_configurations.test_private_key ].each do |secret|
      assert_not_includes response.body, secret
    end
    assert_not_requested :get, "#{GITHUB_API_URL}/app"
    get edit_github_app_credentials_path, as: :json
    assert_equal "patch", data.fetch("form").fetch("method")
    assert_not data.fetch("form").fetch("credentials").key?("value")
    get github_app_webhook_rotation_path, as: :json
    assert_equal "post", data.fetch("form").fetch("method")
    get reset_github_app_path, as: :json
    assert_equal "delete", data.fetch("form").fetch("method")
    get security_audit_path, as: :json
    assert_equal github_app_path, data.fetch("githubAppPath")
  end

  test "ordinary and removed administrators cannot view App data or create challenges" do
    @actor.update!(hub_admin: false)
    @session.update!(fresh_authorized_at: nil)
    assert_no_difference("FreshAuthorization.count") do
      get github_app_path, as: :json
      assert_response :forbidden
      patch github_app_credentials_path, params: confirmation.merge(client_secret: "never-store-this")
      assert_response :forbidden
    end
    assert_not_includes response.body, @configuration.client_id
    assert_not_requested :get, "#{GITHUB_API_URL}/app"
  end

  test "stale proof continues the saved replacement credentials and upload" do
    @session.update!(fresh_authorized_at: 5.minutes.ago)
    Tempfile.create([ "replacement", ".pem" ], Rails.root.join("storage")) do |key|
      key.write(github_app_configurations.test_private_key)
      key.flush
      patch github_app_credentials_path, params: confirmation.merge(
        client_secret: "replacement-client-secret",
        private_key: Rack::Test::UploadedFile.new(key.path, "application/x-pem-file")
      )
    end
    challenge = FreshAuthorization.last
    assert_redirected_to fresh_authorization_path(challenge.public_id)
    form = verify_pending_action(challenge, path: github_app_credentials_path, method: "patch")
    assert_equal "client-secret", @configuration.reload.client_secret
    new_tempfile = Tempfile.method(:new)
    Tempfile.define_singleton_method(:new) do |*|
      raise Minitest::Assertion, "Continuation must not create a temporary file"
    end
    continue_pending_action(form)
    assert_redirected_to github_app_path
    assert_equal "replacement-client-secret", @configuration.reload.client_secret
    assert_equal github_app_configurations.test_private_key, @configuration.private_key
    assert_equal I18n.t("github_app.credentials.saved"), flash[:notice]
    assert_not FreshAuthorization.exists?(challenge.id)
  ensure
    Tempfile.define_singleton_method(:new, new_tempfile) if new_tempfile
  end

  test "confirmed server-side webhook start and finish are separately authorized" do
    stub_request(:patch, "#{GITHUB_API_URL}/app/hook/config").to_return(status: 200, body: "{}")
    @session.update!(fresh_authorized_at: nil)
    post github_app_webhook_rotation_path, params: confirmation.merge(operation: "start")
    form = verify_pending_action(FreshAuthorization.last, path: github_app_webhook_rotation_path, method: "post")
    continue_pending_action(form)
    assert_redirected_to github_app_webhook_rotation_path
    assert_equal "confirmed", @configuration.reload.webhook_rotation_state
    event = SecurityAuditEvent.where(action: "github_app.rotate_webhook_secret").last
    assert_equal @actor.id, event.user_id
    assert_equal "browser", event.context.fetch("source")
    @session.update!(fresh_authorized_at: 5.minutes.ago)
    delete github_app_webhook_rotation_path, params: confirmation
    assert_equal "github_app_finish_webhook", FreshAuthorization.last.purpose
    assert @configuration.reload.previous_webhook_secret
    form = verify_pending_action(FreshAuthorization.last, path: github_app_webhook_rotation_path, method: "delete")
    continue_pending_action(form)
    assert_nil @configuration.reload.previous_webhook_secret
    assert_equal "idle", @configuration.webhook_rotation_state
    assert_equal I18n.t("github_app.webhook.finished"), flash[:notice]
  end

  test "an App version conflict is reported after verification and consumes the saved reset" do
    original = ENV["REPLICA_BOOTSTRAP_SECRET"]
    ENV["REPLICA_BOOTSTRAP_SECRET"] = "manual"
    @session.update!(fresh_authorized_at: nil)
    delete github_app_path, params: confirmation.merge(
      confirmation: GithubAppConfiguration::Administration::RESET_PHRASE
    )
    challenge = FreshAuthorization.last
    form = verify_pending_action(challenge, path: github_app_path, method: "delete")
    @configuration.update!(webhook_secret: "changed-after-verification")
    continue_pending_action(form, expected_version: @configuration.lock_version.to_s)
    assert GithubAppConfiguration.exists?(@configuration.id)
    assert Session.exists?(@session.id)
    assert_equal I18n.t("github_app.errors.state_changed"), flash[:alert]
    assert_nil challenge.reload.pending_action
    assert challenge.continued_at
  ensure
    ENV["REPLICA_BOOTSTRAP_SECRET"] = original
  end

  test "replacement upload saves encrypted credentials and returns only a safe notice" do
    Tempfile.create([ "replacement", ".pem" ]) do |key|
      key.write(github_app_configurations.test_private_key)
      key.flush
      patch github_app_credentials_path, params: confirmation.merge(
        client_secret: "new-client-secret",
        private_key: Rack::Test::UploadedFile.new(key.path, "application/x-pem-file")
      )
    end
    assert_redirected_to github_app_path
    assert_equal "new-client-secret", @configuration.reload.client_secret
    assert_equal I18n.t("github_app.credentials.saved"), flash[:notice]
    assert_not_includes flash.to_hash.to_s, "new-client-secret"
    assert_nil @session.reload.fresh_authorized_at
    get github_app_path, as: :json
    assert_not_includes response.body, "new-client-secret"
  end

  test "App mutations retain browser forgery protection" do
    previous = ActionController::Base.allow_forgery_protection
    @session.update!(fresh_authorized_at: nil)
    post github_app_webhook_rotation_path, params: confirmation.merge(operation: "start")
    challenge = FreshAuthorization.last
    form = verify_pending_action(challenge, path: github_app_webhook_rotation_path, method: "post")
    ActionController::Base.allow_forgery_protection = true
    continue_pending_action(form)
    assert_response :unprocessable_entity
    assert_equal "idle", @configuration.reload.webhook_rotation_state
    assert challenge.reload.pending_action
  ensure
    ActionController::Base.allow_forgery_protection = previous
  end

  test "App reset checks exact confirmation and bootstrap readiness before destruction" do
    delete github_app_path, params: confirmation.merge(confirmation: "wrong")
    assert_equal I18n.t("github_app.errors.confirmation_required"), flash[:alert]
    original = ENV.delete("REPLICA_BOOTSTRAP_SECRET")
    delete github_app_path, params: confirmation.merge(
      confirmation: GithubAppConfiguration::Administration::RESET_PHRASE
    )
    assert_equal I18n.t("github_app.errors.bootstrap_missing"), flash[:alert]
    assert GithubAppConfiguration.exists?(@configuration.id)
    assert Session.exists?(@session.id)
  ensure
    ENV["REPLICA_BOOTSTRAP_SECRET"] = original
  end

  test "unconfirmed changes and invalid secret errors never leak input or call GitHub" do
    patch github_app_credentials_path, params: { client_secret: "never-store-this" }
    assert_equal I18n.t("github_app.errors.confirmation_required"), flash[:alert]
    patch github_app_credentials_path,
      params: confirmation.merge(client_secret: "never-store-this", private_key: github_app_configurations.test_private_key)
    assert_equal I18n.t("github_app.errors.invalid_credentials"), flash[:alert]
    assert_not_includes flash.to_hash.to_s, "never-store-this"
    assert_not_requested :get, "#{GITHUB_API_URL}/app"
  end

  test "reset signs out users and retains roles without changing the remote App" do
    original = ENV["REPLICA_BOOTSTRAP_SECRET"]
    ENV["REPLICA_BOOTSTRAP_SECRET"] = "manual"
    @session.update!(fresh_authorized_at: nil)
    delete github_app_path, params: confirmation.merge(
      confirmation: GithubAppConfiguration::Administration::RESET_PHRASE
    )
    form = verify_pending_action(FreshAuthorization.last, path: github_app_path, method: "delete")
    continue_pending_action(form)
    assert_redirected_to root_path
    assert_empty Session.all
    assert @actor.reload.hub_admin?
    assert_not GithubAppConfiguration.exists?(@configuration.id)
    assert_equal "succeeded", SecurityAuditEvent.where(action: "github_app.reset").last.outcome
    get github_app_path
    assert_redirected_to root_path
    assert_not_requested :delete, %r{https://api\.github\.com/}
  ensure
    ENV["REPLICA_BOOTSTRAP_SECRET"] = original
  end

  test "new credentials invalidate an already started ordinary sign-in" do
    post github_authentication_path
    state = Rack::Utils.parse_query(URI(response.location).query).fetch("state")
    @configuration.administration.recover_credentials! \
      confirmation: GithubAppConfiguration::Administration::RECOVERY_PHRASE,
      client_secret: "replacement", private_key: github_app_configurations.test_private_key
    assert_no_difference("Session.count") do
      get github_authentication_callback_path, params: { code: "code", state: }
    end
    assert_redirected_to root_path
    assert_equal I18n.t("authentication.failure"), flash[:alert]
  end

  test "failed live notification reports the committed reset rather than a rollback" do
    original = ENV["REPLICA_BOOTSTRAP_SECRET"]
    ENV["REPLICA_BOOTSTRAP_SECRET"] = "manual"
    server = ActionCable.server
    broadcast = server.method(:broadcast)
    server.define_singleton_method(:broadcast) { |*_arguments| raise IOError, "private transport detail" }
    delete github_app_path, params: confirmation.merge(
      confirmation: GithubAppConfiguration::Administration::RESET_PHRASE
    )
    assert_redirected_to root_path
    assert_equal I18n.t("github_app.reset.disconnect_failed"), flash[:alert]
    assert_not_includes response.body, "private transport detail"
    assert_not GithubAppConfiguration.exists?(@configuration.id)
    assert_empty Session.all
    assert_equal "succeeded", SecurityAuditEvent.where(action: "github_app.reset").sole.outcome
    assert_equal "failed", SecurityAuditEvent.where(action: "github_app.reset_disconnect").sole.outcome
    assert_equal 1, SessionRevocation.current.generation
  ensure
    server&.define_singleton_method(:broadcast, broadcast) if broadcast
    ENV["REPLICA_BOOTSTRAP_SECRET"] = original
  end

  test "changed credentials during OAuth cannot issue a new browser Session" do
    post github_authentication_path
    state = Rack::Utils.parse_query(URI(response.location).query).fetch("state")
    stub_request(:get, "#{GITHUB_API_URL}/user").to_return do
      GithubAppConfiguration.find(@configuration.id).update!(credential_revision: 2)
      { status: 200, body: JSON.generate(id: @actor.github_id, login: @actor.login) }
    end
    assert_no_difference("Session.count") do
      get github_authentication_callback_path, params: { code: "code", state: }
    end
    assert_redirected_to root_path
    assert_equal I18n.t("authentication.failure"), flash[:alert]
  end

  test "fresh App callback cannot restore proof after credential recovery" do
    @session.update!(fresh_authorized_at: nil)
    post github_app_webhook_rotation_path, params: confirmation.merge(operation: "start")
    challenge = FreshAuthorization.last
    post fresh_authorization_path(challenge.public_id)
    state = Rack::Utils.parse_query(URI(response.location).query).fetch("state")
    @configuration.administration.recover_credentials! \
      confirmation: GithubAppConfiguration::Administration::RECOVERY_PHRASE,
      client_secret: "replacement", private_key: github_app_configurations.test_private_key

    get github_authentication_callback_path, params: { code: "code", state: }
    assert_redirected_to root_path
    assert_not FreshAuthorization.fresh?(@session)
    assert_not FreshAuthorization.exists?(challenge.id)
    assert_not_requested :patch, "#{GITHUB_API_URL}/app/hook/config"
  end

  test "role removal during an App authorization callback cannot renew proof" do
    @session.update!(fresh_authorized_at: nil)
    post github_app_webhook_rotation_path, params: confirmation.merge(operation: "start")
    post fresh_authorization_path(FreshAuthorization.last.public_id)
    state = Rack::Utils.parse_query(URI(response.location).query).fetch("state")
    @actor.update!(hub_admin: false)
    get github_authentication_callback_path, params: { code: "code", state: }
    assert_not FreshAuthorization.fresh?(@session)
    assert_redirected_to root_path
  end

  test "App revision changes during browser and canvas verification cannot renew either credential" do
    repository = repositories.create
    grant = CanvasGrant.create! \
      user: @actor, repository:, token_digest: Digest::SHA256.hexdigest("synthetic-canvas"),
      expires_at: 1.day.from_now
    [ @session, grant ].each do |credential|
      credential.update!(fresh_authorized_at: nil)
      challenge = FreshAuthorization.start!(credential:, purpose: "never_expiring_share")
      post fresh_authorization_path(challenge.public_id)
      state = Rack::Utils.parse_query(URI(response.location).query).fetch("state")
      stub_request(:get, "#{GITHUB_API_URL}/user").to_return do
        configuration = GithubAppConfiguration.find(@configuration.id)
        configuration.update!(credential_revision: configuration.credential_revision + 1)
        { status: 200, body: JSON.generate(id: @actor.github_id, login: @actor.login) }
      end
      assert_no_difference("Session.count") do
        get github_authentication_callback_path, params: { code: "code", state: }
      end
      assert_redirected_to root_path
      assert_equal I18n.t("fresh_authorization.failure"), flash[:alert]
      assert_not FreshAuthorization.fresh?(credential)
      assert_nil challenge.reload.verified_at
      %i[github_oauth_state github_oauth_verifier github_oauth_started_at
        github_oauth_generation github_oauth_configuration_id github_oauth_credential_revision
        fresh_authorization_id].each { |key| assert_nil request.session[key] }
    end
  end

  private

  def confirmation
    @configuration.reload
    { confirmed: "1", configuration_id: @configuration.id.to_s,
      expected_version: @configuration.lock_version.to_s }
  end

  def data
    JSON.parse(response.body).fetch("data")
  end
end
