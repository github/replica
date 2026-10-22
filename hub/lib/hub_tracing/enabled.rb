require "opentelemetry/exporter/otlp"
require "opentelemetry/instrumentation/action_pack"
require "opentelemetry/instrumentation/active_job"
require "opentelemetry/instrumentation/net/http"
require "opentelemetry/sdk"
require_relative "batch_span_processor"
require_relative "data_filter"
require_relative "exporter"
require_relative "propagator"

module HubTracing
  module Enabled
    def self.start!(include_sensitive_data:, trust_incoming_context:, untraced_hosts:)
      span_exporter = Exporter.new(include_sensitive_data:) do
        OpenTelemetry::Exporter::OTLP::Exporter.new
      end
      processor = BatchSpanProcessor.new(span_exporter)
      OpenTelemetry::SDK.configure do |config|
        resource_service_name = \
          OpenTelemetry::SDK::Resources::Resource.default.attribute_enumerator.to_h["service.name"]
        config.service_name = "replica-hub" if resource_service_name == "unknown_service"
        config.propagators = [ Propagator.new(trust_incoming_context:) ]
        config.add_span_processor(processor)
        config.use "OpenTelemetry::Instrumentation::Rack", untraced_endpoints: [ "/up" ]
        config.use "OpenTelemetry::Instrumentation::ActionPack", span_naming: :class
        config.use "OpenTelemetry::Instrumentation::ActiveJob",
          propagation_style: :child, span_naming: :job_class
        config.use "OpenTelemetry::Instrumentation::Net::HTTP", untraced_hosts:
      end

      collect_job_arguments(include_sensitive_data:)
      trace_sql(include_sensitive_data:)
      flush_at_exit
    end

    def self.collect_job_arguments(include_sensitive_data:)
      return unless include_sensitive_data

      # Snapshot the original rules before Rails compiles them into combined regular expressions.
      Rails.application.config.after_initialize do
        data_filter = DataFilter.new
        ActiveSupport.on_load(:active_job) do
          record_arguments = proc do |job|
            span = OpenTelemetry::Trace.current_span
            next unless span.recording?

            begin
              span.set_attribute("replica.job.arguments", data_filter.job_arguments(job.arguments))
            rescue ActiveJob::SerializationError, JSON::GeneratorError
              Rails.logger.warn("OpenTelemetry could not serialize job arguments; diagnostic arguments omitted")
            end
          end
          before_enqueue(&record_arguments)
          before_perform(&record_arguments)
        end
      end
    end

    def self.trace_sql(include_sensitive_data:)
      tracer = OpenTelemetry.tracer_provider.tracer("replica-hub")
      ActiveSupport::Notifications.subscribe("sql.active_record") do |_, started, finished, _, payload|
        next if payload[:name] == "SCHEMA" || payload[:cached]
        next unless OpenTelemetry::Trace.current_span.recording?

        span = tracer.start_span \
          "database query",
          kind: :client,
          start_timestamp: started,
          attributes: {
            "db.system.name" => "sqlite",
            "db.query.text" => include_sensitive_data ? payload[:sql] : nil
          }.compact
        span.status = OpenTelemetry::Trace::Status.error if payload[:exception]
        if include_sensitive_data && payload[:exception_object]
          span.record_exception(payload[:exception_object])
        end
        span.finish(end_timestamp: finished)
      end
    end

    def self.flush_at_exit
      at_exit do
        Timeout.timeout(5) { OpenTelemetry.tracer_provider.shutdown(timeout: 5) }
      rescue Timeout::Error
        OpenTelemetry.handle_error(message: "OpenTelemetry shutdown exceeded its deadline; pending traces dropped")
      end
    end
  end
end
