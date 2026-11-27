require "test_helper"
require "timeout"

# Separate committed connections prove the cutoff, not a shared test transaction.
class SessionRevocationConcurrencyTest < ActiveSupport::TestCase
  self.use_transactional_tests = false

  setup do
    @actor = users.create(github_id: 9101, login: "revocation-admin", hub_admin: true)
    @session = @actor.sessions.create!(fresh_authorized_at: Time.current)
    @repository = repositories.create(github_id: 9201, name_with_owner: "github/revocation")
    @generation = SessionRevocation.current.generation
    @configuration = github_app_configurations.create_installed
    stub_github_installation_token
    stub_github_permissions \
      [ repository_payload(@repository.github_id, @repository.name_with_owner) ],
      { @repository.github_id => "admin" }, github_id: @actor.github_id, login: @actor.login
  end

  teardown do
    SecurityAuditEvent.where(user_id: @actor.id).or(
      SecurityAuditEvent.where(repository_id: @repository.id)
    ).or(
      SecurityAuditEvent.where("json_extract(context, '$.github_app_configuration_id') = ?", @configuration.id)
    ).delete_all
    FreshAuthorization.where(user_id: @actor.id).delete_all
    HubAdminEnrollment.delete_all
    Session.where(user_id: @actor.id).delete_all
    Build.where(prototype_id: Prototype.where(repository_id: @repository.id).select(:id)).delete_all
    Prototype.where(repository_id: @repository.id).destroy_all
    Analytics::Event.where(repository: @repository).delete_all
    Repository.where(id: @repository.id).delete_all
    User.where(id: @actor.id).delete_all
    GithubAppConfiguration.where(id: @configuration.id).delete_all
    SessionRevocation.delete_all
  end

  test "a renewal waiting on the cutoff cannot rotate or reactivate its old grant" do
    grant = CanvasGrant.create! \
      user: @actor, repository: @repository, token_digest: Digest::SHA256.hexdigest("access"),
      expires_at: 7.days.from_now, refresh_token_digest: Digest::SHA256.hexdigest("refresh"),
      last_active_at: Time.current, inactive_at: 30.days.from_now
    before = grant.token_digest
    assert_equal CanvasGrant::Expired, after_cutoff { grant.renew! }
    assert_equal before, grant.reload.token_digest
    assert grant.revoked_at
    assert_empty Session.all
  end

  test "browser approval waiting on the cutoff cannot recreate a deleted pending request" do
    pairing, = CanvasPairing.start!(@repository, renewable: true)
    assert_equal ActiveRecord::RecordNotFound,
      after_cutoff { pairing.approve!(@actor, browser_session: @session) }
    assert_empty CanvasPairing.all
    assert_empty CanvasGrant.all
  end

  test "an approved poll waiting on the cutoff cannot issue access or refresh credentials" do
    pairing, device, refresh = CanvasPairing.start!(@repository, renewable: true)
    pairing.approve!(@actor, browser_session: @session)
    outcome = after_cutoff { CanvasPairing.consume(device) }
    assert outcome == ActiveRecord::RecordNotFound || outcome == [ "expired", nil ]
    assert_empty CanvasGrant.all
    assert_nil CanvasGrant.for_refresh(refresh)
  end

  test "a preview handoff waiting on the cutoff cannot set up signed-in access" do
    build = builds.create(prototype: prototypes.create(repository: @repository))
    token = PreviewGrant.issue!(build:, session: @session, return_path: "/")
    handoff = PreviewGrant.find_valid(token, build_id: build.id)
    assert_equal false, after_cutoff { PreviewGrant.consume(handoff) }
    assert_empty PreviewGrant.all
  end

  test "a claimed fresh callback waiting on the cutoff cannot restore its Session" do
    challenge = FreshAuthorization.start!(credential: @session, purpose: "session_revocation")
    challenge.bind_oauth!("state", browser_session: @session)
    challenge.claim!(state: "state", browser_session: @session)
    assert_equal ActiveRecord::RecordNotFound,
      after_cutoff { challenge.verify!({ "id" => @actor.github_id, "login" => @actor.login }) }
    assert_empty Session.all
    assert_empty FreshAuthorization.all
  end

  test "ordinary Session issuance waiting on the cutoff rejects the old OAuth generation" do
    assert_equal SessionRevocation::Superseded, after_cutoff {
      SessionRevocation.with_generation!(@generation) { @actor.sessions.create! }
    }
    assert_empty Session.all
  end

  test "a cached generation cannot issue a Session after another connection commits the cutoff" do
    revocation = nil
    ActiveRecord::Base.connection_pool.with_connection do |checking|
      SessionRevocation.cache do
        assert checking.query_cache_enabled
        assert_equal @generation, SessionRevocation.find_by!(singleton_key: 1).generation
        revocation = Thread.new do
          ActiveRecord::Base.connection_pool.with_connection do |writer|
            SessionRevocation.end_all!(actor: @actor, browser_session: @session)
            writer.object_id
          end
        end
        assert_not_equal checking.object_id, Timeout.timeout(5) { revocation.value }
        assert_equal @generation, SessionRevocation.find_by!(singleton_key: 1).generation

        entered = false
        assert_raises(SessionRevocation::Superseded) do
          SessionRevocation.with_generation!(@generation) do
            entered = true
            @actor.sessions.create!
          end
        end
        assert_not entered
        assert_empty Session.all

        generation = SessionRevocation.current.generation
        assert_equal @generation + 1, generation
        SessionRevocation.with_generation!(generation) { @actor.sessions.create! }
        assert_equal 1, @actor.sessions.count
      end
    end
  ensure
    revocation&.join
  end

  test "an OAuth callback already waiting on GitHub cannot issue a Session after the cutoff" do
    browser = {}
    @configuration.oauth.authorize_url(browser)
    assert_equal SessionRevocation::Superseded, after_oauth_cutoff(
      browser, profile: { "id" => @actor.github_id, "login" => @actor.login }
    )
    assert_empty Session.all
    assert_empty browser
  end

  test "enrollment waiting on GitHub cannot grant a role or consume a proof after the cutoff" do
    candidate = users.create(github_id: 9103, login: "pending-operator")
    enrollment, proof = HubAdminEnrollment.start!("proof", bootstrap_secret: "proof")
    browser = {}
    @configuration.oauth.authorize_url(browser)
    enrollment.bind_oauth!(browser.fetch(:github_oauth_state))
    browser[:hub_admin_enrollment_proof] = proof

    assert_equal SessionRevocation::Superseded, after_oauth_cutoff(
      browser, profile: { "id" => candidate.github_id, "login" => candidate.login }
    )
    assert_not candidate.reload.hub_admin?
    assert_empty Session.all
    assert_empty HubAdminEnrollment.all
    assert_empty SecurityAuditEvent.where(action: "hub_admin.enroll", outcome: "succeeded")
  ensure
    User.where(id: candidate&.id).delete_all
  end

  test "new challenge creation waiting on the cutoff rejects its stale initiating Session" do
    assert_equal FreshAuthorization::Invalid, after_cutoff {
      FreshAuthorization.start!(credential: @session, purpose: "session_revocation")
    }
    assert_empty FreshAuthorization.all
  end

  test "issuance committed just before the cutoff is revoked rather than left active" do
    issued = Queue.new
    finish = Queue.new
    issuance = Thread.new do
      ActiveRecord::Base.connection_pool.with_connection do
        SessionRevocation.with_generation!(@generation) do
          browser = @actor.sessions.create!
          pairing, device, = CanvasPairing.start!(@repository, renewable: true)
          pairing.approve!(@actor, browser_session: browser)
          status, credentials = CanvasPairing.consume(device)
          raise "Expected approval" if status != "approved"

          issued << credentials.fetch(:grant).id
          finish.pop
        end
      end
    end
    grant_id = Timeout.timeout(5) { issued.pop }
    attempted = Queue.new
    revocation = Thread.new do
      ActiveRecord::Base.connection_pool.with_connection do
        attempted << true
        SessionRevocation.end_all!(actor: @actor, browser_session: @session)
      end
    end
    Timeout.timeout(5) { attempted.pop }
    finish << true
    issuance.value
    revocation.value
    assert CanvasGrant.find(grant_id).revoked_at
    assert_empty Session.all
    assert_empty CanvasPairing.all
  ensure
    finish << true if finish
    [ issuance, revocation ].compact.each(&:join)
  end

  test "role removal committed before the action denies a stale operator without a cutoff" do
    replacement = users.create(github_id: 9102, login: "replacement-admin", hub_admin: true)
    ready = Queue.new
    finish = Queue.new
    removal = Thread.new do
      ActiveRecord::Base.connection_pool.with_connection do
        User.transaction do
          @actor.update!(hub_admin: false)
          ready << true
          finish.pop
        end
      end
    end
    Timeout.timeout(5) { ready.pop }
    attempt = Thread.new do
      ActiveRecord::Base.connection_pool.with_connection do
        SessionRevocation.end_all!(actor: @actor, browser_session: @session)
      rescue User::AdminRoleChangeDenied => error
        error.reason
      end
    end
    finish << true
    removal.value
    assert_equal :not_authorized, attempt.value
    assert Session.exists?(@session.id)
    assert_equal @generation, SessionRevocation.current.generation
  ensure
    finish << true if finish
    [ removal, attempt ].compact.each(&:join)
    User.where(id: replacement&.id).delete_all
  end

  private

  # Pauses external identity I/O while another committed connection performs the cutoff.
  def after_oauth_cutoff(browser, profile:)
    state = browser.fetch(:github_oauth_state)
    generation = browser.fetch(:github_oauth_generation)
    reached_github = Queue.new
    finish = Queue.new
    connection_ids = Queue.new
    oauth = Object.new
    oauth.define_singleton_method(:exchange_code) { |**| "temporary-token" }
    oauth.define_singleton_method(:user) do |token:|
      reached_github << true
      finish.pop
      profile
    end
    client = Object.new
    client.define_singleton_method(:oauth) { oauth }
    @configuration.define_singleton_method(:github_client) { client }
    callback = Thread.new do
      ActiveRecord::Base.connection_pool.with_connection do |connection|
        connection_ids << connection.object_id
        SessionRevocation.cache do
          assert connection.query_cache_enabled
          user = @configuration.oauth.authenticate!(browser, code: "code", state:)
          SessionRevocation.with_generation!(generation) { user.sessions.create! }
        end
      rescue SessionRevocation::Superseded => error
        error.class
      end
    end
    Timeout.timeout(5) { reached_github.pop }
    ActiveRecord::Base.connection_pool.with_connection do |connection|
      connection_ids << connection.object_id
      SessionRevocation.end_all!(actor: @actor, browser_session: @session)
    end
    finish << true
    outcome = Timeout.timeout(5) { callback.value }
    assert_equal 2, 2.times.map { connection_ids.pop }.uniq.length
    outcome
  ensure
    finish << true if finish
    callback&.join
  end

  # Holds an uncommitted cutoff while a separate connection attempts an operation.
  def after_cutoff
    locked = Queue.new
    attempted = Queue.new
    finish = Queue.new
    connection_ids = Queue.new
    revocation = Thread.new do
      ActiveRecord::Base.connection_pool.with_connection do |connection|
        connection_ids << connection.object_id
        SessionRevocation.transaction do
          SessionRevocation.end_all!(actor: @actor, browser_session: @session)
          locked << true
          finish.pop
        end
      end
    end
    Timeout.timeout(5) { locked.pop }
    contender = Thread.new do
      ActiveRecord::Base.connection_pool.with_connection do |connection|
        connection_ids << connection.object_id
        attempted << true
        yield
      rescue CanvasGrant::Expired, ActiveRecord::RecordNotFound,
        FreshAuthorization::Invalid, SessionRevocation::Superseded => error
        error.class
      end
    end
    Timeout.timeout(5) { attempted.pop }
    finish << true
    revocation.value
    outcome = contender.value
    assert_equal 2, 2.times.map { connection_ids.pop }.uniq.length
    outcome
  ensure
    finish << true if finish
    [ revocation, contender ].compact.each(&:join)
  end
end
