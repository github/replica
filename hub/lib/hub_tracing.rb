require "uri"

module HubTracing
  def self.start!
    return if ENV["SECRET_KEY_BASE_DUMMY"] || ENV["OTEL_SDK_DISABLED"]&.casecmp?("true")

    exporter = ENV.fetch("OTEL_TRACES_EXPORTER", "none")
    unless %w[none otlp].include?(exporter)
      raise ArgumentError, "OTEL_TRACES_EXPORTER must be none or otlp"
    end
    return if exporter == "none"

    include_sensitive_data = boolean_setting("REPLICA_OTEL_INCLUDE_SENSITIVE_DATA")
    trust_incoming_context = boolean_setting("REPLICA_OTEL_TRUST_INCOMING_CONTEXT")
    untraced_hosts = ENV.fetch("REPLICA_OTEL_UNTRACED_HOSTS", "").split(",", -1).map(&:strip)
    untraced_hosts = [] unless ENV.key?("REPLICA_OTEL_UNTRACED_HOSTS")
    if untraced_hosts.any?(&:empty?)
      raise ArgumentError, "REPLICA_OTEL_UNTRACED_HOSTS must contain nonempty comma-separated hostnames"
    end

    protocol = ENV["OTEL_EXPORTER_OTLP_TRACES_PROTOCOL"] ||
      ENV.fetch("OTEL_EXPORTER_OTLP_PROTOCOL", "http/protobuf")
    unless protocol == "http/protobuf"
      raise ArgumentError, "Hub tracing supports only the http/protobuf OTLP protocol"
    end
    endpoint = ENV["OTEL_EXPORTER_OTLP_TRACES_ENDPOINT"] || ENV["OTEL_EXPORTER_OTLP_ENDPOINT"]
    begin
      uri = URI.parse(endpoint.to_s)
    rescue URI::InvalidURIError
      raise ArgumentError, "OTLP endpoint must be an absolute HTTP(S) URL"
    end
    unless %w[http https].include?(uri.scheme) && uri.host &&
        !uri.userinfo && !uri.query && !uri.fragment
      raise ArgumentError, "OTLP endpoint must be an absolute HTTP(S) URL without credentials, query, or fragment"
    end

    require "opentelemetry/sdk"
    require "opentelemetry/exporter/otlp"
    require "opentelemetry/instrumentation/action_pack"
    require "opentelemetry/instrumentation/active_job"
    require "opentelemetry/instrumentation/net/http"
    require_relative "hub_tracing/exporter"
    require_relative "hub_tracing/data_filter"
    require_relative "hub_tracing/propagator"

    span_exporter = Exporter.new \
      OpenTelemetry::Exporter::OTLP::Exporter.new,
      include_sensitive_data: include_sensitive_data
    processor = OpenTelemetry::SDK::Trace::Export::BatchSpanProcessor.new(span_exporter)
    OpenTelemetry::SDK.configure do |config|
      config.service_name = ENV.fetch("OTEL_SERVICE_NAME", "replica-hub")
      config.propagators = [ Propagator.new(trust_incoming_context:) ]
      config.add_span_processor(processor)
      config.use "OpenTelemetry::Instrumentation::Rack", untraced_endpoints: [ "/up" ]
      config.use "OpenTelemetry::Instrumentation::ActionPack", span_naming: :class
      config.use "OpenTelemetry::Instrumentation::ActiveJob",
        propagation_style: :child, span_naming: :job_class
      config.use "OpenTelemetry::Instrumentation::Net::HTTP", untraced_hosts:
    end

    if include_sensitive_data
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

    # ORM instrumentation does not cover Hub's direct SQLite calls.
    tracer = OpenTelemetry.tracer_provider.tracer("replica-hub")
    ActiveSupport::Notifications.subscribe("sql.active_record") do |_, started, finished, _, payload|
      next if payload[:name] == "SCHEMA" || payload[:cached]

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
    at_exit do
      Timeout.timeout(5) { OpenTelemetry.tracer_provider.shutdown(timeout: 5) }
    rescue Timeout::Error
      OpenTelemetry.handle_error(message: "OpenTelemetry shutdown exceeded its deadline; pending traces dropped")
    end
  end

  def self.boolean_setting(name)
    value = ENV.fetch(name, "false")
    unless %w[true false].include?(value.downcase)
      raise ArgumentError, "#{name} must be true or false"
    end

    value.casecmp?("true")
  end
end
