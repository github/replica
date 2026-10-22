require "uri"
require "ipaddr"

module HubTracing
  HOSTNAME = /
    \A
    [a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?
    (?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*
    \z
  /ix

  def self.start!
    return if ENV["SECRET_KEY_BASE_DUMMY"] || ENV["OTEL_SDK_DISABLED"]&.casecmp?("true")

    exporter = ENV.fetch("OTEL_TRACES_EXPORTER", "none")
    unless %w[none otlp].include?(exporter)
      raise ArgumentError, "OTEL_TRACES_EXPORTER must be none or otlp"
    end
    return if exporter == "none"

    include_sensitive_data = boolean_setting("REPLICA_OTEL_INCLUDE_SENSITIVE_DATA")
    trust_incoming_context = boolean_setting("REPLICA_OTEL_TRUST_INCOMING_CONTEXT")
    untraced_hosts = if ENV.key?("REPLICA_OTEL_UNTRACED_HOSTS")
      ENV.fetch("REPLICA_OTEL_UNTRACED_HOSTS").split(",", -1).map(&:strip)
    else
      []
    end
    if ENV.key?("REPLICA_OTEL_UNTRACED_HOSTS") &&
        (untraced_hosts.empty? || untraced_hosts.any? { !valid_untraced_host?(_1) })
      raise ArgumentError,
        "REPLICA_OTEL_UNTRACED_HOSTS must contain comma-separated hostnames or IP addresses"
    end
    untraced_hosts = untraced_hosts.map do |host|
      Regexp.new("\\A#{Regexp.escape(host)}\\z", Regexp::IGNORECASE)
    end

    protocol = ENV["OTEL_EXPORTER_OTLP_TRACES_PROTOCOL"] ||
      ENV.fetch("OTEL_EXPORTER_OTLP_PROTOCOL", "http/protobuf")
    unless protocol == "http/protobuf"
      raise ArgumentError, "Hub tracing supports only the http/protobuf OTLP protocol"
    end
    trace_endpoint = ENV.key?("OTEL_EXPORTER_OTLP_TRACES_ENDPOINT")
    endpoint = ENV["OTEL_EXPORTER_OTLP_TRACES_ENDPOINT"] || ENV["OTEL_EXPORTER_OTLP_ENDPOINT"]
    begin
      uri = URI.parse(endpoint.to_s)
    rescue URI::InvalidURIError
      raise ArgumentError, "OTLP endpoint must be an absolute HTTP(S) URL", cause: nil
    end
    unless %w[http https].include?(uri.scheme) && uri.host && !uri.host.empty? &&
        !uri.userinfo && !uri.query && !uri.fragment
      raise ArgumentError, "OTLP endpoint must be an absolute HTTP(S) URL without credentials, query, or fragment"
    end
    if trace_endpoint && uri.path.empty?
      raise ArgumentError, "OTEL_EXPORTER_OTLP_TRACES_ENDPOINT must include a request path"
    end
    validate_otlp_headers!

    require "opentelemetry/sdk"
    require "opentelemetry/exporter/otlp"
    require "opentelemetry/instrumentation/action_pack"
    require "opentelemetry/instrumentation/active_job"
    require "opentelemetry/instrumentation/net/http"
    require_relative "hub_tracing/batch_span_processor"
    require_relative "hub_tracing/exporter"
    require_relative "hub_tracing/data_filter"
    require_relative "hub_tracing/propagator"

    span_exporter = Exporter.new(include_sensitive_data: include_sensitive_data) do
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

  def self.validate_otlp_headers!
    name = if ENV.key?("OTEL_EXPORTER_OTLP_TRACES_HEADERS")
      "OTEL_EXPORTER_OTLP_TRACES_HEADERS"
    elsif ENV.key?("OTEL_EXPORTER_OTLP_HEADERS")
      "OTEL_EXPORTER_OTLP_HEADERS"
    end
    return unless name

    entries = ENV.fetch(name).split(",", -1)
    valid = entries.any? && entries.all? do |entry|
      key, value = entry.split("=", 2)
      key && value &&
        !URI.decode_uri_component(key).strip.empty? &&
        !URI.decode_uri_component(value).strip.empty?
    end
    return if valid

    raise ArgumentError, "#{name} must contain comma-separated URL-encoded key=value headers"
  rescue ArgumentError, Encoding::CompatibilityError
    raise ArgumentError,
      "#{name} must contain comma-separated URL-encoded key=value headers",
      cause: nil
  end

  def self.valid_untraced_host?(host)
    return false if host.empty? || host.bytesize > 253

    if host.include?(":") || host.match?(/\A[0-9.]+\z/)
      return false if host.start_with?("[") || host.end_with?("]") || host.include?("/")

      IPAddr.new(host)
      return true
    end

    host.match?(HOSTNAME)
  rescue IPAddr::InvalidAddressError
    false
  end
end
