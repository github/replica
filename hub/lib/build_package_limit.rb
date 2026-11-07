# Parses and explains the deployment's complete unpacked Build package limit.
module BuildPackageLimit
  # Invalid explicit configuration prevents startup instead of falling back.
  def self.parse(value)
    return 150.megabytes if value.nil?

    unless value.match?(/\A[1-9][0-9]*\z/)
      raise ArgumentError, "REPLICA_MAXIMUM_PACKAGE_MIB must be a positive whole number of MiB"
    end

    value.to_i.megabytes
  end

  # Allows bounded ZIP headers, filenames and deflate overhead, not another editable limit.
  def self.maximum_download_bytes(maximum_bytes)
    maximum_bytes + (maximum_bytes + 999) / 1_000 +
      Build::PackageExtraction::MAXIMUM_ENTRIES * (2 * ArtifactStore::MAXIMUM_NAME_BYTES + 128) + 64.kilobytes
  end

  # Explains recovery without changing or deleting successful Builds.
  def self.limit_message(maximum_bytes)
    whole, remainder = maximum_bytes.divmod(1.megabyte)
    label = remainder.zero? ? whole : maximum_bytes.fdiv(1.megabyte)
    "Build package exceeds Hub's configured #{label} MiB unpacked limit. " \
      "Reduce the build output or ask the Hub operator to raise REPLICA_MAXIMUM_PACKAGE_MIB " \
      "and restart all Hub processes."
  end
end
