require "test_helper"

class Repository::PrototypeCandidatesTest < ActiveSupport::TestCase
  setup do
    github_app_configurations.create_installed
    stub_github_installation_token
  end

  test "writers can list branches at the default head without comparing commits" do
    repository = repositories.create
    prototype = prototypes.create(repository:, branch_name: "feature/navigation")
    stub_branches(repository, "main" => "a" * 40, prototype.branch_name => "a" * 40)

    %w[write admin].each do |permission|
      branches, page_count = repository.prototype_candidates.available_page(permission:)

      assert_equal [ prototype ], branches, permission
      assert_equal 1, page_count
      assert repository.prototype_candidates.eligible?(prototype, permission:), permission
    end
    assert_not_requested :get, %r{/compare/}
  end

  test "users without write access cannot list or register branches" do
    repository = repositories.create
    prototype = prototypes.create(repository:)

    [ "read", "none", nil ].each do |permission|
      assert_equal [ [], 0 ], repository.prototype_candidates.available_page(permission:)
      assert_equal "write_access_required",
        repository.prototype_candidates.registration_ineligibility_reason(prototype, permission:)
    end
    assert_not_requested :get, %r{/branches}
    assert_not_requested :get, %r{/compare/}
  end

  test "offers writers only live unlisted branches from this repository and explains each exclusion" do
    repository = repositories.create
    live = prototypes.create(repository:, branch_name: "feature/live")
    default = prototypes.create(repository:, branch_name: repository.default_branch)
    internal = prototypes.create(repository:, branch_name: "previous-default", replica: true)
    reserved = prototypes.create(repository:, branch_name: "replica/install-workflow")
    missing = prototypes.create(repository:, branch_name: "feature/missing")
    retired = prototypes.create(repository:, branch_name: "feature/retired", branch_deleted_at: 1.hour.ago)
    registered = prototypes.create(repository:, branch_name: "feature/registered")
    registered.register!(name: "Already listed")
    other_repository = repositories.create(github_id: 2002, name_with_owner: "github/other")
    foreign = prototypes.create(repository: other_repository, branch_name: live.branch_name)
    heads = [ live, default, internal, reserved, retired, registered ].to_h do |prototype|
      [ prototype.branch_name, "a" * 40 ]
    end
    stub_branches(repository, heads)

    branches, page_count = repository.prototype_candidates.available_page(permission: "write")

    assert_equal [ live ], branches
    assert_equal 1, page_count
    {
      foreign => "repository_mismatch",
      retired => "remote_branch_missing",
      registered => "already_registered",
      default => "branch_not_reviewable",
      internal => "branch_not_reviewable",
      reserved => "branch_not_reviewable",
      missing => "remote_branch_missing"
    }.each do |prototype, reason|
      assert_equal reason,
        repository.prototype_candidates.registration_ineligibility_reason(prototype, permission: "write")
    end
    assert_not_requested :get, %r{/compare/}
  end

  private

  def stub_branches(repository, heads)
    stub_request(:get, "#{GITHUB_API_URL}/repos/#{repository.github_path}/branches")
      .with(query: { "per_page" => "100", "page" => "1" })
      .to_return \
        status: 200,
        body: JSON.generate(heads.map { |name, sha| { name:, commit: { sha: } } }),
        headers: { "Content-Type" => "application/json" }
  end
end
