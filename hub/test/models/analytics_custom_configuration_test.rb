require "test_helper"

class AnalyticsCustomConfigurationTest < ActiveSupport::TestCase
  setup do
    @input = {
      "endpoint" => "https://events.example.com/collect?version=1",
      "headers" => '{"Authorization":{"$secret":"api_token"},"X-Mode":"import"}',
      "template" => {
        event: { "$field" => "event_name" },
        id: { "$field" => "event_id" },
        actor: { "$field" => "actor_id", when_missing: nil },
        payload: [ { "$field" => "properties" }, { "$secret" => "api_token" } ]
      }.to_json,
      "success_pointer" => "/result/accepted",
      "success_value" => "true",
      "secrets" => [ { "name" => "api_token", "value" => "Bearer very-private" } ]
    }
  end

  test "renders allowlisted fields and whole-value secret references" do
    repository = repositories.create
    prototype = prototypes.create(repository:)
    prototype.register!(name: "Private title")
    event = Analytics::Event.sole
    settings = Analytics::CustomConfiguration.from_input!(@input)
    payload = JSON.parse(settings.render(event))
    assert_equal event.name, payload["event"]
    assert_equal event.uuid, payload["id"]
    assert_nil payload["actor"]
    assert_equal event.properties, payload["payload"].first
    assert_equal "Bearer very-private", payload["payload"].last
    assert settings.accepted?('{"result":{"accepted":true}}')
    assert_not settings.accepted?('{"result":{"accepted":false}}')
    assert_not settings.accepted?('{"result":{}}')
    assert_not settings.accepted?("not json")
    assert_equal({ "$keep" => true }, settings.public_settings.dig("headers", "X-Mode"))
    assert_equal [ "api_token" ], settings.public_settings.fetch("secret_names")
    assert_not_includes settings.public_settings.to_json, "very-private"
    assert_not_includes settings.public_settings.to_json, "import"
  end

  test "renders workload actor kind without changing other template output" do
    repository = repositories.create
    prototype = prototypes.create(repository:, branch_name: "prototype/workload")
    approver = users.create
    now = Time.current.change(usec: 0)
    connection = TaskConnection.create! \
      repository:,
      branch_name: prototype.branch_name,
      user_code: SecureRandom.hex(5),
      approval_expires_at: now + 10.minutes,
      approving_user: approver,
      approved_at: now,
      expires_at: now + 24.hours
    prototype.register!(name: "Automated prototype", registration_task_connection: connection)
    event = Analytics::Event.find_by!(source_key: "prototype/#{prototype.id}/registered")
    template = JSON.parse(@input.fetch("template")).merge("actor_kind" => { "$field" => "actor_kind" })
    settings = Analytics::CustomConfiguration.from_input!(@input.merge("template" => template.to_json))

    payload = JSON.parse(settings.render(event))

    assert_equal "workload", payload.fetch("actor_kind")
    assert_equal event.name, payload.fetch("event")
    assert_equal event.uuid, payload.fetch("id")
    assert_equal event.actor_id, payload.fetch("actor")
    assert_equal event.properties, payload.fetch("payload").first
    assert_equal "Bearer very-private", payload.fetch("payload").last
  end

  test "allows literal provider field names that begin with a dollar sign" do
    input = @input.merge("template" => { "$insert_id" => { "$field" => "event_id" } }.to_json)
    settings = Analytics::CustomConfiguration.from_input!(input)
    repository = repositories.create
    prototypes.create(repository:).register!(name: "Welcome")
    event = Analytics::Event.sole
    assert_equal({ "$insert_id" => event.uuid }, JSON.parse(settings.render(event)))
  end

  test "keeps an existing static header and blank secret without returning either" do
    saved = Analytics::CustomConfiguration.from_input!(@input)
    edited = @input.deep_dup
    edited["headers"] = saved.public_settings.fetch("headers").to_json
    edited["secrets"].first["value"] = ""
    current = Analytics::CustomConfiguration.from_input! \
      edited, previous: saved, existing_secrets: saved.secrets
    assert_equal saved.config, current.config
    assert_equal saved.secrets, current.secrets
    assert_not_includes current.public_settings.to_json, "Bearer"
  end

  test "rejects unknown fields missing optional fallbacks and missing secrets" do
    [
      { "$field" => "review_text" },
      { "$field" => "actor_id" },
      { "$field" => "event_id", "when_missing" => nil },
      { "$secret" => "unknown" },
      { "$secret" => "api_token", "prefix" => "Bearer " },
      { "message" => "prefix ${event_id}" }
    ].each do |value|
      input = @input.merge("template" => { payload: value }.to_json)
      assert_raises(Analytics::CustomConfiguration::Invalid) do
        Analytics::CustomConfiguration.from_input!(input)
      end
    end
  end

  test "rejects invalid headers and stale static-header retention" do
    %w[
      Host Cookie Proxy-Authorization Transfer-Encoding X-Replica-Event-Id
      X-Forwarded-Host X-HTTP-Method-Override
    ].each do |name|
      input = @input.merge("headers" => { name => "unsafe" }.to_json)
      assert_raises(Analytics::CustomConfiguration::Invalid) do
        Analytics::CustomConfiguration.from_input!(input)
      end
    end
    assert_raises(Analytics::CustomConfiguration::Invalid) do
      Analytics::CustomConfiguration.from_input!(@input.merge("headers" => '{"X-New":{"$keep":true}}'))
    end
    assert_raises(Analytics::CustomConfiguration::Invalid) do
      Analytics::CustomConfiguration.from_input!(@input.merge("headers" => '{"X-Test":"good\\r\\nInjected: yes"}'))
    end
  end

  test "rejects deep or oversized templates and non-scalar response checks" do
    deep = 10.times.reduce("value") { |node, _| [ node ] }
    [
      @input.merge("template" => deep.to_json),
      @input.merge("template" => { payload: "x" * 16_385 }.to_json),
      @input.merge("success_value" => '{"accepted":true}'),
      @input.merge("success_pointer" => "/result/~2oops")
    ].each do |input|
      assert_raises(Analytics::CustomConfiguration::Invalid) do
        Analytics::CustomConfiguration.from_input!(input)
      end
    end
  end

  test "bounds header and secret counts and rejects undefined secret references" do
    [
      @input.merge("headers" => 13.times.to_h { |index| [ "X-Key-#{index}", "value" ] }.to_json),
      @input.merge("secrets" => 9.times.map { |index|
        { "name" => "secret_#{index}", "value" => "value" }
      }),
      @input.merge("headers" => '{"Authorization":{"$secret":"missing"}}')
    ].each do |input|
      assert_raises(Analytics::CustomConfiguration::Invalid) do
        Analytics::CustomConfiguration.from_input!(input)
      end
    end
  end

  test "rejects a rendered request larger than the fixed body bound" do
    input = @input.merge(
      "template" => [ 50.times.map { { "$secret" => "api_token" } },
        50.times.map { { "$secret" => "api_token" } } ].to_json,
      "secrets" => [ { "name" => "api_token", "value" => "x" * 1024 } ]
    )
    settings = Analytics::CustomConfiguration.from_input!(input)
    repository = repositories.create
    prototypes.create(repository:).register!(name: "Welcome")
    assert_raises(Analytics::CustomConfiguration::Invalid) do
      settings.render(Analytics::Event.sole)
    end
  end
end
