require "timeout"

module HubTracing
  class Exporter
    OPERATIONAL_ATTRIBUTES = %w[
      http.request.method http.response.status_code http.method http.status_code http.route
      url.scheme http.scheme server.address server.port net.peer.name net.peer.port
      db.system.name
      messaging.system messaging.destination messaging.message.id messaging.active_job.adapter.name
      messaging.active_job.message.provider_job_id messaging.active_job.message.priority
      code.namespace code.function
    ].freeze
    SENSITIVE_ATTRIBUTES = %w[db.query.text replica.job.arguments].freeze
    EXCEPTION_ATTRIBUTES = %w[exception.type exception.message exception.stacktrace].freeze

    def initialize(include_sensitive_data: false, &exporter_factory)
      raise ArgumentError, "exporter factory is required" unless exporter_factory

      @exporter_factory = exporter_factory
      @exporter = @exporter_factory.call
      @include_sensitive_data = include_sensitive_data
      @mutex = Mutex.new
      @pid = Process.pid
    end

    def export(spans, timeout: nil)
      synchronize_exporter { export_with_deadline(spans, timeout:) }
    end

    def shutdown(timeout: nil)
      synchronize_exporter { @exporter.shutdown(timeout:) }
    end

    def force_flush(timeout: nil)
      synchronize_exporter { @exporter.force_flush(timeout:) }
    end

    private

    def synchronize_exporter(&operation)
      replace_inherited_exporter if @pid != Process.pid
      @mutex.synchronize(&operation)
    end

    def replace_inherited_exporter
      exporter = @exporter_factory.call
      @mutex = Mutex.new
      @exporter = exporter
      @pid = Process.pid
    end

    def export_with_deadline(spans, timeout:)
      raise Timeout::Error if timeout && timeout <= 0

      # The bundled OTLP exporter's retry sleeps can outlast its request timeout.
      Timeout.timeout(timeout) do
        @exporter.export(spans.map { |span| sanitized(span) }, timeout:)
      end
    rescue Timeout::Error
      replace_timed_out_exporter
      OpenTelemetry.handle_error(message: "OTLP export exceeded its deadline; trace batch dropped")
      OpenTelemetry::SDK::Trace::Export::TIMEOUT
    end

    def replace_timed_out_exporter
      timed_out_exporter = @exporter
      begin
        timed_out_exporter.shutdown(timeout: 0)
      rescue StandardError => error
        OpenTelemetry.handle_error \
          exception: error,
          message: "OpenTelemetry could not close a timed-out OTLP exporter"
      end
      @exporter = @exporter_factory.call
    end

    def sanitized(span)
      result = span.dup
      attributes = OPERATIONAL_ATTRIBUTES
      attributes += SENSITIVE_ATTRIBUTES if @include_sensitive_data
      result.attributes = (span.attributes || {}).slice(*attributes)
      result.events = sanitized_events(span.events)
      result.links = []
      result.status = case span.status.code
      when OpenTelemetry::Trace::Status::ERROR then OpenTelemetry::Trace::Status.error
      when OpenTelemetry::Trace::Status::OK then OpenTelemetry::Trace::Status.ok
      else OpenTelemetry::Trace::Status.unset
      end
      method = result.attributes["http.request.method"] || result.attributes["http.method"]
      if span.kind == :server || method
        result.name = [ method || "HTTP", result.attributes["http.route"] ].compact.join(" ")
      end
      result
    end

    def sanitized_events(events)
      return [] unless @include_sensitive_data

      (events || []).filter_map do |event|
        next unless event.name == "exception"

        OpenTelemetry::SDK::Trace::Event.new \
          event.name,
          (event.attributes || {}).slice(*EXCEPTION_ATTRIBUTES),
          event.timestamp
      end
    end
  end
end
