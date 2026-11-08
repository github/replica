# Copies what `replica-learning decision taskset` needs from Hub to turn a training export into
# decision model tasks: each published Build of a repository's reviewed prototypes, and its
# screenshots of each page the build action captured, at each width and theme. Each screenshot
# is named by the path a browser reports for the address the build action was asked to capture.
# The build action does not record where a redirect took the page, so Hub cannot name that.
#
# Only Builds of prototypes with review comments can carry a label, so Hub copies no others. The
# screenshots show prototypes people reviewed, so the directory must be new, only its owner can
# read it, and it must stay out of every directory Hub serves or keeps its own data in.
class Learning::DecisionBuilds
  SCHEMA_VERSION = "replica.decision-builds/v1".freeze
  # The page the default screenshots show, the build action's start route.
  START_ROUTE = "/".freeze
  # The widths and themes the build action captures, in its order.
  SIZES = %w[desktop narrow].freeze
  THEMES = %w[light dark].freeze

  def initialize(repository, artifact_store: ArtifactStore.current)
    @repository = repository
    @artifact_store = artifact_store
  end

  # Writes builds.json and the screenshots it names into a new directory, and returns how many
  # Builds and screenshots it wrote. A failure leaves no directory behind.
  def write(directory)
    directory = Pathname(directory).expand_path
    check_placement!(directory)
    FileUtils.mkdir_p(directory.dirname, mode: 0o700)
    Dir.mkdir(directory, 0o700)
    created = true
    builds = published_builds.map { entry(_1, directory) }
    File.write directory.join("builds.json"), JSON.generate(schemaVersion: SCHEMA_VERSION, builds:), perm: 0o600
    { builds: builds.size, screenshots: builds.sum { _1[:screenshots].size } }
  rescue StandardError
    FileUtils.rm_rf(directory) if created
    raise
  end

  private

  # Refuses a path through a symbolic link, the public web root, and Hub's own storage, where a
  # copy could be served or mistaken for Hub's data.
  def check_placement!(directory)
    PrivateStorageRoot.validate! \
      directory,
      name: "The Builds directory",
      application_root: Rails.root,
      public_root: Rails.public_path
    roots = [ Rails.configuration.x.learning_root ]
    roots << Rails.configuration.x.artifact_root if Rails.configuration.x.artifact_store == "local"
    roots.compact.map { Pathname(_1).expand_path }.each do |root|
      next if directory != root && !directory.to_s.start_with?("#{root}#{File::SEPARATOR}")

      raise PrivateStorageRoot::Invalid, "The Builds directory must be outside Hub's learning and artifact storage: #{directory}"
    end
  end

  def published_builds
    reviewed = ReviewComment.where(prototype: @repository.reviewable_prototypes, root_id: nil).select(:prototype_id)
    Build.where(prototype_id: reviewed, state: "successful").order(:prototype_id, :number)
  end

  # Hub orders a prototype's Builds by createdAt, then number, because it numbers Builds as it
  # finds them, which is not always the order GitHub made them in.
  def entry(build, directory)
    {
      prototypeId: build.prototype_id,
      number: build.number,
      createdAt: build.chronological_at.utc.iso8601(6),
      publishedAt: build.finished_at.utc.iso8601(6),
      screenshots: pages(build).flat_map { |route, template_id| screenshots(build, route, template_id, directory) }
    }
  end

  # The start route and each declared template's path, once each, with the screenshot directory
  # the build action used. A Build whose template list Hub cannot read keeps its start route.
  def pages(build)
    templates = build.templates.entries(artifact_store: @artifact_store)
    [
      [ START_ROUTE, "default" ],
      *templates.map { [ Build::Templates.browser_path(_1.fetch("path")), _1.fetch("id") ] }
    ].uniq(&:first)
  rescue Build::Templates::InvalidManifest
    [ [ START_ROUTE, "default" ] ]
  end

  # Copies each width and theme of one page that the Build kept. Older Builds kept light only.
  def screenshots(build, route, template_id, directory)
    SIZES.product(THEMES).filter_map do |size, theme|
      name = build.screenshot_path(size, template_id:, theme:)
      next if !@artifact_store.exist?(name)

      file = "#{build.prototype_id}-#{build.number}-#{template_id}-#{size}-#{theme}.png"
      File.open(directory.join(file), File::WRONLY | File::CREAT | File::EXCL, 0o600) do |destination|
        @artifact_store.read(name, destination:)
      end
      { route:, size:, theme:, path: file }
    end
  end
end
