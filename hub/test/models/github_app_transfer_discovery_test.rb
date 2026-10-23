require "test_helper"

class GithubAppTransferDiscoveryTest < ActiveSupport::TestCase
  test "an old branch poll cannot replace a head retained by the replacement installation" do
    configuration = github_app_configurations.create_installed
    repository = repositories.create
    head = repository.build_discoveries.record! \
      branch_name: "prototype/welcome", commit_sha: "c" * 40, branch_head: true
    stub_poll(configuration, repository)
    stub_request(:get, "#{GITHUB_API_URL}/repos/#{repository.github_path}/branches")
      .with(query: { per_page: 100, page: 1 }).to_return do
        replace_installation!(configuration, repository)
        { status: 200, body: JSON.generate([ { name: "prototype/welcome", commit: { sha: "b" * 40 } } ]) }
      end

    allow_obsolete_work_to_stop { configuration.discover_builds!(repository) }

    assert_replacement_retained(configuration, repository)
    assert_equal head, head.prototype.reload.current_build
    assert_equal [ "c" * 40 ], head.prototype.builds.pluck(:commit_sha)
  end

  test "an old branch absence cannot retire a branch retained by the replacement installation" do
    configuration = github_app_configurations.create_installed
    repository = repositories.create
    head = repository.build_discoveries.record! \
      branch_name: "prototype/welcome", commit_sha: "c" * 40, branch_head: true
    stub_poll(configuration, repository)
    stub_request(:get, "#{GITHUB_API_URL}/repos/#{repository.github_path}/branches")
      .with(query: { per_page: 100, page: 1 })
      .to_return(status: 200, body: "[]")
    stub_absent_branch(repository) { replace_installation!(configuration, repository) }

    allow_obsolete_work_to_stop { configuration.discover_builds!(repository) }

    assert_replacement_retained(configuration, repository)
    assert_nil head.prototype.reload.branch_deleted_at
    assert_equal head, head.prototype.current_build
  end

  test "an old workflow list cannot fail a build retained by the replacement installation" do
    configuration = github_app_configurations.create_installed
    repository = repositories.create
    build = repository.workflow_run_discoveries.record!(workflow_run(status: "in_progress"))
    stub_poll(configuration, repository)
    stub_request(:get, "#{GITHUB_API_URL}/repos/#{repository.github_path}/actions/workflows/replica.yml/runs")
      .with(query: { event: "push", per_page: 100, page: 1 }).to_return do
        replace_installation!(configuration, repository)
        { status: 200, body: JSON.generate(workflow_runs: [ workflow_run(status: "completed", conclusion: "failure") ]) }
      end

    allow_obsolete_work_to_stop { configuration.discover_builds!(repository) }

    assert_replacement_retained(configuration, repository)
    assert_equal "running", build.reload.state
    assert_nil build.failure_summary
    assert_nil build.workflow_completed_at
  end

  test "an old exact workflow lookup cannot complete a build retained by the replacement installation" do
    configuration = github_app_configurations.create_installed
    repository = repositories.create
    build = repository.workflow_run_discoveries.record!(workflow_run(status: "in_progress"))
    stub_poll(configuration, repository)
    stub_request(:get, "#{GITHUB_API_URL}/repos/#{repository.github_path}/actions/runs/9001").to_return do
      replace_installation!(configuration, repository)
      { status: 200, body: JSON.generate(workflow_run(status: "completed", conclusion: "success")) }
    end

    allow_obsolete_work_to_stop { configuration.discover_builds!(repository) }

    assert_replacement_retained(configuration, repository)
    assert_equal "running", build.reload.state
    assert_nil build.workflow_completed_at
  end

  test "an old missing workflow lookup cannot fail a build retained by the replacement installation" do
    configuration = github_app_configurations.create_installed
    repository = repositories.create
    build = repository.workflow_run_discoveries.record!(workflow_run(status: "in_progress"))
    stub_poll(configuration, repository)
    stub_request(:get, "#{GITHUB_API_URL}/repos/#{repository.github_path}/actions/runs/9001").to_return do
      replace_installation!(configuration, repository)
      { status: 404, body: "{}" }
    end

    allow_obsolete_work_to_stop { configuration.discover_builds!(repository) }

    assert_replacement_retained(configuration, repository)
    assert_equal "running", build.reload.state
    assert_nil build.failure_summary
  end

  test "an admitted old push cannot replace the replacement installation's accepted head" do
    configuration = github_app_configurations.create_installed
    repository = repositories.create
    head = nil
    payload = push_payload(repository)

    allow_obsolete_work_to_stop do
      deliver(configuration, payload, event: "push") do
        replace_installation!(configuration, repository)
        head = repository.build_discoveries.record! \
          branch_name: "prototype/welcome", commit_sha: "c" * 40, branch_head: true
        true
      end
    end

    assert_replacement_retained(configuration, repository)
    assert_equal head, head.prototype.reload.current_build
    assert_equal [ "c" * 40 ], head.prototype.builds.pluck(:commit_sha)
  end

  test "an admitted old workflow cannot fail the replacement installation's accepted run" do
    configuration = github_app_configurations.create_installed
    repository = repositories.create
    build = nil
    payload = {
      installation: { id: 456 },
      repository: { id: repository.github_id, default_branch: "main" },
      action: "completed",
      workflow_run: workflow_run(status: "completed", conclusion: "failure")
    }

    allow_obsolete_work_to_stop do
      deliver(configuration, payload, event: "workflow_run") do
        replace_installation!(configuration, repository)
        build = repository.workflow_run_discoveries.record!(workflow_run(status: "in_progress"))
        true
      end
    end

    assert_replacement_retained(configuration, repository)
    assert_equal "running", build.reload.state
    assert_equal 9001, build.github_workflow_run_id
    assert_nil build.failure_summary
  end

  test "an old deletion lookup cannot retire a branch retained by the replacement installation" do
    configuration = github_app_configurations.create_installed
    repository = repositories.create
    head = repository.build_discoveries.record! \
      branch_name: "prototype/welcome", commit_sha: "c" * 40, branch_head: true
    stub_github_installation_token
    stub_request(:get, "#{GITHUB_API_URL}/repos/#{repository.github_path}/branches")
      .with(query: { per_page: 100, page: 1 })
      .to_return(status: 200, body: "[]")
    stub_absent_branch(repository) { replace_installation!(configuration, repository) }
    payload = push_payload(repository).merge(deleted: true, after: "0" * 40)

    allow_obsolete_work_to_stop { deliver(configuration, payload, event: "push") }

    assert_replacement_retained(configuration, repository)
    assert_nil head.prototype.reload.branch_deleted_at
    assert_equal head, head.prototype.current_build
  end

  private

  def stub_poll(configuration, repository)
    stub_github_app(configuration:)
    stub_request(:get, "#{GITHUB_API_URL}/app/installations/456")
      .to_return(status: 200, body: JSON.generate(
        id: 456, app_id: configuration.github_app_id,
        account: { id: 321, login: "github", type: "Organization" }, suspended_at: nil
      ))
    stub_github_installation_token
    stub_github_repositories([ repository_payload(repository.github_id, repository.name_with_owner) ])
    stub_request(:get, "#{GITHUB_API_URL}/repos/#{repository.github_path}/branches")
      .with(query: { per_page: 100, page: 1 })
      .to_return(status: 200, body: JSON.generate(
        [ { name: "prototype/welcome", commit: { sha: "c" * 40 } } ]
      ))
    [ repository.github_path, "new-team/prototype" ].each do |path|
      stub_request(:get, "#{GITHUB_API_URL}/repos/#{path}/actions/workflows/replica.yml/runs")
        .with(query: { event: "push", per_page: 100, page: 1 })
        .to_return(status: 200, body: JSON.generate(workflow_runs: []))
    end
  end

  def stub_absent_branch(repository)
    stub_request(:get, "#{GITHUB_API_URL}/repos/#{repository.github_path}/git/ref/heads/prototype/welcome")
      .to_return(status: 404, body: "{}")
    stub_request(:get, "#{GITHUB_API_URL}/repos/#{repository.github_path}").to_return do
      yield
      { status: 200, body: JSON.generate(id: repository.github_id) }
    end
  end

  def replace_installation!(configuration, repository)
    replacement = GithubAppConfiguration.find(configuration.id)
    replacement.update! \
      owner_github_id: 654, owner_login: "new-team", installation_id: 789,
      installation_account_github_id: 654
    replacement.repositories.remove_all!
    replacement.repositories.synchronize! \
      snapshot: [
        { github_id: repository.github_id, name_with_owner: "new-team/prototype", default_branch: "main" }
      ]
  end

  def assert_replacement_retained(configuration, repository)
    assert_equal configuration.credential_revision, configuration.reload.credential_revision
    assert_equal 654, configuration.owner_github_id
    assert_equal 789, configuration.installation_id
    assert_equal 654, configuration.installation_account_github_id
    assert_equal "active", configuration.installation_state
    assert_equal "active", repository.reload.installation_state
    assert_equal "new-team/prototype", repository.name_with_owner
  end

  def allow_obsolete_work_to_stop
    yield
  rescue GithubAppConfiguration::Superseded, ActiveRecord::StaleObjectError, GithubWebhook::Rejected
    nil
  end

  def deliver(configuration, payload, event:, &admission)
    body = JSON.generate(payload)
    signature = "sha256=#{OpenSSL::HMAC.hexdigest("SHA256", configuration.webhook_secret, body)}"
    GithubWebhook.process! \
      configuration:, body:, signature:, delivery_id: SecureRandom.uuid, event:, &admission
  end

  def push_payload(repository)
    {
      installation: { id: 456 },
      repository: { id: repository.github_id, default_branch: "main" },
      ref: "refs/heads/prototype/welcome",
      before: "a" * 40,
      after: "b" * 40,
      deleted: false
    }
  end

  def workflow_run(status:, conclusion: nil)
    {
      "id" => 9001,
      "run_attempt" => 1,
      "path" => ".github/workflows/replica.yml",
      "event" => "push",
      "head_branch" => "prototype/welcome",
      "head_sha" => "c" * 40,
      "status" => status,
      "conclusion" => conclusion,
      "html_url" => "https://github.com/github/prototype/actions/runs/9001",
      "created_at" => "2026-09-17T18:00:00Z"
    }
  end
end
