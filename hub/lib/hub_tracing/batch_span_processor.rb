module HubTracing
  class BatchSpanProcessor < OpenTelemetry::SDK::Trace::Export::BatchSpanProcessor
    SUCCESS = OpenTelemetry::SDK::Trace::Export::SUCCESS
    FAILURE = OpenTelemetry::SDK::Trace::Export::FAILURE
    TIMEOUT = OpenTelemetry::SDK::Trace::Export::TIMEOUT

    def shutdown(timeout: nil)
      lock { reset_on_fork(restart_thread: false) }
      super
    end

    private

    # The pinned SDK does not include its export mutex wait in force-flush deadlines.
    def export_batch(span_array, timeout: @exporter_timeout_seconds)
      deadline = monotonic_time + timeout if timeout
      unless lock_export_before(deadline)
        report_result(TIMEOUT, span_array)
        return TIMEOUT
      end

      begin
        remaining_timeout = deadline && deadline - monotonic_time
        if remaining_timeout && remaining_timeout <= 0
          report_result(TIMEOUT, span_array)
          return TIMEOUT
        end

        batch = span_array.map(&:to_span_data)
        result_code = @exporter.export(batch, timeout: remaining_timeout)
        report_result(result_code, span_array)
        result_code
      ensure
        @export_mutex.unlock
      end
    rescue StandardError => error
      report_result(FAILURE, span_array)
      @metrics_reporter.add_to_counter("otel.bsp.error", labels: { "reason" => error.class.to_s })
      FAILURE
    end

    def lock_export_before(deadline)
      return @export_mutex.lock unless deadline

      loop do
        return true if @export_mutex.try_lock

        remaining = deadline - monotonic_time
        return false if remaining <= 0

        sleep([ remaining, 0.001 ].min)
      end
    end

    def monotonic_time
      Process.clock_gettime(Process::CLOCK_MONOTONIC)
    end

    def reset_on_fork(restart_thread: true)
      @exporter.reset_after_fork if @pid && @pid != Process.pid
      super
    end
  end
end
