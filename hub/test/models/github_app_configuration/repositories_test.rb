require "test_helper"

class GithubAppConfiguration::RepositoriesTest < ActiveSupport::TestCase
  test "synchronizes renames, additions, and removals by stable GitHub ID" do
    configuration = installed_configuration
    renamed = repositories.create
    removed = repositories.create github_id: 2002, name_with_owner: "github/removed"
    client = Object.new
    installations = Object.new
    installations.define_singleton_method(:repositories) do |token:|
      [
        { "id" => renamed.github_id, "full_name" => "github/renamed", "default_branch" => "trunk" },
        { "id" => 2003, "full_name" => "github/new", "default_branch" => "main" }
      ]
    end
    client.define_singleton_method(:installations) { installations }
    configuration.define_singleton_method(:github_client) { client }

    configuration.repositories.synchronize!

    assert_equal "github/renamed", renamed.reload.name_with_owner
    assert_equal "trunk", renamed.default_branch
    assert_equal "removed", removed.reload.installation_state
    assert removed.removed_at
    assert Repository.active.exists?(github_id: 2003)
  end

  test "marks every repository removed for an inactive installation" do
    configuration = github_app_configurations.create \
      installation_id: 456, installation_account_github_id: 321, installation_state: "suspended"
    repository = repositories.create

    configuration.repositories.synchronize!

    assert_equal "removed", repository.reload.installation_state
  end

  test "an old synchronization cannot reactivate repositories after the App is reset" do
    configuration = installed_configuration
    repository = repositories.create
    stub_request(:get, "#{GITHUB_API_URL}/installation/repositories")
      .with(query: { "page" => "1", "per_page" => "100" }).to_return do
        GithubAppConfiguration.where(id: configuration.id).delete_all
        repository.update!(installation_state: "removed", removed_at: Time.current)
        { status: 200, body: JSON.generate(repositories: [
          { id: repository.github_id, full_name: repository.name_with_owner, default_branch: "main" }
        ]) }
      end
    assert_raises(GithubAppConfiguration::Superseded) { configuration.repositories.synchronize! }
    assert_equal "removed", repository.reload.installation_state
  end

  private

  def installed_configuration
    configuration = github_app_configurations.create_installed
    configuration.tokens.define_singleton_method(:installation) { "installation-token" }
    configuration
  end
end
