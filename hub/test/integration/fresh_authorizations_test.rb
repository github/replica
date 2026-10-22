require "test_helper"
require_relative "../support/authorization_continuation_helpers"

# Keeps legacy never-expiring authorization covered independently of the current cap.
class FreshAuthorizationsTest < ActionDispatch::IntegrationTest
  include AuthorizationContinuationHelpers

  setup do
    @original_share_link_maximum = Rails.configuration.x.share_link_maximum_lifetime
    Rails.configuration.x.share_link_maximum_lifetime = nil
    @original_bootstrap_secret = ENV["REPLICA_BOOTSTRAP_SECRET"]
    ENV["REPLICA_BOOTSTRAP_SECRET"] = "fresh-flow-bootstrap-secret"
    SharingSetting.create!(id: 1, public_sharing_enabled: true)
    host! "replica.localhost:19500"
    github_app_configurations.create_installed
    @payload = repository_payload(2001, "github/prototype")
    stub_github_sign_in(repositories: [ @payload ], permissions: { 2001 => "admin" })
    sign_in
    @user = User.find_by!(github_id: 1001)
    @browser_session = @user.sessions.sole
    @repository = Repository.find_by!(github_id: 2001)
    @prototype = prototypes.create(repository: @repository)
    @build = builds.create_successful(prototype: @prototype)
    @share_path = repository_prototype_share_links_path(@repository.route_id, @prototype)
    @analytics_path = repository_analytics_destinations_path(@repository.route_id)
    @browser_session.update!(fresh_authorized_at: 5.minutes.ago)
  end

  teardown do
    Rails.configuration.x.share_link_maximum_lifetime = @original_share_link_maximum
    ENV["REPLICA_BOOTSTRAP_SECRET"] = @original_bootstrap_secret
  end

  test "ordinary sign in proves only its newly created Session" do
    other = @user.sessions.create!
    sign_in
    assert FreshAuthorization.fresh?(@user.sessions.order(:id).last)
    assert_not FreshAuthorization.fresh?(other)
    assert_not FreshAuthorization.fresh?(@browser_session)
  end

  test "browser sharing requires fresh authorization only for never expiring links" do
    assert_difference("ShareLink.count", 1) { create_share(expiration: "seven_days") }
    assert_no_difference("ShareLink.count") { create_share }
    challenge = FreshAuthorization.last
    assert_redirected_to fresh_authorization_path(challenge.public_id)
    assert_equal "never_expiring_share", challenge.purpose
    assert_equal @browser_session.id, challenge.credential_id
    follow_redirect!
    assert_response :success
    assert_includes response.body, I18n.t("fresh_authorization.heading")
    assert_not_includes response.body, "Review secret label"
    assert_equal "denied", SecurityAuditEvent.where(action: "share_link.create").last.outcome
    state = start_verification(challenge)
    assert_no_difference("ShareLink.count") { callback(state) }
    assert FreshAuthorization.fresh?(@browser_session)
    follow_redirect!(as: :json)
    assert_verification_notice
    assert_equal 1, ShareLink.count
    assert_difference("ShareLink.count", 1) { create_share }
    assert_nil ShareLink.last.expires_at
  end

  test "analytics creation retains encrypted credentials and continues exactly once" do
    assert_no_difference("Analytics::Destination.count") do
      post @analytics_path, params: { destination: analytics_configuration }
    end
    challenge = FreshAuthorization.last
    assert_equal "analytics_destination", challenge.purpose
    raw = FreshAuthorization.connection.select_value(
      "SELECT pending_action FROM fresh_authorizations WHERE id = #{challenge.id}"
    )
    assert_not_includes raw, "submitted-secret"
    assert_not_includes request.session.to_hash.to_s, "submitted-secret"
    assert_not_includes response.location, "submitted-secret"
    state = start_verification(challenge)
    callback(state)
    assert_redirected_to fresh_authorization_path(challenge.public_id)
    follow_redirect!(as: :json)
    form = response.parsed_body.fetch("data")
    assert_not_includes response.body, "submitted-secret"
    assert_empty @repository.analytics_destinations
    continue_pending_action(form, destination: analytics_configuration.merge(credentials: { write_key: "injected" }))
    destination = @repository.analytics_destinations.sole
    assert_equal "submitted-secret", destination.credentials.fetch("write_key")
    assert_equal I18n.t("analytics.configured_notice"), flash[:notice]
    assert_nil challenge.reload.pending_action
    assert challenge.continued_at
    timestamp = @browser_session.reload.fresh_authorized_at
    assert_no_difference("Analytics::Destination.count") do
      callback(state)
      continue_pending_action(form)
    end
    assert_equal timestamp, @browser_session.reload.fresh_authorized_at
  end

  test "analytics credential updates pause resume and deletion continue their original actions" do
    destination = @repository.analytics_destinations.create! \
      provider: "segment", region: "us", credentials: { write_key: "existing" },
      event_types: Analytics::Event::TYPES
    path = repository_analytics_destination_path(@repository.route_id, destination)
    changes = [
      [ "patch", { destination: analytics_configuration }, -> {
        assert_equal "submitted-secret", destination.reload.credentials.fetch("write_key")
      } ],
      [ "patch", { operation: "pause" }, -> { assert_not destination.reload.enabled? } ],
      [ "patch", { operation: "resume" }, -> { assert destination.reload.enabled? } ],
      [ "delete", {}, -> { assert_not Analytics::Destination.exists?(destination.id) } ]
    ]
    changes.each do |method, input, outcome|
      @browser_session.reload.update!(fresh_authorized_at: nil)
      travel 1.minute
      public_send(method, path, params: input)
      form = verify_pending_action(FreshAuthorization.last, path:, method:)
      continue_pending_action(form)
      assert_redirected_to repository_analytics_path(@repository.route_id)
      outcome.call
    end
  end

  test "analytics validation failures report their actual result and discard the continuation" do
    post @analytics_path, params: { destination: analytics_configuration.except(:history) }
    challenge = FreshAuthorization.last
    form = verify_pending_action(challenge, path: @analytics_path, method: "post")
    continue_pending_action(form, destination: analytics_configuration)
    assert_empty @repository.analytics_destinations
    assert_equal I18n.t("analytics.invalid_configuration"), flash[:alert]
    assert_nil challenge.reload.pending_action
    assert challenge.continued_at
    continue_pending_action(form)
    assert_empty @repository.analytics_destinations
  end

  test "cancelling an analytics action before or after verification discards its payload" do
    [ false, true ].each do |verified|
      @browser_session.update!(fresh_authorized_at: nil)
      post @analytics_path, params: { destination: analytics_configuration }
      challenge = FreshAuthorization.last
      form = if verified
        verify_pending_action(challenge, path: @analytics_path, method: "post")
      else
        { "submitPath" => @analytics_path, "continuation" => { "id" => challenge.public_id, "method" => "post" } }
      end
      delete fresh_authorization_path(challenge.public_id)
      assert_equal I18n.t("fresh_authorization.cancelled"), flash[:alert]
      assert_nil challenge.reload.pending_action
      continue_pending_action(form)
      assert_empty @repository.analytics_destinations
    end
  end

  test "failed GitHub verification discards analytics credentials without applying them" do
    [ :identity, :denied, :timeout ].each do |failure|
      stub_github_oauth_user
      post @analytics_path, params: { destination: analytics_configuration }
      challenge = FreshAuthorization.last
      state = start_verification(challenge)
      case failure
      when :identity
        stub_github_oauth_user(github_id: 1002, login: "mona")
      when :timeout
        stub_request(:post, "#{GITHUB_URL}/login/oauth/access_token").to_timeout
      end
      if failure == :denied
        get github_authentication_callback_path, params: { error: "access_denied", state: }
      else
        callback(state)
      end
      assert_equal I18n.t("fresh_authorization.failure"), flash[:alert]
      assert_nil challenge.reload.pending_action
      post @analytics_path, params: { authorization_continuation_id: challenge.public_id }
      assert_empty @repository.analytics_destinations
    end
  end

  test "an unverified analytics continuation cannot execute even with another fresh proof" do
    post @analytics_path, params: { destination: analytics_configuration }
    challenge = FreshAuthorization.last
    @browser_session.update!(fresh_authorized_at: Time.current)
    post @analytics_path, params: { authorization_continuation_id: challenge.public_id }
    assert_empty @repository.analytics_destinations
  end

  test "an opaque continuation identifier does not replace browser forgery protection" do
    previous = ActionController::Base.allow_forgery_protection
    post @analytics_path, params: { destination: analytics_configuration }
    challenge = FreshAuthorization.last
    form = verify_pending_action(challenge, path: @analytics_path, method: "post")
    ActionController::Base.allow_forgery_protection = true
    continue_pending_action(form)
    assert_response :unprocessable_entity
    assert_empty @repository.analytics_destinations
    assert challenge.reload.pending_action
    assert_nil challenge.continued_at
  ensure
    ActionController::Base.allow_forgery_protection = previous
  end

  test "expired proof and the fifteen minute challenge deadline prevent continuation" do
    [ :proof, :challenge ].each do |boundary|
      @browser_session.reload.update!(fresh_authorized_at: nil)
      post @analytics_path, params: { destination: analytics_configuration }
      challenge = FreshAuthorization.last
      form = verify_pending_action(challenge, path: @analytics_path, method: "post")
      assert_in_delta 15.minutes, challenge.expires_at - challenge.created_at, 1
      deadline = boundary == :proof ? @browser_session.reload.fresh_authorized_at + 5.minutes : challenge.expires_at
      travel_to deadline, with_usec: true do
        @browser_session.update!(fresh_authorized_at: Time.current) if boundary == :challenge
        continue_pending_action(form)
        assert_empty @repository.analytics_destinations
        assert_nil challenge.reload.pending_action
      end
    end
  end

  test "another signed in browser cannot read cancel or execute a verified analytics action" do
    post @analytics_path, params: { destination: analytics_configuration }
    challenge = FreshAuthorization.last
    form = verify_pending_action(challenge, path: @analytics_path, method: "post")
    other = open_session
    other.host! "replica.localhost:19500"
    other.post github_authentication_path
    state = Rack::Utils.parse_query(URI(other.response.location).query).fetch("state")
    other.get github_authentication_callback_path, params: { code: "code", state: }
    other.get fresh_authorization_path(challenge.public_id), as: :json
    assert_equal 303, other.response.status
    assert_not_includes other.response.body, "submitted-secret"
    other.delete fresh_authorization_path(challenge.public_id)
    other.post form.fetch("submitPath"), params: { authorization_continuation_id: challenge.public_id }
    assert_empty @repository.analytics_destinations
    continue_pending_action(form)
    assert_equal "submitted-secret", @repository.analytics_destinations.sole.credentials.fetch("write_key")
  end

  test "a changed GitHub identity cannot continue an already verified analytics action" do
    post @analytics_path, params: { destination: analytics_configuration }
    challenge = FreshAuthorization.last
    form = verify_pending_action(challenge, path: @analytics_path, method: "post")
    @user.update_columns(github_id: 1002)
    continue_pending_action(form)
    assert_empty @repository.analytics_destinations
    assert_nil challenge.reload.pending_action
  end

  test "continuation cannot be retargeted to another route or HTTP method" do
    destination = @repository.analytics_destinations.create! \
      provider: "segment", region: "us", credentials: { write_key: "existing" },
      event_types: Analytics::Event::TYPES
    path = repository_analytics_destination_path(@repository.route_id, destination)
    patch path, params: { operation: "pause" }
    challenge = FreshAuthorization.last
    verify_pending_action(challenge, path:, method: "patch")
    other = @repository.analytics_destinations.create! \
      provider: "mixpanel", region: "us",
      credentials: { service_account_username: "service", service_account_secret: "secret", project_id: "123" },
      event_types: Analytics::Event::TYPES
    other_path = repository_analytics_destination_path(@repository.route_id, other)
    patch other_path, params: { authorization_continuation_id: challenge.public_id }
    assert other.reload.enabled?
    delete path, params: { authorization_continuation_id: challenge.public_id }
    assert destination.reload.enabled?
    post @analytics_path, params: { authorization_continuation_id: challenge.public_id }
    assert_equal 2, @repository.analytics_destinations.count
    assert destination.reload.enabled?
  end

  test "repository permission is rechecked after successful verification before continuation" do
    post @analytics_path, params: { destination: analytics_configuration }
    challenge = FreshAuthorization.last
    form = verify_pending_action(challenge, path: @analytics_path, method: "post")
    stub_github_permissions([ @payload ], { 2001 => nil })
    continue_pending_action(form)
    assert_response :not_found
    assert_empty @repository.analytics_destinations
    assert_nil challenge.reload.pending_action
  end

  test "cancellation failure and identity mismatch leave sensitive requests unapplied" do
    create_share
    challenge = FreshAuthorization.last
    delete fresh_authorization_path(challenge.public_id)
    assert_equal I18n.t("fresh_authorization.cancelled"), flash[:alert]
    assert_not FreshAuthorization.fresh?(@browser_session)
    create_share
    state = start_verification(FreshAuthorization.last)
    stub_github_oauth_user(github_id: 1002, login: "mona")
    callback(state)
    assert_equal I18n.t("fresh_authorization.failure"), flash[:alert]
    assert_not FreshAuthorization.fresh?(@browser_session)
    assert_equal "denied", SecurityAuditEvent.where(action: "fresh_authorization.verify").last.outcome
    create_share
    state = start_verification(FreshAuthorization.last)
    stub_request(:post, "#{GITHUB_URL}/login/oauth/access_token").to_timeout
    callback(state)
    assert_equal "failed", SecurityAuditEvent.where(action: "fresh_authorization.verify").last.outcome
    assert_not FreshAuthorization.fresh?(@browser_session)
    assert_empty ShareLink.all
  end

  test "expired and denied GitHub callbacks cannot renew or fall through to sign in" do
    create_share
    challenge = FreshAuthorization.last
    state = start_verification(challenge)
    travel_to challenge.expires_at, with_usec: true do
      callback(state)
      assert_equal I18n.t("fresh_authorization.failure"), flash[:alert]
      assert_not FreshAuthorization.fresh?(@browser_session)
      assert_no_difference("Session.count") { callback(state) }
    end
    create_share
    state = start_verification(FreshAuthorization.last)
    get github_authentication_callback_path, params: { error: "access_denied", state: }
    assert_equal I18n.t("fresh_authorization.failure"), flash[:alert]
    assert_not FreshAuthorization.fresh?(@browser_session)
    assert_empty ShareLink.all
  end

  test "wrong state and callback replay do not extend the five minute window" do
    create_share
    state = start_verification(FreshAuthorization.last)
    callback("wrong")
    assert_not FreshAuthorization.fresh?(@browser_session)
    create_share
    state = start_verification(FreshAuthorization.last)
    callback(state)
    timestamp = @browser_session.reload.fresh_authorized_at
    travel 1.minute do
      assert_no_difference("Session.count") { callback(state) }
      assert_equal timestamp, @browser_session.reload.fresh_authorized_at
    end
  end

  test "fresh identity does not bypass current repository authorization" do
    create_share
    callback(start_verification(FreshAuthorization.last))
    stub_github_permissions([ @payload ], { 2001 => nil })
    assert_no_difference("ShareLink.count") { create_share }
    assert_response :not_found
    assert_no_difference("Analytics::Destination.count") do
      post @analytics_path, params: { destination: analytics_configuration }
    end
    assert_response :not_found
  end

  test "another browser cannot start a challenge belonging to this Session" do
    create_share
    challenge = FreshAuthorization.last
    other_browser = open_session
    other_browser.host! "replica.localhost:19500"
    other_browser.post github_authentication_path
    state = Rack::Utils.parse_query(URI(other_browser.response.location).query).fetch("state")
    other_browser.get github_authentication_callback_path, params: { code: "code", state: }
    other_browser.post fresh_authorization_path(challenge.public_id)
    assert_equal I18n.t("fresh_authorization.failure"), other_browser.flash[:alert]
    assert_not FreshAuthorization.fresh?(@browser_session)
    assert_nil challenge.reload.oauth_state_digest
  end

  test "anonymous invalid challenge reads show failure without writing audit records" do
    expired = expired_browser_challenge
    foreign = FreshAuthorization.start!(credential: @browser_session, purpose: "analytics_destination")
    deleted = FreshAuthorization.start!(credential: @browser_session, purpose: "analytics_destination")
    deleted.destroy!
    browser = open_session
    browser.host! "replica.localhost:19500"

    assert_no_difference("SecurityAuditEvent.count") do
      [ SecureRandom.uuid, expired.public_id, foreign.public_id, deleted.public_id ].each do |id|
        [ :get, :head ].each do |method|
          browser.public_send(method, fresh_authorization_path(id))
          assert_equal 303, browser.response.status
          assert_equal I18n.t("fresh_authorization.failure"), browser.flash[:alert]
        end
      end
    end
  end

  test "unrelated failed reads leave the pending verification usable" do
    create_share
    challenge = FreshAuthorization.last
    state = start_verification(challenge)
    bundle = oauth_bundle
    expired = expired_browser_challenge
    foreign = FreshAuthorization.start!(credential: @user.sessions.create!, purpose: "analytics_destination")
    deleted = FreshAuthorization.start!(credential: @browser_session, purpose: "analytics_destination")
    deleted.destroy!

    assert_no_difference("SecurityAuditEvent.count") do
      [ SecureRandom.uuid, expired.public_id, foreign.public_id, deleted.public_id ].each do |id|
        get fresh_authorization_path(id)
        assert_equal I18n.t("fresh_authorization.failure"), flash[:alert]
        assert_equal bundle, oauth_bundle
      end
    end
    assert_no_difference("Session.count") { callback(state) }
    assert FreshAuthorization.fresh?(@browser_session)
    assert challenge.reload.verified_at
    assert_empty ShareLink.all
  end

  test "failed replacement starts retain the original callback bundle" do
    create_share
    challenge = FreshAuthorization.last
    state = start_verification(challenge)
    bundle = oauth_bundle
    expired = expired_browser_challenge
    foreign = FreshAuthorization.start!(credential: @user.sessions.create!, purpose: "analytics_destination")

    [ SecureRandom.uuid, expired.public_id, foreign.public_id, challenge.public_id ].each do |id|
      assert_difference("SecurityAuditEvent.count", 1) { post fresh_authorization_path(id) }
      assert_equal I18n.t("fresh_authorization.failure"), flash[:alert]
      assert_equal bundle, oauth_bundle
    end
    assert_nil expired.reload.oauth_state_digest
    assert_nil foreign.reload.oauth_state_digest
    assert_no_difference("Session.count") { callback(state) }
    assert FreshAuthorization.fresh?(@browser_session)
  end

  test "cancelling another challenge cannot discard the pending callback" do
    create_share
    challenge = FreshAuthorization.last
    state = start_verification(challenge)
    bundle = oauth_bundle
    expired = expired_browser_challenge
    foreign = FreshAuthorization.start!(credential: @user.sessions.create!, purpose: "analytics_destination")
    other = FreshAuthorization.start!(credential: @browser_session, purpose: "analytics_destination")

    [ SecureRandom.uuid, expired.public_id, foreign.public_id, other.public_id ].each do |id|
      assert_difference("SecurityAuditEvent.count", 1) { delete fresh_authorization_path(id) }
      assert_equal bundle, oauth_bundle
    end
    assert other.reload.consumed_at
    assert_no_difference("Session.count") { callback(state) }
    assert FreshAuthorization.fresh?(@browser_session)
  end

  test "cancelling the active flow clears its whole bundle even without an App" do
    create_share
    challenge = FreshAuthorization.last
    state = start_verification(challenge)
    GithubAppConfiguration.current.destroy!

    delete fresh_authorization_path(challenge.public_id)
    assert_equal I18n.t("fresh_authorization.cancelled"), flash[:alert]
    assert oauth_bundle.values.all?(&:nil?)
    assert_no_difference("Session.count") { callback(state) }
    assert_not FreshAuthorization.fresh?(@browser_session)
    assert_empty ShareLink.all
  end

  test "signed out canvas failures and unrelated cancellation preserve the active generation" do
    grant, = canvas_grant
    other_grant, = canvas_grant
    challenge = FreshAuthorization.start!(credential: grant, purpose: "never_expiring_share")
    expired = travel_to(16.minutes.ago) do
      FreshAuthorization.start!(credential: other_grant, purpose: "never_expiring_share")
    end
    other = FreshAuthorization.start!(credential: other_grant, purpose: "never_expiring_share")
    delete session_path
    state = start_verification(challenge)
    bundle = oauth_bundle
    assert_equal SessionRevocation.current.generation, bundle.fetch("github_oauth_generation")

    get fresh_authorization_path(expired.public_id)
    assert_equal bundle, oauth_bundle
    [ expired.public_id, challenge.public_id ].each do |id|
      post fresh_authorization_path(id)
      assert_equal I18n.t("fresh_authorization.failure"), flash[:alert]
      assert_equal bundle, oauth_bundle
    end
    delete fresh_authorization_path(other.public_id)
    assert_equal bundle, oauth_bundle
    assert other.reload.consumed_at
    assert_no_difference("Session.count") { callback(state) }
    assert FreshAuthorization.fresh?(grant)
    assert_not FreshAuthorization.fresh?(other_grant)
  end

  test "unrelated challenge requests also preserve an ordinary sign in" do
    post github_authentication_path
    state = Rack::Utils.parse_query(URI(response.location).query).fetch("state")
    bundle = oauth_bundle
    foreign = FreshAuthorization.start!(credential: @user.sessions.create!, purpose: "analytics_destination")
    other = FreshAuthorization.start!(credential: @browser_session, purpose: "analytics_destination")

    get fresh_authorization_path(SecureRandom.uuid)
    assert_equal bundle, oauth_bundle
    post fresh_authorization_path(foreign.public_id)
    assert_equal bundle, oauth_bundle
    delete fresh_authorization_path(other.public_id)
    assert_equal bundle, oauth_bundle
    assert_difference("Session.count", 1) { callback(state) }
    assert FreshAuthorization.fresh?(@user.sessions.order(:id).last)
    assert_not FreshAuthorization.fresh?(@browser_session)
  end

  test "invalid enrollment leaves browser and signed out canvas verification intact" do
    grant, = canvas_grant
    [ @browser_session, grant ].each do |credential|
      challenge = FreshAuthorization.start!(credential:, purpose: "never_expiring_share")
      delete session_path if credential == grant
      state = start_verification(challenge)
      bundle = oauth_bundle

      post hub_admin_enrollment_path, params: { bootstrap_secret: "wrong" }
      assert_response :not_found
      assert_equal bundle, oauth_bundle
      assert_no_difference("Session.count") { callback(state) }
      assert_equal I18n.t("fresh_authorization.succeeded"), flash[:notice]
      assert FreshAuthorization.fresh?(credential)
      assert_not @user.reload.hub_admin?
      assert_empty ShareLink.all
    end
  end

  test "invalid enrollment cannot turn a deleted expired or revoked challenge into sign in" do
    grant, = canvas_grant
    [ [ @browser_session, :deleted ], [ @browser_session, :expired ], [ grant, :revoked ] ].each do |credential, failure|
      challenge = FreshAuthorization.start!(credential:, purpose: "never_expiring_share")
      delete session_path if credential == grant
      state = start_verification(challenge)
      bundle = oauth_bundle

      post hub_admin_enrollment_path, params: { bootstrap_secret: "wrong" }
      assert_response :not_found
      assert_equal bundle, oauth_bundle
      case failure
      when :deleted
        challenge.destroy!
      when :expired
        travel_to challenge.expires_at, with_usec: true
      when :revoked
        grant.revoke!
      end
      assert_no_difference("Session.count") { callback(state) }
      assert_equal I18n.t("fresh_authorization.failure"), flash[:alert]
      assert_not FreshAuthorization.fresh?(credential)
      assert_not @user.reload.hub_admin?
      assert_empty ShareLink.all
      travel_back
    end
  ensure
    travel_back
  end

  test "canvas verification renews only the same grant and not its verification browser" do
    first, headers = canvas_grant
    second, = canvas_grant
    api = canvas_api_share_links_path(@repository.route_id, @prototype)
    input = { share_link: { label: "Canvas", build_number: @build.number, expiration: "never" } }
    assert_no_difference("ShareLink.count") { post api, headers:, params: input, as: :json }
    assert_response :forbidden
    response_data = response.parsed_body
    assert_equal "fresh_authorization_required", response_data.fetch("code")
    assert_equal fresh_authorization_url(FreshAuthorization.last.public_id),
      response_data.fetch("authorization").fetch("url")
    challenge = FreshAuthorization.last
    callback(start_verification(challenge))
    assert FreshAuthorization.fresh?(first)
    assert_not FreshAuthorization.fresh?(second)
    assert_not FreshAuthorization.fresh?(@browser_session)
    event = SecurityAuditEvent.where(action: "fresh_authorization.verify").last
    assert_equal({ "source" => "canvas", "canvas_grant_id" => first.id,
      "device_family" => "unknown", "browser_family" => "unknown" }, event.context)
    assert_difference("ShareLink.count", 1) { post api, headers:, params: input, as: :json }
    assert_response :created
  end

  test "a signed out browser can verify a canvas scope without creating a browser Session" do
    grant, headers = canvas_grant
    post canvas_api_share_links_path(@repository.route_id, @prototype), headers:,
      params: { share_link: { label: "Canvas", build_number: @build.number, expiration: "never" } }, as: :json
    challenge = FreshAuthorization.last
    delete session_path
    get fresh_authorization_path(challenge.public_id)
    assert_response :success
    state = start_verification(challenge)
    assert_no_difference("Session.count") { callback(state) }
    assert FreshAuthorization.fresh?(grant)
    follow_redirect!(as: :json)
    assert_verification_notice
    assert_empty ShareLink.all
  end

  test "canvas success survives signed in root and repository redirects" do
    grant, = canvas_grant
    challenge = FreshAuthorization.start!(credential: grant, purpose: "never_expiring_share")
    assert_no_difference("ShareLink.count") { callback(start_verification(challenge)) }
    assert_redirected_to root_path
    follow_redirect!
    assert_redirected_to repositories_path
    follow_redirect!
    assert_redirected_to repository_path(@repository.route_id)
    follow_redirect!(as: :json)
    assert_verification_notice
    assert_not FreshAuthorization.fresh?(@browser_session)
  end

  test "canvas success reaches the signed in operator's repository page" do
    @user.update!(hub_admin: true)
    grant, = canvas_grant
    challenge = FreshAuthorization.start!(credential: grant, purpose: "never_expiring_share")
    assert_no_difference("ShareLink.count") { callback(start_verification(challenge)) }
    assert_redirected_to root_path
    follow_redirect!
    assert_redirected_to repositories_path
    follow_redirect!
    assert_redirected_to repository_path(@repository.route_id)
    follow_redirect!(as: :json)
    assert_verification_notice
    assert_not FreshAuthorization.fresh?(@browser_session)
  end

  test "the exact five minute boundary gates sharing and every analytics mutation" do
    travel_to Time.current.change(usec: 0) do
      @browser_session.update!(fresh_authorized_at: Time.current)
      assert_difference("ShareLink.count", 1) { create_share }
      @browser_session.update!(fresh_authorized_at: 5.minutes.ago)
      assert_no_difference("ShareLink.count") { create_share }
      assert_no_difference("Analytics::Destination.count") do
        post @analytics_path, params: { destination: analytics_configuration }
      end
      assert_equal "analytics_destination", FreshAuthorization.last.purpose
    end
  end

  test "submitted identities and timestamps cannot replace server proof" do
    post @share_path, params: {
      user_id: @user.id, actor_github_id: @user.github_id, fresh_authorized_at: Time.current.iso8601,
      share_link: { label: "Forged", build_number: @build.number, expiration: "never" }
    }
    assert_equal "never_expiring_share", FreshAuthorization.last.purpose
    assert_not FreshAuthorization.fresh?(@browser_session)
    assert_empty ShareLink.all
  end

  test "starting or cancelling a browser challenge cannot bypass forgery protection" do
    create_share
    challenge = FreshAuthorization.last
    previous = ActionController::Base.allow_forgery_protection
    ActionController::Base.allow_forgery_protection = true
    post fresh_authorization_path(challenge.public_id)
    assert_response :unprocessable_entity
    assert_nil challenge.reload.oauth_state_digest
    delete fresh_authorization_path(challenge.public_id)
    assert_response :unprocessable_entity
    assert_nil challenge.reload.consumed_at
    assert_not FreshAuthorization.fresh?(@browser_session)
  ensure
    ActionController::Base.allow_forgery_protection = previous
  end

  test "revocation while GitHub is verifying cannot resurrect a canvas grant" do
    grant, headers = canvas_grant
    post canvas_api_share_links_path(@repository.route_id, @prototype), headers:,
      params: { share_link: { label: "Canvas", build_number: @build.number, expiration: "never" } }, as: :json
    state = start_verification(FreshAuthorization.last)
    grant.revoke!
    callback(state)
    assert_equal I18n.t("fresh_authorization.failure"), flash[:alert]
    assert_nil grant.reload.fresh_authorized_at
    assert_empty ShareLink.all
  end

  test "session removal while GitHub is verifying cannot recreate that Session" do
    create_share
    state = start_verification(FreshAuthorization.last)
    @browser_session.destroy!
    assert_no_difference("Session.count") { callback(state) }
    assert_equal I18n.t("fresh_authorization.failure"), flash[:alert]
    assert_empty ShareLink.all
  end

  test "a deleted challenge cannot become an ordinary GitHub sign in" do
    create_share
    challenge = FreshAuthorization.last
    state = start_verification(challenge)
    challenge.destroy!
    assert_no_difference("Session.count") { callback(state) }
    assert_equal I18n.t("fresh_authorization.failure"), flash[:alert]
    assert_not FreshAuthorization.fresh?(@browser_session)
    assert_empty ShareLink.all
    assert_no_difference("Session.count") { callback(state) }
  end

  test "callback failure without an App consumes the generation and cannot become ordinary sign in" do
    create_share
    challenge = FreshAuthorization.last
    state = start_verification(challenge)
    configuration = GithubAppConfiguration.current
    saved = configuration.attributes.except("id", "created_at", "updated_at")
    configuration.destroy!

    assert_no_difference("Session.count") { callback(state) }
    assert_equal I18n.t("fresh_authorization.failure"), flash[:alert]
    assert oauth_bundle.values.all?(&:nil?)
    GithubAppConfiguration.create!(saved)
    assert_no_difference("Session.count") { callback(state) }
    assert_not FreshAuthorization.fresh?(@browser_session)
  end

  test "a challenge deleted during GitHub verification returns failure without signing in" do
    create_share
    challenge = FreshAuthorization.last
    state = start_verification(challenge)
    stub_request(:get, "#{GITHUB_API_URL}/user").to_return do
      challenge.destroy!
      { status: 200, body: { id: @user.github_id, login: @user.login }.to_json,
        headers: { "Content-Type" => "application/json" } }
    end
    assert_no_difference("Session.count") { callback(state) }
    assert_equal I18n.t("fresh_authorization.failure"), flash[:alert]
    assert_not FreshAuthorization.fresh?(@browser_session)
    assert_empty ShareLink.all
  end

  test "a challenge expiring during GitHub verification cannot renew the credential" do
    create_share
    challenge = FreshAuthorization.last
    state = start_verification(challenge)
    stub_request(:get, "#{GITHUB_API_URL}/user").to_return do
      travel_to challenge.expires_at, with_usec: true
      { status: 200, body: { id: @user.github_id, login: @user.login }.to_json,
        headers: { "Content-Type" => "application/json" } }
    end
    assert_no_difference("Session.count") { callback(state) }
    assert_equal I18n.t("fresh_authorization.failure"), flash[:alert]
    assert_not FreshAuthorization.fresh?(@browser_session)
    assert_empty ShareLink.all
  ensure
    travel_back
  end

  private

  # Creates an expired request without changing its immutable deadline.
  def expired_browser_challenge
    travel_to 16.minutes.ago do
      FreshAuthorization.start!(credential: @browser_session, purpose: "analytics_destination")
    end
  end

  # Checks the redirected page projection, not just the callback's flash.
  def assert_verification_notice
    assert_response :success
    data = JSON.parse(response.body).fetch("data")
    assert_equal I18n.t("fresh_authorization.succeeded"), data.fetch("notice")
  end

  # Checks callback routing and PKCE together, not just the surviving marker.
  def oauth_bundle
    %w[fresh_authorization_id hub_admin_enrollment_proof github_oauth_state
      github_oauth_verifier github_oauth_started_at github_oauth_generation
      github_oauth_configuration_id github_oauth_credential_revision].index_with { |key| request.session[key] }
  end

  def sign_in
    post github_authentication_path
    state = Rack::Utils.parse_query(URI(response.location).query).fetch("state")
    callback(state)
  end

  def callback(state)
    get github_authentication_callback_path, params: { code: "code", state: }
  end

  def start_verification(challenge)
    post fresh_authorization_path(challenge.public_id)
    Rack::Utils.parse_query(URI(response.location).query).fetch("state")
  end

  def create_share(expiration: "never")
    post @share_path, params: {
      share_link: { label: "Review secret label", build_number: @build.number, expiration: }
    }
  end

  def canvas_grant
    secret = "rp_#{SecureRandom.urlsafe_base64(32)}"
    grant = CanvasGrant.create! \
      user: @user, repository: @repository,
      token_digest: Digest::SHA256.hexdigest(secret), expires_at: 7.days.from_now
    [ grant, { "Authorization" => "Bearer #{secret}" } ]
  end

  def analytics_configuration
    { provider: "segment", region: "us", history: "new", credentials: { write_key: "submitted-secret" },
      event_types: Analytics::Event::TYPES }
  end
end
