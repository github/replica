require "test_helper"
require "timeout"

class GithubClientBatchTest < ActiveSupport::TestCase
  test "bounds concurrent calls and preserves input order" do
    started = Queue.new
    release = Queue.new
    count = GithubClient::Batch::MAX_CONCURRENCY + 2
    worker = Thread.new do
      GithubClient::Batch.map((1..count).to_a) do |item|
        started << item
        release.pop
        item * 2
      end
    end

    Timeout.timeout(5) do
      GithubClient::Batch::MAX_CONCURRENCY.times { started.pop }
      assert started.empty?
      GithubClient::Batch::MAX_CONCURRENCY.times { release << true }
      2.times { started.pop }
      2.times { release << true }
      assert_equal (1..count).map { _1 * 2 }, worker.value
    end
  ensure
    count.times { release << true }
    worker&.join
  end

  test "surfaces a GitHub failure and drains all worker calls" do
    completed = Queue.new
    assert_raises(GithubClient::Error) do
      GithubClient::Batch.map([ 1, 2, 3 ]) do |item|
        raise GithubClient::Error, "Unavailable" if item == 2

        item
      ensure
        completed << item
      end
    end
    assert_equal 3, completed.size
  end

  test "restores the submitting tracing context in every worker" do
    require "opentelemetry/sdk"

    provider = OpenTelemetry::SDK::Trace::TracerProvider.new
    span = provider.tracer("github-client-batch-test").start_span("request")

    results = OpenTelemetry::Trace.with_span(span) do
      GithubClient::Batch.map([ 3, 1, 2 ]) do |item|
        [ item, OpenTelemetry::Trace.current_span.context.span_id ]
      end
    end

    assert_equal [ 3, 1, 2 ], results.map(&:first)
    assert_equal [ span.context.span_id ] * 3, results.map(&:last)
  ensure
    span&.finish
    provider&.shutdown
  end
end
