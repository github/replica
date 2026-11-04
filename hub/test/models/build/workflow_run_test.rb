require "test_helper"

class Build::WorkflowRunTest < ActiveSupport::TestCase
  include ActiveJob::TestHelper

  test "records successful workflow completion while import remains pending" do
    build = builds.create

    assert_enqueued_with(job: Build::ImportPackageJob) do
      build.workflow_run.record! \
        run_id: 9001,
        run_attempt: 1,
        workflow_url: "https://github.com/github/prototype/actions/runs/9001",
        workflow_created_at: Time.iso8601("2026-09-17T18:00:00Z"),
        stage: "completed",
        conclusion: "success"
    end

    assert_equal "running", build.state
    assert_predicate build.workflow_completed_at, :present?
    assert_predicate build.package_import, :pending?
    assert_includes Build.awaiting_import, build
  end

  test "fails a Build when GitHub no longer provides its saved run" do
    build = builds.create
    build.workflow_run.record! \
      run_id: 9001,
      run_attempt: 1,
      workflow_url: "https://github.com/github/prototype/actions/runs/9001",
      workflow_created_at: Time.iso8601("2026-09-17T18:00:00Z"),
      stage: "requested",
      conclusion: nil

    assert build.workflow_run.fail_missing!

    assert_equal "failed", build.state
    assert_equal "GitHub no longer provides this build's workflow run.", build.failure_summary
    assert_predicate build.started_at, :present?
    assert_predicate build.finished_at, :present?
  end

  test "does not replace successful completion with a later failure" do
    build = builds.create
    attributes = {
      run_id: 9001,
      run_attempt: 1,
      workflow_url: "https://github.com/github/prototype/actions/runs/9001",
      workflow_created_at: Time.iso8601("2026-09-17T18:00:00Z")
    }
    build.workflow_run.record!(**attributes, stage: "completed", conclusion: "success")
    completed_at = build.workflow_completed_at

    build.workflow_run.record!(**attributes, stage: "completed", conclusion: "failure")

    assert_equal "running", build.reload.state
    assert_equal completed_at, build.workflow_completed_at
    assert_nil build.failure_summary
  end

  test "backfills GitHub chronology for a completed legacy Build" do
    time = Time.current
    build = builds.create
    build.update! \
      state: "failed",
      started_at: time,
      finished_at: time,
      failure_summary: "GitHub Actions finished with failure.",
      github_workflow_run_id: 9001,
      github_workflow_run_attempt: 1,
      workflow_url: "https://github.com/github/prototype/actions/runs/9001"
    workflow_created_at = Time.iso8601("2026-09-17T18:00:00Z")

    build.workflow_run.record! \
      run_id: 9001,
      run_attempt: 1,
      workflow_url: build.workflow_url,
      workflow_created_at:,
      stage: "completed",
      conclusion: "failure"

    assert_equal workflow_created_at, build.reload.workflow_created_at
    assert_equal "failed", build.state
  end

  test "a newer attempt of the saved run recovers a Build that GitHub held for approval" do
    build = builds.create
    build.workflow_run.record!(**run_attributes(1), stage: "completed", conclusion: "action_required")
    assert_equal "failed", build.state

    build.workflow_run.record!(**run_attributes(2), stage: "in_progress", conclusion: nil)

    assert_equal "running", build.reload.state
    assert_equal 2, build.github_workflow_run_attempt
    assert_equal 9001, build.github_workflow_run_id
    assert_equal Time.iso8601("2026-09-17T18:00:00Z"), build.workflow_created_at
    assert_nil build.finished_at
    assert_nil build.failure_summary

    assert_enqueued_with(job: Build::ImportPackageJob) do
      build.workflow_run.record!(**run_attributes(2), stage: "completed", conclusion: "success")
    end
    assert_predicate build.reload.package_import, :pending?
  end

  test "an older attempt cannot change a newer attempt's state" do
    build = builds.create
    build.workflow_run.record!(**run_attributes(2), stage: "completed", conclusion: "success")
    completed_at = build.workflow_completed_at

    build.workflow_run.record!(**run_attributes(1), stage: "completed", conclusion: "action_required")
    build.workflow_run.record!(**run_attributes(1), stage: "in_progress", conclusion: nil)

    assert_equal "running", build.reload.state
    assert_equal 2, build.github_workflow_run_attempt
    assert_equal completed_at, build.workflow_completed_at
    assert_predicate build.package_import, :pending?
  end

  test "a newer attempt cannot replace successful workflow output" do
    build = builds.create
    build.workflow_run.record!(**run_attributes(1), stage: "completed", conclusion: "success")
    completed_at = build.workflow_completed_at

    build.workflow_run.record!(**run_attributes(2), stage: "completed", conclusion: "failure")

    assert_equal "running", build.reload.state
    assert_equal 1, build.github_workflow_run_attempt
    assert_equal completed_at, build.workflow_completed_at
  end

  test "a newer attempt does not revive a superseded Build" do
    build = builds.create
    build.workflow_run.record!(**run_attributes(1), stage: "requested", conclusion: nil)
    build.update!(state: "superseded", finished_at: Time.current)

    build.workflow_run.record!(**run_attributes(2), stage: "completed", conclusion: "success")

    assert_equal "superseded", build.reload.state
    assert_equal 1, build.github_workflow_run_attempt
    assert_nil build.workflow_completed_at
  end

  test "the Build model only lets a workflow identity advance to a newer attempt of the same run" do
    build = builds.create
    build.workflow_run.record!(**run_attributes(2), stage: "completed", conclusion: "failure")

    assert_not build.update(github_workflow_run_attempt: 1)
    assert_not build.reload.update(github_workflow_run_id: 9002, github_workflow_run_attempt: 3)
    assert_not build.reload.update(workflow_url: "https://github.com/github/prototype/actions/runs/9002")
  end

  test "recognizes workflow links on the configured GitHub website" do
    assert Build::WorkflowRun.github_url?("https://github.com/github/prototype/actions/runs/9001")
    assert_not Build::WorkflowRun.github_url?("https://example.com/github/prototype/actions/runs/9001")
  end

  private

  def run_attributes(run_attempt)
    {
      run_id: 9001,
      run_attempt:,
      workflow_url: "https://github.com/github/prototype/actions/runs/9001",
      workflow_created_at: Time.iso8601("2026-09-17T18:00:00Z")
    }
  end
end
