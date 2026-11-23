# Registers an exact imported task commit without changing the existing canvas contract.
class Prototype::TaskRegistration < ActiveRecord::AssociatedObject
  # Verifies remote evidence before entering the shared authorization and registration locks.
  def register!(connection:, commit_sha:)
    raise ActionController::BadRequest unless commit_sha.is_a?(String) && commit_sha.match?(Build::COMMIT_SHA_FORMAT)
    if connection.repository_id != record.repository_id || connection.branch_name != record.branch_name
      raise TaskConnection::Forbidden
    end

    observed = Prototype.find(record.id)
    configuration = GithubAppConfiguration.current
    raise TaskConnection::Forbidden if configuration.nil?

    remote_sha = if observed.reviewable? && observed.branch_deleted_at.nil?
      observed.repository.branch_presence.current_head(observed.branch_name, configuration:)
    end
    connection.with_publication_authorization! do |live_connection|
      record.with_lock do
        publish!(connection: live_connection, observed:, remote_sha:, commit_sha:)
      end
    end
  end

  private

  # Rechecks identity after every external request, including already registered targets.
  def publish!(connection:, observed:, remote_sha:, commit_sha:)
    target = record.repository.reviewable_prototypes.active.find_by(branch_name: record.branch_name)
    if !record.reviewable?
      return result(commit_sha:, status: "blocked", reason: "branch_not_reviewable")
    end
    if target&.id != record.id || record.branch_deleted_at || remote_sha != commit_sha ||
        record.head_observation_revision != observed.head_observation_revision
      return result(commit_sha:, status: "superseded", reason: "target_changed")
    end
    if record.current_build&.commit_sha != commit_sha
      return result(commit_sha:, status: "pending", phase: "discovery", reason: "head_not_discovered")
    end

    build = record.builds.find_by(commit_sha:)
    unless build&.state == "successful"
      status = case build&.state
      when "failed" then "failed"
      when "superseded" then "superseded"
      else "pending"
      end
      phase = build&.workflow_completed_at && build.state == "running" ? "import" : "workflow"
      return result(commit_sha:, build:, status:, phase:, reason: build ? "build_#{build.state}" : "build_not_discovered")
    end

    raise TaskConnection::Unauthorized if connection.expires_at <= Time.current || connection.revoked_at

    created = !record.registered?
    record.register! \
      name: record.name || record.branch_name,
      description: record.description,
      registration_task_connection: connection,
      registration_only: true

    connection.audit!("register")
    path = Rails.application.routes.url_helpers.repository_prototype_path \
      record.repository.route_id, record, build: build.number
    result(commit_sha:, build:, status: "ready").merge \
      registration: created ? "created" : "existing",
      url: "#{Rails.configuration.x.hub_origin.delete_suffix('/')}#{path}"
  end

  # Carries only the saved Build that matches this command, never the latest preview.
  def result(commit_sha:, status:, phase: "registration", reason: nil, build: nil)
    payload = {
      status:, phase:, repositoryGitHubId: record.repository.route_id,
      prototypeId: record.id, branch: record.branch_name, commitSha: commit_sha,
      registered: record.registered?
    }
    payload[:reason] = reason if reason
    if build
      payload.merge! \
        buildId: build.id, buildNumber: build.number,
        runId: build.github_workflow_run_id, runAttempt: build.github_workflow_run_attempt,
        artifactId: build.github_artifact_id
    end
    payload
  end
end
