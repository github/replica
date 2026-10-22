require "test_helper"
require "open3"
require "socket"
require "opentelemetry/sdk"
require "opentelemetry/exporter/otlp"
require "opentelemetry/sdk/trace/export/in_memory_span_exporter"
require_relative "../../lib/hub_tracing/exporter"

class HubTracingTest < ActiveSupport::TestCase
  self.use_transactional_tests = false

  test "default disabled and dummy builds do not load the tracing SDK" do
    [
      {},
      { "OTEL_TRACES_EXPORTER" => "none" },
      { "OTEL_TRACES_EXPORTER" => "otlp", "OTEL_SDK_DISABLED" => "true" },
      { "OTEL_TRACES_EXPORTER" => "otlp", "SECRET_KEY_BASE_DUMMY" => "1" },
      { "REPLICA_OTEL_INCLUDE_SENSITIVE_DATA" => "invalid", "REPLICA_OTEL_TRUST_INCOMING_CONTEXT" => "invalid" }
    ].each do |configuration|
      output, error, status = run_startup(configuration, <<~RUBY)
        HubTracing.start!
        abort "SDK initialized while disabled" if defined?(OpenTelemetry::SDK)
        puts "disabled"
      RUBY

      assert status.success?, error
      assert_equal "disabled", output.strip
    end
  end

  test "invalid enabled configuration fails without printing endpoint credentials" do
    [
      { "OTEL_EXPORTER_OTLP_ENDPOINT" => nil },
      { "OTEL_EXPORTER_OTLP_ENDPOINT" => "https://user:credential-canary@collector.example" },
      { "OTEL_EXPORTER_OTLP_ENDPOINT" => "https://collector.example?token=credential-canary" },
      { "OTEL_EXPORTER_OTLP_ENDPOINT" => "https://collector.example/#credential-canary" },
      { "OTEL_EXPORTER_OTLP_ENDPOINT" => "https://[credential-canary" },
      { "OTEL_EXPORTER_OTLP_ENDPOINT" => "file:///credential-canary" },
      { "OTEL_EXPORTER_OTLP_ENDPOINT" => "http:///v1/traces" },
      { "OTEL_EXPORTER_OTLP_ENDPOINT" => "https://:4318/v1/traces" },
      { "OTEL_EXPORTER_OTLP_PROTOCOL" => "grpc" },
      { "OTEL_TRACES_EXPORTER" => "console,otlp" },
      { "REPLICA_OTEL_INCLUDE_SENSITIVE_DATA" => "credential-canary" },
      { "REPLICA_OTEL_INCLUDE_SENSITIVE_DATA" => "" },
      { "REPLICA_OTEL_INCLUDE_SENSITIVE_DATA" => "1" },
      { "REPLICA_OTEL_TRUST_INCOMING_CONTEXT" => "credential-canary" },
      { "REPLICA_OTEL_TRUST_INCOMING_CONTEXT" => "" },
      { "REPLICA_OTEL_TRUST_INCOMING_CONTEXT" => "yes" },
      { "REPLICA_OTEL_UNTRACED_HOSTS" => "" },
      { "REPLICA_OTEL_UNTRACED_HOSTS" => "upstream.example," },
      { "REPLICA_OTEL_UNTRACED_HOSTS" => ",upstream.example" },
      { "REPLICA_OTEL_UNTRACED_HOSTS" => "upstream.example, ,other.example" },
      { "REPLICA_OTEL_UNTRACED_HOSTS" => "https://upstream.example" },
      { "REPLICA_OTEL_UNTRACED_HOSTS" => "upstream.example:443" },
      { "REPLICA_OTEL_UNTRACED_HOSTS" => "upstream.example/path" },
      { "REPLICA_OTEL_UNTRACED_HOSTS" => "-upstream.example" },
      { "REPLICA_OTEL_UNTRACED_HOSTS" => "upstream..example" },
      { "REPLICA_OTEL_UNTRACED_HOSTS" => "999.0.0.1" },
      { "REPLICA_OTEL_UNTRACED_HOSTS" => "2001:db8::gggg" },
      { "REPLICA_OTEL_UNTRACED_HOSTS" => "[::1]" },
      { "REPLICA_OTEL_UNTRACED_HOSTS" => "::1/128" }
    ].each do |invalid|
      configuration = {
        "OTEL_TRACES_EXPORTER" => "otlp",
        "OTEL_EXPORTER_OTLP_ENDPOINT" => "http://collector.example"
      }.merge(invalid)
      output, error, status = run_startup(configuration, <<~RUBY)
        begin
          HubTracing.start!
        rescue ArgumentError => error
          puts error.full_message(highlight: false)
          exit 42
        end
      RUBY

      assert_equal 42, status.exitstatus, "#{configuration.keys}: #{output} #{error}"
      refute_includes output + error, "credential-canary"
    end
  end

  test "export deadline interrupts a sleeping exporter even when it rescues ordinary errors" do
    delegate = Object.new
    entered = false
    completed = false
    discarded = false
    delegate.define_singleton_method(:export) do |_, timeout:|
      entered = true
      sleep 0.25
      completed = true
      OpenTelemetry::SDK::Trace::Export::SUCCESS
    rescue StandardError
      OpenTelemetry::SDK::Trace::Export::SUCCESS
    end
    delegate.define_singleton_method(:shutdown) do |timeout:|
      discarded = true
      OpenTelemetry::SDK::Trace::Export::SUCCESS
    end
    exporter = HubTracing::Exporter.new { delegate }

    assert_equal OpenTelemetry::SDK::Trace::Export::TIMEOUT, exporter.export([], timeout: 0.01)
    assert entered, "delegate was never called"
    refute completed, "delegate continued beyond the export deadline"
    assert discarded, "timed-out delegate was not discarded"
  end

  test "flush times out while another export holds the lifecycle lock" do
    entered = Queue.new
    release = Queue.new
    flush_calls = 0
    delegate = Object.new
    delegate.define_singleton_method(:export) do |_, timeout:|
      entered << true
      release.pop
      OpenTelemetry::SDK::Trace::Export::SUCCESS
    end
    delegate.define_singleton_method(:force_flush) do |timeout:|
      flush_calls += 1
      OpenTelemetry::SDK::Trace::Export::SUCCESS
    end
    delegate.define_singleton_method(:shutdown) do |timeout:|
      OpenTelemetry::SDK::Trace::Export::SUCCESS
    end
    exporter = HubTracing::Exporter.new { delegate }
    export = Thread.new { exporter.export([], timeout: nil) }
    Timeout.timeout(1) { entered.pop }

    flush = Thread.new { exporter.force_flush(timeout: 0.01) }

    assert flush.join(0.2), "flush waited beyond its caller timeout"
    assert_equal OpenTelemetry::SDK::Trace::Export::TIMEOUT, flush.value
    assert_equal 0, flush_calls
  ensure
    release&.push(true)
    export&.join(1)
    flush&.join(1)
    exporter&.shutdown(timeout: 1)
  end

  test "flush passes only its remaining timeout after waiting for the lifecycle lock" do
    entered = Queue.new
    release = Queue.new
    flush_started = Queue.new
    flush_timeouts = Queue.new
    delegate = Object.new
    delegate.define_singleton_method(:export) do |_, timeout:|
      entered << true
      release.pop
      OpenTelemetry::SDK::Trace::Export::SUCCESS
    end
    delegate.define_singleton_method(:force_flush) do |timeout:|
      flush_timeouts << timeout
      OpenTelemetry::SDK::Trace::Export::SUCCESS
    end
    delegate.define_singleton_method(:shutdown) do |timeout:|
      OpenTelemetry::SDK::Trace::Export::SUCCESS
    end
    exporter = HubTracing::Exporter.new { delegate }
    export = Thread.new { exporter.export([], timeout: nil) }
    Timeout.timeout(1) { entered.pop }
    flush = Thread.new do
      flush_started << true
      exporter.force_flush(timeout: 1)
    end
    Timeout.timeout(1) { flush_started.pop }
    Timeout.timeout(1) { Thread.pass until flush.status == "sleep" }
    sleep 0.05
    release << true

    assert_equal OpenTelemetry::SDK::Trace::Export::SUCCESS, Timeout.timeout(1) { flush.value }
    remaining = Timeout.timeout(1) { flush_timeouts.pop }
    assert_operator remaining, :>, 0
    assert_operator remaining, :<, 1
  ensure
    release&.push(true)
    export&.join(1)
    flush&.join(1)
    exporter&.shutdown(timeout: 1)
  end

  test "exporter replaces a timed-out OTLP connection before the next batch" do
    collector = TCPServer.new("127.0.0.1", 0)
    connections = []
    first_request = Queue.new
    release_first_response = Queue.new
    server = Thread.new do
      2.times do |index|
        client = collector.accept
        connections << client.peeraddr.fetch(1)
        read_http_request(client)
        if index.zero?
          first_request << true
          release_first_response.pop
        end
        client.write("HTTP/1.1 200 OK\r\nContent-Length: 0\r\nConnection: close\r\n\r\n")
      rescue Errno::EPIPE, IOError
      ensure
        client&.close
      end
    end
    factories = 0
    endpoint = "http://127.0.0.1:#{collector.local_address.ip_port}/v1/traces"
    exporter = HubTracing::Exporter.new do
      factories += 1
      OpenTelemetry::Exporter::OTLP::Exporter.new(endpoint:)
    end
    originals, provider, _sensitive = traced_spans

    first_export = Thread.new { exporter.export(originals, timeout: 0.05) }
    Timeout.timeout(1) { first_request.pop }
    assert_equal OpenTelemetry::SDK::Trace::Export::TIMEOUT, Timeout.timeout(1) { first_export.value }
    release_first_response << true
    assert_equal OpenTelemetry::SDK::Trace::Export::SUCCESS, exporter.export(originals, timeout: 1)
    Timeout.timeout(1) { server.value }
    assert_equal 2, factories
    assert_equal 2, connections.uniq.size
  ensure
    release_first_response&.push(true)
    first_export&.join(1)
    exporter&.shutdown(timeout: 1)
    provider&.shutdown(timeout: 1)
    collector&.close
    server&.join(1)
  end

  test "forked exporters use independent keep-alive collector connections" do
    collector = TCPServer.new("127.0.0.1", 0)
    requests = Queue.new
    server = Thread.new do
      handlers = 2.times.map do |connection|
        client = collector.accept
        Thread.new do
          (connection.zero? ? 2 : 1).times do
            body = read_http_request(client)
            requests << [ connection, decoded_spans(body).map(&:name) ]
            client.write("HTTP/1.1 200 OK\r\nContent-Length: 0\r\nConnection: keep-alive\r\n\r\n")
          end
        ensure
          client.close
        end
      end
      handlers.each(&:value)
    end
    endpoint = "http://127.0.0.1:#{collector.local_address.ip_port}/v1/traces"
    exporter = HubTracing::Exporter.new do
      OpenTelemetry::Exporter::OTLP::Exporter.new(endpoint:)
    end
    originals, provider, _sensitive = traced_spans
    template = originals.last

    assert_equal \
      OpenTelemetry::SDK::Trace::Export::SUCCESS,
      exporter.export(named_batch(template, "before fork"), timeout: 1)

    reader, writer = IO.pipe
    pid = fork do
      reader.close
      result = exporter.export(named_batch(template, "child after fork"), timeout: 1)
      shutdown = exporter.shutdown(timeout: 1)
      writer.write(Marshal.dump(export: result, shutdown:))
      writer.close
      exit! 0
    end
    writer.close
    child = Marshal.load(reader.read)
    reader.close
    _, child_status = Process.wait2(pid)

    assert child_status.success?
    assert_equal OpenTelemetry::SDK::Trace::Export::SUCCESS, child.fetch(:export)
    assert_equal OpenTelemetry::SDK::Trace::Export::SUCCESS, child.fetch(:shutdown)
    assert_equal \
      OpenTelemetry::SDK::Trace::Export::SUCCESS,
      exporter.export(named_batch(template, "parent after fork"), timeout: 1)
    assert_equal OpenTelemetry::SDK::Trace::Export::SUCCESS, exporter.shutdown(timeout: 1)
    Timeout.timeout(1) { server.value }

    names_by_connection = Hash.new { |names, connection| names[connection] = [] }
    3.times do
      connection, names = requests.pop
      names_by_connection[connection].concat(names)
    end
    assert_equal [ "before fork", "parent after fork" ], names_by_connection.fetch(0)
    assert_equal [ "child after fork" ], names_by_connection.fetch(1)
  ensure
    exporter&.shutdown(timeout: 1)
    provider&.shutdown(timeout: 1)
    collector&.close
    server&.join(1)
  end

  test "forked flush and shutdown replace inherited delegates before use" do
    %i[force_flush shutdown].each do |operation|
      calls = []
      factories = 0
      exporter = HubTracing::Exporter.new do
        identifier = factories += 1
        Object.new.tap do |delegate|
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
      reader, writer = IO.pipe
      pid = fork do
        reader.close
        result = exporter.public_send(operation, timeout: 1)
        writer.write(Marshal.dump(factories:, calls:, result:))
        writer.close
        exit! 0
      end
      writer.close
      child = Marshal.load(reader.read)
      reader.close
      _, status = Process.wait2(pid)

      assert status.success?
      assert_equal 2, child.fetch(:factories)
      assert_equal [ [ 2, operation ] ], child.fetch(:calls)
      assert_equal OpenTelemetry::SDK::Trace::Export::SUCCESS, child.fetch(:result)
    ensure
      exporter&.shutdown(timeout: 1)
    end
  end

  test "expired export deadlines do not send spans" do
    delegate = Object.new
    calls = 0
    delegate.define_singleton_method(:export) do |_, timeout:|
      calls += 1
      OpenTelemetry::SDK::Trace::Export::SUCCESS
    end
    delegate.define_singleton_method(:shutdown) do |timeout:|
      OpenTelemetry::SDK::Trace::Export::SUCCESS
    end
    exporter = HubTracing::Exporter.new { delegate }

    [ 0, -1 ].each do |timeout|
      assert_equal OpenTelemetry::SDK::Trace::Export::TIMEOUT, exporter.export([], timeout:)
    end
    assert_equal 0, calls
  end

  test "exporter removes sensitive diagnostics and unrelated private content by default" do
    originals, provider, sensitive = traced_spans
    exporter, requests, intake = exporter_requests

    assert_equal OpenTelemetry::SDK::Trace::Export::SUCCESS, exporter.export(originals, timeout: 1)

    assert_requested intake, times: 1
    payload = requests.first.body
    %w[sql-diagnostic-canary argument-diagnostic-canary exception-diagnostic-canary].each do |diagnostic|
      refute_includes payload, diagnostic
    end
    refute_includes payload, sensitive
    decoded_spans(payload).zip(originals).each do |span, original|
      attributes = span.attributes.to_h { |attribute| [ attribute.key, attribute.value ] }
      assert_equal original.attributes.fetch("http.request.method"), attributes.fetch("http.request.method").string_value
      assert_equal "sqlite", attributes.fetch("db.system.name").string_value
      assert_equal "default", attributes.fetch("messaging.destination").string_value
      assert_equal "TracingProbeJob", attributes.fetch("code.namespace").string_value
      refute attributes.key?("db.query.text")
      refute attributes.key?("replica.job.arguments")
      refute attributes.key?("db.query.parameter.0")
      assert_empty span.events
      assert_empty span.links
      assert_empty span.status.message
    end
    assert_equal "POST /#{sensitive}", originals.first.name
    assert_equal sensitive, originals.first.events.first.name
    assert_equal sensitive, originals.first.status.description
  ensure
    exporter&.shutdown(timeout: 1)
    provider&.shutdown(timeout: 1)
  end

  test "sensitive exporter retains intended diagnostics but removes unrelated private content" do
    originals, provider, sensitive = traced_spans
    exporter, requests, intake = exporter_requests(include_sensitive_data: true)

    assert_equal OpenTelemetry::SDK::Trace::Export::SUCCESS, exporter.export(originals, timeout: 1)

    assert_requested intake, times: 1
    assert_equal "application/x-protobuf", requests.first.headers["Content-Type"]
    payload = requests.first.body
    refute_includes payload, sensitive
    exported = decoded_spans(payload)
    assert_equal [ "POST /builds/:id", "GET /builds/:id" ], exported.map(&:name)
    exported.zip(originals).each do |actual, original|
      assert_equal original.trace_id, actual.trace_id
      assert_equal original.span_id, actual.span_id
      assert_equal original.start_timestamp, actual.start_time_unix_nano
      assert_equal original.end_timestamp, actual.end_time_unix_nano
      assert_empty actual.links
      metadata = actual.attributes.to_h { |attribute| [ attribute.key, attribute.value ] }
      assert_equal "SELECT 'sql-diagnostic-canary'", metadata.fetch("db.query.text").string_value
      assert_equal \
        '["argument-diagnostic-canary",{"password":"[FILTERED]"}]',
        metadata.fetch("replica.job.arguments").string_value
      refute metadata.key?("db.query.parameter.0")
      refute metadata.key?("http.request.header.authorization")
      refute metadata.key?("http.request.body")
      refute metadata.key?("url.full")
    end
    assert_equal [ "exception" ], exported.first.events.map(&:name)
    event = exported.first.events.first
    assert_equal originals.first.events.last.timestamp, event.time_unix_nano
    expected_exception = {
      "exception.type" => "RuntimeError",
      "exception.message" => "exception-diagnostic-canary",
      "exception.stacktrace" => "probe.rb:1:in `perform'"
    }
    assert_equal expected_exception, event.attributes.to_h { |attribute| [ attribute.key, attribute.value.string_value ] }
    assert_empty exported.last.events
    assert_equal :STATUS_CODE_ERROR, exported.first.status.code
    assert_empty exported.first.status.message
  ensure
    exporter&.shutdown(timeout: 1)
    provider&.shutdown(timeout: 1)
  end

  private

  def traced_spans
    memory = OpenTelemetry::SDK::Trace::Export::InMemorySpanExporter.new
    provider = OpenTelemetry::SDK::Trace::TracerProvider.new
    provider.add_span_processor(OpenTelemetry::SDK::Trace::Export::SimpleSpanProcessor.new(memory))
    tracer = provider.tracer("hub-tracing-test")
    sensitive = "private-value-canary"
    attributes = {
      "http.request.method" => "POST",
      "http.response.status_code" => 500,
      "http.route" => "/builds/:id",
      "http.method" => "POST",
      "http.status_code" => 500,
      "url.scheme" => "https",
      "http.scheme" => "https",
      "server.address" => "example.com",
      "server.port" => 443,
      "net.peer.name" => "example.com",
      "net.peer.port" => 443,
      "db.system.name" => "sqlite",
      "db.query.text" => "SELECT 'sql-diagnostic-canary'",
      "messaging.system" => "active_job",
      "messaging.destination" => "default",
      "messaging.message.id" => "job-id",
      "messaging.active_job.adapter.name" => "ActiveJob::QueueAdapters::TestAdapter",
      "messaging.active_job.message.provider_job_id" => "provider-id",
      "messaging.active_job.message.priority" => "3",
      "code.namespace" => "TracingProbeJob",
      "code.function" => "perform",
      "replica.job.arguments" => '["argument-diagnostic-canary",{"password":"[FILTERED]"}]',
      "http.request.header.authorization" => "Bearer #{sensitive}",
      "http.request.body" => sensitive,
      "url.full" => "https://user:#{sensitive}@example.com/#{sensitive}?token=#{sensitive}",
      "db.statement" => "SELECT '#{sensitive}'",
      "db.query.parameter.0" => sensitive,
      "job.arguments" => sensitive,
      "db.system" => sensitive,
      "db.operation" => sensitive,
      "db.operation.name" => sensitive,
      "messaging.operation" => sensitive,
      "messaging.operation.name" => sensitive,
      "messaging.operation.type" => sensitive,
      "messaging.destination.name" => sensitive,
      "messaging.destination_kind" => sensitive
    }
    link = OpenTelemetry::Trace::Link.new \
      OpenTelemetry::Trace::SpanContext.new,
      { "secret" => sensitive }
    span = tracer.start_span("POST /#{sensitive}", kind: :server, attributes:, links: [ link ])
    span.add_event(sensitive, attributes: { "exception.message" => sensitive })
    span.add_event \
      "exception",
      attributes: {
        "exception.type" => "RuntimeError",
        "exception.message" => "exception-diagnostic-canary",
        "exception.stacktrace" => "probe.rb:1:in `perform'",
        "exception.escaped" => true,
        "request.body" => sensitive
      }
    span.status = OpenTelemetry::Trace::Status.error(sensitive)
    span.finish
    client = tracer.start_span \
      "GET https://example.com/#{sensitive}",
      kind: :client,
      attributes: attributes.merge("http.request.method" => "GET")
    client.finish
    [ memory.finished_spans, provider, sensitive ]
  end

  def exporter_requests(include_sensitive_data: false)
    requests = []
    intake = stub_request(:post, "http://collector.example/v1/traces").with do |request|
      requests << request
      true
    end.to_return(status: 200, body: "")
    delegate = OpenTelemetry::Exporter::OTLP::Exporter.new(endpoint: "http://collector.example/v1/traces")
    [ HubTracing::Exporter.new(include_sensitive_data:) { delegate }, requests, intake ]
  end

  def decoded_spans(payload)
    decoded = Opentelemetry::Proto::Collector::Trace::V1::ExportTraceServiceRequest.decode(payload)
    decoded.resource_spans.flat_map(&:scope_spans).flat_map(&:spans)
  end

  def read_http_request(socket)
    request = +""
    request << socket.readpartial(1024) until request.include?("\r\n\r\n")
    headers, body = request.split("\r\n\r\n", 2)
    content_length = headers[/\r\nContent-Length:\s*(\d+)/i, 1].to_i
    body << socket.read(content_length - body.bytesize) if body.bytesize < content_length
    body
  end

  def named_batch(template, name)
    span = template.dup
    span.name = name
    span.attributes = {}
    [ span ]
  end

  def run_startup(configuration, script)
    environment = ENV.keys.grep(/\A(?:OTEL_|REPLICA_OTEL_)/).to_h { |key| [ key, nil ] }
      .merge("SECRET_KEY_BASE_DUMMY" => nil)
      .merge(configuration)
    Open3.capture3 \
      environment,
      RbConfig.ruby,
      "-rbundler/setup",
      "-Ilib",
      "-rhub_tracing",
      "-e",
      script,
      chdir: Rails.root
  end
end
