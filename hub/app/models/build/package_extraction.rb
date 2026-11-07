require "zip"
require "open3"

# Extracts one Actions package into a Build's retained storage prefix.
class Build::PackageExtraction
  MAXIMUM_ENTRIES = 2_090
  MAXIMUM_DIST_FILES = 2_000
  MAXIMUM_FILE_BYTES = 25.megabytes
  MAXIMUM_SCREENSHOT_BYTES = 25.megabytes
  REQUIRED_FILES = %w[dist/index.html screenshots/desktop.png screenshots/narrow.png].freeze

  class InvalidPackage < StandardError; end

  # Uses provider-neutral storage for one package extraction.
  def initialize(artifact_store:, maximum_bytes: Rails.configuration.x.maximum_package_bytes)
    @artifact_store = artifact_store
    @maximum_bytes = maximum_bytes
  end

  # Streams safe dist and screenshot files into the Build's storage prefix.
  def extract!(package, prefix:)
    Zip::File.open(package.path) do |archive|
      files = package_files(archive, prefix:)
      missing = REQUIRED_FILES - files.map(&:name)
      raise InvalidPackage, "package is missing #{missing.join(", ")}" if missing.any?

      validate_templates!(archive, files)
      validate_controls!(files)
      total = 0
      files.each do |entry|
        total += write(entry, prefix:, remaining_bytes: maximum_bytes - total)
      end
      total
    end
  rescue Zip::Error, Zlib::Error, EOFError
    raise InvalidPackage, "package ZIP could not be read"
  rescue ArtifactStore::InvalidName
    raise InvalidPackage, "package contains an unsupported storage path"
  rescue ArtifactStore::AlreadyExists
    raise InvalidPackage, "package contains duplicate storage paths"
  rescue Build::Templates::InvalidManifest => error
    raise InvalidPackage, error.message
  end

  private

  attr_reader :artifact_store, :maximum_bytes

  # Checks the retained definitions rather than trusting the prototype's build scripts.
  def validate_controls!(files)
    entry = files.find { _1.name == "dist/controls.replica.json" }
    return if !entry

    source = entry.get_input_stream { _1.read(256_001) }
    if source.bytesize > 256_000 || source.bytesize != entry.size
      raise InvalidPackage, "controls.replica.json exceeds its limit or ended early"
    end

    output, error, status = Open3.capture3 \
      "node",
      Rails.root.join("app/javascript/utils/prototype-controls/validate-document.mjs").to_s,
      stdin_data: source
    raise InvalidPackage, (error.presence || output).first(900) if !status.success?
  end

  # Returns regular files from the expected package directories within limits.
  def package_files(archive, prefix:)
    if archive.entries.length > MAXIMUM_ENTRIES
      raise InvalidPackage, "package contains more than 2,090 files and directories"
    end

    files = archive.filter_map do |entry|
      validate_entry(entry, prefix:)
      entry unless entry.directory?
    end
    paths = archive.map { _1.name.delete_suffix("/") }
    raise InvalidPackage, "package contains duplicate storage paths" if paths.uniq.length != paths.length
    if files.count { _1.name.start_with?("dist/") } > MAXIMUM_DIST_FILES
      raise InvalidPackage, "package contains more than 2,000 dist files"
    end

    total = files.sum(&:size)
    if total > maximum_bytes
      raise InvalidPackage, BuildPackageLimit.limit_message(maximum_bytes)
    end

    files
  end

  # Requires one file or directory beneath dist or screenshots.
  def validate_entry(entry, prefix:)
    name = entry.directory? ? entry.name.delete_suffix("/") : entry.name
    valid = (entry.directory? || entry.file?) && !entry.symlink?
    valid &&= (entry.directory? && %w[dist screenshots].include?(name)) || name.start_with?("dist/", "screenshots/") ||
      (!entry.directory? && name == "templates.json")
    valid &&= safe_path?(name, prefix:)
    raise InvalidPackage, "package contains an unsupported path or entry type" if !valid

    return if entry.directory?

    maximum = file_limit(name)
    raise InvalidPackage, "package contains a file larger than its limit" if entry.size > maximum
  end

  # Accepts legacy light captures or complete light and dark sets, with no undeclared files.
  def validate_templates!(archive, files)
    manifest = files.find { _1.name == "templates.json" }
    templates = if manifest
      source = manifest.get_input_stream { _1.read(Build::Templates::MAXIMUM_BYTES + 1) }
      raise InvalidPackage, "templates.json ended before its declared size" if source.bytesize != manifest.size

      Build::Templates.parse(source)
    else
      []
    end
    expected = %w[screenshots/desktop.png screenshots/narrow.png] + templates.flat_map do |template|
      %w[desktop narrow].map { "screenshots/templates/#{template.fetch('id')}/#{_1}.png" }
    end
    actual = files.filter_map { _1.name if _1.name.start_with?("screenshots/") }
    dark = expected.map { _1.delete_suffix(".png") + "-dark.png" }
    expected += dark if (actual & dark).any?
    missing = expected - actual
    raise InvalidPackage, "package is missing #{missing.join(', ')}" if missing.any?
    raise InvalidPackage, "package contains undeclared screenshot files" if (actual - expected).any?

    directories = [ "screenshots" ]
    if templates.any?
      directories << "screenshots/templates"
      directories.concat(templates.map { "screenshots/templates/#{_1.fetch('id')}" })
    end
    if archive.any? { _1.directory? && _1.name.start_with?("screenshots/") && !directories.include?(_1.name.delete_suffix("/")) }
      raise InvalidPackage, "package contains undeclared screenshot directories"
    end
  end

  # Bounds metadata separately from dist files and screenshots.
  def file_limit(name)
    return Build::Templates::MAXIMUM_BYTES if name == "templates.json"

    name.start_with?("screenshots/") ? MAXIMUM_SCREENSHOT_BYTES : MAXIMUM_FILE_BYTES
  end

  # Reports whether one package path is safe for every ArtifactStore adapter.
  def safe_path?(name, prefix:)
    valid = name.match?(/\A[\x20-\x7e]+\z/) && !name.start_with?("/") && !name.include?("\\")
    valid &&= "#{prefix}/#{name}".bytesize <= ArtifactStore::MAXIMUM_NAME_BYTES
    segments = valid ? "#{prefix}/#{name}".split("/", -1) : []
    valid &&= segments.length <= ArtifactStore::MAXIMUM_SEGMENTS
    valid &&= segments.none? do |segment|
      segment.empty? || %w[. ..].include?(segment) || segment == ArtifactStore::INTERNAL_SEGMENT ||
        segment.bytesize > ArtifactStore::MAXIMUM_SEGMENT_BYTES
    end
    valid
  end

  # Streams one package file into retained storage and returns its byte count.
  def write(entry, prefix:, remaining_bytes:)
    entry.get_input_stream do |source|
      maximum = file_limit(entry.name)
      bounded_source = BoundedSource.new \
        source,
        maximum_bytes: maximum,
        remaining_bytes: remaining_bytes,
        total_limit: maximum_bytes
      bytes = artifact_store.write("#{prefix}/#{entry.name}", source: bounded_source)
      raise InvalidPackage, "package file ended before its declared size" if bytes != entry.size

      bytes
    end
  end

  # Stops decompression when one file exceeds its storage limit.
  class BoundedSource
    # Wraps one ZIP entry stream with a decompressed-byte limit.
    def initialize(source, maximum_bytes:, remaining_bytes:, total_limit:)
      @source = source
      @maximum_bytes = maximum_bytes
      @remaining_bytes = remaining_bytes
      @total_limit = total_limit
      @bytes = 0
    end

    # Returns one chunk while enforcing the decompressed-byte limit.
    def read(length)
      chunk = @source.read(length)
      return chunk if chunk.nil? || chunk.empty?

      @bytes += chunk.bytesize
      raise InvalidPackage, "package contains a file larger than its limit" if @bytes > @maximum_bytes
      raise InvalidPackage, BuildPackageLimit.limit_message(@total_limit) if @bytes > @remaining_bytes

      chunk
    end
  end
end
