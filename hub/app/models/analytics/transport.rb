require "net/http"

# Translates a neutral event into one bounded request to a fixed provider endpoint.
class Analytics::Transport
  ENDPOINTS = {
    "segment" => {
      "us" => "https://api.segment.io/v1/track",
      "eu" => "https://events.eu1.segmentapis.com/v1/track"
    },
    "mixpanel" => {
      "us" => "https://api.mixpanel.com/import",
      "eu" => "https://api-eu.mixpanel.com/import",
      "in" => "https://api-in.mixpanel.com/import"
    }
  }.freeze

  # Exposes only a sanitized category, never provider response text or credentials.
  class Failure < StandardError
    attr_reader :code, :retryable

    def initialize(code, retryable: false)
      @code, @retryable = code, retryable
      super(code)
    end
  end

  # Uses a saved, validated destination rather than a caller-provided URL.
  def initialize(destination, custom_endpoint: nil)
    @destination = destination
    @custom_endpoint = custom_endpoint
  end

  # Sends one event so Mixpanel cannot partially accept a multi-event batch.
  def deliver(event)
    return deliver_custom(event) if @destination.provider == "custom"

    uri = URI(ENDPOINTS.fetch(@destination.provider).fetch(@destination.region))
    credentials = @destination.credentials
    if @destination.provider == "mixpanel"
      uri.query = URI.encode_www_form(strict: 1, project_id: credentials.fetch("project_id"))
    end
    request = Net::HTTP::Post.new(uri)
    request["Content-Type"] = "application/json"
    request["Accept"] = "application/json"
    if @destination.provider == "segment"
      request.basic_auth(credentials.fetch("write_key"), "")
      request.body = segment_payload(event).to_json
    else
      request.basic_auth(credentials.fetch("service_account_username"), credentials.fetch("service_account_secret"))
      request.body = [ mixpanel_payload(event) ].to_json
    end

    status, response_body = Net::HTTP.start(uri.host, uri.port,
      use_ssl: true, open_timeout: 5, read_timeout: 10, write_timeout: 10) do |http|
      http.max_retries = 0
      perform_request(http, request)
    end
    raise Failure.new("http_#{status}", retryable: status == 429 || status >= 500) if !(200..299).cover?(status)

    body = JSON.parse(response_body)
    raise Failure.new("invalid_response") if !body.is_a?(Hash)

    accepted = @destination.provider == "segment" ? body["success"] == true :
      body["status"] == "OK" && body["num_records_imported"] == 1
    raise Failure.new("provider_rejected") if !accepted
  rescue JSON::ParserError, TypeError, Net::HTTPBadResponse, Net::ProtocolError
    raise Failure.new("invalid_response")
  rescue Analytics::CustomEndpoint::LookupFailure
    raise Failure.new("network_error", retryable: true)
  rescue Analytics::CustomEndpoint::Invalid
    raise Failure.new("unsafe_endpoint")
  rescue Analytics::CustomConfiguration::Invalid
    raise Failure.new("invalid_payload")
  rescue Timeout::Error, SocketError, IOError, SystemCallError, OpenSSL::SSL::SSLError
    raise Failure.new("network_error", retryable: true)
  end

  private

  # Re-resolves and pins each request independently, without environment proxies.
  def deliver_custom(event)
    Timeout.timeout(20) do
      settings = Analytics::CustomConfiguration.new(@destination.custom_config, @destination.credentials)
        .validate!
      endpoint = @custom_endpoint || Analytics::CustomEndpoint.new(settings.config.fetch("endpoint"))
      ip = endpoint.public_ip!
      request = Net::HTTP::Post.new(endpoint.uri)
      request["Content-Type"] = "application/json"
      request["Accept"] = "application/json"
      request["X-Replica-Event-Id"] = event.uuid
      settings.config.fetch("headers").each do |name, value|
        request[name] = value.is_a?(Hash) ? settings.secrets.fetch(value.fetch("$secret")) : value
      end
      request.body = settings.render(event)
      status, response_body = endpoint.http(ip).start { perform_request(_1, request) }
      raise Failure.new("http_#{status}", retryable: status == 429 || status >= 500) if !(200..299).cover?(status)
      raise Failure.new("response_mismatch") if !settings.accepted?(response_body)
    end
  end

  # Stops reading large responses, including redirects and failed responses.
  def perform_request(http, request)
    body = +""
    status = nil
    http.request(request) do |response|
      status = response.code.to_i
      response.read_body do |chunk|
        raise Failure.new("response_too_large") if body.bytesize + chunk.bytesize > 16_384

        body << chunk
      end
    end
    [ status, body ]
  end

  # Reuses the event UUID on every Segment retry.
  def segment_payload(event)
    payload = {
      event: event.name, messageId: event.uuid, timestamp: event.occurred_at.iso8601(6),
      properties: event.properties.merge("actor_type" => event.actor_kind)
    }
    if event.actor_kind == "person"
      payload.merge(userId: event.actor_id)
    else
      payload.merge(anonymousId: event.actor_id || "system/#{event.uuid}")
    end
  end

  # Supplies the import API's required identity, time, and deduplication fields.
  def mixpanel_payload(event)
    {
      event: event.name,
      properties: event.properties.merge(
        "time" => event.occurred_at.to_i,
        "distinct_id" => event.actor_id || "system/#{event.uuid}",
        "actor_type" => event.actor_kind,
        "$insert_id" => event.uuid,
        "ip" => 0
      )
    }
  end
end
