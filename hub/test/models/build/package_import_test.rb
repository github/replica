require "test_helper"
require "tmpdir"
require "zip"

class Build::PackageImportTest < ActiveSupport::TestCase
  setup do
    @artifact_root = Pathname(Dir.mktmpdir("replica-package-import-"))
    @artifact_store = ArtifactStore.new(adapter: ArtifactStore::Local.new(root: @artifact_root))
  end

  teardown do
    FileUtils.rm_rf(@artifact_root)
  end

  test "retains dist and screenshots from one completed workflow" do
    build = completed_build
    configuration = installed_configuration
    temporary_paths = []
    client = fake_client
    package = replica_package
    download_limit = BuildSetting.current.maximum_download_bytes
    client.actions.define_singleton_method(:download_artifact) do |_repository, artifact_id, token:, destination:, maximum_bytes:|
      raise "wrong artifact" if artifact_id != 8001
      raise "wrong token" if token != "installation-token"
      raise "wrong package limit" if maximum_bytes != download_limit

      temporary_paths << destination.path
      destination.write(package)
    end
    stub_github_client(configuration, client)

    import_package(build, configuration)

    assert_equal "successful", build.reload.state
    assert_equal 8001, build.github_artifact_id
    assert_equal "builds/#{build.id}", build.artifact_prefix
    assert_equal 72, build.artifact_bytes
    assert_equal \
      [ "builds/#{build.id}/dist/index.html", "builds/#{build.id}/screenshots/desktop.png",
        "builds/#{build.id}/screenshots/narrow.png" ],
      @artifact_store.list(build.artifact_prefix)
    assert temporary_paths.none? { File.exist?(_1) }
  end

  test "accepts explicit package directory entries" do
    build = completed_build
    configuration = installed_configuration
    client = fake_client(package: replica_package(directories: %w[dist screenshots]))
    stub_github_client(configuration, client)

    import_package(build, configuration)

    assert_equal "successful", build.reload.state
  end

  test "retains a full-page screenshot larger than the former byte limit" do
    build = completed_build
    configuration = installed_configuration
    desktop = "s" * (11.megabytes)
    client = fake_client(package: replica_package(desktop_screenshot: desktop))
    stub_github_client(configuration, client)

    import_package(build, configuration)

    assert_equal "successful", build.reload.state
    assert_equal 11.megabytes + "<!doctype html><title>Replica</title>".bytesize +
      "narrow screenshot".bytesize, build.artifact_bytes
  end

  test "retries a selected artifact after removing its incomplete files" do
    build = completed_build
    build.update!(github_artifact_id: 8001)
    configuration = installed_configuration
    client = fake_client
    downloads = 0
    package = replica_package
    client.actions.define_singleton_method(:artifacts) { |*_args, **_options| raise "listed artifacts" }
    client.actions.define_singleton_method(:download_artifact) do |_repository, _artifact_id, token:, destination:, maximum_bytes:|
      downloads += 1
      destination.write(package)
    end
    artifact_store = @artifact_store
    writes = 0
    store = Object.new
    store.define_singleton_method(:delete_prefix) { |prefix| artifact_store.delete_prefix(prefix) }
    store.define_singleton_method(:write) do |name, source:|
      writes += 1
      bytes = artifact_store.write(name, source:)
      raise IOError, "storage interrupted" if downloads == 1 && writes == 1

      bytes
    end
    stub_github_client(configuration, client)

    assert_raises(IOError) do
      build.package_import.download!(configuration:, artifact_store: store)
    end
    assert_equal "running", build.reload.state
    assert_empty @artifact_store.list("builds/#{build.id}")

    import_package(build, configuration)

    assert_equal "successful", build.reload.state
    assert_equal 2, downloads
  end

  test "fails when the fixed artifact is missing" do
    build = completed_build
    configuration = installed_configuration
    stub_github_client(configuration, fake_client([]))

    import_package(build, configuration)

    assert_equal "failed", build.reload.state
    assert_equal "GitHub Actions did not provide the replica-build-v1 artifact.", build.failure_summary
  end

  test "fails when the fixed artifact expired" do
    build = completed_build
    configuration = installed_configuration
    client = fake_client([ { "id" => 8001, "name" => "replica-build-v1", "expired" => true } ])
    stub_github_client(configuration, client)

    import_package(build, configuration)

    assert_equal "failed", build.reload.state
    assert_includes build.failure_summary, "expired"
  end

  test "fails when GitHub returns duplicate fixed artifacts" do
    build = completed_build
    configuration = installed_configuration
    client = fake_client([
      { "id" => 8001, "name" => "replica-build-v1", "expired" => false },
      { "id" => 8002, "name" => "replica-build-v1", "expired" => false }
    ])
    stub_github_client(configuration, client)

    import_package(build, configuration)

    assert_equal "failed", build.reload.state
    assert_includes build.failure_summary, "more than one"
  end

  test "fails when GitHub no longer permits the artifact download" do
    build = completed_build
    configuration = installed_configuration
    client = fake_client
    client.actions.define_singleton_method(:download_artifact) do |*_args, **_options|
      raise GithubClient::Forbidden, "forbidden"
    end
    stub_github_client(configuration, client)

    import_package(build, configuration)

    assert_equal "failed", build.reload.state
    assert_equal "The GitHub App can no longer download this build.", build.failure_summary
  end

  test "fails when the package exceeds its download limit" do
    BuildSetting.create!(id: 1, maximum_package_mib: 7)
    build = completed_build
    configuration = installed_configuration
    client = fake_client
    client.actions.define_singleton_method(:download_artifact) do |*_args, **_options|
      raise GithubClient::DownloadTooLarge, "too large"
    end
    stub_github_client(configuration, client)

    import_package(build, configuration)

    assert_equal "failed", build.reload.state
    assert_includes build.failure_summary, "7 MiB"
    assert_includes build.failure_summary, "Hub settings > Build packages"
    assert_empty @artifact_store.list("builds/#{build.id}")
  end

  test "snapshots one setting for both download and extraction during an import" do
    setting = BuildSetting.create!(id: 1, maximum_package_mib: 2)
    download_limit = setting.maximum_download_bytes
    build = completed_build
    configuration = installed_configuration
    package = replica_package(desktop_screenshot: "x" * (1.megabyte + 1))
    client = fake_client
    client.actions.define_singleton_method(:download_artifact) do |_repository, _artifact_id, token:, destination:, maximum_bytes:|
      raise "download ignored setting" if maximum_bytes != download_limit

      BuildSetting.find(1).update!(maximum_package_mib: 1)
      destination.write(package)
    end
    stub_github_client(configuration, client)

    import_package(build, configuration)

    assert_equal 1, BuildSetting.current.maximum_package_mib
    assert_equal "successful", build.reload.state
    assert_operator build.artifact_bytes, :>, 1.megabyte
  end

  test "an oversized unpacked package fails with the saved limit and removes partial storage" do
    BuildSetting.create!(id: 1, maximum_package_mib: 1)
    build = completed_build
    configuration = installed_configuration
    client = fake_client(package: replica_package(desktop_screenshot: "x" * 1.megabyte))
    stub_github_client(configuration, client)

    import_package(build, configuration)

    assert_equal "failed", build.reload.state
    assert_includes build.failure_summary, "1 MiB"
    assert_includes build.failure_summary, "Hub settings > Build packages"
    assert_empty @artifact_store.list("builds/#{build.id}")
  end

  test "changing the limit leaves an already successful Build and its retained files untouched" do
    build = completed_build
    configuration = installed_configuration
    stub_github_client(configuration, fake_client)
    import_package(build, configuration)
    original = build.reload.attributes
    files = @artifact_store.list(build.artifact_prefix)
    BuildSetting.create!(id: 1, maximum_package_mib: 1)

    import_package(build, configuration)

    assert_equal original, build.reload.attributes
    assert_equal files, @artifact_store.list(build.artifact_prefix)
  end

  test "fails when the package is not a readable ZIP" do
    build = completed_build
    configuration = installed_configuration
    client = fake_client(package: "not a zip")
    stub_github_client(configuration, client)

    import_package(build, configuration)

    assert_equal "failed", build.reload.state
    assert_includes build.failure_summary, "ZIP could not be read"
    assert_empty @artifact_store.list("builds/#{build.id}")
  end

  test "leaves the Build pending when GitHub has a temporary failure" do
    build = completed_build
    configuration = installed_configuration
    client = fake_client
    client.actions.define_singleton_method(:artifacts) do |*_args, **_options|
      raise GithubClient::Error, "timeout"
    end
    stub_github_client(configuration, client)

    assert_raises(GithubClient::Error) do
      import_package(build, configuration)
    end

    assert_equal "running", build.reload.state
    assert_predicate build.package_import, :pending?
    assert_includes Build.awaiting_import, build
  end

  test "leaves the Build pending when storage has a temporary failure" do
    build = completed_build
    configuration = installed_configuration
    stub_github_client(configuration, fake_client)
    store = Object.new
    store.define_singleton_method(:delete_prefix) { |_prefix| raise ArtifactStore::TemporaryError, "busy" }

    assert_raises(ArtifactStore::TemporaryError) do
      build.package_import.download!(configuration:, artifact_store: store)
    end

    assert_equal "running", build.reload.state
  end

  test "fails when storage rejects the package" do
    build = completed_build
    configuration = installed_configuration
    stub_github_client(configuration, fake_client)
    store = Object.new
    store.define_singleton_method(:delete_prefix) { |_prefix| raise ArtifactStore::InvalidObject, "container missing" }

    build.package_import.download!(configuration:, artifact_store: store)

    assert_equal "failed", build.reload.state
    assert_includes build.failure_summary, "container missing"
  end

  test "scheduled recovery includes an incomplete selected artifact" do
    build = completed_build
    build.update!(github_artifact_id: 8001)

    assert_predicate build.package_import, :pending?
    assert_includes Build.awaiting_import, build
  end

  test "fails and removes retained files when the package lacks dist index" do
    build = completed_build
    configuration = installed_configuration
    client = fake_client(package: replica_package(files: { "dist/app.js" => "javascript" }))
    stub_github_client(configuration, client)

    import_package(build, configuration)

    assert_equal "failed", build.reload.state
    assert_includes build.failure_summary, "missing dist/index.html"
    assert_empty @artifact_store.list("builds/#{build.id}")
  end

  test "fails and removes retained files when the package contains an unsafe path" do
    build = completed_build
    configuration = installed_configuration
    client = fake_client(package: replica_package(files: { "dist/../outside" => "outside" }))
    stub_github_client(configuration, client)

    import_package(build, configuration)

    assert_equal "failed", build.reload.state
    assert_includes build.failure_summary, "unsupported path"
    assert_empty @artifact_store.list("builds/#{build.id}")
  end

  test "does not import a Build after another job publishes it" do
    build = completed_build
    configuration = installed_configuration
    client = fake_client
    package = replica_package
    client.actions.define_singleton_method(:download_artifact) do |_repository, _artifact_id, token:, destination:, maximum_bytes:|
      destination.write(package)
      build.update! \
        github_artifact_id: 8001,
        state: "successful",
        finished_at: Time.current,
        artifact_prefix: "builds/#{build.id}",
        artifact_bytes: 1
    end
    stub_github_client(configuration, client)

    import_package(build, configuration)

    assert_equal "successful", build.reload.state
    assert_empty @artifact_store.list("builds/#{build.id}")
  end

  private

  def stub_github_client(configuration, client)
    configuration.define_singleton_method(:github_client) { client }
    configuration.tokens.define_singleton_method(:installation) { "installation-token" }
  end

  def import_package(build, configuration)
    build.package_import.download!(configuration:, artifact_store: @artifact_store)
  end

  def installed_configuration
    configuration = github_app_configurations.create_installed
    configuration.tokens.define_singleton_method(:installation) { "installation-token" }
    configuration
  end

  def completed_build
    build = builds.create
    build.workflow_run.record! \
      run_id: 9001,
      run_attempt: 1,
      workflow_url: "https://github.com/github/prototype/actions/runs/9001",
      workflow_created_at: Time.iso8601("2026-09-17T18:00:00Z"),
      stage: "completed",
      conclusion: "success"
    build
  end

  def fake_client(artifacts = [ { "id" => 8001, "name" => "replica-build-v1", "expired" => false } ], package: replica_package)
    Object.new.tap do |client|
      actions = Object.new
      actions.define_singleton_method(:artifacts) do |*_args, **_options|
        artifacts
      end
      actions.define_singleton_method(:download_artifact) do |_repository, _artifact_id, token:, destination:, maximum_bytes:|
        destination.write(package)
      end
      client.define_singleton_method(:actions) { actions }
    end
  end

  def replica_package(files: { "dist/index.html" => "<!doctype html><title>Replica</title>" },
    directories: [], desktop_screenshot: "desktop screenshot")
    entries = files.merge \
      "screenshots/desktop.png" => desktop_screenshot,
      "screenshots/narrow.png" => "narrow screenshot"
    Zip::OutputStream.write_buffer do |archive|
      directories.each { archive.put_next_entry("#{_1}/") }
      entries.each do |name, bytes|
        archive.put_next_entry(name)
        archive.write(bytes)
      end
    end.string
  end
end
