require "test_helper"
require "open3"
require "base64"
require "opentelemetry/exporter/otlp"

class HubTracingIntegrationTest < ActiveSupport::TestCase
  self.use_transactional_tests = false

  test "normal boot isolates inbound context and excludes sensitive diagnostics" do
    result = run_traced_request(failing_job: true)

    assert_equal 200, result.fetch("status")
    assert_equal "completed", result.fetch("body")
    assert_equal 200, result.fetch("health_status")
    refute result.fetch("baggage_propagated"), "incoming baggage reached the outbound service"
    refute result.fetch("tracestate_propagated"), "incoming tracestate reached the outbound service"
    assert result.fetch("traceparent_propagated"), "ordinary outbound HTTP lost context injection"
    payloads = result.fetch("payloads").map { |payload| Base64.strict_decode64(payload) }
    assert_not_empty payloads, result.fetch("diagnostics")
    payloads.each do |payload|
      %w[
        request-private-canary identity-email-canary identity-name-canary password-canary token-canary
        sql-diagnostic-canary argument-diagnostic-canary job-failure-diagnostic-canary
      ].each do |private_value|
        refute_includes payload, private_value
      end
    end
    spans = decoded_spans(result)
    server = spans.find { |span| span.kind == :SPAN_KIND_SERVER }
    assert server, "Rails boot did not produce a server span"
    assert_equal "POST /tracing-probe", server.name
    refute_equal "1234567890abcdef1234567890abcdef", server.trace_id.unpack1("H*")
    assert_empty server.parent_span_id
    assert_equal 1, spans.count { |span| span.kind == :SPAN_KIND_SERVER }, "health check was traced"
    jobs = spans.select { |span| span.name.include?("TracingProbeJob") }
    assert_operator jobs.size, :>=, 2, "enqueue and serialized execution must both be traced"
    assert jobs.all? { |span| span.trace_id == server.trace_id }, "job execution lost its request trace"
    jobs.each do |job|
      assert spans.any? { |parent| parent.span_id == job.parent_span_id }, "job has no exported parent"
    end
    metadata = spans.flat_map(&:attributes)
    assert metadata.any? { |attribute| attribute.key == "db.system.name" }
    jobs.each do |job|
      attributes = span_attributes(job)
      assert_equal "default", attributes.fetch("messaging.destination").string_value
      assert attributes.fetch("messaging.message.id").string_value.present?
      assert_equal "test", attributes.fetch("messaging.active_job.adapter.name").string_value
      assert_equal "3", attributes.fetch("messaging.active_job.message.priority").string_value
      refute attributes.key?("replica.job.arguments")
    end
    refute metadata.any? { |attribute| attribute.key == "db.query.text" }
    refute metadata.any? { |attribute| attribute.key.match?(/bind|parameter/) }
    assert spans.any? { |span| span.kind == :SPAN_KIND_CLIENT }, "outbound HTTP was not traced"
    spans.each do |span|
      assert_empty span.events
      assert_empty span.status.message if span.has_status?
    end
  end

  test "trusted inbound context retains sampled parent but discards tracestate and baggage" do
    result = run_traced_request(configuration: {
      "REPLICA_OTEL_TRUST_INCOMING_CONTEXT" => "TrUe",
      "OTEL_TRACES_SAMPLER" => "parentbased_traceidratio",
      "OTEL_TRACES_SAMPLER_ARG" => "0"
    })

    server = decoded_spans(result).find { |span| span.kind == :SPAN_KIND_SERVER }
    assert server, result.fetch("diagnostics")
    assert_equal "1234567890abcdef1234567890abcdef", server.trace_id.unpack1("H*")
    assert_equal "1234567890abcdef", server.parent_span_id.unpack1("H*")
    refute result.fetch("baggage_propagated")
    refute result.fetch("tracestate_propagated")
    assert result.fetch("traceparent_propagated")
    assert decoded_spans(result).all? { |span| span.trace_state.empty? }
  end

  test "public inbound sampled context cannot override zero sampling" do
    result = run_traced_request(configuration: {
      "OTEL_TRACES_SAMPLER" => "parentbased_traceidratio",
      "OTEL_TRACES_SAMPLER_ARG" => "0"
    })

    assert_equal 200, result.fetch("status")
    assert result.fetch("job_performed")
    assert_empty decoded_spans(result), "an untrusted sampled parent bypassed the configured sampler"
  end

  test "explicit false keeps identity filtering and incoming context isolation" do
    result = run_traced_request(configuration: {
      "REPLICA_OTEL_TRUST_INCOMING_CONTEXT" => "FaLsE",
      "REPLICA_OTEL_INCLUDE_SENSITIVE_DATA" => "FaLsE"
    })

    server = decoded_spans(result).find { |span| span.kind == :SPAN_KIND_SERVER }
    assert server, result.fetch("diagnostics")
    refute_equal "1234567890abcdef1234567890abcdef", server.trace_id.unpack1("H*")
    refute_includes result.fetch("payloads").map { |payload| Base64.strict_decode64(payload) }.join, "identity-email-canary"
  end

  test "service name preserves SDK resource precedence" do
    [
      [ {}, "replica-hub" ],
      [ { "OTEL_RESOURCE_ATTRIBUTES" => "service.name=resource-service" }, "resource-service" ],
      [
        {
          "OTEL_RESOURCE_ATTRIBUTES" => "service.name=resource-service",
          "OTEL_SERVICE_NAME" => "explicit-service"
        },
        "explicit-service"
      ]
    ].each do |configuration, expected|
      result = run_traced_request(configuration:)

      assert_equal [ expected ], resource_service_names(result), result.fetch("diagnostics")
    end
  end

  test "pathless common endpoint appends the OTLP traces path" do
    result = run_traced_request(configuration: {
      "OTEL_EXPORTER_OTLP_TRACES_ENDPOINT" => nil,
      "OTEL_EXPORTER_OTLP_ENDPOINT" => "http://collector.example"
    })

    assert_equal 200, result.fetch("status")
    assert_operator result.fetch("export_attempts"), :>, 0
    assert_not_empty decoded_spans(result)
  end

  test "sensitive opt in exports SQL filtered job arguments and exception diagnostics" do
    result = run_traced_request(
      configuration: { "REPLICA_OTEL_INCLUDE_SENSITIVE_DATA" => "TrUe" },
      failing_job: true
    )

    payload = result.fetch("payloads").map { |encoded| Base64.strict_decode64(encoded) }.join
    %w[
      password-canary token-canary app-secret-canary authorization-canary cookies-canary
      request-private-canary
    ].each { |private_value| refute_includes payload, private_value }
    spans = decoded_spans(result)
    jobs = spans.select { |span| span.name.include?("TracingProbeJob") }
    assert_operator jobs.size, :>=, 2
    jobs.each do |job|
      arguments = JSON.parse(span_attributes(job).fetch("replica.job.arguments").string_value).last
      assert_equal "identity-email-canary@example.test", arguments.fetch("email"), "#{job.name} did not honor identity opt in"
      assert_equal "identity-name-canary", arguments.fetch("name")
      assert_equal "[FILTERED]", arguments.fetch("password")
      assert_equal "[FILTERED]", arguments.fetch("token")
      assert_equal "[FILTERED]", arguments.fetch("customer_secret")
      assert_equal "[FILTERED]", arguments.fetch("authorization")
      assert_equal "[FILTERED]", arguments.fetch("cookies")
    end
    successful_query = spans.find do |span|
      span_attributes(span)["db.query.text"]&.string_value == "SELECT 'sql-diagnostic-canary'"
    end
    assert successful_query, "successful SQL query was not exported"

    unparented_query = spans.find do |span|
      span_attributes(span)["db.query.text"]&.string_value == "SELECT 'unparented-sql-diagnostic-canary'"
    end
    refute unparented_query, "unparented SQL query was exported"

    failed_query = spans.find do |span|
      span_attributes(span)["db.query.text"]&.string_value&.include?("missing_diagnostic_table")
    end
    assert failed_query, "failed SQL query was not exported"
    assert_equal :STATUS_CODE_ERROR, failed_query.status.code
    exception = jobs.flat_map(&:events).find { |event| event.name == "exception" }
    assert exception, "job failure has no exported exception event"
    attributes = exception.attributes.to_h { |attribute| [ attribute.key, attribute.value.string_value ] }
    assert_equal "RuntimeError", attributes.fetch("exception.type")
    assert_includes attributes.fetch("exception.message"), "job-failure-diagnostic-canary"
    assert attributes.fetch("exception.stacktrace").present?
    assert_equal %w[exception.message exception.stacktrace exception.type], attributes.keys.sort
    assert spans.flat_map(&:attributes).none? { |attribute| attribute.key.match?(/bind|parameter/) }
  end

  test "sensitive collection setting remains fixed until restart" do
    [ [ "true", "false" ], [ "false", "true" ] ].each do |startup, changed|
      result = run_traced_request(
        configuration: { "REPLICA_OTEL_INCLUDE_SENSITIVE_DATA" => startup },
        change_sensitive_setting: changed,
        failing_job: true
      )
      spans = decoded_spans(result)
      jobs = spans.select { |span| span.name.include?("TracingProbeJob") }
      assert_operator jobs.size, :>=, 2
      if startup == "true"
        assert jobs.all? { |job| span_attributes(job).key?("replica.job.arguments") }
        assert spans.any? { |span| span_attributes(span).key?("db.query.text") }
        assert jobs.any? { |job| job.events.any? { |event| event.name == "exception" } }
      else
        assert jobs.none? { |job| span_attributes(job).key?("replica.job.arguments") }
        assert spans.none? { |span| span_attributes(span).key?("db.query.text") }
        assert jobs.all? { |job| job.events.empty? }
      end
    end
  end

  test "untraced exact hosts suppress HTTP spans and propagation without suppressing other hosts or jobs" do
    result = run_traced_request(configuration: {
      "REPLICA_OTEL_UNTRACED_HOSTS" => " upstream.example, LocalHost,127.0.0.1,::1 "
    })

    refute result.fetch("traceparent_propagated"), "mixed-case untraced host received trace context"
    refute result.fetch("tracestate_propagated")
    refute result.fetch("baggage_propagated")
    assert result.fetch("other_traceparent_propagated"), "hostname subdomain was incorrectly suppressed"
    spans = decoded_spans(result)
    http = spans.select { |span| span_attributes(span).key?("http.method") || span_attributes(span).key?("http.request.method") }
    refute http.any? { |span| span.kind == :SPAN_KIND_CLIENT && span_attributes(span).values.any? { |value| value.string_value&.casecmp?("upstream.example") } }
    assert http.any? { |span| span.kind == :SPAN_KIND_CLIENT && span_attributes(span).values.any? { |value| value.string_value == "sub.upstream.example" } }
    server = spans.find { |span| span.kind == :SPAN_KIND_SERVER }
    jobs = spans.select { |span| span.name.include?("TracingProbeJob") }
    assert_operator jobs.size, :>=, 2
    assert jobs.all? { |span| span.trace_id == server.trace_id }
  end

  test "an unavailable collector does not interrupt a request or serialized job and flush is bounded" do
    result = run_traced_request(collector_failure: true)

    assert_equal 200, result.fetch("status")
    assert_equal "completed", result.fetch("body")
    assert result.fetch("job_performed")
    assert_operator result.fetch("export_attempts"), :>, 0
    assert_operator result.fetch("request_seconds"), :<, 5
    assert_operator result.fetch("flush_seconds"), :<, 5
  end

  test "a forked worker exports new job spans without replaying its parents pending request" do
    result = run_traced_request(fork_worker: true)

    assert_equal 0, result.fetch("worker_exitstatus")
    assert result.fetch("worker_performed")
    spans = result.fetch("worker_payloads").flat_map do |payload|
      request = Opentelemetry::Proto::Collector::Trace::V1::ExportTraceServiceRequest.decode \
        Base64.strict_decode64(payload)
      request.resource_spans.flat_map(&:scope_spans).flat_map(&:spans)
    end
    assert spans.any? { |span| span.name.include?("TracingProbeJob") }, "forked worker did not export"
    refute spans.any? { |span| span.kind == :SPAN_KIND_SERVER }, "child re-exported its parent's request"
    spans.each { |span| assert_empty span.events }
  end

  private

  def decoded_spans(result)
    result.fetch("payloads").flat_map do |payload|
      request = Opentelemetry::Proto::Collector::Trace::V1::ExportTraceServiceRequest.decode \
        Base64.strict_decode64(payload)
      request.resource_spans.flat_map(&:scope_spans).flat_map(&:spans)
    end
  end

  def span_attributes(span)
    span.attributes.to_h { |attribute| [ attribute.key, attribute.value ] }
  end

  def resource_service_names(result)
    result.fetch("payloads").flat_map do |payload|
      request = Opentelemetry::Proto::Collector::Trace::V1::ExportTraceServiceRequest.decode \
        Base64.strict_decode64(payload)
      request.resource_spans.filter_map do |resource_spans|
        attribute = resource_spans.resource.attributes.find { |candidate| candidate.key == "service.name" }
        attribute&.value&.string_value
      end
    end.uniq
  end

  def run_traced_request(collector_failure: false, fork_worker: false, configuration: {}, failing_job: false, change_sensitive_setting: nil)
    environment = ENV.keys.grep(/\A(?:OTEL_|REPLICA_OTEL_)/).to_h { |key| [ key, nil ] }
    environment.merge! \
      "SECRET_KEY_BASE_DUMMY" => nil,
      "RAILS_ENV" => "test",
      "OTEL_TRACES_EXPORTER" => "otlp",
      "OTEL_EXPORTER_OTLP_TRACES_ENDPOINT" => "http://collector.example/v1/traces",
      "OTEL_EXPORTER_OTLP_TIMEOUT" => "1",
      "OTEL_BSP_SCHEDULE_DELAY" => "60000",
      "OTEL_BSP_EXPORT_TIMEOUT" => "1000"
    environment.merge!(configuration)
    script = <<~RUBY
      require "webmock"
      require "json"
      require "base64"
      WebMock.enable!
      WebMock.disable_net_connect!
      require_relative "config/environment"
      Rails.application.config.filter_parameters += [ :customer_secret ]
      ENV["REPLICA_OTEL_INCLUDE_SENSITIVE_DATA"] = #{change_sensitive_setting.inspect} unless #{change_sensitive_setting.nil?}
      payloads = []
      export_attempts = 0
      baggage_propagated = false
      tracestate_propagated = false
      traceparent_propagated = false
      other_traceparent_propagated = false
      intake = WebMock.stub_request(:post, "http://collector.example/v1/traces")
      if #{collector_failure}
        intake.to_return do
          export_attempts += 1
          raise Errno::ECONNREFUSED
        end
      else
        intake.to_return do |request|
          export_attempts += 1
          payloads << Base64.strict_encode64(request.body)
          { status: 200, body: "" }
        end
      end
      WebMock.stub_request(:get, "http://UpStReAm.ExAmPlE/request-private-canary?token=request-private-canary")
        .to_return do |request|
          baggage_propagated ||= request.headers.key?("Baggage")
          tracestate_propagated ||= request.headers.key?("Tracestate")
          traceparent_propagated ||= request.headers.key?("Traceparent")
          { status: 200, body: "request-private-canary" }
        end
      WebMock.stub_request(:get, "http://sub.upstream.example/")
        .to_return do |request|
          other_traceparent_propagated ||= request.headers.key?("Traceparent")
          { status: 200, body: "" }
        end
      class TracingProbeJob < ActiveJob::Base
        def perform(diagnostic, values)
          raise "job argument changed" unless diagnostic == "argument-diagnostic-canary" &&
            values.fetch("email") == "identity-email-canary@example.test" &&
            values.fetch("name") == "identity-name-canary" &&
            values.fetch("password") == "password-canary" &&
            values.fetch("token") == "token-canary" &&
            values.fetch("customer_secret") == "app-secret-canary" &&
            values.fetch("authorization") == "authorization-canary" &&
            values.fetch("cookies") == "cookies-canary" &&
            values.fetch("on") == Date.new(2026, 10, 19)
          raise "job-failure-diagnostic-canary" if #{failing_job}
          self.class.performed = true
        end
        class_attribute :performed, default: false
      end
      TracingProbeJob.queue_adapter = :test
      class TracingProbeController < ActionController::Base
        def create
          ActiveRecord::Base.connection.select_value("SELECT 'sql-diagnostic-canary'")
          if #{failing_job}
            begin
              ActiveRecord::Base.connection.select_value("SELECT * FROM missing_diagnostic_table")
            rescue ActiveRecord::StatementInvalid
            end
          end
          Net::HTTP.get(URI("http://UpStReAm.ExAmPlE/request-private-canary?token=request-private-canary"))
          Net::HTTP.get(URI("http://sub.upstream.example/"))
          TracingProbeJob.set(priority: 3).perform_later("argument-diagnostic-canary", {
            "email" => "identity-email-canary@example.test",
            "name" => "identity-name-canary",
            "password" => "password-canary",
            "token" => "token-canary",
            "customer_secret" => "app-secret-canary",
            "authorization" => "authorization-canary",
            "cookies" => "cookies-canary",
            "on" => Date.new(2026, 10, 19)
          })
          queued = TracingProbeJob.queue_adapter.enqueued_jobs.shift.select { |key, _| key.is_a?(String) }
          serialized = JSON.parse(JSON.generate(queued))
          OpenTelemetry::Context.with_current(OpenTelemetry::Context.empty) do
            begin
              ActiveJob::Base.execute(serialized)
            rescue RuntimeError => error
              raise unless #{failing_job} && error.message == "job-failure-diagnostic-canary"
            end
          end
          render plain: "completed"
        end
      end
      Rails.application.routes.draw do
        post "/tracing-probe", to: "tracing_probe#create"
        get "/up", to: "rails/health#show"
      end
      OpenTelemetry::Context.with_current(OpenTelemetry::Context.empty) do
        ActiveRecord::Base.connection.select_value("SELECT 'unparented-sql-diagnostic-canary'")
      end
      started = Process.clock_gettime(Process::CLOCK_MONOTONIC)
      request = Rack::MockRequest.env_for \
        "/tracing-probe?token=request-private-canary",
        method: "POST",
        "HTTP_AUTHORIZATION" => "Bearer private-value-canary",
        "HTTP_BAGGAGE" => "secret=request-private-canary",
        "HTTP_TRACEPARENT" => "00-1234567890abcdef1234567890abcdef-1234567890abcdef-01",
        "HTTP_TRACESTATE" => "vendor=request-private-canary",
        input: "request-private-canary",
        "CONTENT_TYPE" => "text/plain"
      status, headers, body = Rails.application.call(request)
      response_body = body.each.to_a.join
      body.close if body.respond_to?(:close)
      request_seconds = Process.clock_gettime(Process::CLOCK_MONOTONIC) - started
      health_status, _, health_body = Rails.application.call(Rack::MockRequest.env_for("/up"))
      health_body.each { |_part| }
      health_body.close if health_body.respond_to?(:close)
      worker = {}
      if #{fork_worker}
        reader, writer = IO.pipe
        pid = fork do
          reader.close
          payloads.clear
          TracingProbeJob.performed = false
          TracingProbeJob.perform_now("argument-diagnostic-canary", {
            "email" => "identity-email-canary@example.test",
            "name" => "identity-name-canary",
            "password" => "password-canary",
            "token" => "token-canary",
            "customer_secret" => "app-secret-canary",
            "authorization" => "authorization-canary",
            "cookies" => "cookies-canary",
            "on" => Date.new(2026, 10, 19)
          })
          OpenTelemetry.tracer_provider.force_flush(timeout: 1)
          OpenTelemetry.tracer_provider.shutdown(timeout: 1)
          writer.write(JSON.generate(payloads: payloads, performed: TracingProbeJob.performed))
          writer.close
          exit! 0
        end
        writer.close
        worker = JSON.parse(reader.read)
        reader.close
        _, worker_status = Process.wait2(pid)
        worker["exitstatus"] = worker_status.exitstatus
      end
      started = Process.clock_gettime(Process::CLOCK_MONOTONIC)
      OpenTelemetry.tracer_provider.force_flush(timeout: 1)
      flush_seconds = Process.clock_gettime(Process::CLOCK_MONOTONIC) - started
      result = JSON.generate \
        status: status,
        body: response_body,
        job_performed: TracingProbeJob.performed,
        health_status: health_status,
        baggage_propagated: baggage_propagated,
        tracestate_propagated: tracestate_propagated,
        traceparent_propagated: traceparent_propagated,
        other_traceparent_propagated: other_traceparent_propagated,
        payloads: payloads,
        export_attempts: export_attempts,
        request_seconds: request_seconds,
        flush_seconds: flush_seconds,
        worker_payloads: worker["payloads"],
        worker_performed: worker["performed"],
        worker_exitstatus: worker["exitstatus"]
      puts "HUB_TRACING_RESULT=" + result
    RUBY
    output, error, status = Open3.capture3 \
      environment,
      RbConfig.ruby,
      "-rbundler/setup",
      "-e",
      script,
      chdir: Rails.root
    assert status.success?, "Tracing subprocess failed:\n#{output}\n#{error}"
    result = output.lines.find { |line| line.start_with?("HUB_TRACING_RESULT=") }
    assert result, "Tracing subprocess returned no result:\n#{output}\n#{error}"
    JSON.parse(result.delete_prefix("HUB_TRACING_RESULT="))
      .merge("diagnostics" => "#{output}\n#{error}")
  end
end
