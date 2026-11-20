require "net/http"

# Sends GitHub HTTP requests for the grouped API clients.
class GithubClient::Transport
  # Uses one GitHub origin and optional REST API version for every request.
  def initialize(base_url:, api_version:)
    @base_url = base_url.delete_suffix("/")
    @api_version = api_version
  end

  # Sends one JSON request and returns GitHub's decoded response body.
  def request(method, path, token: nil, body: nil, expected_status: 200..299, accept: "application/vnd.github+json",
    with_headers: false, empty_response: false)
    uri = URI.join(base_url, path)
    request = Net::HTTP.const_get(method.to_s.capitalize).new(uri)
    add_headers(request, token:, accept:)
    request["Content-Type"] = "application/json" if body
    request.body = JSON.generate(body) if body

    response = perform(request, uri)
    status = response.code.to_i
    expected = expected_status.respond_to?(:cover?) ? expected_status.cover?(status) : Array(expected_status).include?(status)
    raise_response_error(response) if !expected

    parsed = empty_response && response.body.blank? ? {} : JSON.parse(response.body)
    with_headers ? { body: parsed, headers: response.to_hash } : parsed
  rescue JSON::ParserError
    raise GithubClient::InvalidResponse, "GitHub returned invalid JSON"
  rescue SocketError, SystemCallError, Timeout::Error, OpenSSL::SSL::SSLError => error
    raise GithubClient::Error, "GitHub request failed: #{error.message}"
  end

  # Streams one GitHub download after following a safe HTTPS redirect.
  def download(path, token:, destination:, maximum_bytes: nil)
    raise ArgumentError, "Download limit must be positive" if maximum_bytes && maximum_bytes.to_i <= 0

    uri = URI.join(base_url, path)
    redirect_uri = nil
    result = with_download_response(uri, token:) do |response|
      if response.is_a?(Net::HTTPRedirection)
        redirect_uri = download_redirect_uri(response)
        nil
      else
        stream_download(response, destination:, maximum_bytes:)
      end
    end
    return result if redirect_uri.nil?

    with_download_response(redirect_uri) do |response|
      stream_download(response, destination:, maximum_bytes:)
    end
  rescue SocketError, SystemCallError, Timeout::Error, OpenSSL::SSL::SSLError => error
    raise GithubClient::Error, "GitHub request failed: #{error.message}"
  end

  private

  attr_reader :api_version, :base_url

  # Adds headers shared by GitHub JSON and download requests.
  def add_headers(request, token: nil, accept: "application/vnd.github+json")
    request["Accept"] = accept
    request["Authorization"] = "Bearer #{token}" if token
    request["User-Agent"] = "replica-hub"
    request["X-GitHub-Api-Version"] = api_version if api_version
  end

  # Yields one download response while its network connection remains open.
  def with_download_response(uri, token: nil)
    request = Net::HTTP::Get.new(uri)
    add_headers(request, token:)
    Net::HTTP.start \
      uri.host,
      uri.port,
      use_ssl: true,
      open_timeout: 5,
      read_timeout: 10 do |http|
        http.request(request) { |response| return yield(response) }
      end
  end

  # Accepts one safe redirect target returned by GitHub's authenticated endpoint.
  def download_redirect_uri(response)
    location = response["location"]
    raise GithubClient::InvalidResponse, "GitHub returned an invalid download redirect" if location.blank?

    uri = URI.parse(location)
    valid = uri.is_a?(URI::HTTPS) && uri.host.present? && uri.userinfo.nil? && uri.port == 443
    raise GithubClient::InvalidResponse, "GitHub returned an invalid download redirect" if !valid

    uri
  rescue URI::InvalidURIError
    raise GithubClient::InvalidResponse, "GitHub returned an invalid download redirect"
  end

  # Copies a successful response while calculating its size and digest.
  def stream_download(response, destination:, maximum_bytes:)
    raise_response_error(response) if !response.is_a?(Net::HTTPSuccess)

    content_length = response["content-length"]&.to_i
    if maximum_bytes && content_length && content_length > maximum_bytes
      raise GithubClient::DownloadTooLarge, "GitHub download exceeds #{maximum_bytes} bytes"
    end

    bytes = 0
    digest = Digest::SHA256.new
    response.read_body do |chunk|
      bytes += chunk.bytesize
      if maximum_bytes && bytes > maximum_bytes
        raise GithubClient::DownloadTooLarge, "GitHub download exceeds #{maximum_bytes} bytes"
      end

      destination.write(chunk)
      digest.update(chunk)
    end
    destination.flush
    { bytes:, sha256: digest.hexdigest }
  end

  # Performs one HTTP request with Hub's GitHub transport timeouts.
  def perform(request, uri)
    Net::HTTP.start \
      uri.host,
      uri.port,
      use_ssl: uri.scheme == "https",
      open_timeout: 5,
      read_timeout: 10 do |http|
        http.request(request)
      end
  end

  # Raises the GitHub client error that matches one unsuccessful response.
  def raise_response_error(response)
    status = response.code.to_i
    error_class = case status
    when 401 then GithubClient::Forbidden
    when 403
      rate_limited?(response) ? GithubClient::RateLimited : GithubClient::Forbidden
    when 404 then GithubClient::NotFound
    when 410 then GithubClient::Gone
    else GithubClient::Error
    end
    raise error_class.new \
      "GitHub returned HTTP #{status}",
      status:,
      response: error_response(response)
  end

  # Reports whether GitHub identified a 403 response as a temporary rate limit.
  def rate_limited?(response)
    return true if response["retry-after"].present? || response["x-ratelimit-remaining"] == "0"

    response.body.to_s.downcase.include?("rate limit")
  end

  # Keeps a structured GitHub error available for exact classification without exposing it in messages.
  def error_response(response)
    parsed = JSON.parse(response.body)
    parsed if parsed.is_a?(Hash)
  rescue JSON::ParserError, TypeError
    nil
  end
end
