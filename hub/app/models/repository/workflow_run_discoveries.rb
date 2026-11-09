# Matches authenticated GitHub workflow runs to exact builds.
class Repository::WorkflowRunDiscoveries < ActiveRecord::AssociatedObject
  WORKFLOW_PATH = ".github/workflows/replica.yml"
  ARTIFACT_NAME = "replica-build-v1"
  COMMIT_SHA_FORMAT = /\A[0-9a-f]{40}\z/
  FAILURE_CONCLUSIONS = %w[
    action_required cancelled failure neutral skipped stale startup_failure timed_out
  ].freeze
  REQUESTED_STATUSES = %w[pending queued requested waiting].freeze

  class InvalidRun < StandardError; end

  # Validates one workflow run and records its identity and state on the matching Build.
  def record!(run, action: nil, default_branch: record.default_branch)
    return if run.fetch("path") != WORKFLOW_PATH || run.fetch("event") != "push"

    branch_name = run.fetch("head_branch")
    valid_branch = branch_name.is_a?(String) && branch_name.strip.present? && branch_name.bytesize <= 255
    raise InvalidRun, "GitHub returned an invalid workflow branch" if !valid_branch

    return if !record.build_branch?(branch_name)

    attributes = attributes_from(run, action:)
    # A concurrent branch replacement must not claim an older workflow.
    build = record.with_lock do
      # Re-runs keep the run ID, so any saved attempt identifies the Build and its history.
      saved = Build.joins(:prototype)
        .where(prototypes: { repository_id: record.id, branch_name: }, github_workflow_run_id: attributes.fetch(:run_id))
        .order(github_workflow_run_attempt: :desc)
        .first
      if saved && saved.commit_sha != attributes.fetch(:commit_sha)
        raise InvalidRun, "GitHub changed the saved workflow commit"
      end

      owner = saved&.prototype || workflow_owner(branch_name, attributes.fetch(:workflow_created_at))
      return if saved.nil? && owner.nil? && record.prototypes.retired.exists?(branch_name:)

      record.build_discoveries.record! \
        branch_name:,
        commit_sha: attributes.fetch(:commit_sha),
        default_branch:,
        prototype_id: saved&.prototype_id || owner&.id
    end

    return if build.nil?

    build.workflow_run.record!(**attributes.except(:commit_sha))
    build
  rescue KeyError, TypeError, ArgumentError
    raise InvalidRun, "GitHub returned an incomplete workflow run"
  end

  private

  # Whole-second run times cannot distinguish histories replaced in that second.
  def workflow_owner(branch_name, created_at)
    owners = record.prototypes.where(branch_name:)
    retired = owners.retired.where("branch_deleted_at >= ?", created_at)
      .order(:branch_deleted_at, :id).first
    if retired && retired.branch_deleted_at.to_i == created_at.to_i
      raise GithubClient::Error, "Workflow creation time overlaps branch retirement; Hub cannot identify its prototype"
    end

    retired || owners.active.first
  end

  # Validates required GitHub fields and returns the values saved on the Build.
  def attributes_from(run, action:)
    commit_sha = run.fetch("head_sha")
    raise InvalidRun, "GitHub returned an invalid workflow commit" if !COMMIT_SHA_FORMAT.match?(commit_sha)

    run_id = positive_integer(run.fetch("id"))
    run_attempt = positive_integer(run.fetch("run_attempt"))
    workflow_url = run.fetch("html_url")
    validate_workflow_url!(workflow_url)
    workflow_created_at = Time.iso8601(run.fetch("created_at"))
    stage = stage_from(action || run.fetch("status"))
    conclusion = run["conclusion"]
    if stage == "completed" && conclusion != "success" && !FAILURE_CONCLUSIONS.include?(conclusion)
      raise InvalidRun, "GitHub returned an invalid workflow conclusion"
    end

    {
      commit_sha:,
      run_id:,
      run_attempt:,
      workflow_url:,
      workflow_created_at:,
      stage:,
      conclusion:
    }
  end

  # Rejects workflow links outside the configured GitHub website.
  def validate_workflow_url!(workflow_url)
    if !Build::WorkflowRun.github_url?(workflow_url)
      raise InvalidRun, "GitHub returned a workflow URL outside the configured GitHub website"
    end
  end

  # Converts GitHub's numeric identifiers and requires positive values.
  def positive_integer(value)
    raise InvalidRun, "GitHub returned an invalid workflow identity" if !value.is_a?(Integer) || value <= 0

    value
  end

  # Converts GitHub's status into requested, in-progress, or completed work.
  def stage_from(value)
    return "requested" if REQUESTED_STATUSES.include?(value)
    return value if %w[in_progress completed].include?(value)

    raise InvalidRun, "GitHub returned an invalid workflow status"
  end
end
