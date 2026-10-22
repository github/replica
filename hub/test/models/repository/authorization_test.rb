require "test_helper"

class Repository::AuthorizationTest < ActiveSupport::TestCase
  test "accepts read permission for the expected stable user identity" do
    user = users.create
    repository = repositories.create
    configuration = installed_configuration
    client = permission_client(user, "pull")
    configuration.define_singleton_method(:github_client) { client }

    assert repository.authorization.authorized?(user, fresh: true, configuration:)
  end

  test "rejects a matching login that GitHub identifies as another user" do
    user = users.create
    repository = repositories.create
    configuration = installed_configuration
    client = permission_client(user, "admin", github_id: 9999)
    configuration.define_singleton_method(:github_client) { client }

    assert_not repository.authorization.authorized?(user, fresh: true, configuration:)
  end

  test "does not hide transport failures behind an authorization result" do
    user = users.create
    repository = repositories.create
    configuration = installed_configuration
    client = Object.new
    github_repositories = Object.new
    github_repositories.define_singleton_method(:permission) do |_repository, _user, token:|
      raise GithubClient::Error, "timeout"
    end
    client.define_singleton_method(:repositories) { github_repositories }
    configuration.define_singleton_method(:github_client) { client }

    assert_raises(GithubClient::Error) do
      repository.authorization.authorized?(user, fresh: true, configuration:)
    end
  end

  test "caches one permission result for a short interval" do
    user = users.create
    repository = repositories.create
    configuration = installed_configuration
    calls = 0
    client = Object.new
    github_repositories = Object.new
    github_repositories.define_singleton_method(:permission) do |_repository, _user, token:|
      calls += 1
      { "permission" => "pull", "user" => { "id" => user.github_id } }
    end
    client.define_singleton_method(:repositories) { github_repositories }
    configuration.define_singleton_method(:github_client) { client }
    cache = ActiveSupport::Cache::MemoryStore.new

    assert repository.authorization.authorized?(user, configuration:, cache:)
    assert repository.authorization.authorized?(user, configuration:, cache:)

    assert_equal 1, calls
  end

  test "checks an unregistered mention identity without creating an account or revocation" do
    identity = GithubIdentity.new(github_id: 9002, login: "new-reader")
    repository = repositories.create
    configuration = installed_configuration
    client = permission_client(identity, "none")
    configuration.define_singleton_method(:github_client) { client }

    assert_no_difference [ "User.count", "ShareLinkCreatorRevocation.count" ] do
      assert_not repository.authorization.authorized?(identity, fresh: true, configuration:)
    end
    assert_nil repository.authorization.share_link_creation_proof
  end

  test "allows an unregistered mention identity with current repository access" do
    identity = GithubIdentity.new(github_id: 9002, login: "new-reader")
    repository = repositories.create
    configuration = installed_configuration
    client = permission_client(identity, "read")
    configuration.define_singleton_method(:github_client) { client }

    assert_no_difference "User.count" do
      assert repository.authorization.authorized?(identity, fresh: true, configuration:)
    end
  end

  test "a mention identity's confirmed access loss revokes its actual Hub creator" do
    user = users.create
    identity = GithubIdentity.create!(github_id: user.github_id, login: user.login)
    repository = repositories.create
    configuration = installed_configuration
    client = permission_client(identity, "none")
    configuration.define_singleton_method(:github_client) { client }

    assert_not repository.authorization.authorized?(identity, fresh: true, configuration:)
    assert_equal user, ShareLinkCreatorRevocation.sole.user
    assert_equal user.id, repository.authorization.share_link_creation_proof.user_id
  end

  test "fresh permission checks ignore prefetched selector payloads" do
    user = users.create
    repository = repositories.create
    configuration = installed_configuration
    client = permission_client(user, "pull")
    configuration.define_singleton_method(:github_client) { client }
    payload = { "permission" => "admin", "user" => { "id" => user.github_id } }

    assert_equal "read", repository.authorization.permission_for(user, fresh: true, configuration:, payload:)
  end

  test "recognizes GitHub's maintain role, which the legacy permission reports as write" do
    user = users.create
    repository = repositories.create
    configuration = installed_configuration
    client = permission_client(user, "write", role_name: "maintain")
    configuration.define_singleton_method(:github_client) { client }

    assert_equal "maintain", repository.authorization.permission_for(user, fresh: true, configuration:)
    assert repository.authorization.authorized?(user, minimum: :write, fresh: true, configuration:)
    assert repository.authorization.authorized?(user, minimum: :maintain, fresh: true, configuration:)
    assert_not repository.authorization.authorized?(user, minimum: :admin, fresh: true, configuration:)
  end

  test "ranks maintain above write and below admin" do
    user = users.create
    repository = repositories.create
    configuration = installed_configuration
    {
      [ "write", "write" ] => false,
      [ "push", nil ] => false,
      [ "read", "triage" ] => false,
      [ "admin", "admin" ] => true
    }.each do |(permission, role_name), maintainer|
      client = permission_client(user, permission, role_name:)
      configuration.define_singleton_method(:github_client) { client }

      assert_equal maintainer,
        repository.authorization.authorized?(user, minimum: :maintain, fresh: true, configuration:),
        "#{permission}/#{role_name.inspect}"
    end
  end

  test "rejects a maintain role that GitHub reports for another stable user" do
    user = users.create
    repository = repositories.create
    configuration = installed_configuration
    client = permission_client(user, "write", role_name: "maintain", github_id: 9999)
    configuration.define_singleton_method(:github_client) { client }

    assert_equal "none", repository.authorization.permission_for(user, fresh: true, configuration:)
  end

  test "a fresh check sees a maintainer's demotion despite a cached maintain permission" do
    user = users.create
    repository = repositories.create
    configuration = installed_configuration
    cache = ActiveSupport::Cache::MemoryStore.new
    client = permission_client(user, "write", role_name: "maintain")
    configuration.define_singleton_method(:github_client) { client }
    assert repository.authorization.authorized?(user, minimum: :maintain, configuration:, cache:)

    client = permission_client(user, "write", role_name: "write")
    configuration.define_singleton_method(:github_client) { client }

    assert_not repository.authorization.authorized?(user, minimum: :maintain, fresh: true, configuration:, cache:)
  end

  private

  def installed_configuration
    configuration = github_app_configurations.create_installed
    configuration.tokens.define_singleton_method(:installation) { "installation-token" }
    configuration
  end

  def permission_client(user, permission, github_id: user.github_id, role_name: nil)
    Object.new.tap do |client|
      github_repositories = Object.new
      github_repositories.define_singleton_method(:permission) do |_repository, _user, token:|
        { "permission" => permission, "role_name" => role_name, "user" => { "id" => github_id } }.compact
      end
      client.define_singleton_method(:repositories) { github_repositories }
    end
  end
end
