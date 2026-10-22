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

  private

  def installed_configuration
    configuration = github_app_configurations.create_installed
    configuration.tokens.define_singleton_method(:installation) { "installation-token" }
    configuration
  end

  def permission_client(user, permission, github_id: user.github_id)
    Object.new.tap do |client|
      github_repositories = Object.new
      github_repositories.define_singleton_method(:permission) do |_repository, _user, token:|
        { "permission" => permission, "user" => { "id" => github_id } }
      end
      client.define_singleton_method(:repositories) { github_repositories }
    end
  end
end
