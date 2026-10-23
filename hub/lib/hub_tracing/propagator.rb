module HubTracing
  class Propagator
    def initialize(trust_incoming_context: false)
      @trust_incoming_context = trust_incoming_context
      @trace_context = OpenTelemetry::Trace::Propagation::TraceContext.text_map_propagator
    end

    def extract(carrier, context: OpenTelemetry::Context.current,
      getter: OpenTelemetry::Context::Propagation.text_map_getter)
      if getter.equal?(OpenTelemetry::Common::Propagation.rack_env_getter) && !@trust_incoming_context
        return OpenTelemetry::Trace.context_with_span \
          OpenTelemetry::Trace::Span::INVALID,
          parent_context: context
      end

      # Vendor state and baggage never cross a Hub boundary, even with trusted ingress.
      @trace_context.extract({ "traceparent" => getter.get(carrier, "traceparent") }, context:)
    end

    def inject(carrier, context: OpenTelemetry::Context.current,
      setter: OpenTelemetry::Context::Propagation.text_map_setter)
      @trace_context.inject(carrier, context:, setter:)
    end

    def fields
      [ "traceparent" ]
    end
  end
end
