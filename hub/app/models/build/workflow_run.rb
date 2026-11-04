# Records GitHub workflow identity and state changes for one Build.
class Build::WorkflowRun < ActiveRecord::AssociatedObject
  class << self
    # Reports whether a link uses the configured GitHub website over HTTPS.
    def github_url?(value)
      return false if !value.is_a?(String) || value.bytesize > 2048

      workflow_uri = URI.parse(value)
      github_uri = URI.parse(Rails.configuration.x.github_url)
      workflow_uri.is_a?(URI::HTTPS) && workflow_uri.userinfo.nil? &&
        workflow_uri.host == github_uri.host && workflow_uri.port == github_uri.port
    rescue URI::InvalidURIError
      false
    end
  end

  # Adds an error when the saved workflow link does not use the configured GitHub website.
  def validate_url
    return if build.workflow_url.nil? || self.class.github_url?(build.workflow_url)

    build.errors.add(:workflow_url, "must use the configured GitHub website over HTTPS")
  end

  # Records the first workflow run, or a newer attempt of it, and changes the Build from GitHub's current result.
  def record!(run_id:, run_attempt:, workflow_url:, workflow_created_at:, stage:, conclusion:)
    build.with_lock do
      if same_run?(run_id, run_attempt) && build.workflow_created_at.nil?
        build.update!(workflow_created_at:)
      end

      if newer_attempt?(run_id, run_attempt)
        restart_attempt(run_attempt, workflow_url, workflow_created_at)
        update_state(stage, conclusion)
        build.save!
        next
      end

      eligible = !%w[failed superseded successful].include?(build.state)
      eligible &&= build.github_workflow_run_id.nil? || same_run?(run_id, run_attempt)
      if eligible && build.workflow_completed_at.nil?
        assign_identity(run_id, run_attempt, workflow_url, workflow_created_at)
        update_state(stage, conclusion)
        build.save!
      end
    end
    build.import_package_later! if build.package_import.pending?
    build
  end

  # Fails a Build when GitHub no longer provides its saved workflow run.
  def fail_missing!
    build.with_lock do
      return false if !%w[queued running].include?(build.state) || build.workflow_completed_at.present?

      now = Time.current
      build.update! \
        state: "failed",
        started_at: build.started_at || now,
        finished_at: now,
        failure_summary: "GitHub no longer provides this build's workflow run."
    end
    true
  end

  private

  # Checks whether the run ID and attempt match the workflow already recorded.
  def same_run?(run_id, run_attempt)
    build.github_workflow_run_id == run_id && build.github_workflow_run_attempt == run_attempt
  end

  # A re-run keeps GitHub's run ID. Only Builds without successful workflow output can follow it.
  def newer_attempt?(run_id, run_attempt)
    build.github_workflow_run_id == run_id && run_attempt > build.github_workflow_run_attempt &&
      %w[queued running failed].include?(build.state) && build.workflow_completed_at.nil?
  end

  # Moves the Build to a newer attempt of its saved run and clears the earlier attempt's result.
  def restart_attempt(run_attempt, workflow_url, workflow_created_at)
    build.github_workflow_run_attempt = run_attempt
    build.workflow_url = workflow_url
    build.workflow_created_at ||= workflow_created_at
    build.state = "queued"
    build.started_at = nil
    build.finished_at = nil
    build.failure_summary = nil
  end

  # Saves the first workflow run ID, attempt, and GitHub URL.
  def assign_identity(run_id, run_attempt, workflow_url, workflow_created_at)
    if build.github_workflow_run_id.present?
      build.workflow_created_at ||= workflow_created_at
      return
    end

    build.github_workflow_run_id = run_id
    build.github_workflow_run_attempt = run_attempt
    build.workflow_url = workflow_url
    build.workflow_created_at = workflow_created_at
  end

  # Changes the Build to running or failed while successful output awaits import.
  def update_state(stage, conclusion)
    return if stage == "requested"

    now = Time.current
    build.started_at ||= now
    build.state = "running"
    return if stage == "in_progress"

    if conclusion == "success"
      build.workflow_completed_at ||= now
      return
    end

    build.state = "failed"
    build.finished_at = now
    build.failure_summary = "GitHub Actions finished with #{conclusion.tr("_", " ")}."
  end
end
