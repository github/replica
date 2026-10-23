require "time"

# Verifies that locked third-party dependencies have aged before the repository uses them.
module DependencyAgePolicy
  MINIMUM_AGE_DAYS = 7
  WORKER_COUNT = 16

  Dependency = Data.define(:ecosystem, :name, :version, :platform, :source)
  Violation = Data.define(:dependency, :published_at)
  Failure = Data.define(:dependency, :message)

  # Represents a dependency that could not be verified through its authoritative source.
  class VerificationError < StandardError
  end
end

require_relative "dependency_age_policy/dependency_loader"
require_relative "dependency_age_policy/registry_client"
require_relative "dependency_age_policy/result"
require_relative "dependency_age_policy/audit"
