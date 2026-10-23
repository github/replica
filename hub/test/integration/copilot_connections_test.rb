require "open3"
require "test_helper"
require_relative "../support/authorization_continuation_helpers"

class CopilotConnectionsTest < ActionDispatch::IntegrationTest
  include AuthorizationContinuationHelpers

  CLI = Rails.root.join("test/fixtures/files/fake-replica-learning.mjs").to_s

  setup do
    @configuration = github_app_configurations.create_installed
    @payload = repository_payload(2001, "github/prototype")
    stub_github_sign_in(repositories: [ @payload ], permissions: { 2001 => "admin" })
    post github_authentication_path
    state = Rack::Utils.parse_query(URI(response.location).query).fetch("state")
    get github_authentication_callback_path, params: { code: "code", state: }
    @actor = User.find_by!(github_id: 1001)
    @actor.update!(hub_admin: true)
    @session = @actor.sessions.sole
    @previous_cli = ENV["REPLICA_LEARNING_CLI"]
    @previous_token = Rails.configuration.x.copilot_token
    ENV["REPLICA_LEARNING_CLI"] = CLI
    Rails.configuration.x.copilot_token = "copilot-user-token"
  end

  teardown do
    ENV["REPLICA_LEARNING_CLI"] = @previous_cli
    Rails.configuration.x.copilot_token = @previous_token
  end

  test "connecting checks the operator's token with Copilot and never shows it" do
    get copilot_connection_path, as: :json
    assert_equal [ false, nil ], [ data.fetch("connected"), data.fetch("tokenLabel") ]
    assert_equal I18n.t("copilot_connection.connect.label"), data.dig("connect", "label")

    post copilot_connection_path, params: { confirmed: "1" }

    assert_redirected_to copilot_connection_path
    assert_equal I18n.t("copilot_connection.connected"), flash[:notice]
    assert_equal @actor, CopilotConnection.current.user
    assert_equal "succeeded", SecurityAuditEvent.where(action: "copilot_connection.connect").sole.outcome

    repository = Repository.find_by(github_id: 2_001) || repositories.create
    Learning::Run.create! \
      repository:,
      scheduled: true,
      state: "succeeded",
      created_at: 31.days.ago,
      started_at: 29.days.ago,
      copilot_requests: 2,
      nano_aiu: 147_000_000
    Learning::Run.create! \
      repository:,
      scheduled: true,
      state: "succeeded",
      copilot_requests: 9,
      nano_aiu: 9_000_000_000,
      created_at: 32.days.ago,
      started_at: 31.days.ago
    get copilot_connection_path, as: :json
    assert_equal true, data.fetch("connected")
    assert_match "@octocat connected Copilot", data.fetch("connectedBy")
    assert_equal \
      "In the last 30 days, Learnings used 0.147 AI credits in 2 Copilot requests.",
      data.fetch("usageLabel")
    assert_nil data.fetch("connect")
    assert_equal I18n.t("copilot_connection.disconnect.label"), data.dig("disconnect", "label")
    assert_not_includes response.body, "copilot-user-token"
  end

  test "without a token, the page says how to set one and connecting changes nothing" do
    Rails.configuration.x.copilot_token = nil

    get copilot_connection_path, as: :json
    assert_equal I18n.t("copilot_connection.no_token"), data.fetch("tokenLabel")
    assert_nil data.fetch("connect")

    post copilot_connection_path, params: { confirmed: "1" }

    assert_redirected_to copilot_connection_path
    assert_equal I18n.t("copilot_connection.errors.no_token"), flash[:alert]
    assert_nil CopilotConnection.current
    assert_equal "denied", SecurityAuditEvent.where(action: "copilot_connection.connect").sole.outcome
  end

  test "connects nothing when Copilot refuses the token, cannot be reached, or replica-learning is missing" do
    {
      "no-copilot-token" => [ :refused, "denied" ],
      "offline-token" => [ :unavailable, "failed" ],
      "uninstalled-token" => [ :not_installed, "failed" ]
    }.each do |token, (reason, outcome)|
      Rails.configuration.x.copilot_token = token

      post copilot_connection_path, params: { confirmed: "1" }

      assert_redirected_to copilot_connection_path
      assert_equal I18n.t("copilot_connection.errors.#{reason}"), flash[:alert], token
      assert_nil CopilotConnection.current
      assert_equal outcome, SecurityAuditEvent.where(action: "copilot_connection.connect").last.outcome, token
    end
  end

  test "a refused token can be checked again, and a token that works clears the refusal" do
    post copilot_connection_path, params: { confirmed: "1" }
    CopilotConnection.current.refuse!

    get copilot_connection_path, as: :json
    assert_match "Copilot refused the token", data.fetch("refusedLabel")
    assert_equal I18n.t("copilot_connection.reconnect.label"), data.dig("connect", "label")

    post copilot_connection_path, params: { confirmed: "1" }

    assert_equal I18n.t("copilot_connection.connected"), flash[:notice]
    assert_not CopilotConnection.current.refused?
  end

  test "a successful check reports cancellation instead of restoring a disconnected connection" do
    post copilot_connection_path, params: { confirmed: "1" }
    check = CopilotConnection.method(:check!)
    CopilotConnection.define_singleton_method(:check!) do |_token|
      CopilotConnection.current.destroy!
      {}
    end

    post copilot_connection_path, params: { confirmed: "1" }

    assert_redirected_to copilot_connection_path
    assert_equal I18n.t("copilot_connection.errors.connection_changed"), flash[:alert]
    assert_nil CopilotConnection.current
    assert_equal 1, SecurityAuditEvent.where(action: "copilot_connection.connect", outcome: "succeeded").count
    assert_equal 1, SecurityAuditEvent.where(action: "copilot_connection.connect", outcome: "denied").count
  ensure
    CopilotConnection.define_singleton_method(:check!, check) if check
    CopilotConnection.private_class_method(:check!)
  end

  test "connecting continues after fresh GitHub proof without another confirmation" do
    @session.update!(fresh_authorized_at: nil)

    post copilot_connection_path, params: { confirmed: "1" }
    challenge = FreshAuthorization.last
    assert_equal "copilot_connection", challenge.purpose
    assert_redirected_to fresh_authorization_path(challenge.public_id)
    form = verify_pending_action(challenge, path: copilot_connection_path, method: "post")
    assert_nil CopilotConnection.current
    continue_pending_action(form)

    assert_equal I18n.t("copilot_connection.connected"), flash[:notice]
    assert CopilotConnection.current
  end

  test "changes need confirmation, and only Hub administrators can see or change the connection" do
    post copilot_connection_path
    assert_redirected_to copilot_connection_path
    assert_equal I18n.t("copilot_connection.errors.confirmation_required"), flash[:alert]

    @actor.update!(hub_admin: false)
    assert_no_difference "FreshAuthorization.count" do
      get copilot_connection_path, as: :json
      assert_response :forbidden
      assert_equal true, data.fetch("accessDenied")
      assert_not data.key?("connect")
      post copilot_connection_path, params: { confirmed: "1" }
      assert_response :forbidden
    end
  end

  test "disconnecting continues after fresh proof and leaves the token with the operator" do
    post copilot_connection_path, params: { confirmed: "1" }
    @session.update!(fresh_authorized_at: nil)

    delete copilot_connection_path, params: { confirmed: "1" }
    challenge = FreshAuthorization.last
    assert_equal "copilot_disconnection", challenge.purpose
    assert_redirected_to fresh_authorization_path(challenge.public_id)
    form = verify_pending_action(challenge, path: copilot_connection_path, method: "delete")
    assert CopilotConnection.current
    continue_pending_action(form)

    assert_redirected_to copilot_connection_path
    assert_equal I18n.t("copilot_connection.disconnected"), flash[:notice]
    assert_nil CopilotConnection.current
    assert_not_requested :delete, %r{/applications/.+/token}
  end

  test "Hub administration links to the Copilot page" do
    get security_audit_path, as: :json

    links = data.dig("administrationWorkspace", "administrationLinks")
    copilot_link = {
      "section" => "copilot",
      "label" => "Copilot",
      "path" => copilot_connection_path(repository_github_id: 2001)
    }
    assert_includes links, copilot_link
    assert_equal copilot_connection_path, data.fetch("copilotConnectionPath")
  end

  test "local development has no Copilot page" do
    root = Rails.root.join("storage", "local-prototypes-test-#{SecureRandom.hex(5)}")
    committed_checkout(root.join("prototypes"))
    original_enabled = LocalDevelopment.method(:enabled?)
    original_root = LocalDevelopment.method(:repositories_root)
    LocalDevelopment.define_singleton_method(:enabled?) { true }
    LocalDevelopment.define_singleton_method(:repositories_root) { root }
    host! "replica.localhost:19500"
    post local_authentication_path
    assert_redirected_to welcome_path

    get copilot_connection_path
    assert_response :not_found
  ensure
    LocalDevelopment.define_singleton_method(:enabled?, original_enabled)
    LocalDevelopment.define_singleton_method(:repositories_root, original_root)
    FileUtils.rm_rf(root)
  end

  private

  # A checkout with one commit, so local sign-in finds a repository whatever this machine has on disk.
  def committed_checkout(path)
    FileUtils.mkdir_p(path)
    [ %w[init -q -b main], %w[-c user.name=Local -c user.email=local@example.invalid commit -q --allow-empty -m initial] ]
      .each do |arguments|
        _output, error, status = Open3.capture3("git", "-C", path.to_s, *arguments)
        assert status.success?, error
      end
  end

  def data
    JSON.parse(response.body).fetch("data")
  end
end
