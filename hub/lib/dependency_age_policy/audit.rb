module DependencyAgePolicy
  # Finds locked dependencies and checks their ages in parallel.
  class Audit
    def initialize(
      root:,
      client: RegistryClient.new,
      now: Time.now.utc,
      minimum_age_days: MINIMUM_AGE_DAYS,
      excluded_paths: []
    )
      @loader = DependencyLoader.new(root:, excluded_paths:)
      @client = client
      @cutoff = now.utc - (minimum_age_days * 24 * 60 * 60)
    end

    # Reports dependencies that are too new and checks that could not be completed.
    def call
      dependencies, parsing_failures = @loader.call
      queue = Queue.new
      dependencies.each { |dependency| queue << dependency }
      violations = []
      failures = parsing_failures.dup
      mutex = Mutex.new

      [ dependencies.length, WORKER_COUNT ].min.times.map do
        Thread.new do
          loop do
            dependency = queue.pop(true)
            published_at = @client.published_at(dependency)

            if published_at > @cutoff
              mutex.synchronize { violations << Violation.new(dependency:, published_at:) }
            end
          rescue ThreadError
            break
          rescue VerificationError => error
            mutex.synchronize { failures << Failure.new(dependency:, message: error.message) }
          end
        end
      end.each(&:value)

      Result.new \
        checked_count: dependencies.length,
        cutoff: @cutoff,
        failures: failures.sort_by { |failure| identity(failure.dependency) },
        violations: violations.sort_by { |violation| violation.published_at }.reverse
    end

    private

    def identity(dependency)
      "#{dependency.ecosystem}:#{dependency.name}@#{dependency.version}"
    end
  end
end
