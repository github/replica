require "tempfile"

# Downloads and retains one completed Build's GitHub Actions package.
class Build::PackageImport < ActiveRecord::AssociatedObject
  ARTIFACT_NAME = Repository::WorkflowRunDiscoveries::ARTIFACT_NAME

  class ArtifactMissing < StandardError; end
  class ArtifactExpired < StandardError; end
  class ArtifactAmbiguous < StandardError; end

  # Downloads one Actions package and publishes its dist and screenshots.
  def download!(configuration: GithubAppConfiguration.current, artifact_store: ArtifactStore.current)
    setting = BuildSetting.current
    build.reload
    return if !importable?

    return fail!("The GitHub App installation is no longer active.") if !active?(configuration)

    repository = build.prototype.repository
    if repository.installation_state != "active"
      return fail!("The prototype repository is no longer installed.")
    end

    client = configuration.github_client
    token = configuration.tokens.installation
    artifact_id = build.github_artifact_id || select_artifact_id(client, token, repository)
    import_package(client, token, repository, artifact_id, artifact_store:, setting:)
  rescue ArtifactMissing
    fail!("GitHub Actions did not provide the replica-build-v1 artifact.")
  rescue ArtifactExpired
    fail!("The replica-build-v1 artifact expired before Hub could download it.")
  rescue ArtifactAmbiguous
    fail!("GitHub Actions returned more than one replica-build-v1 artifact for this run.")
  rescue Build::PackageExtraction::InvalidPackage => error
    fail!("The replica-build-v1 artifact cannot be stored: #{error.message}")
  rescue GithubClient::DownloadTooLarge
    fail!("The replica-build-v1 archive is too large to download safely. " \
      "#{BuildSetting.limit_message(setting.maximum_bytes)}")
  rescue GithubClient::Gone
    fail!("The GitHub download expired before Hub could finish it.")
  rescue GithubClient::NotFound
    fail!("GitHub no longer provides the package for this build.")
  rescue GithubClient::Forbidden
    fail!("The GitHub App can no longer download this build.")
  rescue GithubClient::InvalidResponse => error
    fail!("The build import failed: #{error.message}")
  rescue ArtifactStore::InvalidObject => error
    fail!("Artifact storage rejected the build package: #{error.message}")
  end

  # Reports whether a completed successful workflow still needs publication.
  def pending?
    importable?
  end

  private

  # Reports whether a successful workflow can continue its import.
  def importable?
    build.state == "running" && build.workflow_completed_at.present?
  end

  # Reports whether the saved GitHub App can authenticate installation requests.
  def active?(configuration)
    configuration&.installation_state == "active"
  end

  # Downloads the selected package and replaces any incomplete retained prefix.
  def import_package(client, token, repository, artifact_id, artifact_store:, setting:)
    prefix = "builds/#{build.id}"
    Tempfile.create([ "replica-build-", ".zip" ], binmode: true) do |package|
      client.actions.download_artifact \
        repository,
        artifact_id,
        token:,
        destination: package,
        maximum_bytes: setting.maximum_download_bytes
      package.flush
      build.reload
      return if !importable?
      return if build.github_artifact_id.nil? && !record_artifact!(artifact_id)

      artifact_store.delete_prefix(prefix)
      bytes = Build::PackageExtraction.new(artifact_store:, maximum_bytes: setting.maximum_bytes).extract!(package, prefix:)
      publish!(prefix:, bytes:)
    end
  rescue StandardError
    artifact_store.delete_prefix(prefix) if build.reload.state != "successful"
    raise
  end

  # Saves the first GitHub artifact selected for this completed workflow run.
  def record_artifact!(artifact_id)
    build.with_lock do
      return build.github_artifact_id == artifact_id if build.github_artifact_id.present?
      return false if !importable?

      build.update!(github_artifact_id: artifact_id)
    end
    true
  end

  # Marks the Build successful after all retained files have been stored.
  def publish!(prefix:, bytes:)
    build.with_lock do
      return false if !importable?

      build.update! \
        state: "successful",
        finished_at: Time.current,
        artifact_prefix: prefix,
        artifact_bytes: bytes
    end
    true
  end

  # Fails a Build whose completed workflow output cannot be imported.
  def fail!(summary)
    build.with_lock do
      return false if !importable?

      build.update!(state: "failed", finished_at: Time.current, failure_summary: summary)
    end
    true
  end

  # Returns the one Actions artifact ID selected from the completed workflow run.
  def select_artifact_id(client, token, repository)
    artifacts = client.actions.artifacts \
      repository,
      build.github_workflow_run_id,
      name: ARTIFACT_NAME,
      token: token
    artifact = select_artifact(artifacts)
    artifact.fetch("id")
  end

  # Returns the one unexpired fixed-name artifact for this workflow run.
  def select_artifact(artifacts)
    matches = artifacts.select { _1["name"] == ARTIFACT_NAME }
    raise ArtifactMissing if matches.empty?
    raise ArtifactAmbiguous if matches.many?

    artifact = matches.first
    raise ArtifactExpired if artifact.fetch("expired") == true

    id = artifact.fetch("id")
    raise GithubClient::InvalidResponse, "GitHub returned an invalid artifact ID" if !id.is_a?(Integer) || id <= 0

    artifact
  rescue KeyError, TypeError
    raise GithubClient::InvalidResponse, "GitHub returned incomplete artifact data"
  end
end
