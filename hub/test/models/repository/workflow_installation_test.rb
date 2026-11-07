require "test_helper"

class Repository::WorkflowInstallationTest < ActiveSupport::TestCase
  BUILD_ACTION = "github/replica/actions/build@#{"a" * 40}"

  setup do
    @original_build_action = Rails.configuration.x.build_action
    @original_build_action_revisions = Rails.configuration.x.build_action_revisions
    Rails.configuration.x.build_action = BUILD_ACTION
    Rails.configuration.x.build_action_revisions = Set.new
  end

  teardown do
    Rails.configuration.x.build_action = @original_build_action
    Rails.configuration.x.build_action_revisions = @original_build_action_revisions
  end

  test "generated workflow builds the default branch and excludes only the installation branch" do
    repository = repositories.create
    workflow = expected_workflow(repository)
    assert_includes workflow, "if: github.ref_name != 'replica/install-workflow'"
    assert_not_includes workflow, "github.event.repository.default_branch"
  end

  test "offers an update for the previous generated default-branch exclusion" do
    repository = repositories.create
    configuration = github_app_configurations.create_installed
    stub_github_installation_token
    old_workflow = expected_workflow(repository).sub \
      "if: github.ref_name != 'replica/install-workflow'",
      "if: github.ref_name != github.event.repository.default_branch && github.ref_name != 'replica/install-workflow'"
    stub_request(:get, workflow_url(repository))
      .with(query: { "ref" => "main" })
      .to_return(status: 200, body: workflow_payload(old_workflow, "d" * 40))

    assert_equal :different, repository.workflow_installation.status(configuration:)
    assert_includes old_workflow, "- uses: #{BUILD_ACTION}"
    assert_not_requested :put, workflow_url(repository)
    assert_not_requested :post, "#{GITHUB_API_URL}/repos/#{repository.name_with_owner}/pulls"
  end

  test "does not propose replacing a customized same-pin workflow for the branch-guard migration" do
    repository = repositories.create
    configuration = github_app_configurations.create_installed
    stub_github_installation_token
    customized = expected_workflow(repository).sub \
      "if: github.ref_name != 'replica/install-workflow'",
      "if: github.ref_name != github.event.repository.default_branch && github.ref_name != 'replica/install-workflow'"
    customized = customized.sub("name: Replica", "name: Customized Replica")
    stub_request(:get, workflow_url(repository))
      .with(query: { "ref" => "main" })
      .to_return(status: 200, body: workflow_payload(customized, "d" * 40))

    assert_equal :current, repository.workflow_installation.status(configuration:)
    assert_not_requested :put, workflow_url(repository)
  end

  test "opens a pull request containing the pinned Replica workflow" do
    repository = repositories.create
    configuration = github_app_configurations.create_installed
    stub_github_installation_token
    workflow = expected_workflow(repository)
    stub_request(:get, workflow_url(repository))
      .with(query: { "ref" => "main" })
      .to_return(status: 404, body: JSON.generate(message: "Not Found"))
    stub_request(:get, reference_url(repository, "main"))
      .to_return(status: 200, body: reference_payload("b" * 40))
    stub_request(:get, reference_url(repository, "replica/install-workflow"))
      .to_return(
        { status: 404, body: JSON.generate(message: "Not Found") },
        { status: 200, body: reference_payload("c" * 40) }
      )
    create_reference = stub_request(:post, "#{GITHUB_API_URL}/repos/#{repository.name_with_owner}/git/refs")
      .to_return(status: 201, body: JSON.generate(ref: "refs/heads/replica/install-workflow"))
    create_file = stub_request(:put, workflow_url(repository))
      .with do |request|
        payload = JSON.parse(request.body)
        workflow = Base64.strict_decode64(payload.fetch("content"))
        payload.fetch("branch") == "replica/install-workflow" &&
          workflow.include?("- uses: #{BUILD_ACTION}")
      end
      .to_return(status: 201, body: JSON.generate(content: { path: workflow_path }))
    stub_request(:get, workflow_url(repository))
      .with(query: { "ref" => "replica/install-workflow" })
      .to_return(status: 200, body: workflow_payload(workflow, "d" * 40))
    stub_comparison(repository, base_sha: "b" * 40, branch_sha: "c" * 40, file_status: "added")
    stub_request(:get, "#{GITHUB_API_URL}/repos/#{repository.name_with_owner}/pulls")
      .with(query: {
        "base" => "main",
        "head" => "github:replica/install-workflow",
        "state" => "open"
      })
      .to_return(status: 200, body: JSON.generate([]))
    create_pull_request = stub_request(:post, "#{GITHUB_API_URL}/repos/#{repository.name_with_owner}/pulls")
      .to_return \
        status: 201,
        body: JSON.generate(
          number: 25,
          html_url: "https://github.com/github/prototype/pull/25"
        )

    pull_request = repository.workflow_installation.create_pull_request!(configuration:)

    assert_equal 25, pull_request.fetch("number")
    assert_requested create_reference
    assert_requested create_file
    assert_requested create_pull_request
  end

  test "reuses a prepared branch and open pull request after a retry" do
    repository = repositories.create
    configuration = github_app_configurations.create_installed
    stub_github_installation_token
    workflow = expected_workflow(repository)
    stub_request(:get, workflow_url(repository))
      .with(query: { "ref" => "main" })
      .to_return(status: 404, body: JSON.generate(message: "Not Found"))
    stub_request(:get, reference_url(repository, "main"))
      .to_return(status: 200, body: reference_payload("b" * 40))
    stub_request(:get, reference_url(repository, "replica/install-workflow"))
      .to_return(status: 200, body: reference_payload("c" * 40))
    stub_request(:get, workflow_url(repository))
      .with(query: { "ref" => "replica/install-workflow" })
      .to_return \
        status: 200,
        body: workflow_payload(workflow, "d" * 40)
    stub_comparison(repository, base_sha: "b" * 40, branch_sha: "c" * 40, file_status: "added")
    stub_request(:get, "#{GITHUB_API_URL}/repos/#{repository.name_with_owner}/pulls")
      .with(query: {
        "base" => "main",
        "head" => "github:replica/install-workflow",
        "state" => "open"
      })
      .to_return \
        status: 200,
        body: JSON.generate([
          {
            number: 25,
            html_url: "https://github.com/github/prototype/pull/25"
          }
        ])

    pull_request = repository.workflow_installation.create_pull_request!(configuration:)

    assert_equal 25, pull_request.fetch("number")
    assert_not_requested :post, "#{GITHUB_API_URL}/repos/#{repository.name_with_owner}/git/refs"
    assert_not_requested :put, workflow_url(repository)
    assert_not_requested :post, "#{GITHUB_API_URL}/repos/#{repository.name_with_owner}/pulls"
  end

  test "does not open a pull request when the default branch has the current workflow" do
    repository = repositories.create
    configuration = github_app_configurations.create_installed
    stub_github_installation_token
    workflow = expected_workflow(repository)
    stub_request(:get, workflow_url(repository))
      .with(query: { "ref" => "main" })
      .to_return(status: 200, body: workflow_payload(workflow, "d" * 40))

    assert_raises(Repository::WorkflowInstallation::AlreadyInstalled) do
      repository.workflow_installation.create_pull_request!(configuration:)
    end
  end

  test "does not remind for a legacy Hub pin in a customized workflow" do
    repository = repositories.create
    configuration = github_app_configurations.create_installed
    stub_github_installation_token
    workflow = expected_workflow(repository)
      .sub(BUILD_ACTION, "github/replica/actions/build@#{"b" * 40}")
      .sub("name: Replica", "name: Customized Replica")
    stub_request(:get, workflow_url(repository))
      .with(query: { "ref" => "main" })
      .to_return(status: 200, body: workflow_payload(workflow, "d" * 40))

    assert_equal :present, repository.workflow_installation.status(configuration:)
    assert_raises(Repository::WorkflowInstallation::AlreadyInstalled) do
      repository.workflow_installation.create_pull_request!(configuration:)
    end
    assert_not_requested :get, reference_url(repository, "main")
  end

  test "does not replace a workflow that does not use the Replica build Action" do
    repository = repositories.create
    configuration = github_app_configurations.create_installed
    stub_github_installation_token
    stub_request(:get, workflow_url(repository))
      .with(query: { "ref" => "main" })
      .to_return(status: 200, body: workflow_payload("name: Custom workflow", "d" * 40))

    assert_equal :present, repository.workflow_installation.status(configuration:)
    assert_raises(Repository::WorkflowInstallation::AlreadyInstalled) do
      repository.workflow_installation.create_pull_request!(configuration:)
    end

    assert_not_requested :get, reference_url(repository, "main")
  end

  test "does not overwrite customized auth build steps or action inputs even for a known old release pin" do
    repository = repositories.create
    configuration = github_app_configurations.create_installed
    stub_github_installation_token
    old_action = "github/replica/actions/build@#{"b" * 40}"
    Rails.configuration.x.build_action_revisions = Set.new([ "b" * 40 ])
    generated = expected_workflow(repository).sub(BUILD_ACTION, old_action)
    customizations = [
      generated.sub("- uses: #{old_action}", "- run: ./scripts/authenticate.sh\n      - uses: #{old_action}"),
      generated.sub("- uses: #{old_action}", "- run: make site\n      - uses: #{old_action}"),
      generated.sub("- uses: #{old_action}", "- uses: #{old_action}\n        with:\n          skip-build: 'true'\n          output-directory: website/public")
    ]

    customizations.each do |workflow|
      stub_request(:get, workflow_url(repository))
        .with(query: { "ref" => "main" })
        .to_return(status: 200, body: workflow_payload(workflow, "d" * 40))

      assert_includes [ :present, :current ], repository.workflow_installation.status(configuration:)
      assert_raises(Repository::WorkflowInstallation::AlreadyInstalled) do
        repository.workflow_installation.create_pull_request!(configuration:)
      end
    end
    assert_not_requested :get, reference_url(repository, "main")
    assert_not_requested :put, workflow_url(repository)
    assert_not_requested :post, "#{GITHUB_API_URL}/repos/#{repository.name_with_owner}/pulls"
  end

  test "reminds for a changed custom Action pin" do
    repository = repositories.create
    configuration = github_app_configurations.create_installed
    stub_github_installation_token
    Rails.configuration.x.build_action = "team/replica/actions/build@#{"a" * 40}"
    Rails.configuration.x.build_action_revisions = nil
    workflow = expected_workflow(repository)
      .sub(Rails.configuration.x.build_action, "team/replica/actions/build@#{"b" * 40}")
    stub_request(:get, workflow_url(repository))
      .with(query: { "ref" => "main" })
      .to_return(status: 200, body: workflow_payload(workflow, "d" * 40))

    assert_equal :different, repository.workflow_installation.status(configuration:)
  end

  test "opens a pull request that synchronizes a differing workflow" do
    repository = repositories.create
    configuration = github_app_configurations.create_installed
    stub_github_installation_token
    Rails.configuration.x.build_action_revisions = Set.new([ "b" * 40 ])
    workflow = expected_workflow(repository)
    old_action = "github/replica/actions/build@#{"b" * 40}"
    previous_workflow = workflow.sub(BUILD_ACTION, old_action)
    stub_request(:get, workflow_url(repository))
      .with(query: { "ref" => "main" })
      .to_return(status: 200, body: workflow_payload(previous_workflow, "d" * 40))
    stub_request(:get, reference_url(repository, "main"))
      .to_return(status: 200, body: reference_payload("b" * 40))
    stub_request(:get, reference_url(repository, "replica/install-workflow"))
      .to_return(
        { status: 404, body: JSON.generate(message: "Not Found") },
        { status: 200, body: reference_payload("c" * 40) }
      )
    stub_request(:post, "#{GITHUB_API_URL}/repos/#{repository.name_with_owner}/git/refs")
      .to_return(status: 201, body: JSON.generate(ref: "refs/heads/replica/install-workflow"))
    update_file = stub_request(:put, workflow_url(repository))
      .with do |request|
        payload = JSON.parse(request.body)
        Base64.strict_decode64(payload.fetch("content")) == workflow &&
          payload.fetch("sha") == "d" * 40 &&
          payload.fetch("branch") == "replica/install-workflow" &&
          payload.fetch("message") == "chore: update Replica workflow"
      end
      .to_return(status: 200, body: JSON.generate(content: { path: workflow_path }))
    stub_request(:get, workflow_url(repository))
      .with(query: { "ref" => "replica/install-workflow" })
      .to_return(status: 200, body: workflow_payload(workflow, "e" * 40))
    stub_comparison(repository, base_sha: "b" * 40, branch_sha: "c" * 40, file_status: "modified")
    stub_request(:get, "#{GITHUB_API_URL}/repos/#{repository.name_with_owner}/pulls")
      .with(query: {
        "base" => "main",
        "head" => "github:replica/install-workflow",
        "state" => "open"
      })
      .to_return(status: 200, body: JSON.generate([]))
    create_pull_request = stub_request(:post, "#{GITHUB_API_URL}/repos/#{repository.name_with_owner}/pulls")
      .with do |request|
        payload = JSON.parse(request.body)
        payload.fetch("title") == "Update Replica workflow"
      end
      .to_return \
        status: 201,
        body: JSON.generate(
          number: 25,
          html_url: "https://github.com/github/prototype/pull/25"
        )

    pull_request = repository.workflow_installation.create_pull_request!(configuration:)

    assert_equal 25, pull_request.fetch("number")
    assert_requested update_file
    assert_requested create_pull_request
  end

  test "does not write when the reserved branch is the default branch" do
    repository = repositories.create(default_branch: "replica/install-workflow")
    configuration = github_app_configurations.create_installed
    stub_github_installation_token

    assert_raises(Repository::WorkflowInstallation::BranchConflict) do
      repository.workflow_installation.create_pull_request!(configuration:)
    end

    assert_not_requested :get, workflow_url(repository)
    assert_not_requested :post, "#{GITHUB_API_URL}/repos/#{repository.name_with_owner}/git/refs"
    assert_not_requested :put, workflow_url(repository)
  end

  test "does not replace another workflow on the installation branch" do
    repository = repositories.create
    configuration = github_app_configurations.create_installed
    stub_github_installation_token
    stub_request(:get, workflow_url(repository))
      .with(query: { "ref" => "main" })
      .to_return(status: 404, body: JSON.generate(message: "Not Found"))
    stub_request(:get, reference_url(repository, "main"))
      .to_return(status: 200, body: reference_payload("b" * 40))
    stub_request(:get, reference_url(repository, "replica/install-workflow"))
      .to_return(status: 200, body: reference_payload("c" * 40))
    stub_request(:get, workflow_url(repository))
      .with(query: { "ref" => "replica/install-workflow" })
      .to_return \
        status: 200,
        body: workflow_payload("another workflow", "d" * 40)

    assert_raises(Repository::WorkflowInstallation::BranchConflict) do
      repository.workflow_installation.create_pull_request!(configuration:)
    end
  end

  test "does not reuse a workflow branch containing unrelated files" do
    repository = repositories.create
    configuration = github_app_configurations.create_installed
    stub_github_installation_token
    workflow = expected_workflow(repository)
    stub_request(:get, workflow_url(repository))
      .with(query: { "ref" => "main" })
      .to_return(status: 404, body: JSON.generate(message: "Not Found"))
    stub_request(:get, reference_url(repository, "main"))
      .to_return(status: 200, body: reference_payload("b" * 40))
    stub_request(:get, reference_url(repository, "replica/install-workflow"))
      .to_return(status: 200, body: reference_payload("c" * 40))
    stub_request(:get, workflow_url(repository))
      .with(query: { "ref" => "replica/install-workflow" })
      .to_return(status: 200, body: workflow_payload(workflow, "d" * 40))
    files = [
      { filename: workflow_path, status: "added" },
      { filename: "README.md", status: "modified" }
    ]
    stub_comparison(
      repository,
      base_sha: "b" * 40,
      branch_sha: "c" * 40,
      file_status: "added",
      files: files
    )

    assert_raises(Repository::WorkflowInstallation::BranchConflict) do
      repository.workflow_installation.create_pull_request!(configuration:)
    end
  end

  test "does not reuse a workflow branch behind the current default branch" do
    repository = repositories.create
    configuration = github_app_configurations.create_installed
    stub_github_installation_token
    workflow = expected_workflow(repository)
    stub_request(:get, workflow_url(repository))
      .with(query: { "ref" => "main" })
      .to_return(status: 404, body: JSON.generate(message: "Not Found"))
    stub_request(:get, reference_url(repository, "main"))
      .to_return(status: 200, body: reference_payload("b" * 40))
    stub_request(:get, reference_url(repository, "replica/install-workflow"))
      .to_return(status: 200, body: reference_payload("c" * 40))
    stub_request(:get, workflow_url(repository))
      .with(query: { "ref" => "replica/install-workflow" })
      .to_return(status: 200, body: workflow_payload(workflow, "d" * 40))
    stub_comparison(
      repository,
      base_sha: "a" * 40,
      branch_sha: "c" * 40,
      file_status: "added",
      behind_by: 1
    )

    assert_raises(Repository::WorkflowInstallation::BranchConflict) do
      repository.workflow_installation.create_pull_request!(configuration:)
    end
  end

  private

  def workflow_path
    Repository::WorkflowInstallation::WORKFLOW_PATH
  end

  def workflow_url(repository)
    "#{GITHUB_API_URL}/repos/#{repository.name_with_owner}/contents/#{workflow_path}"
  end

  def reference_url(repository, branch)
    "#{GITHUB_API_URL}/repos/#{repository.name_with_owner}/git/ref/heads/#{branch}"
  end

  def reference_payload(sha)
    { object: { sha: } }.to_json
  end

  def workflow_payload(content, sha)
    JSON.generate(content: Base64.strict_encode64(content), sha: sha)
  end

  def stub_comparison(
    repository,
    base_sha:,
    branch_sha:,
    file_status:,
    behind_by: 0,
    files: nil
  )
    files ||= [ { filename: workflow_path, status: file_status } ]
    stub_request(:get, comparison_url(repository))
      .to_return \
        status: 200,
        body: JSON.generate(
          status: "ahead",
          ahead_by: 1,
          behind_by: behind_by,
          total_commits: 1,
          merge_base_commit: { sha: base_sha },
          commits: [ { sha: branch_sha } ],
          files: files
        )
  end

  def comparison_url(repository)
    "#{GITHUB_API_URL}/repos/#{repository.name_with_owner}/compare/main...replica%2Finstall-workflow"
  end

  def expected_workflow(repository)
    repository.workflow_installation.send(:workflow)
  end
end
