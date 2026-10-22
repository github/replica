require "uri"
require "ipaddr"

module HubTracing
  autoload :Enabled, File.expand_path("hub_tracing/enabled", __dir__)

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

    Enabled.start!(include_sensitive_data:, trust_incoming_context:, untraced_hosts:)
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
