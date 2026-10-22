require "test_helper"
require "timeout"

# Uses committed records and distinct connections, not Rails's shared test transaction.
class FreshAuthorizationConcurrencyTest < ActiveSupport::TestCase
  self.use_transactional_tests = false

  setup do
    @user = users.create(github_id: 9401, login: "fresh-expiry-user")
    @session = @user.sessions.create!
  end

  teardown do
    SecurityAuditEvent.where(user_id: @user.id).delete_all
    FreshAuthorization.where(user_id: @user.id).delete_all
    Session.where(user_id: @user.id).delete_all
    User.where(id: @user.id).delete_all
  end

  test "concurrent continuations can claim only one committed execution attempt" do
    request = ActionDispatch::Request.new(
      Rack::MockRequest.env_for("/repositories/2001/analytics/destinations", method: "POST")
    )
    request.path_parameters = {
      controller: "analytics_destinations", action: "create", repository_github_id: "2001"
    }
    parameters = ActionController::Parameters.new(
      destination: { provider: "segment", region: "us", history: "new", credentials: { write_key: "saved-secret" } }
    )
    pending = FreshAuthorization::Continuation.capture(request, parameters, purpose: "analytics_destination")
    challenge = FreshAuthorization.start!(
      credential: @session, purpose: "analytics_destination", pending_action: pending
    )
    challenge.bind_oauth!("state", browser_session: @session)
    challenge.claim!(state: "state", browser_session: @session)
    challenge.verify!({ "id" => @user.github_id, "login" => @user.login })
    ready = Queue.new
    start = Queue.new
    attempts = 2.times.map do
      Thread.new do
        ActiveRecord::Base.connection_pool.with_connection do
          callback = FreshAuthorization.find(challenge.id)
          ready << true
          start.pop
          callback.continuation.claim!(request, browser_session: @session)
          :claimed
        rescue FreshAuthorization::Continuation::Invalid
          :denied
        end
      end
    end
    Timeout.timeout(5) { 2.times { ready.pop } }
    2.times { start << true }
    assert_equal [ :claimed, :denied ], Timeout.timeout(5) { attempts.map(&:value).sort }
    assert_nil challenge.reload.pending_action
    assert challenge.continued_at
  ensure
    2.times { start << true } if start
    attempts&.each(&:join)
  end

  test "expiry during a paused credential lock cannot stamp committed proof" do
    challenge = FreshAuthorization.start!(credential: @session, purpose: "analytics_destination")
    challenge.bind_oauth!("state", browser_session: @session)
    challenge.claim!(state: "state", browser_session: @session)
    profile = { "id" => @user.github_id, "login" => @user.login }
    locked = Queue.new
    finish = Queue.new
    connections = Queue.new
    verification = nil

    ActiveRecord::Base.connection_pool.with_connection do |observer|
      connections << observer.object_id
      assert FreshAuthorization.find(challenge.id).consumed_at
      verification = Thread.new do
        ActiveRecord::Base.connection_pool.with_connection do |connection|
          connections << connection.object_id
          callback = FreshAuthorization.find(challenge.id)
          credential = callback.credential
          callback.define_singleton_method(:credential) { credential }
          original_lock = credential.method(:with_lock)
          credential.define_singleton_method(:with_lock) do |&block|
            original_lock.call do
              # Pauses real lock completion; this is not a SQLite row-lock wait.
              locked << true
              finish.pop
              block.call
            end
          end
          callback.verify!(profile)
          :verified
        rescue FreshAuthorization::Invalid
          :denied
        end
      end

      Timeout.timeout(5) { locked.pop }
      travel_to challenge.expires_at, with_usec: true
      finish << true
      assert_equal :denied, Timeout.timeout(5) { verification.value }
      assert_equal 2, 2.times.map { connections.pop }.uniq.length
      assert_nil @session.reload.fresh_authorized_at
      assert_nil challenge.reload.verified_at
      assert_equal 0, SecurityAuditEvent.where(user_id: @user.id,
        action: "fresh_authorization.verify", outcome: "succeeded").count
    end
  ensure
    finish << true if finish
    verification&.join
    travel_back
  end
end
