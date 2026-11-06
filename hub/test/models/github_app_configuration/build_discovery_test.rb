require "test_helper"

class GithubAppConfiguration::BuildDiscoveryTest < ActiveSupport::TestCase
  include ActiveJob::TestHelper

  test "requests builds for default and prototype branch heads" do
    configuration = installed_configuration
    repository = repositories.create
    client = Object.new
    github_repositories = Object.new
    actions = Object.new
    github_repositories.define_singleton_method(:branches) do |_repository, token:|
      [
        { "name" => "main", "commit" => { "sha" => "a" * 40 } },
        { "name" => "prototype/welcome", "commit" => { "sha" => "b" * 40 } }
      ]
    end
    actions.define_singleton_method(:workflow_runs) { |_repository, token:| [] }
    client.define_singleton_method(:repositories) { github_repositories }
    client.define_singleton_method(:actions) { actions }
    configuration.define_singleton_method(:github_client) { client }
    configuration.define_singleton_method(:synchronize_repositories!) { nil }

    configuration.build_discovery.poll!(repository)
    configuration.build_discovery.poll!(repository)

    assert_equal %w[main prototype/welcome], repository.prototypes.order(:branch_name).pluck(:branch_name)
    assert_equal [ "a" * 40, "b" * 40 ], Build.order(:id).pluck(:commit_sha)
    assert_predicate repository.replica_build_owner, :replica?
    assert_equal [ "prototype/welcome" ], repository.reviewable_prototypes.pluck(:branch_name)
    assert_equal \
      Build.find_by!(commit_sha: "b" * 40),
      repository.prototypes.find_by!(branch_name: "prototype/welcome").current_build
    assert_enqueued_jobs 2, only: Build::RecordCommitAuthorJob
    assert_enqueued_jobs 2, only: Build::ImportStartPageJob
  end

  test "polling retires omitted branches and records returning heads as separate histories" do
    configuration = installed_configuration
    configuration.define_singleton_method(:synchronize_repositories!) { nil }
    repository = repositories.create
    original = repository.build_discoveries.record!(
      branch_name: "prototype/welcome", commit_sha: "a" * 40, branch_head: true
    ).prototype
    original.register!(name: "Original")
    branches = stub_request(:get, "https://api.github.com/repos/#{repository.github_path}/branches?per_page=100&page=1")
      .to_return(status: 200, body: "[]")
    stub_request(:get, "https://api.github.com/repos/#{repository.github_path}/git/ref/heads/prototype/welcome")
      .to_return(status: 404, body: "{}")
    stub_request(:get, "https://api.github.com/repos/#{repository.github_path}")
      .to_return(status: 200, body: JSON.generate(id: repository.github_id))
    stub_request(:get, "https://api.github.com/repos/#{repository.github_path}/actions/workflows/replica.yml/runs")
      .with(query: { event: "push", per_page: 100, page: 1 })
      .to_return(status: 200, body: JSON.generate(workflow_runs: []))

    configuration.build_discovery.poll!(repository)
    assert original.reload.branch_deleted_at
    branches.to_return(status: 200, body: JSON.generate(
      [ { name: "prototype/welcome", commit: { sha: "b" * 40 } } ]
    ))
    stub_request(:get, "https://api.github.com/repos/#{repository.github_path}/compare/#{"a" * 40}...#{"b" * 40}")
      .to_return(status: 200, body: JSON.generate(
        status: "diverged", base_commit: { sha: "a" * 40 }, merge_base_commit: { sha: "c" * 40 }
      ))

    configuration.build_discovery.poll!(repository)

    assert original.reload.branch_deleted_at
    replacement = repository.prototypes.active.sole
    assert_not_equal original.id, replacement.id
    assert_equal "b" * 40, replacement.current_build.commit_sha
    assert_not replacement.registered?
  end

  test "rechecks repository eligibility after fetching branches" do
    configuration = installed_configuration
    repository = repositories.create
    client = Object.new
    configuration.define_singleton_method(:synchronize_repositories!) { nil }
    github_repositories = Object.new
    actions = Object.new
    github_repositories.define_singleton_method(:branches) do |_repository, token:|
      repository.update!(installation_state: "removed", removed_at: Time.current)
      [ { "name" => "prototype/welcome", "commit" => { "sha" => "a" * 40 } } ]
    end
    actions.define_singleton_method(:workflow_runs) { |_repository, token:| [] }
    client.define_singleton_method(:repositories) { github_repositories }
    client.define_singleton_method(:actions) { actions }
    configuration.define_singleton_method(:github_client) { client }

    configuration.build_discovery.poll!(repository)

    assert_empty Build.all
  end

  test "follows workflow runs after discovering branch heads" do
    configuration = installed_configuration
    repository = repositories.create
    client = Object.new
    configuration.define_singleton_method(:synchronize_repositories!) { nil }
    run = workflow_run(status: "completed", conclusion: "failure")
    github_repositories = Object.new
    actions = Object.new
    github_repositories.define_singleton_method(:branches) do |_repository, token:|
      [ { "name" => "prototype/welcome", "commit" => { "sha" => "a" * 40 } } ]
    end
    actions.define_singleton_method(:workflow_runs) { |_repository, token:| [ run ] }
    client.define_singleton_method(:repositories) { github_repositories }
    client.define_singleton_method(:actions) { actions }
    configuration.define_singleton_method(:github_client) { client }

    configuration.build_discovery.poll!(repository)

    build = Build.find_by!(commit_sha: "a" * 40)
    assert_equal "failed", build.state
    assert_equal 9001, build.github_workflow_run_id
  end

  test "explains when the installation cannot read Actions workflow runs" do
    configuration = installed_configuration
    repository = repositories.create
    client = Object.new
    github_repositories = Object.new
    actions = Object.new
    configuration.define_singleton_method(:synchronize_repositories!) { nil }
    github_repositories.define_singleton_method(:branches) { |_repository, token:| [] }
    actions.define_singleton_method(:workflow_runs) do |_repository, token:|
      raise GithubClient::Forbidden, "GitHub returned HTTP 403"
    end
    client.define_singleton_method(:repositories) { github_repositories }
    client.define_singleton_method(:actions) { actions }
    configuration.define_singleton_method(:github_client) { client }

    error = assert_raises(GithubClient::Forbidden) do
      configuration.build_discovery.poll!(repository)
    end

    assert_equal \
      "GitHub App installation cannot read Actions workflow runs. " \
        "Grant Actions read permission and approve the installation update.",
      error.message
  end

  test "fetches an exact saved run when it is outside the newest run list" do
    configuration = installed_configuration
    repository = repositories.create
    build = repository.workflow_run_discoveries.record!(workflow_run(status: "in_progress"))
    client = Object.new
    github_repositories = Object.new
    actions = Object.new
    completed_run = workflow_run(status: "completed", conclusion: "success")
    configuration.define_singleton_method(:synchronize_repositories!) { nil }
    github_repositories.define_singleton_method(:branches) do |_repository, token:|
      [ { "name" => "prototype/welcome", "commit" => { "sha" => "a" * 40 } } ]
    end
    actions.define_singleton_method(:workflow_runs) { |_repository, token:| [] }
    actions.define_singleton_method(:workflow_run) do |_repository, run_id, token:|
      raise "wrong run" if run_id != 9001
      completed_run
    end
    client.define_singleton_method(:repositories) { github_repositories }
    client.define_singleton_method(:actions) { actions }
    configuration.define_singleton_method(:github_client) { client }

    configuration.build_discovery.poll!(repository)

    assert_predicate build.reload.workflow_completed_at, :present?
    assert_predicate build.package_import, :pending?
  end

  test "does not refetch an incomplete run returned by the newest run list" do
    configuration = installed_configuration
    repository = repositories.create
    run = workflow_run(status: "in_progress")
    client = Object.new
    github_repositories = Object.new
    actions = Object.new
    configuration.define_singleton_method(:synchronize_repositories!) { nil }
    github_repositories.define_singleton_method(:branches) { |_repository, token:| [] }
    actions.define_singleton_method(:workflow_runs) { |_repository, token:| [ run ] }
    actions.define_singleton_method(:workflow_run) { |*_args| raise "the observed run was fetched twice" }
    client.define_singleton_method(:repositories) { github_repositories }
    client.define_singleton_method(:actions) { actions }
    configuration.define_singleton_method(:github_client) { client }

    configuration.build_discovery.poll!(repository)

    assert_equal "running", Build.find_by!(github_workflow_run_id: 9001).state
  end

  test "refetches the saved run when the newest list has another run for the commit" do
    configuration = installed_configuration
    repository = repositories.create
    build = repository.workflow_run_discoveries.record!(workflow_run(status: "in_progress"))
    newer_run = workflow_run(id: 9002, run_attempt: 2, status: "in_progress")
    completed_run = workflow_run(status: "completed", conclusion: "success")
    client = Object.new
    github_repositories = Object.new
    actions = Object.new
    configuration.define_singleton_method(:synchronize_repositories!) { nil }
    github_repositories.define_singleton_method(:branches) do |_repository, token:|
      [ { "name" => "prototype/welcome", "commit" => { "sha" => "a" * 40 } } ]
    end
    actions.define_singleton_method(:workflow_runs) { |_repository, token:| [ newer_run ] }
    actions.define_singleton_method(:workflow_run) do |_repository, run_id, token:|
      raise "wrong run" if run_id != 9001
      completed_run
    end
    client.define_singleton_method(:repositories) { github_repositories }
    client.define_singleton_method(:actions) { actions }
    configuration.define_singleton_method(:github_client) { client }

    configuration.build_discovery.poll!(repository)

    assert_predicate build.reload.workflow_completed_at, :present?
  end

  test "polling recovers a stored action-required failure from the run's successful newer attempt" do
    configuration = installed_configuration
    repository = repositories.create
    build = repository.workflow_run_discoveries.record!(
      workflow_run(status: "completed", conclusion: "action_required")
    )
    approved_run = workflow_run(run_attempt: 2, status: "completed", conclusion: "success")
    client = Object.new
    github_repositories = Object.new
    actions = Object.new
    configuration.define_singleton_method(:synchronize_repositories!) { nil }
    github_repositories.define_singleton_method(:branches) do |_repository, token:|
      [ { "name" => "prototype/welcome", "commit" => { "sha" => "a" * 40 } } ]
    end
    exact_lookups = []
    actions.define_singleton_method(:workflow_runs) { |_repository, token:| [] }
    actions.define_singleton_method(:workflow_run) do |_repository, run_id, token:|
      exact_lookups << run_id
      approved_run
    end
    client.define_singleton_method(:repositories) { github_repositories }
    client.define_singleton_method(:actions) { actions }
    configuration.define_singleton_method(:github_client) { client }

    assert_enqueued_with(job: Build::ImportPackageJob) do
      configuration.build_discovery.poll!(repository)
    end

    assert_equal [ 9001 ], exact_lookups
    assert_equal "running", build.reload.state
    assert_equal 2, build.github_workflow_run_attempt
    assert_predicate build.package_import, :pending?
  end

  test "fails a missing saved run without stopping other reconciliation" do
    configuration = installed_configuration
    repository = repositories.create
    missing = repository.workflow_run_discoveries.record!(workflow_run(status: "in_progress"))
    second = repository.workflow_run_discoveries.record!(
      workflow_run(id: 9002, head_sha: "b" * 40, status: "in_progress")
    )
    client = Object.new
    completed_run = workflow_run \
      id: 9002, head_sha: "b" * 40, status: "completed", conclusion: "success"
    configuration.define_singleton_method(:synchronize_repositories!) { nil }
    github_repositories = Object.new
    actions = Object.new
    github_repositories.define_singleton_method(:branches) do |_repository, token:|
      [ { "name" => "prototype/welcome", "commit" => { "sha" => "b" * 40 } } ]
    end
    actions.define_singleton_method(:workflow_runs) { |_repository, token:| [] }
    actions.define_singleton_method(:workflow_run) do |_repository, run_id, token:|
      raise GithubClient::NotFound, "missing" if run_id == 9001
      completed_run
    end
    client.define_singleton_method(:repositories) { github_repositories }
    client.define_singleton_method(:actions) { actions }
    configuration.define_singleton_method(:github_client) { client }

    configuration.build_discovery.poll!(repository)

    assert_equal "failed", missing.reload.state
    assert_equal "GitHub no longer provides this build's workflow run.", missing.failure_summary
    assert_predicate second.reload.workflow_completed_at, :present?
  end

  private

  def installed_configuration
    configuration = github_app_configurations.create_installed
    configuration.tokens.define_singleton_method(:installation) { "installation-token" }
    configuration
  end

  def workflow_run(status:, conclusion: nil, **overrides)
    {
      "id" => 9001,
      "run_attempt" => 1,
      "path" => ".github/workflows/replica.yml",
      "event" => "push",
      "head_branch" => "prototype/welcome",
      "head_sha" => "a" * 40,
      "status" => status,
      "conclusion" => conclusion,
      "html_url" => "https://github.com/github/prototype/actions/runs/9001",
      "created_at" => "2026-09-17T18:00:00Z"
    }.merge(overrides.transform_keys(&:to_s))
  end
end
