require "test_helper"

# Uses committed records and distinct connections to check issuance ordering.
class GithubAppAdministrationConcurrencyTest < ActiveSupport::TestCase
  self.use_transactional_tests = false

  setup do
    @configuration = github_app_configurations.create
    @actor = users.create(github_id: 9901, login: "app-admin", hub_admin: true)
    @session = sessions.create(user: @actor, fresh_authorized_at: Time.current)
  end

  teardown do
    SecurityAuditEvent.where(user_id: @actor.id)
      .or(SecurityAuditEvent.where("json_extract(context, '$.github_app_configuration_id') = ?", @configuration.id))
      .delete_all
    GithubAppConfiguration.where(id: @configuration.id).delete_all
    Session.where(user_id: @actor.id).delete_all
    User.where(id: @actor.id).delete_all
    SessionRevocation.delete_all
  end

  test "simultaneous starts reserve only one replacement and remote attempt" do
    ready = Queue.new
    start = Queue.new
    dispatch = Queue.new
    finish = Queue.new
    stub_request(:patch, "#{GITHUB_API_URL}/app/hook/config").to_return do
      assert_not ActiveRecord::Base.connection.transaction_open?
      dispatch << true
      finish.pop
      { status: 200, body: "{}" }
    end
    attempts = 2.times.map do
      Thread.new do
        ActiveRecord::Base.connection_pool.with_connection do
          configuration = GithubAppConfiguration.find(@configuration.id)
          ready << true
          start.pop
          configuration.administration.rotate_webhook! \
            actor: @actor, browser_session: @session,
            expected_version: 0, operation: "start"
          :succeeded
        rescue GithubAppConfiguration::Administration::Denied
          :denied
        end
      end
    end
    2.times { wait_for(ready) }
    2.times { start << true }
    wait_for(dispatch)
    2.times { finish << true }
    assert_equal [ :denied, :succeeded ], attempts.map(&:value).sort
    assert_requested :patch, "#{GITHUB_API_URL}/app/hook/config", times: 1
    assert_equal "webhook-secret", @configuration.reload.previous_webhook_secret
    assert_equal 1, SecurityAuditEvent.where(action: "github_app.rotate_webhook_secret").count
  ensure
    finish << true if finish
    2.times { start << true } if start
    attempts&.each(&:join)
  end

  test "replacement waiting behind role removal sees the committed normal role" do
    revoked = Queue.new
    attempted = Queue.new
    finish = Queue.new
    revocation = Thread.new do
      ActiveRecord::Base.connection_pool.with_connection do
        User.transaction do
          @actor.update!(hub_admin: false)
          revoked << true
          finish.pop
        end
      end
    end
    wait_for(revoked)
    replacement = Thread.new do
      ActiveRecord::Base.connection_pool.with_connection do
        attempted << true
        GithubAppConfiguration.find(@configuration.id).administration.replace_credentials! \
          actor: @actor, browser_session: @session, expected_version: 0,
          client_secret: "replacement", private_key: github_app_configurations.test_private_key
        :succeeded
      rescue GithubAppConfiguration::Administration::Denied => error
        error.reason
      end
    end
    wait_for(attempted)
    finish << true
    revocation.value
    assert_equal :not_authorized, replacement.value
    assert_equal "client-secret", @configuration.reload.client_secret
    assert_not_requested :get, "#{GITHUB_API_URL}/app"
  ensure
    finish << true if finish
    [ revocation, replacement ].compact.each(&:join)
  end

  test "a Session revoked during candidate verification cannot commit replacement" do
    dispatch = Queue.new
    finish = Queue.new
    stub_request(:get, "#{GITHUB_API_URL}/app").to_return do
      assert_not ActiveRecord::Base.connection.transaction_open?
      dispatch << true
      finish.pop
      { status: 200, body: JSON.generate(github_app_configurations.manifest_credentials) }
    end
    replacement = Thread.new do
      ActiveRecord::Base.connection_pool.with_connection do
        GithubAppConfiguration.find(@configuration.id).administration.replace_credentials! \
          actor: @actor, browser_session: @session, expected_version: 0,
          client_secret: "replacement", private_key: github_app_configurations.test_private_key
        :succeeded
      rescue GithubAppConfiguration::Administration::Denied => error
        error.reason
      end
    end
    wait_for(dispatch)
    Session.find(@session.id).destroy!
    finish << true
    assert_equal :not_authorized, replacement.value
    assert_equal "client-secret", @configuration.reload.client_secret
    assert_empty SecurityAuditEvent.where(action: "github_app.rotate_credentials")
  ensure
    finish << true if finish
    replacement&.join
  end

  test "recovery after an abandoned lease preserves overlap and rejects late completion" do
    dispatch = Queue.new
    finish = Queue.new
    stub_request(:patch, "#{GITHUB_API_URL}/app/hook/config").to_return do
      dispatch << true
      finish.pop
      { status: 200, body: "{}" }
    end
    rotation = Thread.new do
      ActiveRecord::Base.connection_pool.with_connection do
        GithubAppConfiguration.find(@configuration.id).administration.rotate_webhook! \
          actor: @actor, browser_session: @session, expected_version: 0, operation: "start"
        :succeeded
      rescue GithubAppConfiguration::Administration::Denied => error
        error.reason
      end
    end
    wait_for(dispatch)
    @configuration.reload
    replacement = @configuration.webhook_secret
    @configuration.update!(webhook_request_expires_at: 1.second.ago)
    stub_request(:get, "#{GITHUB_API_URL}/app")
      .to_return(status: 200, body: JSON.generate(github_app_configurations.manifest_credentials))
    @configuration.administration.recover_credentials! \
      confirmation: GithubAppConfiguration::Administration::RECOVERY_PHRASE,
      client_secret: "replacement", private_key: github_app_configurations.test_private_key

    finish << true
    assert_equal :state_changed, rotation.value
    assert_equal "pending", @configuration.reload.webhook_rotation_state
    assert_equal replacement, @configuration.webhook_secret
    assert_equal "webhook-secret", @configuration.previous_webhook_secret
    assert_nil @configuration.webhook_request_token
    assert_equal 2, @configuration.credential_revision
    assert_empty SecurityAuditEvent.where(action: "github_app.rotate_webhook_secret")
  ensure
    finish << true if finish
    rotation&.join
  end

  test "reset serialized behind OAuth issuance still removes the newly issued Session" do
    issued = Queue.new
    attempted = Queue.new
    finish = Queue.new
    snapshot = @configuration.credential_snapshot
    generation = SessionRevocation.current.generation
    connection_ids = Queue.new
    original = ENV["REPLICA_BOOTSTRAP_SECRET"]
    ENV["REPLICA_BOOTSTRAP_SECRET"] = "manual"
    issuance = Thread.new do
      ActiveRecord::Base.connection_pool.with_connection do |connection|
        connection_ids << connection.object_id
        SessionRevocation.with_generation!(generation) do
          GithubAppConfiguration.with_credentials!(**snapshot) do
            Session.create!(user: @actor, fresh_authorized_at: Time.current)
            issued << true
            finish.pop
          end
        end
      end
    end
    wait_for(issued)
    reset = Thread.new do
      ActiveRecord::Base.connection_pool.with_connection do |connection|
        connection_ids << connection.object_id
        attempted << true
        GithubAppConfiguration.find(@configuration.id).administration.reset! \
          actor: @actor, browser_session: @session, expected_version: 0,
          confirmation: GithubAppConfiguration::Administration::RESET_PHRASE
      end
    end
    wait_for(attempted)
    finish << true
    issuance.value
    reset.value
    assert_equal 2, 2.times.map { connection_ids.pop }.uniq.length
    assert_equal generation + 1, SessionRevocation.current.generation
    assert_empty Session.where(user: @actor)
    assert_not GithubAppConfiguration.exists?(@configuration.id)
    assert_raises(GithubAppConfiguration::Superseded) do
      GithubAppConfiguration.with_credentials!(**snapshot) { Session.create!(user: @actor) }
    end
  ensure
    finish << true if finish
    [ issuance, reset ].compact.each(&:join)
    ENV["REPLICA_BOOTSTRAP_SECRET"] = original
  end

  %w[browser host].each do |entrypoint|
    test "#{entrypoint} credential replacement survives an unchanged poll during key verification" do
      @configuration.update! \
        installation_id: 456, installation_account_github_id: 321,
        installation_state: "active", installed_at: Time.current
      version = @configuration.lock_version
      dispatch = Queue.new
      finish = Queue.new
      connections = Queue.new
      stub_github_installation_token
      stub_github_repositories([])
      stub_request(:get, "#{GITHUB_API_URL}/app").to_return do
        assert_not ApplicationRecord.connection.transaction_open?
        dispatch << true
        wait_for(finish)
        { status: 200, body: JSON.generate(github_app_configurations.manifest_credentials) }
      end
      replacement = Thread.new do
        ApplicationRecord.connection_pool.with_connection do |connection|
          connections << connection.object_id
          administration = GithubAppConfiguration.find(@configuration.id).administration
          credentials = { client_secret: "replacement", private_key: github_app_configurations.test_private_key }
          if entrypoint == "browser"
            administration.replace_credentials! \
              actor: @actor, browser_session: @session, expected_version: version, **credentials
          else
            administration.recover_credentials! \
              confirmation: GithubAppConfiguration::Administration::RECOVERY_PHRASE, **credentials
          end
          :succeeded
        end
      end
      wait_for(dispatch)
      ApplicationRecord.connection_pool.with_connection do |connection|
        connections << connection.object_id
        GithubAppConfiguration.find(@configuration.id).installation.record_status!(installation_payload)
      end
      assert_equal version, @configuration.reload.lock_version
      finish << true

      assert_equal :succeeded, Timeout.timeout(10) { replacement.value }
      assert_equal 2, 2.times.map { connections.pop }.uniq.length
      assert_equal "replacement", @configuration.reload.client_secret
      assert_equal 2, @configuration.credential_revision
      assert Session.exists?(@session.id)
    ensure
      finish << true if finish
      replacement&.join
    end
  end

  test "overlapping unchanged polls both synchronize repositories without stale writes" do
    @configuration.update! \
      installation_id: 456, installation_account_github_id: 321,
      installation_state: "active", installed_at: Time.current
    version = @configuration.lock_version
    dispatch = Queue.new
    finish = Queue.new
    connections = Queue.new
    stub_github_app(configuration: @configuration)
    stub_github_installation_token
    stub_github_repositories([])
    stub_request(:get, "#{GITHUB_API_URL}/app/installations/456").to_return do
      assert_not ApplicationRecord.connection.transaction_open?
      dispatch << true
      wait_for(finish)
      { status: 200, body: JSON.generate(installation_payload) }
    end
    workers = 2.times.map do
      Thread.new do
        ApplicationRecord.connection_pool.with_connection do |connection|
          connections << connection.object_id
          GithubAppConfiguration.find(@configuration.id).synchronize_repositories!
          :succeeded
        end
      end
    end
    2.times { wait_for(dispatch) }
    2.times { finish << true }

    assert_equal [ :succeeded, :succeeded ], workers.map { |worker| Timeout.timeout(10) { worker.value } }
    assert_equal 2, 2.times.map { connections.pop }.uniq.length
    assert_equal version, @configuration.reload.lock_version
    assert @configuration.installation_checked_at
    assert_requested :get, "#{GITHUB_API_URL}/installation/repositories?page=1&per_page=100", times: 2
  ensure
    2.times { finish << true } if finish
    workers&.each(&:join)
  end

  private

  # Represents an unchanged, active installation owned by the configured account.
  def installation_payload
    {
      "id" => 456,
      "app_id" => 123,
      "account" => { "id" => 321, "login" => "github", "type" => "Organization" }
    }
  end

  # A worker failure must surface rather than leave the test waiting indefinitely.
  def wait_for(queue)
    Timeout.timeout(10) { queue.pop }
  end
end
