module HubTracing
  class DataFilter
    def initialize
      filters = Rails.application.config.filter_parameters
      # The opt-in permits identity fields, including Rails' baseline email filter.
      filters = filters.reject { |filter| filter == :email || filter == "email" }
      @filter = ActiveSupport::ParameterFilter.new(filters + [ :cookie ])
    end

    def job_arguments(arguments)
      serialized = ActiveJob::Arguments.serialize(arguments)
      JSON.generate(@filter.filter("arguments" => serialized).fetch("arguments"))
    end
  end
end
