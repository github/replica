require "test_helper"

class GithubAppConfiguration::AdministrationTest < ActiveSupport::TestCase
  setup do
    @configuration = github_app_configurations.create_installed
    @actor = users.create(hub_admin: true)
    @session = sessions.create(user: @actor, fresh_authorized_at: Time.current)
    stub_request(:get, "#{GITHUB_API_URL}/app")
      .to_return(status: 200, body: JSON.generate(github_app_configurations.manifest_credentials))
  end

  test "credential replacement preserves data and live credentials but ends old proof" do
    repository = repositories.create
    grant = canvas_grant(repository)
    challenge = FreshAuthorization.start!(credential: @session, purpose: "github_app_credentials")
    enrollment, = HubAdminEnrollment.start!("manual", bootstrap_secret: "manual")
    original_id = @configuration.id
    replace_credentials

    assert_equal original_id, @configuration.reload.id
    assert_equal 2, @configuration.credential_revision
    assert_equal "replacement", @configuration.client_secret
    assert_equal 456, @configuration.installation_id
    assert Session.exists?(@session.id)
    assert_nil @session.reload.fresh_authorized_at
    assert_nil grant.reload.revoked_at
    assert_nil grant.fresh_authorized_at
    assert_not FreshAuthorization.exists?(challenge.id)
    assert_not HubAdminEnrollment.exists?(enrollment.id)
    assert_equal "active", repository.reload.installation_state
    assert @actor.reload.hub_admin?
    event = SecurityAuditEvent.where(action: "github_app.rotate_credentials").sole
    assert_equal @actor.id, event.user_id
    assert_not event.repository_scoped?
    assert_not_includes event.attributes.to_s, "replacement"
  end

  test "role loss and revoked Sessions while GitHub responds cannot commit replacement" do
    stub_request(:get, "#{GITHUB_API_URL}/app").to_return do
      @actor.update!(hub_admin: false)
      { status: 200, body: JSON.generate(github_app_configurations.manifest_credentials) }
    end
    assert_raises(GithubAppConfiguration::Administration::Denied) { replace_credentials }
    assert_equal "client-secret", @configuration.reload.client_secret
    @actor.update!(hub_admin: true)
    stub_request(:get, "#{GITHUB_API_URL}/app").to_return do
      @session.destroy!
      { status: 200, body: JSON.generate(github_app_configurations.manifest_credentials) }
    end
    assert_raises(GithubAppConfiguration::Administration::Denied) { replace_credentials }
    assert_equal "client-secret", @configuration.reload.client_secret
  end

  test "exactly five minute proof and stale state cannot commit" do
    @session.update!(fresh_authorized_at: 5.minutes.ago)
    assert_raises(FreshAuthorization::Invalid) { replace_credentials }
    assert_not_requested :get, "#{GITHUB_API_URL}/app"
    @session.update!(fresh_authorized_at: Time.current)
    @configuration.update!(owner_login: "renamed")
    assert_raises(GithubAppConfiguration::Administration::Denied) do
      @configuration.administration.replace_credentials! \
        **browser_options.merge(expected_version: 0),
        client_secret: "replacement", private_key: github_app_configurations.test_private_key
    end
  end

  test "an unchanged installation poll keeps an open credential confirmation valid" do
    confirmation = browser_options
    stub_github_installation_token
    stub_github_repositories([])
    @configuration.installation.record_status!(installation_payload)

    @configuration.administration.replace_credentials! \
      **confirmation,
      client_secret: "replacement", private_key: github_app_configurations.test_private_key

    assert_equal "replacement", @configuration.reload.client_secret
    assert_equal 2, @configuration.credential_revision
  end

  test "an installation state change invalidates an open credential confirmation" do
    confirmation = browser_options
    @configuration.installation.record_status!(installation_payload.merge("suspended_at" => Time.current.iso8601))

    error = assert_raises(GithubAppConfiguration::Administration::Denied) do
      @configuration.administration.replace_credentials! \
        **confirmation,
        client_secret: "replacement", private_key: github_app_configurations.test_private_key
    end

    assert_equal :state_changed, error.reason
    assert_equal "client-secret", @configuration.reload.client_secret
    assert_not_requested :get, "#{GITHUB_API_URL}/app"
  end

  test "uncertain webhook retry uses the same replacement and finish waits for confirmation" do
    stub_request(:patch, "#{GITHUB_API_URL}/app/hook/config").to_timeout
    assert_raises(GithubClient::Error) { rotate("start") }
    @configuration.reload
    replacement = @configuration.webhook_secret
    assert_equal "pending", @configuration.webhook_rotation_state
    assert_equal "webhook-secret", @configuration.previous_webhook_secret
    assert_nil @configuration.webhook_request_token
    assert_raises(GithubAppConfiguration::Administration::Denied) { finish }
    request = stub_request(:patch, "#{GITHUB_API_URL}/app/hook/config")
      .with { |http| JSON.parse(http.body).fetch("secret") == replacement }
      .to_return(status: 200, body: "{}")
    rotate("retry")
    assert_requested request, times: 2
    assert_equal "confirmed", @configuration.reload.webhook_rotation_state
    assert_equal replacement, @configuration.webhook_secret
    assert_equal "webhook-secret", @configuration.previous_webhook_secret
    finish
    assert_equal "idle", @configuration.reload.webhook_rotation_state
    assert_nil @configuration.previous_webhook_secret
    assert_equal replacement, @configuration.webhook_secret
  end

  test "a pending update cannot start a third secret and an active attempt blocks changes" do
    @configuration.update! \
      previous_webhook_secret: "previous", webhook_rotation_state: "pending",
      webhook_request_token: "attempt", webhook_request_expires_at: 1.minute.from_now
    original = @configuration.webhook_secret
    assert_raises(GithubAppConfiguration::Administration::Denied) { rotate("retry") }
    assert_raises(GithubAppConfiguration::Administration::Denied) { replace_credentials }
    @configuration.update!(webhook_request_expires_at: 1.second.ago)
    assert_raises(GithubAppConfiguration::Administration::Denied) { rotate("start") }
    assert_equal original, @configuration.reload.webhook_secret
    assert_not_requested :patch, "#{GITHUB_API_URL}/app/hook/config"
  end

  test "expiry or role loss during remote confirmation preserves both webhook secrets" do
    stub_request(:patch, "#{GITHUB_API_URL}/app/hook/config").to_return do
      GithubAppConfiguration.find(@configuration.id).update!(webhook_request_expires_at: Time.current)
      { status: 200, body: "{}" }
    end
    assert_raises(GithubAppConfiguration::Administration::Denied) { rotate("start") }
    replacement = @configuration.reload.webhook_secret
    assert_equal "pending", @configuration.webhook_rotation_state
    assert_equal "webhook-secret", @configuration.previous_webhook_secret
    assert_nil @configuration.webhook_request_token
    stub_request(:patch, "#{GITHUB_API_URL}/app/hook/config").to_return do
      @actor.update!(hub_admin: false)
      { status: 200, body: "{}" }
    end
    assert_raises(GithubAppConfiguration::Administration::Denied) { rotate("retry") }
    assert_equal replacement, @configuration.reload.webhook_secret
    assert_equal "pending", @configuration.webhook_rotation_state
    assert_equal "webhook-secret", @configuration.previous_webhook_secret
    assert_empty SecurityAuditEvent.where(action: "github_app.rotate_webhook_secret")
  end

  test "emergency repair retains the cutoff and sharing tombstones without renewing live credentials" do
    repository = repositories.create
    prototype = prototypes.create(repository:)
    build = builds.create_successful(prototype:)
    review = review_for(build)
    original_review = review.attributes
    SharingSetting.change!(actor: @actor, browser_session: @session, operation: "enable")
    link = ShareLink.create_public!(prototype:, build:, created_by: @actor, label: "Old review")
    SharingSetting.change!(actor: @actor, browser_session: @session, operation: "disable")
    SessionRevocation.end_all!(actor: @actor, browser_session: @session)
    live_session = sessions.create(user: @actor, fresh_authorized_at: Time.current)
    grant = canvas_grant(repository)
    generation = SessionRevocation.current.generation
    ended_at = SessionRevocation.current.ended_at
    sharing_revision = SharingSetting.revision
    audits = SecurityAuditEvent.count
    @configuration.administration.recover_credentials! \
      confirmation: GithubAppConfiguration::Administration::RECOVERY_PHRASE,
      client_secret: "replacement", private_key: github_app_configurations.test_private_key
    assert_equal generation, SessionRevocation.current.generation
    assert_equal ended_at, SessionRevocation.current.ended_at
    assert Session.exists?(live_session.id)
    assert_nil live_session.reload.fresh_authorized_at
    assert_nil grant.reload.revoked_at
    assert_nil grant.fresh_authorized_at
    assert @actor.reload.hub_admin?
    assert Build.exists?(build.id)
    assert_equal original_review, review.reload.attributes
    assert_equal "active", repository.reload.installation_state
    assert_not SharingSetting.enabled?
    assert_equal sharing_revision, SharingSetting.revision
    assert link.reload.revoked_at
    assert_equal audits + 1, SecurityAuditEvent.count
  end

  test "GitHub I/O occurs outside transactions and audit failure leaves safe pending overlap" do
    stub_request(:patch, "#{GITHUB_API_URL}/app/hook/config").to_return do
      assert_equal 1, ActiveRecord::Base.connection.open_transactions
      { status: 200, body: "{}" }
    end
    Current.security_audit_context = { raw_payload: "not allowed" }
    assert_raises(ActiveRecord::RecordInvalid) { rotate("start") }
    assert_equal "pending", @configuration.reload.webhook_rotation_state
    assert_equal "webhook-secret", @configuration.previous_webhook_secret
    assert @configuration.webhook_request_expires_at
  ensure
    Current.reset
  end

  test "emergency repair uses only candidate credentials without an administrator or OAuth" do
    @configuration.update!(private_key: "broken-stored-key", client_secret: "broken-stored-secret")
    @actor.update!(hub_admin: false)
    original_secret = ENV.delete("REPLICA_BOOTSTRAP_SECRET")
    Current.session = @session
    Current.security_audit_context = { source: "browser", ip_address: "192.0.2.1" }
    @configuration.administration.recover_credentials! \
      confirmation: GithubAppConfiguration::Administration::RECOVERY_PHRASE,
      client_secret: "replacement", private_key: github_app_configurations.test_private_key
    assert_equal "replacement", @configuration.reload.client_secret
    assert_not @actor.reload.hub_admin?
    assert Session.exists?(@session.id)
    event = SecurityAuditEvent.where(action: "github_app.recover_credentials").sole
    assert_nil event.user_id
    assert_equal "command", event.context.fetch("source")
    assert_not event.context.key?("session_id")
    assert_nil event.ip_address
    assert_not_requested :post, "#{GITHUB_URL}/login/oauth/access_token"
  ensure
    ENV["REPLICA_BOOTSTRAP_SECRET"] = original_secret
    Current.reset
  end

  test "an outage or changed configuration during candidate verification cannot save credentials" do
    before = @configuration.attributes
    stub_request(:get, "#{GITHUB_API_URL}/app").to_return(status: 503, body: JSON.generate(message: "private-provider-detail"))
    assert_raises(GithubClient::Error) do
      @configuration.administration.recover_credentials! \
        confirmation: GithubAppConfiguration::Administration::RECOVERY_PHRASE,
        client_secret: "replacement", private_key: github_app_configurations.test_private_key
    end
    assert_equal before, @configuration.reload.attributes
    assert FreshAuthorization.fresh?(@session)
    stub_request(:get, "#{GITHUB_API_URL}/app").to_return do
      GithubAppConfiguration.find(@configuration.id).update!(owner_login: "renamed")
      { status: 200, body: JSON.generate(github_app_configurations.manifest_credentials) }
    end
    error = assert_raises(GithubAppConfiguration::Administration::Denied) do
      @configuration.administration.recover_credentials! \
        confirmation: GithubAppConfiguration::Administration::RECOVERY_PHRASE,
        client_secret: "replacement", private_key: github_app_configurations.test_private_key
    end
    assert_equal :state_changed, error.reason
    assert_equal "client-secret", @configuration.reload.client_secret
    assert_equal 1, @configuration.credential_revision
    assert_equal "active", @configuration.installation_state
    assert FreshAuthorization.fresh?(@session)
    assert_empty SecurityAuditEvent.where(action: "github_app.recover_credentials")
  end

  test "a failed emergency audit retains credentials and fresh proof" do
    connection = ActiveRecord::Base.connection
    connection.execute <<~SQL
      CREATE TEMP TRIGGER reject_recovery_audit BEFORE INSERT ON security_audit_events
      WHEN NEW.action = 'github_app.recover_credentials'
      BEGIN
        SELECT RAISE(ABORT, 'synthetic audit failure');
      END
    SQL
    assert_raises(ActiveRecord::StatementInvalid) do
      @configuration.administration.recover_credentials! \
        confirmation: GithubAppConfiguration::Administration::RECOVERY_PHRASE,
        client_secret: "replacement", private_key: github_app_configurations.test_private_key
    end
    assert_equal "client-secret", @configuration.reload.client_secret
    assert_equal 1, @configuration.credential_revision
    assert FreshAuthorization.fresh?(@session)
    assert_empty SecurityAuditEvent.where(action: "github_app.recover_credentials")
  ensure
    connection&.execute("DROP TRIGGER IF EXISTS reject_recovery_audit")
  end

  test "reset retains collaboration and audit but invalidates access and stale synchronization" do
    SharingSetting.change!(actor: @actor, browser_session: @session, operation: "enable")
    repository = repositories.create
    prototype = prototypes.create(repository:)
    build = builds.create_successful(prototype:)
    review = review_for(build)
    original_review = review.attributes
    revoked_link = ShareLink.create_public!(prototype:, build:, created_by: @actor, label: "Old review")
    SharingSetting.change!(actor: @actor, browser_session: @session, operation: "disable")
    SharingSetting.change!(actor: @actor, browser_session: @session, operation: "enable")
    link = ShareLink.create_public!(prototype:, build:, created_by: @actor, label: "Review")
    grant = canvas_grant(repository)
    PreviewGrant.issue!(build:, session: @session, return_path: "/")
    SharePreviewGrant.issue!(share_link: link)
    CanvasPairing.start!(repository)
    FreshAuthorization.start!(credential: @session, purpose: "github_app_reset")
    HubAdminEnrollment.start!("manual", bootstrap_secret: "manual")
    original_secret = ENV["REPLICA_BOOTSTRAP_SECRET"]
    generation = SessionRevocation.current.generation
    sharing_revision = SharingSetting.revision
    ENV["REPLICA_BOOTSTRAP_SECRET"] = "manual"
    @configuration.administration.reset! \
      **browser_options, confirmation: GithubAppConfiguration::Administration::RESET_PHRASE
    assert_not GithubAppConfiguration.exists?(@configuration.id)
    assert_empty Session.all
    assert_empty PreviewGrant.all
    assert_empty CanvasPairing.all
    assert_empty FreshAuthorization.all
    assert_empty HubAdminEnrollment.all
    assert_equal generation + 1, SessionRevocation.current.generation
    assert SharingSetting.enabled?
    assert_equal sharing_revision, SharingSetting.revision
    assert_equal 1, SharePreviewGrant.count
    assert grant.reload.revoked_at
    assert_equal "removed", repository.reload.installation_state
    assert @actor.reload.hub_admin?
    assert Build.exists?(build.id)
    assert_equal original_review, review.reload.attributes
    assert ShareLink.exists?(link.id)
    assert_not link.reload.available?
    event = SecurityAuditEvent.where(action: "github_app.reset").sole
    assert_equal @actor.id, event.user_id
    assert_raises(GithubAppConfiguration::Superseded) { @configuration.repositories.remove_all! }
    github_app_configurations.create_installed
    assert_nil ShareLink.find_available(link.public_id)
    repository.update!(installation_state: "active", removed_at: nil)
    assert ShareLink.find_available(link.public_id)
    assert_nil ShareLink.find_available(revoked_link.public_id)
    assert revoked_link.reload.revoked_at
    assert_equal sharing_revision, SharingSetting.revision
  ensure
    ENV["REPLICA_BOOTSTRAP_SECRET"] = original_secret
  end

  test "a failed reset audit rolls back configuration and credential invalidation together" do
    repository = repositories.create
    grant = canvas_grant(repository)
    original = ENV["REPLICA_BOOTSTRAP_SECRET"]
    ENV["REPLICA_BOOTSTRAP_SECRET"] = "manual"
    Current.security_audit_context = { raw_payload: "not allowed" }
    assert_raises(ActiveRecord::RecordInvalid) do
      @configuration.administration.reset! \
        **browser_options, confirmation: GithubAppConfiguration::Administration::RESET_PHRASE
    end
    assert GithubAppConfiguration.exists?(@configuration.id)
    assert Session.exists?(@session.id)
    assert_nil grant.reload.revoked_at
    assert_equal "active", repository.reload.installation_state
    assert_equal 0, SessionRevocation.current.generation
  ensure
    ENV["REPLICA_BOOTSTRAP_SECRET"] = original
    Current.reset
  end

  test "late webhook completion cannot overwrite a newer attempt" do
    stub_request(:patch, "#{GITHUB_API_URL}/app/hook/config").to_return do
      GithubAppConfiguration.find(@configuration.id).update! \
        webhook_request_token: "newer-attempt", webhook_request_expires_at: 1.minute.from_now
      { status: 200, body: "{}" }
    end
    assert_raises(GithubAppConfiguration::Administration::Denied) { rotate("start") }
    assert_equal "pending", @configuration.reload.webhook_rotation_state
    assert_equal "newer-attempt", @configuration.webhook_request_token
    assert_equal "webhook-secret", @configuration.previous_webhook_secret
  end

  private

  def installation_payload
    {
      "id" => 456,
      "app_id" => 123,
      "account" => { "id" => 321, "login" => "github", "type" => "Organization" }
    }
  end

  def review_for(build)
    ReviewComment.create!(prototype: build.prototype, build:, user: @actor,
      body: "Retained synthetic review",
      anchor: {
        schemaVersion: 1, kind: "element",
        route: { pathname: "/", search: "", hash: "" },
        selector: "#save", accessibleName: "Save", tagName: "button", selectedText: "",
        rect: { x: 20, y: 30, width: 100, height: 32 },
        viewport: { width: 1280, height: 720, scrollX: 0, scrollY: 0 },
        elementOffset: { x: 0.5, y: 0.5 }
      })
  end

  def browser_options
    { actor: @actor, browser_session: @session, expected_version: @configuration.lock_version }
  end

  def replace_credentials
    @configuration.administration.replace_credentials! \
      **browser_options, client_secret: "replacement", private_key: github_app_configurations.test_private_key
  end

  def rotate(operation)
    @configuration.administration.rotate_webhook!(**browser_options, operation:)
  end

  def finish
    @configuration.administration.finish_webhook!(**browser_options)
  end

  def canvas_grant(repository)
    CanvasGrant.create! \
      repository:, user: @actor, token_digest: Digest::SHA256.hexdigest("canvas-token"),
      expires_at: 1.day.from_now, fresh_authorized_at: Time.current
  end
end
