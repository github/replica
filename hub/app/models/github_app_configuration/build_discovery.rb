# Polls GitHub for current branch commits and Replica workflow states.
class GithubAppConfiguration::BuildDiscovery < ActiveRecord::AssociatedObject
  # Refreshes repositories and records their current branch and workflow state.
  def poll!(repository = nil)
    record.synchronize_repositories!
    return if record.installation_state != "active"

    installation = record.installation_snapshot
    repositories = repository ? Repository.active.where(id: repository.id) : Repository.active
    repositories.find_each { discover_repository!(_1, installation:) }
  end

  private

  # Records current branch commits and workflow states for one repository.
  def discover_repository!(repository, installation:)
    observations = repository.branch_presence.observations
    current_branches = observations.values.select { |prototype| prototype.branch_deleted_at.nil? && prototype.reviewable? }
      .map(&:branch_name)
    heads = repository.branch_presence.heads(configuration: record, corroborate: current_branches)
    heads.each do |branch_name, commit_sha|
      next unless repository.build_branch?(branch_name)

      repository.branch_presence.record_head! \
        branch_name:,
        commit_sha:,
        observed: observations[branch_name],
        configuration: record,
        installation:
    end
    observations.each do |branch_name, observed|
      next if heads.key?(branch_name)

      record.with_installation!(snapshot: installation) do
        repository.branch_presence.record_missing!(branch_name:, observed:)
      end
    end
    runs = workflow_runs(repository)
    observed_run_ids = runs.filter_map do |run|
      build = record.with_installation!(snapshot: installation) do
        repository.workflow_run_discoveries.record!(run)
      end
      if build&.github_workflow_run_id == run.fetch("id") &&
          build.github_workflow_run_attempt == run.fetch("run_attempt")
        build.github_workflow_run_id
      end
    end
    reconcile_saved_workflow_runs!(repository, observed_run_ids, installation:)
  rescue KeyError, TypeError, ArgumentError, Repository::WorkflowRunDiscoveries::InvalidRun
    raise \
      GithubClient::InvalidResponse,
      "GitHub returned incomplete build discovery data"
  end

  # Lists workflow runs or explains which App permission must be approved.
  def workflow_runs(repository)
    record.github_client.actions.workflow_runs \
      repository,
      token: record.tokens.installation
  rescue GithubClient::Forbidden
    raise \
      GithubClient::Forbidden,
      "GitHub App installation cannot read Actions workflow runs. " \
        "Grant Actions read permission and approve the installation update."
  end

  # Fetches exact saved runs whose completion was not present in the newest run list.
  def reconcile_saved_workflow_runs!(repository, observed_run_ids, installation:)
    builds = Build.joins(:prototype).where \
      prototypes: { repository_id: repository.id },
      state: %w[queued running],
      workflow_completed_at: nil
    builds = builds.where.not(github_workflow_run_id: nil)
    builds = builds.where.not(github_workflow_run_id: observed_run_ids) if observed_run_ids.any?
    builds.find_each do |build|
      run = record.github_client.actions.workflow_run \
        repository,
        build.github_workflow_run_id,
        token: record.tokens.installation
      record.with_installation!(snapshot: installation) do
        repository.workflow_run_discoveries.record!(run)
      end
    rescue GithubClient::NotFound
      record.with_installation!(snapshot: installation) do
        build.workflow_run.fail_missing!
      end
    end
  end
end
