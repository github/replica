require "json"
require "stringio"
require "uri"

# Reads template metadata from the same immutable artifact as the preview.
class Build::Templates < ActiveRecord::AssociatedObject
  MAXIMUM_BYTES = 16.kilobytes
  MAXIMUM_ENTRIES = 12
  ID_FORMAT = /\A[a-z0-9]+(?:-[a-z0-9]+)*\z/
  FIELDS = %w[id name category description path].freeze

  class InvalidManifest < StandardError; end

  # Returns declared templates; a legacy Build has no manifest.
  def entries(artifact_store: ArtifactStore.current)
    name = "#{build.artifact_prefix}/templates.json"
    return [] if !artifact_store.exist?(name)

    destination = BoundedDestination.new
    artifact_store.read(name, destination:)
    self.class.parse(destination.string)
  end

  # Checks the complete versioned manifest before retaining or displaying it.
  def self.parse(source)
    raise InvalidManifest, "templates.json exceeds 16 KiB" if source.bytesize > MAXIMUM_BYTES

    manifest = JSON.parse(source)
    valid = manifest.is_a?(Hash) && manifest.keys.sort == %w[templates version] &&
      manifest["version"] == 1 && manifest["templates"].is_a?(Array) &&
      manifest["templates"].length <= MAXIMUM_ENTRIES
    raise InvalidManifest, "templates.json must contain version 1 and at most 12 templates" if !valid

    ids = []
    manifest.fetch("templates").each do |entry|
      valid = entry.is_a?(Hash) && entry.keys.sort == FIELDS.sort &&
        entry.values.all? { _1.is_a?(String) && _1.valid_encoding? }
      valid &&= entry["id"].length <= 64 && entry["id"].match?(ID_FORMAT) &&
        entry["id"] != "default" && !ids.include?(entry["id"])
      valid &&= entry["name"].length <= 120 && entry["name"].strip.present? &&
        entry["category"].length <= 80 && entry["category"].strip.present? &&
        entry["description"].length <= 500 && entry["description"].strip.present? &&
        %w[name category description].none? { entry[_1].match?(/[\x00-\x1f\x7f]/) } &&
        valid_path?(entry["path"])
      raise InvalidManifest, "templates.json contains an invalid or duplicate template" if !valid

      ids << entry.fetch("id")
    end
    manifest.fetch("templates")
  rescue JSON::ParserError, EncodingError
    raise InvalidManifest, "templates.json is not valid JSON"
  end

  # Applies the preview return-path guard and rejects encoded traversal or Hub endpoints.
  def self.valid_path?(value)
    PreviewGrant.validate_return_path(value)
    serialized = browser_path(value)
    PreviewGrant.validate_return_path(serialized)
    URI.parse(serialized)
    pathname = value.split(/[?#]/, 2).first
    return false if pathname.match?(/%(?![0-9a-f]{2})/i)

    path = URI::DEFAULT_PARSER.unescape(pathname)
    path.valid_encoding? && !path.match?(/[[:cntrl:][:space:]\\%]/) &&
      !path.start_with?("//") && !path.split("/").intersect?([ ".", "..", ArtifactStore::INTERNAL_SEGMENT ]) &&
      !path.match?(%r{\A/__replica(?:/|\z)})
  rescue ArgumentError, URI::InvalidURIError
    false
  end

  # Mirrors HTTP browser serialization without changing the declared destination, so a path
  # matches the location a browser reports for it.
  def self.browser_path(value)
    before_fragment, fragment = value.split("#", 2)
    pathname, query = before_fragment.split("?", 2)
    serialized = URI::DEFAULT_PARSER.escape(pathname, /[^\x21-\x7e]|["<>`{}^]/)
    serialized += "?#{URI::DEFAULT_PARSER.escape(query, /[^\x21-\x7e]|["<>'#]/)}" if query.present?
    serialized += "##{URI::DEFAULT_PARSER.escape(fragment, /[^\x21-\x7e]|["<>`]/)}" if fragment.present?
    serialized
  end

  # Stops a corrupt storage object before it can allocate an unbounded string.
  class BoundedDestination < StringIO
    # Rejects writes beyond the metadata byte limit.
    def write(chunk)
      raise InvalidManifest, "templates.json exceeds 16 KiB" if size + chunk.bytesize > MAXIMUM_BYTES

      super
    end
  end
end
