require "test_helper"
require "timeout"

# Committed adapters pause real external waits without claiming SQLite row-lock behavior.
class GithubAppDualBarrierConcurrencyTest < ActiveSupport::TestCase
  self.use_transactional_tests = false

  setup do
    @configuration = github_app_configurations.create_installed
    @actor = users.create(github_id: 9911, login: "dual-barrier-admin", hub_admin: true)
    @session = sessions.create(user: @actor, fresh_authorized_at: Time.current)
    @repository = repositories.create(github_id: 9921, name_with_owner: "github/dual-barrier")
    stub_request(:get, "#{GITHUB_API_URL}/app")
      .to_return(status: 200, body: JSON.generate(github_app_configurations.manifest_credentials))
    stub_github_installation_token
  end

  teardown do
    SecurityAuditEvent.where(user_id: [ @actor.id, @candidate&.id ])
      .or(SecurityAuditEvent.where(repository_id: @repository.id))
      .or(SecurityAuditEvent.where("json_extract(context, '$.github_app_configuration_id') = ?", @configuration.id))
      .delete_all
    FreshAuthorization.where(user_id: @actor.id).delete_all
    HubAdminEnrollment.delete_all
    Session.where(user_id: [ @actor.id, @candidate&.id ]).delete_all
    Repository.where(id: @repository.id).destroy_all
    User.where(id: [ @actor.id, @candidate&.id ]).delete_all
    GithubAppConfiguration.where(id: @configuration.id).delete_all
    SessionRevocation.delete_all
  end

  %i[generation app].each do |barrier|
    test "#{barrier} changes during OAuth block Session issuance and clear every snapshot" do
      browser = {}
      @configuration.oauth.authorize_url(browser)
      generation = browser.fetch(:github_oauth_generation)
      snapshot = @configuration.oauth.credential_snapshot!(browser)
      state = browser.fetch(:github_oauth_state)
      stub_github_oauth_user(github_id: @actor.github_id, login: @actor.login)

      outcome = during_wait(:get, "#{GITHUB_API_URL}/user", barrier:) do
        user = @configuration.oauth.authenticate!(browser, code: "code", state:)
        SessionRevocation.with_generation!(generation) do
          GithubAppConfiguration.with_credentials!(**snapshot) { user.sessions.create! }
        end
      end
      assert_equal denial_for(barrier), outcome
      assert_equal(barrier == :generation ? 0 : 1, Session.where(user: @actor).count)
      assert_empty browser
    end

    test "#{barrier} changes during enrollment cannot grant a role or consume old proof" do
      @candidate = users.create(github_id: 9912, login: "pending-dual-barrier-operator")
      enrollment, proof = HubAdminEnrollment.start!("manual", bootstrap_secret: "manual")
      browser = {}
      @configuration.oauth.authorize_url(browser)
      enrollment.bind_oauth!(browser.fetch(:github_oauth_state))
      browser[:hub_admin_enrollment_proof] = proof
      state = browser.fetch(:github_oauth_state)
      stub_github_oauth_user(github_id: @candidate.github_id, login: @candidate.login)

      outcome = during_wait(:get, "#{GITHUB_API_URL}/user", barrier:,
        payload: { id: @candidate.github_id, login: @candidate.login }) do
        @configuration.oauth.authenticate!(browser, code: "code", state:)
      end
      assert_equal denial_for(barrier), outcome
      assert_not @candidate.reload.hub_admin?
      assert_empty @candidate.sessions
      assert_empty HubAdminEnrollment.all
      assert_empty SecurityAuditEvent.where(action: "hub_admin.enroll", outcome: "succeeded")
      assert_empty browser
    end

    test "#{barrier} changes during pairing permission cannot issue access or refresh credentials" do
      pairing, device, refresh = CanvasPairing.start!(@repository, renewable: true)
      pairing.approve!(@actor, browser_session: @session)
      url = "#{GITHUB_API_URL}/repos/#{@repository.name_with_owner}/collaborators/#{@actor.login}/permission"

      outcome = during_wait(:get, url, barrier:,
        payload: { permission: "admin", user: { id: @actor.github_id } }) do
        CanvasPairing.consume(device)
      end
      assert_equal denial_for(barrier), outcome
      assert_empty CanvasGrant.all
      assert_nil CanvasGrant.for_refresh(refresh)
      assert_empty SecurityAuditEvent.where(action: "canvas_pairing.consume", outcome: "succeeded")
    end
  end

  test "credential repair during prepared installation cannot apply status repositories or success audit" do
    @configuration.update! \
      installation_id: nil, installation_account_github_id: nil, installation_state: "not_installed"
    stub_request(:get, "#{GITHUB_API_URL}/app/installations/456")
      .to_return(status: 200, body: JSON.generate(id: 456, app_id: @configuration.github_app_id,
        account: github_app_configurations.manifest_credentials.fetch("owner")))
    before = @repository.attributes
    url = "#{GITHUB_API_URL}/installation/repositories?page=1&per_page=100"
    outcome = during_wait(:get, url, barrier: :app,
      payload: { repositories: [ repository_payload(@repository.github_id, "github/changed") ] }) do
      @configuration.installation.install!(456)
    end
    assert_equal GithubAppConfiguration::Superseded, outcome
    assert_equal "not_installed", @configuration.reload.installation_state
    assert_nil @configuration.installation_id
    assert_equal before, @repository.reload.attributes
    assert_empty SecurityAuditEvent.where(action: "github_app_setup.install", outcome: "succeeded")
  end

  %i[reset repair].each do |change|
    test "#{change} during cached OAuth rejects the old App and leaves repositories unchanged" do
      @candidate = users.create(github_id: 9912, login: "cached-app-reader")
      browser = {}
      @configuration.oauth.authorize_url(browser)
      generation = browser.fetch(:github_oauth_generation)
      snapshot = @configuration.credential_snapshot
      state = browser.fetch(:github_oauth_state)
      payload = repository_payload(@repository.github_id, @repository.name_with_owner)
      stub_github_oauth_user(github_id: @candidate.github_id, login: @candidate.login)
      stub_github_repositories([ payload ])
      stub_github_permissions \
        [ payload ], { @repository.github_id => "read" },
        github_id: @candidate.github_id, login: @candidate.login

      outcome = during_wait \
        :get, "#{GITHUB_API_URL}/user",
        barrier: change, payload: { id: @candidate.github_id, login: @candidate.login } do
        GithubAppConfiguration.cache do
          assert ApplicationRecord.connection.query_cache_enabled
          assert GithubAppConfiguration.exists? \
            id: snapshot.fetch(:configuration_id), credential_revision: snapshot.fetch(:credential_revision)
          error = assert_raises(SessionRevocation::Superseded, GithubAppConfiguration::Superseded) do
            user = @configuration.oauth.authenticate!(browser, code: "code", state:)
            SessionRevocation.with_generation!(generation) do
              GithubAppConfiguration.with_credentials!(**snapshot) { user.sessions.create! }
            end
          end
          error.class
        end
      end

      assert_includes [ SessionRevocation::Superseded, GithubAppConfiguration::Superseded ], outcome
      assert_empty Session.where(user: @candidate)
      expected_state = change == :reset ? "removed" : "active"
      assert_equal expected_state, @repository.reload.installation_state
      assert_empty browser
    end

    test "#{change} cannot pass the App barrier with a stale cached configuration" do
      snapshot = @configuration.credential_snapshot
      outcome = during_wait(:get, "#{GITHUB_API_URL}/user", barrier: change) do
        GithubAppConfiguration.cache do
          assert ApplicationRecord.connection.query_cache_enabled
          assert GithubAppConfiguration.exists? \
            id: snapshot.fetch(:configuration_id), credential_revision: snapshot.fetch(:credential_revision)
          @configuration.github_client.oauth.user(token: "synthetic-oauth-token")

          # No failed transaction precedes this witness or clears its cached answer.
          assert_not ApplicationRecord.connection.transaction_open?
          assert GithubAppConfiguration.exists? \
            id: snapshot.fetch(:configuration_id), credential_revision: snapshot.fetch(:credential_revision)
          entered = false
          error = assert_raises(GithubAppConfiguration::Superseded) do
            GithubAppConfiguration.with_credentials!(**snapshot) { entered = true }
          end
          assert_not entered
          error.class
        end
      end

      assert_equal GithubAppConfiguration::Superseded, outcome
    end
  end

  private

  # Two adapters witness a committed mutation while the first is waiting outside a transaction.
  def during_wait(method, url, barrier:, payload: { id: @actor.github_id, login: @actor.login })
    reached = Queue.new
    release = Queue.new
    connection_ids = Queue.new
    original_secret = ENV["REPLICA_BOOTSTRAP_SECRET"]
    stub_request(method, url).to_return do
      assert_not ApplicationRecord.connection.transaction_open?
      reached << true
      Timeout.timeout(10) { release.pop }
      { status: 200, body: JSON.generate(payload) }
    end
    worker = Thread.new do
      ApplicationRecord.connection_pool.with_connection do |connection|
        connection_ids << connection.object_id
        yield
      rescue SessionRevocation::Superseded, GithubAppConfiguration::Superseded => error
        error.class
      end
    end
    Timeout.timeout(10) { reached.pop }
    ApplicationRecord.connection_pool.with_connection do |connection|
      connection_ids << connection.object_id
      if barrier == :generation
        SessionRevocation.end_all!(actor: @actor, browser_session: @session)
      elsif barrier == :reset
        ENV["REPLICA_BOOTSTRAP_SECRET"] = "manual"
        GithubAppConfiguration.find(@configuration.id).administration.reset! \
          actor: @actor, browser_session: @session, expected_version: @configuration.lock_version,
          confirmation: GithubAppConfiguration::Administration::RESET_PHRASE
      else
        GithubAppConfiguration.find(@configuration.id).administration.recover_credentials! \
          confirmation: GithubAppConfiguration::Administration::RECOVERY_PHRASE,
          client_secret: "synthetic-replacement", private_key: github_app_configurations.test_private_key
      end
    end
    release << true
    outcome = Timeout.timeout(10) { worker.value }
    assert_equal 2, 2.times.map { connection_ids.pop }.uniq.length
    outcome
  ensure
    release << true if release
    worker&.join
    ENV["REPLICA_BOOTSTRAP_SECRET"] = original_secret
  end

  # Each independent barrier denies with its own fixed, nonsecret result.
  def denial_for(barrier)
    barrier == :generation ? SessionRevocation::Superseded : GithubAppConfiguration::Superseded
  end
end
