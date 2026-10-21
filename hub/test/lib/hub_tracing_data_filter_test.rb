require "test_helper"
require "json"
require_relative "../../lib/hub_tracing/data_filter"

class HubTracingDataFilterTest < ActiveSupport::TestCase
  test "opt in retains identities while preserving credential cookie and application filters" do
    original_filters = Rails.application.config.filter_parameters
    Rails.application.config.filter_parameters = [
      :email, "email", :password, :token, :customer_secret, :authorization, /private_email/,
      ->(key, value) { value.replace("[APP FILTERED]") if key == "internal_note" }
    ]
    filter = HubTracing::DataFilter.new
    arguments = [
      {
        "email" => "person@example.test",
        "name" => "Example Person",
        "login" => "example-person",
        "password" => "password-canary",
        "token" => "token-canary",
        "customer_secret" => "app-secret-canary",
        "authorization" => "authorization-canary",
        "cookies" => "cookies-canary",
        "private_email" => "private@example.test",
        "internal_note" => "note-canary"
      }
    ]
    original = Marshal.load(Marshal.dump(arguments))

    result = JSON.parse(filter.job_arguments(arguments)).first

    assert_equal "person@example.test", result.fetch("email")
    assert_equal "Example Person", result.fetch("name")
    assert_equal "example-person", result.fetch("login")
    %w[password token customer_secret authorization cookies private_email].each do |key|
      assert_equal "[FILTERED]", result.fetch(key)
    end
    assert_equal "[APP FILTERED]", result.fetch("internal_note")
    assert_equal original, arguments
  ensure
    Rails.application.config.filter_parameters = original_filters
  end

  test "constructed filters retain identity opt in and credentials after Rails replaces its source with precompiled rules" do
    original_filters = Rails.application.config.filter_parameters
    Rails.application.config.filter_parameters = [ :email, :password, :token, :customer_secret ]
    filter = HubTracing::DataFilter.new
    source = Rails.application.config.filter_parameters
    source.replace(ActiveSupport::ParameterFilter.precompile_filters(source))
    arguments = [
      {
        "email" => "person@example.test",
        "name" => "Example Person",
        "password" => "password-canary",
        "token" => "token-canary",
        "customer_secret" => "app-secret-canary"
      }
    ]

    result = JSON.parse(filter.job_arguments(arguments)).first

    assert_equal "person@example.test", result.fetch("email")
    assert_equal "Example Person", result.fetch("name")
    %w[password token customer_secret].each { |key| assert_equal "[FILTERED]", result.fetch(key) }
  ensure
    Rails.application.config.filter_parameters = original_filters
  end

  test "sensitive opt in does not remove an application rule for another identity field" do
    original_filters = Rails.application.config.filter_parameters
    Rails.application.config.filter_parameters = [ :email, :name, /email/ ]
    arguments = [ { "email" => "person@example.test", "name" => "Example Person", "login" => "example-person" } ]

    result = JSON.parse(HubTracing::DataFilter.new.job_arguments(arguments)).first

    assert_equal "[FILTERED]", result.fetch("email")
    assert_equal "[FILTERED]", result.fetch("name")
    assert_equal "example-person", result.fetch("login")
  ensure
    Rails.application.config.filter_parameters = original_filters
  end
end
