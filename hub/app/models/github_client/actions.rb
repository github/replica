# Calls GitHub Actions APIs for workflow runs and artifacts.
class GithubClient::Actions
  # Uses the shared GitHub API transport.
  def initialize(transport)
    @transport = transport
  end

  # Lists the newest runs for the fixed Replica workflow.
  def workflow_runs(repository, token:)
    path = "/repos/#{repository.github_path}/actions/workflows/replica.yml/runs" \
      "?event=push&per_page=100&page=1"
    batch = transport.request(:get, path, token:)
    entries = batch.fetch("workflow_runs")
    raise GithubClient::InvalidResponse, "GitHub returned an invalid workflow run list" if !entries.is_a?(Array)

    entries
  rescue GithubClient::NotFound
    []
  rescue KeyError, TypeError
    raise GithubClient::InvalidResponse, "GitHub returned an incomplete workflow run list"
  end

  # Fetches one workflow run by its GitHub identity.
  def workflow_run(repository, run_id, token:)
    raise ArgumentError, "Workflow run ID must be positive" if run_id.to_i <= 0

    transport.request(:get, "/repos/#{repository.github_path}/actions/runs/#{run_id.to_i}", token:)
  end

  # Fetches one attempt of a workflow run.
  def workflow_run_attempt(repository, run_id, run_attempt, token:)
    raise ArgumentError, "Workflow run ID must be positive" if run_id.to_i <= 0
    raise ArgumentError, "Workflow run attempt must be positive" if run_attempt.to_i <= 0

    transport.request \
      :get,
      "/repos/#{repository.github_path}/actions/runs/#{run_id.to_i}/attempts/#{run_attempt.to_i}",
      token:
  end

  # Lists every fixed-name artifact created by one workflow run.
  def artifacts(repository, run_id, name:, token:)
    raise ArgumentError, "Workflow run ID must be positive" if run_id.to_i <= 0

    artifacts = []
    page = 1
    loop do
      path = "/repos/#{repository.github_path}/actions/runs/#{run_id.to_i}/artifacts" \
        "?name=#{CGI.escapeURIComponent(name)}&per_page=100&page=#{page}"
      entries = transport.request(:get, path, token:).fetch("artifacts")
      raise GithubClient::InvalidResponse, "GitHub returned an invalid workflow artifact list" if !entries.is_a?(Array)

      artifacts.concat(entries)
      break if entries.length < 100

      page += 1
    end
    artifacts
  rescue KeyError, TypeError
    raise GithubClient::InvalidResponse, "GitHub returned an incomplete workflow artifact list"
  end

  # Streams one private Actions artifact ZIP into the provided destination.
  def download_artifact(repository, artifact_id, token:, destination:, maximum_bytes: nil)
    raise ArgumentError, "Artifact ID must be positive" if artifact_id.to_i <= 0

    transport.download \
      "/repos/#{repository.github_path}/actions/artifacts/#{artifact_id.to_i}/zip",
      token:,
      destination:,
      maximum_bytes:
  end

  private

  attr_reader :transport
end
