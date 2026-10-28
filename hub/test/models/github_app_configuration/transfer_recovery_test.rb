require "test_helper"

class GithubAppConfiguration::TransferRecoveryTest < ActiveSupport::TestCase
  test "polling recovers a personal App transfer while retaining credentials and sessions" do
    configuration = github_app_configurations.create_installed \
      owner_github_id: 1001, owner_login: "octocat", owner_type: "User"
    user = users.create
    session = sessions.create(user:, fresh_authorized_at: Time.current)
    repository = repositories.create
    build = builds.create(prototype: prototypes.create(repository:))
    grant = preview_grants.create(build:, session:)
    credentials = configuration.slice \
      :github_app_id, :client_id, :client_secret, :private_key, :webhook_secret, :credential_revision
    owner = { id: 654, login: "new-team", type: "Organization" }
    stub_github_app(configuration:, owner:, slug: "transferred-hub")
    stub_github_account_installation(account: owner, installation_id: 789)
    stub_github_installation_token(installation_id: 789)
    stub_github_repositories([ repository_payload(repository.github_id, "new-team/prototype") ])

    configuration.synchronize_repositories!

    assert_equal credentials, configuration.reload.slice(*credentials.keys)
    assert_equal [ 654, "new-team", "Organization", "transferred-hub" ],
      configuration.slice(:owner_github_id, :owner_login, :owner_type, :app_slug).values
    assert_equal 789, configuration.installation_id
    assert_equal 654, configuration.installation_account_github_id
    assert_equal "active", configuration.installation_state
    assert_equal "new-team/prototype", repository.reload.name_with_owner
    assert_equal session.fresh_authorized_at, session.reload.fresh_authorized_at
    assert_equal session.id, grant.reload.session_id
    assert User.exists?(user.id)
    assert Build.exists?(build.id)
  end

  test "polling discovers a missed installation even when no installation was saved" do
    configuration = github_app_configurations.create
    owner = { id: 654, login: "new-team", type: "Organization" }
    stub_github_app(configuration:, owner:)
    stub_github_account_installation(account: owner, installation_id: 789)
    stub_github_installation_token(installation_id: 789)
    stub_github_repositories([ repository_payload(2001, "new-team/prototype") ])

    configuration.synchronize_repositories!

    assert_equal 789, configuration.reload.installation_id
    assert_equal "active", configuration.installation_state
    assert Repository.active.exists?(github_id: 2001)
  end

  test "an organization transfer retains history while waiting for reinstallation and recovers afterward" do
    configuration = github_app_configurations.create_installed
    repository = repositories.create
    prototype = prototypes.create(repository:)
    build = builds.create_successful(prototype:)
    user = users.create
    comment = ReviewComment.create! \
      prototype:, build:, user:, body: "Retain this review.",
      anchor: {
        schemaVersion: 1, kind: "element",
        route: { pathname: "/", search: "", hash: "" },
        selector: "#save", accessibleName: "Save", tagName: "button", selectedText: "",
        rect: { x: 20, y: 30, width: 100, height: 32 },
        viewport: { width: 1280, height: 720, scrollX: 0, scrollY: 0 },
        elementOffset: { x: 0.5, y: 0.5 }
      }
    owner = { id: 654, login: "new-team", type: "Organization" }
    stub_github_app(configuration:, owner:)
    account_request = stub_github_account_installation(account: owner, status: 404)

    configuration.synchronize_repositories!

    assert_equal 654, configuration.reload.owner_github_id
    assert_equal 321, configuration.installation_account_github_id
    assert_not_equal "active", configuration.installation_state
    assert_equal "removed", repository.reload.installation_state
    assert Build.exists?(build.id)
    assert Prototype.exists?(prototype.id)
    assert User.exists?(user.id)
    assert_equal "Retain this review.", comment.reload.body

    remove_request_stub(account_request)
    stub_github_account_installation(account: owner, installation_id: 789)
    stub_github_installation_token(installation_id: 789)
    stub_github_repositories([ repository_payload(repository.github_id, "new-team/prototype") ])

    configuration.synchronize_repositories!

    assert_equal 789, configuration.reload.installation_id
    assert_equal 654, configuration.installation_account_github_id
    assert_equal "active", repository.reload.installation_state
    assert Build.exists?(build.id)
  end

  test "polling rejects another authenticated App identity before accepting its owner" do
    configuration = github_app_configurations.create_installed
    repository = repositories.create
    stub_github_app \
      configuration:, app_id: 999,
      owner: { id: 654, login: "new-team", type: "Organization" }

    assert_raises(GithubClient::InvalidResponse) { configuration.synchronize_repositories! }

    assert_equal 321, configuration.reload.owner_github_id
    assert_equal 456, configuration.installation_id
    assert_equal "active", repository.reload.installation_state
  end

  test "an installation in another account cannot replace the current owner's installation" do
    configuration = github_app_configurations.create_installed
    owner = { id: 321, login: "github", type: "Organization" }
    stub_github_app(configuration:)
    stub_missing_saved_installation
    stub_github_account_installation \
      account: owner, payload: installation_payload(owner: owner.merge(id: 999), id: 789)

    assert_raises(GithubAppConfiguration::Installation::OwnerMismatch) do
      configuration.synchronize_repositories!
    end

    assert_equal 456, configuration.reload.installation_id
    assert_equal 321, configuration.installation_account_github_id
  end

  test "a forbidden account lookup is not evidence that the installation was removed" do
    configuration = github_app_configurations.create_installed
    repository = repositories.create
    stub_github_app(configuration:)
    stub_missing_saved_installation
    stub_github_account_installation \
      account: { id: 321, login: "github", type: "Organization" }, status: 403

    assert_raises(GithubClient::Forbidden) { configuration.synchronize_repositories! }

    assert_equal "active", configuration.reload.installation_state
    assert_equal 456, configuration.installation_id
    assert_equal "active", repository.reload.installation_state
  end

  test "an owner rename and App slug change keep repository access available" do
    configuration = github_app_configurations.create_installed
    repository = repositories.create
    owner = { id: 321, login: "renamed-team", type: "Organization" }
    stub_github_app(configuration:, owner:, slug: "renamed-hub")
    stub_request(:get, "#{GITHUB_API_URL}/app/installations/456")
      .to_return(status: 200, body: JSON.generate(installation_payload(owner:, id: 456)))
    stub_github_installation_token
    stub_github_repositories([ repository_payload(repository.github_id, "renamed-team/prototype") ])

    configuration.synchronize_repositories!

    assert_equal "renamed-team", configuration.reload.owner_login
    assert_equal "renamed-hub", configuration.app_slug
    assert_equal 456, configuration.installation_id
    assert_equal 321, configuration.installation_account_github_id
    assert_equal "active", configuration.installation_state
    assert_equal "renamed-team/prototype", repository.reload.name_with_owner
    assert_equal "active", repository.installation_state
  end

  test "an installation webhook recovers transferred ownership before accepting the new installation" do
    configuration = github_app_configurations.create_installed
    owner = { id: 654, login: "new-team", type: "Organization" }
    stub_github_app(configuration:, owner:)
    stub_github_account_installation(account: owner, installation_id: 789)
    stub_github_installation_token(installation_id: 789)
    stub_github_repositories([ repository_payload(2001, "new-team/prototype") ])

    deliver_installation(configuration:, owner:, id: 789, action: "created")

    assert_equal 654, configuration.reload.owner_github_id
    assert_equal 654, configuration.installation_account_github_id
    assert_equal 789, configuration.installation_id
    assert Repository.active.exists?(github_id: 2001)
  end

  test "a delayed old-owner uninstall cannot clear the recovered installation" do
    configuration = github_app_configurations.create_installed \
      owner_github_id: 654, owner_login: "new-team", installation_id: 789
    repository = repositories.create(name_with_owner: "new-team/prototype")

    deliver_installation \
      configuration:, owner: { id: 321, login: "github", type: "Organization" },
      id: 456, action: "deleted"

    assert_equal 789, configuration.reload.installation_id
    assert_equal 654, configuration.owner_github_id
    assert_equal "active", configuration.installation_state
    assert_equal "active", repository.reload.installation_state
  end

  test "an old repository response cannot reactivate repositories after a concurrent transfer" do
    configuration = github_app_configurations.create_installed
    repository = repositories.create
    stub_github_app(configuration:)
    stub_request(:get, "#{GITHUB_API_URL}/app/installations/456")
      .to_return(status: 200, body: JSON.generate(
        installation_payload(owner: { id: 321, login: "github", type: "Organization" }, id: 456)
      ))
    stub_github_installation_token
    stub_request(:get, "#{GITHUB_API_URL}/installation/repositories")
      .with(query: { "page" => "1", "per_page" => "100" }).to_return do
        GithubAppConfiguration.find(configuration.id).update! \
          owner_github_id: 654, owner_login: "new-team", installation_id: 789,
          installation_account_github_id: 654
        repository.update!(installation_state: "removed", removed_at: Time.current)
        { status: 200, body: JSON.generate(repositories: [
          repository_payload(repository.github_id, repository.name_with_owner)
        ]) }
      end

    assert_raises(GithubAppConfiguration::Superseded, ActiveRecord::StaleObjectError) do
      configuration.synchronize_repositories!
    end

    assert_equal 654, configuration.reload.owner_github_id
    assert_equal 789, configuration.installation_id
    assert_equal "removed", repository.reload.installation_state
  end

  private

  def stub_missing_saved_installation
    stub_request(:get, "#{GITHUB_API_URL}/app/installations/456")
      .to_return(status: 404, body: "{}")
  end

  def installation_payload(owner:, id:)
    { id:, app_id: 123, account: owner, suspended_at: nil }
  end

  def deliver_installation(configuration:, owner:, id:, action:)
    body = JSON.generate(action:, installation: installation_payload(owner:, id:))
    signature = "sha256=#{OpenSSL::HMAC.hexdigest("SHA256", configuration.webhook_secret, body)}"
    GithubWebhook.process! \
      configuration:, body:, signature:, delivery_id: SecureRandom.uuid, event: "installation"
  end
end
