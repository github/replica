require "concurrent"

# Bounds independent GitHub calls without moving database work into worker threads.
class GithubClient::Batch
  MAX_CONCURRENCY = 4

  # Returns results in input order and raises failures after draining the workers.
  def self.map(items, &operation)
    return [] if items.empty?

    tracing_context = OpenTelemetry::Context.current if defined?(OpenTelemetry::Context)
    executor = Concurrent::FixedThreadPool.new([ items.size, MAX_CONCURRENCY ].min)
    futures = items.map do |item|
      Concurrent::Promises.future_on(executor) do
        if tracing_context
          OpenTelemetry::Context.with_current(tracing_context) { operation.call(item) }
        else
          operation.call(item)
        end
      end
    end
    futures.map(&:value!)
  ensure
    executor&.shutdown
    executor&.wait_for_termination
  end
end
