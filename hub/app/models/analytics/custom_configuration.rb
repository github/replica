# Validates a versioned JSON request template without exposing model attributes.
class Analytics::CustomConfiguration
  FIELD_TYPES = {
    "event_id" => :string, "event_name" => :string, "occurred_at" => :string,
    "actor_id" => :optional, "actor_kind" => :string, "repository_id" => :integer, "prototype_id" => :optional,
    "build_id" => :optional, "thread_id" => :optional, "comment_id" => :optional,
    "properties" => :object
  }.freeze
  SECRET_NAME = /\A[a-z][a-z0-9_]{0,31}\z/
  HEADER_NAME = /\A[A-Za-z0-9][A-Za-z0-9-]{0,63}\z/
  AUTHENTICATION_HEADERS = %w[authorization x-api-key x-auth-token api-key].freeze
  FORBIDDEN_HEADERS = %w[
    host cookie set-cookie connection content-length content-type transfer-encoding
    te trailer upgrade keep-alive proxy-connection authorization-info forwarded
    x-replica-event-id x-http-method-override x-method-override x-original-url
    x-rewrite-url x-real-ip
  ].freeze
  class Invalid < StandardError; end

  attr_reader :config, :secrets

  # Reuses unchanged encrypted values by name, never by a new recipient header.
  def self.from_input!(input, previous: nil, existing_secrets: {})
    template = parse_json!(input.fetch("template"), 16_384, "JSON body template")
    headers = parse_json!(input.fetch("headers"), 8_192, "JSON headers")
    headers = retain_headers!(headers, previous&.config&.fetch("headers", {}))
    success_pointer = input.fetch("success_pointer", "").to_s
    success_value = success_pointer.present? ?
      parse_json!(input.fetch("success_value"), 512, "Expected response value") : nil
    credentials = existing_secrets.dup
    names = []
    Array(input.fetch("secrets", [])).each do |entry|
      name = entry.fetch("name").to_s
      raise Invalid, "Secret names must be distinct" if names.include?(name)

      names << name
      value = entry.fetch("value").to_s
      credentials[name] = value if value.present?
    end
    credentials = credentials.slice(*names)
    new(
      {
        "version" => 1, "endpoint" => input.fetch("endpoint"),
        "headers" => headers, "template" => template,
        "success_pointer" => success_pointer, "success_value" => success_value
      },
      credentials
    ).tap(&:validate!)
  rescue KeyError, TypeError, JSON::ParserError, JSON::NestingError
    raise Invalid, "Enter a valid custom destination configuration"
  end

  # Parses JSON with a fixed byte and nesting limit before saving anything.
  def self.parse_json!(value, limit, label)
    raise Invalid, "#{label} exceeds its size limit" if !value.is_a?(String) || value.bytesize > limit

    JSON.parse(value, max_nesting: 10)
  end

  # A redacted static header marker only preserves the same old named header.
  def self.retain_headers!(headers, previous)
    return headers if !headers.is_a?(Hash)

    headers.each_with_object({}) do |(name, value), result|
      if value == { "$keep" => true }
        saved = (previous || {})[name]
        raise Invalid, "A header cannot be kept without a saved value" if !saved.is_a?(String)

        result[name] = saved
      else
        result[name] = value
      end
    end
  end

  # Holds both newly entered and decrypted persisted settings for validation.
  def initialize(config, secrets)
    @config = config
    @secrets = secrets
  end

  # Rejects unknown settings, missing references, and unbounded nested content.
  def validate!
    if !config.is_a?(Hash) || config.keys.sort != %w[endpoint headers success_pointer success_value template version].sort ||
        config["version"] != 1 || !secrets.is_a?(Hash)
      raise Invalid, "The custom configuration version or fields are not supported"
    end

    Analytics::CustomEndpoint.new(config["endpoint"])
    if secrets.size > 8 || secrets.any? do |name, value|
      !name.is_a?(String) || !name.match?(SECRET_NAME) ||
        !value.is_a?(String) || value.blank? || value.bytesize > 1024
    end
      raise Invalid, "Define up to eight named secrets of at most 1024 bytes"
    end

    validate_headers!
    validate_template!(config["template"], depth: 0)
    validate_success!
    self
  end

  # Includes no saved secret values or static header values in page data.
  def public_settings
    config.except("headers").merge(
      "headers" => config.fetch("headers").transform_values do |value|
        value.is_a?(String) ? { "$keep" => true } : value
      end,
      "secret_names" => secrets.keys
    )
  end

  # Evaluates only allowlisted facts; a missing optional fact uses its explicit fallback.
  def render(event)
    fields = {
      "event_id" => event.uuid, "event_name" => event.name,
      "occurred_at" => event.occurred_at.iso8601(6), "actor_id" => event.actor_id, "actor_kind" => event.actor_kind,
      "repository_id" => event.repository_id,
      "prototype_id" => event.properties["prototype_id"],
      "build_id" => event.properties["build_id"], "thread_id" => event.properties["thread_id"],
      "comment_id" => event.properties["comment_id"], "properties" => event.properties
    }
    evaluate(config.fetch("template"), fields).to_json.tap do |body|
      raise Invalid, "The rendered request is too large" if body.bytesize > 65_536
    end
  end

  # Compares one RFC 6901 pointer with an explicitly configured JSON scalar.
  def accepted?(body)
    pointer = config.fetch("success_pointer")
    return true if pointer.blank?

    value = JSON.parse(body, max_nesting: 12)
    pointer.split("/").drop(1).each do |segment|
      key = segment.gsub("~1", "/").gsub("~0", "~")
      if value.is_a?(Hash) && value.key?(key)
        value = value.fetch(key)
      elsif value.is_a?(Array) && key.match?(/\A(?:0|[1-9]\d*)\z/) && key.to_i < value.size
        value = value.fetch(key.to_i)
      else
        return false
      end
    end
    value == config.fetch("success_value")
  rescue JSON::ParserError, JSON::NestingError
    false
  end

  private

  # Authentication can be a complete encrypted header value, without interpolation.
  def validate_headers!
    headers = config["headers"]
    if !headers.is_a?(Hash) || headers.size > 12 || headers.keys.map(&:downcase).uniq.size != headers.size
      raise Invalid, "Define at most 12 distinct JSON headers"
    end

    headers.each do |name, value|
      if !name.is_a?(String) || !name.match?(HEADER_NAME) ||
          FORBIDDEN_HEADERS.include?(name.downcase) ||
          name.downcase.start_with?("proxy-", "x-forwarded-")
        raise Invalid, "A header name is not allowed"
      end
      next if secret_reference?(value)

      if !value.is_a?(String) || value.bytesize > 1024 || !value.match?(/\A[\x20-\x7E]*\z/) ||
          value.match?(/\$\{|\{\{|\$secret/)
        raise Invalid, "Header values must be short printable strings or named secrets"
      end
    end
  end

  # A placeholder must replace a complete JSON value, never part of a string.
  def validate_template!(node, depth:)
    raise Invalid, "The JSON body is too deeply nested" if depth > 8

    case node
    when Hash
      if node.key?("$field") || node.key?("$secret")
        if node.key?("$secret")
          raise Invalid, "Secret references must be whole values" if node.keys != [ "$secret" ] ||
            !secrets.key?(node["$secret"])
        elsif node.key?("$field")
          field = node["$field"]
          if !FIELD_TYPES.key?(field) || (node.keys - %w[$field when_missing]).any? ||
              (FIELD_TYPES[field] == :optional && !node.key?("when_missing")) ||
              (node.key?("when_missing") && (FIELD_TYPES[field] != :optional ||
                !scalar?(node["when_missing"])))
            raise Invalid, "Use only allowlisted fields and explicit optional fallbacks"
          end
        end
      else
        raise Invalid, "The JSON body has too many fields" if node.size > 50

        node.each do |key, value|
          raise Invalid, "JSON field names must be short" if !key.is_a?(String) || key.bytesize > 128

          validate_template!(value, depth: depth + 1)
        end
      end
    when Array
      raise Invalid, "The JSON body has too many elements" if node.size > 50

      node.each { validate_template!(_1, depth: depth + 1) }
    else
      raise Invalid, "The JSON body has an unsupported value" if !scalar?(node)
      if node.is_a?(String) && node.match?(/\$\{|\{\{|\$secret/)
        raise Invalid, "JSON strings cannot interpolate fields or secrets"
      end
    end
  end

  # Never treats a missing optional ID as a request to drop a JSON key.
  def evaluate(node, fields)
    if node.is_a?(Hash) && node.key?("$field")
      value = fields.fetch(node["$field"])
      return value.nil? ? node.fetch("when_missing") : value
    end
    return secrets.fetch(node["$secret"]) if node.is_a?(Hash) && node.key?("$secret")
    return node.transform_values { evaluate(_1, fields) } if node.is_a?(Hash)
    return node.map { evaluate(_1, fields) } if node.is_a?(Array)

    node
  end

  # Secret references in headers use the complete saved value, including auth scheme.
  def secret_reference?(value)
    value.is_a?(Hash) && value.keys == [ "$secret" ] && secrets.key?(value["$secret"]) &&
      secrets[value["$secret"]].match?(/\A[\x20-\x7E]+\z/)
  end

  # A response check cannot traverse an unbounded document or compare objects.
  def validate_success!
    pointer = config["success_pointer"]
    expected = config["success_value"]
    return if pointer == "" && expected.nil?

    segments = pointer.is_a?(String) ? pointer.split("/", -1) : []
    if !pointer.is_a?(String) || pointer.bytesize > 128 || segments.size > 9 ||
        segments.first != "" || segments.drop(1).any? { _1.match?(/~(?![01])/) } ||
        !scalar?(expected) || expected.to_json.bytesize > 512
      raise Invalid, "Choose one short JSON response field and a scalar expected value"
    end
  end

  # JSON literals and response comparisons exclude executable or compound values.
  def scalar?(value)
    value.nil? || value.is_a?(String) || value.is_a?(Numeric) || value == true || value == false
  end
end
