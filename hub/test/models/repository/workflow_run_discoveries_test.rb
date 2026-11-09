require "test_helper"

class Repository::WorkflowRunDiscoveriesTest < ActiveSupport::TestCase
  include ActiveJob::TestHelper

  test "creates one queued Build when a workflow is requested before its push" do
    repository = repositories.create

    build = repository.workflow_run_discoveries.record!(workflow_run, action: "requested")

    assert_equal "queued", build.state
    assert_equal 9001, build.github_workflow_run_id
    assert_equal 1, build.github_workflow_run_attempt
    assert_equal Time.iso8601("2026-09-17T18:00:00Z"), build.workflow_created_at
  end

  test "moves a Build to running when GitHub starts its workflow" do
    repository = repositories.create

    build = repository.workflow_run_discoveries.record!(workflow_run(status: "in_progress"))

    assert_equal "running", build.state
    assert_predicate build.started_at, :present?
  end

  test "fails a Build when a completed workflow did not succeed" do
    repository = repositories.create

    build = repository.workflow_run_discoveries.record!(workflow_run(status: "completed", conclusion: "timed_out"))

    assert_equal "failed", build.state
    assert_equal "GitHub Actions finished with timed out.", build.failure_summary
    assert_predicate build.finished_at, :present?
  end

  test "keeps a completed successful workflow running until import" do
    repository = repositories.create

    assert_enqueued_with(job: Build::ImportPackageJob) do
      @build = repository.workflow_run_discoveries.record!(workflow_run(status: "completed", conclusion: "success"))
    end
    build = @build

    assert_equal "running", build.state
    assert_predicate build.workflow_completed_at, :present?
    assert_nil build.finished_at
  end

  test "may enqueue the same completed workflow more than once" do
    repository = repositories.create
    run = workflow_run(status: "completed", conclusion: "success")

    assert_enqueued_jobs 2, only: Build::ImportPackageJob do
      repository.workflow_run_discoveries.record!(run)
      repository.workflow_run_discoveries.record!(run)
    end

    assert_equal 1, Build.count
  end

  test "lets a later push add predecessor evidence to a workflow-first Build" do
    repository = repositories.create
    older = repository.build_discoveries.record! \
      branch_name: "prototype/welcome",
      commit_sha: "b" * 40
    build = repository.workflow_run_discoveries.record!(workflow_run, action: "requested")

    repeated = repository.build_discoveries.record! \
      branch_name: "prototype/welcome",
      commit_sha: "a" * 40,
      previous_commit_sha: older.commit_sha

    assert_equal build, repeated
    assert_equal "superseded", older.reload.state
  end

  test "ignores another run attempt after attaching workflow identity" do
    repository = repositories.create
    original = repository.workflow_run_discoveries.record!(workflow_run(status: "in_progress"))

    repeated = repository.workflow_run_discoveries.record!(
      workflow_run(id: 9002, run_attempt: 2, status: "completed", conclusion: "failure")
    )

    assert_equal original, repeated
    assert_equal "running", original.reload.state
    assert_equal 9001, original.github_workflow_run_id
  end

  test "a successful second attempt recovers the Build that GitHub held for approval" do
    repository = repositories.create
    failed = repository.workflow_run_discoveries.record!(
      workflow_run(status: "completed", conclusion: "action_required")
    )
    assert_equal "GitHub Actions finished with action required.", failed.failure_summary

    repository.workflow_run_discoveries.record!(workflow_run(run_attempt: 2), action: "requested")
    assert_equal "queued", failed.reload.state
    assert_enqueued_with(job: Build::ImportPackageJob) do
      @recovered = repository.workflow_run_discoveries.record!(
        workflow_run(run_attempt: 2, status: "completed", conclusion: "success"), action: "completed"
      )
    end
    stale = repository.workflow_run_discoveries.record!(
      workflow_run(status: "completed", conclusion: "action_required"), action: "completed"
    )

    assert_equal failed, @recovered
    assert_equal failed, stale
    assert_equal 1, Build.count
    assert_equal 2, failed.reload.github_workflow_run_attempt
    assert_equal "running", failed.state
    assert_nil failed.failure_summary
    assert_predicate failed.package_import, :pending?
  end

  test "a newer attempt stays on the retired history that owns its run" do
    repository = repositories.create
    original = repository.workflow_run_discoveries.record!(
      workflow_run(status: "completed", conclusion: "action_required")
    )
    original.prototype.update!(current_build: original)
    travel_to original.workflow_created_at + 0.2.seconds, with_usec: true do
      repository.branch_presence.record_missing! \
        branch_name: "prototype/welcome",
        observed: repository.branch_presence.observations.fetch("prototype/welcome")
    end
    replacement = prototypes.create(repository:, branch_name: "prototype/welcome")
    replacement_build = builds.create(prototype: replacement, commit_sha: "a" * 40)

    recovered = repository.workflow_run_discoveries.record!(
      workflow_run(run_attempt: 2, status: "completed", conclusion: "success")
    )

    assert_equal original, recovered
    assert_predicate original.reload.package_import, :pending?
    assert_nil replacement_build.reload.github_workflow_run_id
  end

  test "ignores runs outside the fixed workflow contract" do
    repository = repositories.create

    assert_nil repository.workflow_run_discoveries.record!(workflow_run(path: ".github/workflows/other.yml"))
    assert_nil repository.workflow_run_discoveries.record!(workflow_run(event: "workflow_dispatch"))
    assert_nil repository.workflow_run_discoveries.record!(
      workflow_run(head_branch: "replica/install-workflow")
    )
    assert_empty Build.all
  end

  test "imports a successful default branch workflow with the existing Build job" do
    repository = repositories.create
    assert_enqueued_with(job: Build::ImportPackageJob) do
      build = repository.workflow_run_discoveries.record!(
        workflow_run(head_branch: "main", status: "completed", conclusion: "success")
      )
      assert_predicate build.prototype, :replica?
      assert_equal "running", build.state
      assert_predicate build.workflow_completed_at, :present?
    end
    assert_enqueued_jobs 0, only: Build::ImportStartPageJob
  end

  test "payload default hints stay internal without replacing the synchronized default" do
    repository = repositories.create
    build = repository.workflow_run_discoveries.record!(
      workflow_run(head_branch: "trunk"), default_branch: "trunk"
    )
    assert_predicate build.prototype, :replica?
    assert_equal "main", repository.reload.default_branch
    assert_not repository.reviewable_prototypes.exists?(id: build.prototype_id)
  end

  test "a delayed former default workflow stays internal after a rename without prior Builds" do
    repository = repositories.create
    repository.update!(default_branch: "trunk")
    owner = repository.prototypes.find_by!(branch_name: "main")

    assert_no_enqueued_jobs only: Build::ImportStartPageJob do
      build = repository.workflow_run_discoveries.record!(
        workflow_run(head_branch: "main", status: "completed", conclusion: "success")
      )
      assert_equal owner, build.prototype
      assert_predicate build.prototype, :replica?
      assert_not build.prototype.reviewable?
      assert_equal "running", build.state
    end
    assert_empty repository.reviewable_prototypes
  end

  test "rejects malformed workflow identity" do
    repository = repositories.create

    assert_raises(Repository::WorkflowRunDiscoveries::InvalidRun) do
      repository.workflow_run_discoveries.record!(workflow_run(id: 0))
    end
  end

  test "rejects a workflow link outside the configured GitHub origin" do
    repository = repositories.create

    error = assert_raises(Repository::WorkflowRunDiscoveries::InvalidRun) do
      repository.workflow_run_discoveries.record! \
        workflow_run(html_url: "https://example.com/github/prototype/actions/runs/9001")
    end

    assert_equal \
      "GitHub returned a workflow URL outside the configured GitHub website",
      error.message
  end

  test "rejects a missing workflow branch" do
    repository = repositories.create

    assert_raises(Repository::WorkflowRunDiscoveries::InvalidRun) do
      repository.workflow_run_discoveries.record!(workflow_run(head_branch: nil))
    end
  end

  test "a delayed workflow stays on its retired history after the branch name is reused" do
    repository = repositories.create
    original = repository.workflow_run_discoveries.record!(workflow_run(status: "in_progress"))
    original.prototype.update!(current_build: original)
    travel_to original.workflow_created_at + 0.2.seconds, with_usec: true do
      repository.branch_presence.record_missing! \
        branch_name: "prototype/welcome",
        observed: repository.branch_presence.observations.fetch("prototype/welcome")
    end
    replacement = prototypes.create(repository:, branch_name: "prototype/welcome")
    replacement_build = builds.create(prototype: replacement, commit_sha: "a" * 40)
    replacement.update!(current_build: replacement_build)

    completed = repository.workflow_run_discoveries.record!(
      workflow_run(status: "completed", conclusion: "success")
    )
    historical_run = workflow_run \
      id: 9002,
      head_sha: "b" * 40,
      status: "in_progress",
      created_at: (original.workflow_created_at - 1.second).iso8601
    previously_unseen = repository.workflow_run_discoveries.record!(historical_run)

    assert_equal original, completed
    assert_equal original.prototype_id, previously_unseen.prototype_id
    assert_predicate original.reload.package_import, :pending?
    assert_nil replacement_build.reload.github_workflow_run_id
    assert_equal replacement_build, replacement.reload.current_build
    assert_equal "a" * 40, original.prototype.reload.retired_head_sha
  end

  test "a new workflow belongs to the active generation and cannot revive a retired one" do
    repository = repositories.create
    original = repository.workflow_run_discoveries.record!(workflow_run)
    original.prototype.update!(current_build: original)
    repository.branch_presence.record_missing!(
      branch_name: "prototype/welcome",
      observed: repository.branch_presence.observations.fetch("prototype/welcome")
    )
    run = workflow_run(id: 9002, head_sha: "b" * 40, created_at: 1.minute.from_now.iso8601)

    assert_nil repository.workflow_run_discoveries.record!(run)
    replacement = prototypes.create(repository:, branch_name: "prototype/welcome")
    build = repository.workflow_run_discoveries.record!(run)

    assert_equal replacement.id, build.prototype_id
    assert original.prototype.reload.branch_deleted_at
    assert_equal [ "a" * 40 ], original.prototype.builds.pluck(:commit_sha)
  end

  test "a first workflow waiting for discovery keeps the history retired before it acquired the lock" do
    repository = repositories.create
    original_lock = repository.method(:with_lock)
    retired = nil
    replacement = nil
    repository.define_singleton_method(:with_lock) do |&block|
      define_singleton_method(:with_lock, original_lock)
      concurrent = Repository.find(id)
      retired = concurrent.build_discoveries.record! \
        branch_name: "prototype/welcome",
        commit_sha: "a" * 40,
        branch_head: true
      concurrent.branch_presence.record_missing! \
        branch_name: "prototype/welcome",
        observed: concurrent.branch_presence.observations.fetch("prototype/welcome")
      observed = concurrent.branch_presence.observations.fetch("prototype/welcome")
      replacement = concurrent.build_discoveries.record! \
        branch_name: "prototype/welcome",
        commit_sha: "b" * 40,
        branch_head: true,
        expected_prototype_id: observed.id,
        expected_head_observation_revision: observed.head_observation_revision,
        resume_retired: false
      original_lock.call(&block)
    end

    build = repository.workflow_run_discoveries.record!(workflow_run)

    assert_equal retired, build
    assert_equal 9001, retired.reload.github_workflow_run_id
    assert retired.prototype.reload.branch_deleted_at
    assert_nil replacement.reload.github_workflow_run_id
    assert_equal [ "b" * 40 ], replacement.prototype.builds.pluck(:commit_sha)
    assert_equal replacement, replacement.prototype.reload.current_build
  end

  private

  def workflow_run(overrides = {})
    {
      "id" => 9001,
      "run_attempt" => 1,
      "path" => ".github/workflows/replica.yml",
      "event" => "push",
      "head_branch" => "prototype/welcome",
      "head_sha" => "a" * 40,
      "status" => "queued",
      "conclusion" => nil,
      "html_url" => "https://github.com/github/prototype/actions/runs/9001",
      "created_at" => "2026-09-17T18:00:00Z"
    }.merge(overrides.transform_keys(&:to_s))
  end
end
