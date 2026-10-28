require "test_helper"

# Committed fixtures expose real transaction boundaries during GitHub requests.
class GithubAppInstallationAtomicityTest < ActionDispatch::IntegrationTest
  self.use_transactional_tests = false

  setup do
    @audit_floor = SecurityAuditEvent.maximum(:id) || 0
    @original_secret = ENV["REPLICA_BOOTSTRAP_SECRET"]
    ENV["REPLICA_BOOTSTRAP_SECRET"] = github_app_configurations.bootstrap_secret
    start_installation
    @renamed = repositories.create
    @removed = repositories.create(github_id: 2002, name_with_owner: "github/removed")
    stub_installation
  end

  teardown do
    Repository.where(github_id: [ @renamed&.github_id, @removed&.github_id, 2003 ]).delete_all
    if @configuration
      SecurityAuditEvent.where("json_extract(context, '$.github_app_configuration_id') = ?", @configuration.id).delete_all
      GithubAppConfiguration.where(id: @configuration.id).delete_all
    end
    SecurityAuditEvent.where("id > ?", @audit_floor).delete_all
    ENV["REPLICA_BOOTSTRAP_SECRET"] = @original_secret
  end

  test "installation token and repository requests finish before local writes begin" do
    get install_setup_path, params: { installation_id: 456 }

    assert_response :success
    assert_equal "active", @configuration.reload.installation_state
    assert_equal "github/renamed", @renamed.reload.name_with_owner
    assert_equal "removed", @removed.reload.installation_state
    assert Repository.active.exists?(github_id: 2003)
    assert_equal 1, SecurityAuditEvent.where(action: "github_app_setup.install", outcome: "succeeded").count
    get install_setup_path, params: { installation_id: 456 }
    assert_response :not_found
  end

  test "a failed audit rolls back installation and repository changes and preserves browser authorization" do
    configuration_before = installation_state
    repositories_before = repository_state
    original = SecurityAuditEvent.method(:record!)
    SecurityAuditEvent.define_singleton_method(:record!) do |**attributes|
      if attributes[:action] == "github_app_setup.install" && attributes[:outcome] == "succeeded"
        record = SecurityAuditEvent.new
        record.errors.add(:base, "Forced audit failure")
        raise ActiveRecord::RecordInvalid, record
      end
      original.call(**attributes)
    end
    begin
      get install_setup_path, params: { installation_id: 456 }
      assert_response :unprocessable_entity
    ensure
      SecurityAuditEvent.define_singleton_method(:record!, original)
    end

    assert_equal configuration_before, installation_state
    assert_equal repositories_before, repository_state
    assert_empty SecurityAuditEvent.where(action: "github_app_setup.install", outcome: "succeeded")
    get install_setup_path, params: { installation_id: 456 }
    assert_response :success
    assert_equal "active", @configuration.reload.installation_state
    assert_equal 1, SecurityAuditEvent.where(action: "github_app_setup.install", outcome: "succeeded").count
  end

  test "a repository outage cannot save partial installation state or consume authorization" do
    configuration_before = installation_state
    repositories_before = repository_state
    stub_request(:get, "#{GITHUB_API_URL}/installation/repositories")
      .with(query: { "page" => "1", "per_page" => "100" })
      .to_return(status: 503, body: JSON.generate(message: "private-service-detail"))

    get install_setup_path, params: { installation_id: 456 }

    assert_response :not_found
    assert_equal configuration_before, installation_state
    assert_equal repositories_before, repository_state
    event = SecurityAuditEvent.where(action: "github_app_setup.install").sole
    assert_equal "failed", event.outcome
    assert_not_includes event.attributes.to_s, "private-service-detail"
    stub_installation
    get install_setup_path, params: { installation_id: 456 }
    assert_response :success
  end

  test "invalid repository snapshots cannot save installation state" do
    configuration_before = installation_state
    repositories_before = repository_state
    stub_request(:get, "#{GITHUB_API_URL}/installation/repositories")
      .with(query: { "page" => "1", "per_page" => "100" })
      .to_return(status: 200, body: JSON.generate(repositories: [
        repository_payload(2001, "github/renamed"), { id: 0, full_name: "private-response-detail", default_branch: "" }
      ]))

    get install_setup_path, params: { installation_id: 456 }

    assert_response :not_found
    assert_equal configuration_before, installation_state
    assert_equal repositories_before, repository_state
    assert_empty SecurityAuditEvent.where(action: "github_app_setup.install", outcome: "succeeded")
  end

  private

  def start_installation
    post setup_path, params: { bootstrap_secret: github_app_configurations.bootstrap_secret }
    get setup_path, as: :json
    registration = JSON.parse(response.body).fetch("data")
    state = Rack::Utils.parse_query(URI(registration.fetch("submitPath")).query).fetch("state")
    @credentials = github_app_configurations.manifest_credentials
    stub_request(:post, "#{GITHUB_API_URL}/app-manifests/temporary/conversions")
      .to_return(status: 201, body: JSON.generate(@credentials))
    get callback_setup_path, params: { code: "temporary", state: }
    assert_response :redirect
    @configuration = GithubAppConfiguration.current
  end

  def stub_installation
    stub_request(:get, "#{GITHUB_API_URL}/app/installations/456")
      .with { assert_no_write_transaction }
      .to_return(status: 200, body: JSON.generate(
        id: 456, app_id: @credentials.fetch("id"), account: @credentials.fetch("owner")
      ))
    stub_request(:post, "#{GITHUB_API_URL}/app/installations/456/access_tokens")
      .with { assert_no_write_transaction }
      .to_return(status: 201, body: JSON.generate(token: "installation-token", expires_at: 1.hour.from_now.iso8601))
    stub_request(:get, "#{GITHUB_API_URL}/installation/repositories")
      .with(query: { "page" => "1", "per_page" => "100" }) { assert_no_write_transaction }
      .to_return(status: 200, body: JSON.generate(repositories: [
        repository_payload(2001, "github/renamed"), repository_payload(2003, "github/new")
      ]))
  end

  def assert_no_write_transaction
    assert_not ApplicationRecord.connection.transaction_open?
    true
  end

  def installation_state
    @configuration.reload.attributes.slice \
      "installation_id", "installation_account_github_id", "installation_state", "owner_login", "installed_at",
      "suspended_at", "installation_checked_at", "updated_at"
  end

  def repository_state
    Repository.order(:github_id).pluck \
      :github_id, :name_with_owner, :default_branch, :installation_state,
      :removed_at, :synchronized_at, :updated_at
  end
end
