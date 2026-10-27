require "test_helper"
require_relative "../support/security_rate_limit_store"

class GithubAppSetupRateLimitsTest < ActionDispatch::IntegrationTest
  include SecurityRateLimitStore

  setup do
    use_security_rate_limit_store
    travel_to Time.current.change(usec: 0)
    @previous_bootstrap_secret = ENV["REPLICA_BOOTSTRAP_SECRET"]
    ENV["REPLICA_BOOTSTRAP_SECRET"] = github_app_configurations.bootstrap_secret
  end

  teardown do
    ENV["REPLICA_BOOTSTRAP_SECRET"] = @previous_bootstrap_secret
    restore_security_rate_limit_store
    travel_back
  end

  test "ten rejected secrets exhaust the budget across browser session resets" do
    10.times do
      reset!
      post setup_path, params: { bootstrap_secret: "wrong" }, as: :json
      assert_response :not_found
    end

    reset!
    assert_no_difference("SecurityAuditEvent.count") do
      post setup_path, params: { bootstrap_secret: "wrong" }, as: :json
      assert_security_throttle(60)
    end
  end

  test "an exhausted budget blocks the correct secret without authorizing or auditing until expiry" do
    started = Time.current
    10.times do
      post setup_path, params: { bootstrap_secret: "wrong" }, as: :json
      assert_response :not_found
    end

    assert_no_difference("SecurityAuditEvent.count") do
      post setup_path, params: { bootstrap_secret: github_app_configurations.bootstrap_secret }, as: :json
      assert_security_throttle(60)
    end
    get setup_path, as: :json
    assert_response :success
    assert_includes response.body, "github_app_setup/show"
    assert_not_includes response.body, "github_app_setup/register"

    travel_to started + 59.seconds
    post setup_path, params: { bootstrap_secret: github_app_configurations.bootstrap_secret }, as: :json
    assert_security_throttle(60)

    travel_to started + 1.minute
    assert_difference("SecurityAuditEvent.where(action: 'github_app_setup.authorize', outcome: 'succeeded').count") do
      post setup_path, params: { bootstrap_secret: github_app_configurations.bootstrap_secret }, as: :json
      assert_redirected_to setup_path
    end
    get setup_path, as: :json
    assert_response :success
    assert_includes response.body, "github_app_setup/register"
  end

  test "untrusted forwarded addresses cannot split a peer budget while another peer has its own" do
    10.times do |index|
      post setup_path, params: { bootstrap_secret: "wrong" }, headers: {
        "REMOTE_ADDR" => "203.0.113.10", "X-Forwarded-For" => "198.51.100.#{index + 1}"
      }, as: :json
      assert_response :not_found
    end

    post setup_path, params: { bootstrap_secret: "wrong" }, headers: {
      "REMOTE_ADDR" => "203.0.113.10", "X-Forwarded-For" => "198.51.100.200"
    }, as: :json
    assert_security_throttle(60)

    post setup_path, params: { bootstrap_secret: "wrong" },
      headers: { "REMOTE_ADDR" => "203.0.113.11" }, as: :json
    assert_response :not_found
  end

  test "setup reads callback and installation requests do not spend the authorization budget" do
    10.times do
      get setup_path, as: :json
      assert_response :success
      get callback_setup_path, params: { code: "unused", state: "invalid" }, as: :json
      assert_response :not_found
      get install_setup_path, params: { installation_id: 456 }, as: :json
      assert_response :not_found
    end

    10.times do
      post setup_path, params: { bootstrap_secret: "wrong" }, as: :json
      assert_response :not_found
    end
    post setup_path, params: { bootstrap_secret: "wrong" }, as: :json
    assert_security_throttle(60)
  end
end
