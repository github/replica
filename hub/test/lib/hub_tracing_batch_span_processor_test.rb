require "test_helper"
require "opentelemetry/sdk"
require_relative "../../lib/hub_tracing/exporter"
require_relative "../../lib/hub_tracing/batch_span_processor"

class HubTracingBatchSpanProcessorTest < ActiveSupport::TestCase
  self.use_transactional_tests = false

  test "force flush times out while a background batch holds the export lock" do
    entered = Queue.new
    release = Queue.new
    exports = 0
    exporter = Object.new
    exporter.define_singleton_method(:export) do |_, timeout:|
      exports += 1
      if exports == 1
        entered << true
        release.pop
      end
      OpenTelemetry::SDK::Trace::Export::SUCCESS
    end
    exporter.define_singleton_method(:force_flush) do |timeout:|
      OpenTelemetry::SDK::Trace::Export::SUCCESS
    end
    exporter.define_singleton_method(:shutdown) do |timeout:|
      OpenTelemetry::SDK::Trace::Export::SUCCESS
    end
    processor = HubTracing::BatchSpanProcessor.new \
      exporter,
      exporter_timeout: 1_000,
      schedule_delay: 1,
      max_queue_size: 10,
      max_export_batch_size: 1
    provider = OpenTelemetry::SDK::Trace::TracerProvider.new
    provider.add_span_processor(processor)
    tracer = provider.tracer("hub-tracing-batch-processor-test")
    tracer.start_span("in flight").finish
    Timeout.timeout(1) { entered.pop }
    tracer.start_span("queued").finish

    flush = Thread.new { provider.force_flush(timeout: 0.01) }

    assert flush.join(0.2), "force flush waited for the background export"
    assert_equal OpenTelemetry::SDK::Trace::Export::TIMEOUT, flush.value
    assert_equal 1, exports
  ensure
    release&.push(true)
    flush&.join(1)
    provider&.shutdown(timeout: 1)
  end

  test "fork reset runs once before concurrent child export flush and shutdown" do
    entered = Queue.new
    release = Queue.new
    factory_entered = Queue.new
    release_factory = Queue.new
    calls = []
    factories = 0
    blocked = false
    processor_errors = []
    metrics = Object.new
    metrics.define_singleton_method(:add_to_counter) do |name, increment: nil, labels: {}|
      processor_errors << labels["reason"] if name == "otel.bsp.error"
    end
    metrics.define_singleton_method(:observe_value) do |name, value:|
    end
    exporter = HubTracing::Exporter.new do
      identifier = factories += 1
      if identifier > 1
        factory_entered << identifier
        release_factory.pop
      end
      Object.new.tap do |delegate|
        delegate.define_singleton_method(:export) do |_, timeout:|
          calls << [ identifier, :export ]
          unless blocked
            blocked = true
            entered << true
            release.pop
          end
          OpenTelemetry::SDK::Trace::Export::SUCCESS
        end
        delegate.define_singleton_method(:force_flush) do |timeout:|
          calls << [ identifier, :force_flush ]
          OpenTelemetry::SDK::Trace::Export::SUCCESS
        end
        delegate.define_singleton_method(:shutdown) do |timeout:|
          calls << [ identifier, :shutdown ]
          OpenTelemetry::SDK::Trace::Export::SUCCESS
        end
      end
    end
    processor = HubTracing::BatchSpanProcessor.new \
      exporter,
      exporter_timeout: 1_000,
      schedule_delay: 1,
      max_queue_size: 10,
      max_export_batch_size: 1,
      start_thread_on_boot: false,
      metrics_reporter: metrics
    provider = OpenTelemetry::SDK::Trace::TracerProvider.new
    provider.add_span_processor(processor)
    reader, writer = IO.pipe
    pid = fork do
      reader.close
      result = begin
        tracer = provider.tracer("hub-tracing-batch-processor-fork-test")
        span = tracer.start_span("child")
        finish = Thread.new { span.finish }
        first_flush = Thread.new { provider.force_flush(timeout: 1) }
        Timeout.timeout(1) { factory_entered.pop }
        sleep 0.05
        2.times { release_factory << true }
        Timeout.timeout(1) { entered.pop }
        concurrent_flush = Thread.new { provider.force_flush(timeout: 1) }
        Timeout.timeout(1) { Thread.pass until concurrent_flush.status == "sleep" }
        release << true
        Timeout.timeout(1) { finish.value }
        first_flush_result = Timeout.timeout(1) { first_flush.value }
        concurrent_flush_result = Timeout.timeout(1) { concurrent_flush.value }
        shutdown_result = provider.shutdown(timeout: 1)
        {
          factories:,
          calls:,
          processor_errors:,
          first_flush_result:,
          concurrent_flush_result:,
          shutdown_result:
        }
      rescue StandardError => error
        { error: [ error.class.name, error.message ] }
      ensure
        2.times { release_factory << true }
        release << true
      end
      writer.write(Marshal.dump(result))
      writer.close
      exit! 0
    end
    writer.close
    child = Marshal.load(reader.read)
    reader.close
    _, status = Process.wait2(pid)

    assert status.success?
    refute child.key?(:error), child[:error]&.join(": ")
    assert_equal 2, child.fetch(:factories)
    assert_empty child.fetch(:processor_errors)
    assert child.fetch(:calls).all? { |identifier, _| identifier == 2 }
    assert_includes child.fetch(:calls), [ 2, :export ]
    assert_includes child.fetch(:calls), [ 2, :force_flush ]
    assert_includes child.fetch(:calls), [ 2, :shutdown ]
    assert_equal OpenTelemetry::SDK::Trace::Export::SUCCESS, child.fetch(:first_flush_result)
    assert_equal OpenTelemetry::SDK::Trace::Export::SUCCESS, child.fetch(:concurrent_flush_result)
    assert_equal OpenTelemetry::SDK::Trace::Export::SUCCESS, child.fetch(:shutdown_result)
  ensure
    release_factory&.push(true)
    release&.push(true)
    provider&.shutdown(timeout: 1)
  end
end
