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
    @previous_billing = Rails.configuration.x.copilot_billing
    ENV["REPLICA_LEARNING_CLI"] = CLI
    Rails.configuration.x.copilot_token = "copilot-user-token"
  end

  teardown do
    ENV["REPLICA_LEARNING_CLI"] = @previous_cli
    Rails.configuration.x.copilot_token = @previous_token
    Rails.configuration.x.copilot_billing = @previous_billing
  end

  test "connecting checks the operator's token with Copilot and never shows it" do
    get copilot_connection_path, as: :json
    assert_equal \
      [ false, nil, I18n.t("copilot_connection.billing") ],
      [ data.fetch("connected"), data.fetch("setupLabel"), data.fetch("billingLabel") ]
    assert_equal I18n.t("copilot_connection.connect.label"), data.dig("connect", "label")

    post copilot_connection_path, params: connect_params

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
    assert_equal [ I18n.t("copilot_connection.no_token"), nil ], [ data.fetch("setupLabel"), data.fetch("billingLabel") ]
    assert_nil data.fetch("connect")

    post copilot_connection_path, params: connect_params

    assert_redirected_to copilot_connection_path
    assert_equal I18n.t("copilot_connection.errors.confirmation_changed"), flash[:alert]
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

      post copilot_connection_path, params: connect_params

      assert_redirected_to copilot_connection_path
      assert_equal I18n.t("copilot_connection.errors.#{reason}"), flash[:alert], token
      assert_nil CopilotConnection.current
      assert_equal outcome, SecurityAuditEvent.where(action: "copilot_connection.connect").last.outcome, token
    end
  end

  test "a refused token can be checked again, and a token that works clears the refusal" do
    post copilot_connection_path, params: connect_params
    CopilotConnection.current.refuse!

    get copilot_connection_path, as: :json
    assert_match "Copilot refused the token", data.fetch("refusedLabel")
    assert_equal I18n.t("copilot_connection.reconnect.label"), data.dig("connect", "label")

    post copilot_connection_path, params: connect_params

    assert_equal I18n.t("copilot_connection.connected"), flash[:notice]
    assert_not CopilotConnection.current.refused?
  end

  test "with organization billing, the page names the organization Copilot bills, also once Copilot refuses Hub's App" do
    Rails.configuration.x.copilot_billing = "organization"
    Rails.configuration.x.copilot_token = nil
    stub_github_copilot_token("copilot-user-token")

    get copilot_connection_path, as: :json
    assert_equal \
      [ I18n.t("copilot_connection.organization.billing", organization: "github"),
        I18n.t("copilot_connection.organization.connect.consequence", organization: "github"),
        I18n.t("copilot_connection.organization.connect.confirm", organization: "github") ],
      [ data.fetch("billingLabel"), data.dig("connect", "consequence"), data.dig("connect", "confirmLabel") ]

    post copilot_connection_path, params: connect_params
    assert_equal I18n.t("copilot_connection.connected"), flash[:notice]
    CopilotConnection.current.refuse!

    get copilot_connection_path, as: :json
    assert_equal \
      [ I18n.t("copilot_connection.organization.refused", date: Date.current.to_fs(:long), organization: "github"),
        I18n.t("copilot_connection.organization.reconnect.label") ],
      [ data.fetch("refusedLabel"), data.dig("connect", "label") ]
  end

  test "after organization billing is turned on, the page asks an administrator to connect Copilot again" do
    token_owner_confirmation = CopilotConnection.billing_confirmation
    post copilot_connection_path, params: connect_params
    Rails.configuration.x.copilot_billing = "organization"
    stub_github_copilot_token("copilot-user-token")

    get copilot_connection_path, as: :json
    assert_equal \
      [ I18n.t("copilot_connection.organization.unconfirmed", organization: "github"),
        I18n.t("copilot_connection.connect.label") ],
      [ data.fetch("setupLabel"), data.dig("connect", "label") ]

    post copilot_connection_path, params: {
      confirmed: "1",
      billing_confirmation: token_owner_confirmation
    }
    assert_equal I18n.t("copilot_connection.errors.confirmation_changed"), flash[:alert]
    assert_not CopilotConnection.current.confirmed?

    post copilot_connection_path, params: connect_params
    get copilot_connection_path, as: :json
    assert_equal [ nil, nil ], [ data.fetch("setupLabel"), data.fetch("connect") ]
  end

  test "with organization billing, a form cannot confirm an installation that changed after it rendered" do
    Rails.configuration.x.copilot_billing = "organization"
    confirmation = CopilotConnection.billing_confirmation
    @configuration.update!(installation_id: 789)
    mint = stub_github_copilot_token("unconfirmed-token", installation_id: 789)

    post copilot_connection_path, params: {
      confirmed: "1",
      billing_confirmation: confirmation
    }

    assert_redirected_to copilot_connection_path
    assert_equal I18n.t("copilot_connection.errors.confirmation_changed"), flash[:alert]
    assert_nil CopilotConnection.current
    assert_not_requested mint
  end

  test "with organization billing, connects nothing when the App lacks the Copilot permission or GitHub fails" do
    Rails.configuration.x.copilot_billing = "organization"
    failures = [
      [ 422, github_copilot_permission_missing_error, "copilot_connection.errors.permission_missing", "denied" ],
      [ 422, { message: "Validation Failed", errors: [ { code: "abuse" } ] },
        "copilot_connection.organization.errors.unavailable", "failed" ],
      [ 500, nil, "copilot_connection.organization.errors.unavailable", "failed" ]
    ]
    failures.each do |status, body, alert, outcome|
      stub_github_copilot_token(error_status: status, error_body: body)

      post copilot_connection_path, params: connect_params

      assert_redirected_to copilot_connection_path
      assert_equal I18n.t(alert), flash[:alert], "HTTP #{status}"
      assert_nil CopilotConnection.current
      assert_equal outcome, SecurityAuditEvent.where(action: "copilot_connection.connect").last.outcome, "HTTP #{status}"
    end
  end

  test "with organization billing, a changed App configuration during token minting connects nothing" do
    Rails.configuration.x.copilot_billing = "organization"
    request = stub_request(:post, "#{GITHUB_API_URL}/app/installations/456/access_tokens")
      .with(body: { permissions: { organization_copilot_requests: "read" } })
      .to_return do
        @configuration.update_columns(credential_revision: @configuration.credential_revision + 1)
        {
          status: 201,
          body: JSON.generate(
            token: "copilot-user-token",
            expires_at: 1.hour.from_now.iso8601,
            permissions: { organization_copilot_requests: "read" }
          ),
          headers: { "Content-Type" => "application/json" }
        }
      end

    post copilot_connection_path, params: connect_params

    assert_redirected_to copilot_connection_path
    assert_nil CopilotConnection.current
    assert_not_equal I18n.t("copilot_connection.connected"), flash[:notice]
    assert_empty SecurityAuditEvent.where(action: "copilot_connection.connect", outcome: "succeeded")
    assert_requested request
  end

  test "with organization billing, a disconnect during token minting discards the token before checking Copilot" do
    Rails.configuration.x.copilot_billing = "organization"
    CopilotConnection.create! \
      user: @actor,
      token_digest: CopilotConnection.digest(CopilotConnection.credential),
      verified_at: 1.day.ago
    checked = false
    check = CopilotConnection.method(:check!)
    CopilotConnection.define_singleton_method(:check!) { |_token| checked = true }
    request = stub_request(:post, "#{GITHUB_API_URL}/app/installations/456/access_tokens")
      .with(body: { permissions: { organization_copilot_requests: "read" } })
      .to_return do
        CopilotConnection.disconnect!(actor: @actor, browser_session: @session)
        {
          status: 201,
          body: JSON.generate(
            token: "copilot-user-token",
            expires_at: 1.hour.from_now.iso8601,
            permissions: { organization_copilot_requests: "read" }
          ),
          headers: { "Content-Type" => "application/json" }
        }
      end

    post copilot_connection_path, params: connect_params

    assert_redirected_to copilot_connection_path
    assert_equal I18n.t("copilot_connection.errors.connection_changed"), flash[:alert]
    assert_nil CopilotConnection.current
    assert_not checked
    assert_requested request
  ensure
    CopilotConnection.define_singleton_method(:check!, check) if check
    CopilotConnection.private_class_method(:check!)
  end

  test "with organization billing, the page tells a personal-account App from an organization App without an active installation" do
    Rails.configuration.x.copilot_billing = "organization"
    @configuration.update!(owner_type: "User")

    get copilot_connection_path, as: :json
    assert_equal I18n.t("copilot_connection.organization.personal_app"), data.fetch("setupLabel")

    post copilot_connection_path, params: connect_params

    assert_redirected_to copilot_connection_path
    assert_equal I18n.t("copilot_connection.errors.confirmation_changed"), flash[:alert]

    @configuration.update!(owner_type: "Organization", installation_state: "suspended", suspended_at: Time.current)
    get copilot_connection_path, as: :json
    assert_equal I18n.t("copilot_connection.organization.no_token"), data.fetch("setupLabel")
  end

  test "a successful check reports cancellation instead of restoring a disconnected connection" do
    post copilot_connection_path, params: connect_params
    check = CopilotConnection.method(:check!)
    CopilotConnection.define_singleton_method(:check!) do |_token|
      CopilotConnection.current.destroy!
      {}
    end

    post copilot_connection_path, params: connect_params

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

    post copilot_connection_path, params: connect_params
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
      post copilot_connection_path, params: connect_params
      assert_response :forbidden
    end
  end

  test "disconnecting continues after fresh proof and leaves the token with the operator" do
    post copilot_connection_path, params: connect_params
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

  def connect_params
    { confirmed: "1", billing_confirmation: CopilotConnection.billing_confirmation }
  end

  def data
    JSON.parse(response.body).fetch("data")
  end
end
