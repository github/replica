require "test_helper"

class AnalyticsIntegrationTest < ActionDispatch::IntegrationTest
  setup do
    github_app_configurations.create_installed
    @payload = repository_payload(2001, "github/prototype")
    stub_github_sign_in(repositories: [ @payload ], permissions: { 2001 => "admin" })
    post github_authentication_path
    state = Rack::Utils.parse_query(URI(response.location).query).fetch("state")
    get github_authentication_callback_path, params: { code: "code", state: }
    @repository = Repository.find_by!(github_id: 2001)
    @path = repository_analytics_path(@repository.route_id)
    @destinations_path = repository_analytics_destinations_path(@repository.route_id)
  end

  test "admin can configure rotate pause resume and disconnect without exposing credentials" do
    get @path, headers: { "Accept" => "application/json" }
    assert_response :success
    data = JSON.parse(response.body).fetch("data")
    assert_equal @path, data["analyticsPath"]
    assert_equal "analytics", data["selectedSection"]
    copy = data.fetch("copy")
    assert_equal I18n.t("analytics.page.event_types"), copy.fetch("eventTypes")
    assert_equal %w[
      heading description privacy destinations empty add cancel provider segment mixpanel custom
      region us eu in writeKey serviceAccountUsername serviceAccountSecret projectId
      mixpanelHelp rotation eventTypes history newEvents retainedEvents historyWarning
      save configured paused failed pause resume disconnect failureHelp
      customName customEndpoint customEndpointHelp customHeaders customHeaderRetention
      customTemplate customSecrets
      customSecretName customSecretValue customAddSecret customSuccessPointer customSuccessValue
      customPreview customPreviewHelp customPreviewInvalid customKeepPending customBacklogWarning customRetryWarning
      customEndpointExample customTemplateExample customHeadersExample
    ].sort, copy.keys.sort
    assert_equal Analytics::Event::TYPES, data.fetch("eventTypes").map { _1.fetch("value") }
    assert_equal Analytics::CustomConfiguration::AUTHENTICATION_HEADERS, data.fetch("authenticationHeaders")

    selected_events = %w[prototype_registered template_previewed]
    settings = configuration.merge(event_types: selected_events)
    post @destinations_path, params: { destination: settings }
    assert_response :see_other
    destination = @repository.analytics_destinations.sole
    path = repository_analytics_destination_path(@repository.route_id, destination)
    follow_redirect!
    assert_includes response.body, "Configured"
    assert_not_includes response.body, "initial-secret"
    assert_not_includes response.body, '"credentials"'

    get @path, headers: { "Accept" => "application/json" }
    card = JSON.parse(response.body).fetch("data").fetch("destinations").sole
    assert_equal selected_events, card.fetch("eventTypes")
    assert_equal false, card.fetch("deliveryFailed")
    assert_empty card.keys & %w[lastDeliveredAt failureCount retryCount]

    patch path, params: {
      destination: settings.except(:provider, :history).merge(credentials: { write_key: "rotated-secret" })
    }
    assert_equal "rotated-secret", destination.reload.credentials["write_key"]
    patch path, params: { destination: settings.merge(credentials: { write_key: "" }) }
    assert_equal "rotated-secret", destination.reload.credentials["write_key"]
    patch path, params: { operation: "pause" }
    assert_not destination.reload.enabled?
    patch path, params: { operation: "resume" }
    assert destination.reload.enabled?
    assert_equal selected_events, destination.event_types
    delete path
    assert_response :see_other
    assert_not Analytics::Destination.exists?(destination.id)
  end

  test "reads and mutations fail closed after permission revocation or a GitHub error" do
    post @destinations_path, params: { destination: configuration }
    destination = @repository.analytics_destinations.sole
    path = repository_analytics_destination_path(@repository.route_id, destination)
    get @path
    assert_response :success
    [ "push", "pull", nil, :failure ].each do |permission|
      stub_github_permissions([ @payload ], { 2001 => permission })
      expected = permission == :failure ? :service_unavailable : :not_found
      get @path
      assert_response expected
      post @destinations_path, params: { destination: configuration }
      assert_response expected
      patch path, params: { operation: "pause" }
      assert_response expected
      delete path
      assert_response expected
      assert destination.reload.enabled?
    end
  end

  test "cannot mutate a destination through another repository" do
    other = repositories.create(github_id: 2002, name_with_owner: "github/other")
    stub_github_permissions([ repository_payload(2002, "github/other") ], { 2002 => "pull" })
    destination = other.analytics_destinations.create! \
      provider: "segment", region: "us", credentials: { write_key: "other-secret" },
      event_types: Analytics::Event::TYPES
    path = repository_analytics_destination_path(@repository.route_id, destination)
    patch path, params: { operation: "pause" }
    assert_response :not_found
    delete path
    assert_response :not_found
    get @path
    assert_not_includes response.body, "other-secret"
    assert destination.reload.enabled?
  end

  test "requires explicit onboarding and validates without reflecting submitted secrets" do
    invalid = configuration.except(:history)
    assert_no_difference("Analytics::Destination.count") do
      post @destinations_path, params: { destination: invalid }
    end
    follow_redirect!
    assert_includes response.body, "Could not save"
    assert_not_includes response.body, "initial-secret"
    post @destinations_path, params: { destination: configuration.merge(region: "https://example.com") }
    assert_empty @repository.analytics_destinations
    post @destinations_path, params: { destination: configuration }
    assert_no_difference("Analytics::Destination.count") do
      post @destinations_path, params: { destination: configuration }
    end
  end

  test "repository removal denies the canonical page" do
    @repository.update!(installation_state: "removed", removed_at: Time.current)
    get @path
    assert_response :not_found
  end

  test "invalid Mixpanel credentials explain the format without echoing submitted values" do
    [
      { service_account_username: "service-user", service_account_secret: "private-secret", project_id: "invalid-project" },
      { service_account_username: "invalid:username", service_account_secret: "private-secret", project_id: "123" }
    ].each do |credentials|
      assert_no_difference("Analytics::Destination.count") do
        post @destinations_path, params: {
          destination: configuration.merge(provider: "mixpanel", credentials:)
        }
      end
      assert_redirected_to @path
      get @path, headers: { "Accept" => "application/json" }
      assert_response :success
      alert = JSON.parse(response.body).fetch("data").fetch("alert")
      assert_includes alert, "positive whole-number project ID"
      assert_includes alert, "username without a colon"
      assert_not_includes response.body, "private-secret"
      assert_not_includes response.body, "invalid-project"
      assert_not_includes response.body, "invalid:username"
    end
  end

  test "retained history is sent only when chosen and only for the selected repository and events" do
    prototype = prototypes.create(repository: @repository)
    prototype.register!(name: "Registered", author: nil)
    other = prototypes.create(repository: repositories.create(github_id: 2002))
    other.register!(name: "Other repository", author: nil)
    event = @repository.analytics_events.sole

    post @destinations_path, params: { destination: configuration }
    assert_response :see_other
    destination = @repository.analytics_destinations.sole
    assert_empty destination.deliveries
    delete repository_analytics_destination_path(@repository.route_id, destination)

    post @destinations_path, params: {
      destination: configuration.merge(history: "retained", event_types: [ "review_reply_added" ])
    }
    assert_response :see_other
    destination = @repository.analytics_destinations.sole
    assert_empty destination.deliveries
    delete repository_analytics_destination_path(@repository.route_id, destination)

    post @destinations_path, params: {
      destination: configuration.merge(history: "retained", event_types: [ event.name ])
    }
    assert_response :see_other
    destination = @repository.analytics_destinations.sole
    assert_equal [ event.id ], destination.deliveries.pluck(:event_id)
  end

  test "only repository admins receive an analytics navigation link" do
    get repository_path(@repository.route_id), headers: { "Accept" => "application/json" }
    assert_response :success
    assert_equal @path, JSON.parse(response.body).fetch("data").fetch("analyticsPath")

    stub_github_permissions([ @payload ], { 2001 => "pull" })
    Rails.cache.clear
    get repository_path(@repository.route_id), headers: { "Accept" => "application/json" }
    assert_response :success
    assert_nil JSON.parse(response.body).fetch("data").fetch("analyticsPath")
  end

  test "admin can configure two custom destinations without exposing saved secrets or headers" do
    with_public_dns do
      post @destinations_path, params: { destination: custom_configuration }
      assert_response :see_other
      post @destinations_path, params: { destination: custom_configuration.merge(name: "Warehouse") }
      assert_response :see_other
    end
    assert_equal 2, @repository.analytics_destinations.where(provider: "custom").count
    get @path, headers: { "Accept" => "application/json" }
    data = JSON.parse(response.body).fetch("data")
    assert_equal 2, data.fetch("destinations").size
    card = data.fetch("destinations").first.fetch("customConfig")
    assert_equal "https://example.com/collect?version=1", card.fetch("endpoint")
    assert_equal({ "$keep" => true }, card.dig("headers", "X-Channel"))
    assert_equal [ "api_token" ], card.fetch("secret_names")
    assert_not_includes response.body, "Bearer private"
    assert_not_includes response.body, "safe-static-value"
    assert_not_includes response.body, '"credentials"'
  end

  test "custom edits cancel old backlog by default but can keep it for authentication rotation" do
    with_public_dns do
      post @destinations_path, params: { destination: custom_configuration }
      destination = @repository.analytics_destinations.sole
      prototype = prototypes.create(repository: @repository)
      prototype.register!(name: "Welcome")
      delivery = destination.deliveries.sole
      path = repository_analytics_destination_path(@repository.route_id, destination)
      changed = custom_configuration.except(:history, :provider)
      changed[:secrets] = [ { name: "api_token", value: "Bearer rotated" } ]
      patch path, params: { destination: changed.merge(keep_pending: "1") }
      assert_response :see_other
      assert_equal 2, delivery.reload.destination_revision
      assert_equal "pending", delivery.state
      assert_equal "Bearer rotated", destination.reload.credentials["api_token"]

      changed[:endpoint] = "https://new.example.com/collect?version=1"
      patch path, params: { destination: changed.merge(keep_pending: "1") }
      assert_response :see_other
      assert_equal 2, destination.reload.revision
      assert_equal "pending", delivery.reload.state
      follow_redirect!
      assert_includes response.body, "Could not save the custom destination"

      patch path, params: { destination: changed }
      assert_response :see_other
      assert_equal "canceled", delivery.reload.state
      assert_equal 3, destination.reload.revision
    end
  end

  test "forged retention cannot forward pending events after a routing header changes" do
    with_public_dns do
      original = custom_configuration.merge(
        headers: '{"Authorization":{"$secret":"api_token"},"X-Token-Tenant":"recipient-one"}'
      )
      post @destinations_path, params: { destination: original }
      destination = @repository.analytics_destinations.sole
      prototypes.create(repository: @repository).register!(name: "Welcome")
      delivery = destination.deliveries.sole
      path = repository_analytics_destination_path(@repository.route_id, destination)
      changed = original.except(:history, :provider).merge(
        headers: '{"Authorization":{"$secret":"api_token"},"X-Token-Tenant":"recipient-two"}',
        secrets: [ { name: "api_token", value: "Bearer rotated" } ]
      )
      patch path, params: { destination: changed.merge(keep_pending: "1") }
      assert_response :see_other
      assert_equal 1, destination.reload.revision
      assert_equal "pending", delivery.reload.state
      follow_redirect!
      assert_includes response.body, "Could not save the custom destination"

      patch path, params: { destination: changed }
      assert_response :see_other
      assert_equal 2, destination.reload.revision
      assert_equal "canceled", delivery.reload.state
    end
  end

  test "custom endpoint and secret validation never reflect submitted private values" do
    with_public_dns do
      [
        custom_configuration.merge(endpoint: "https://example.com/collect?api_key=private-value"),
        custom_configuration.merge(headers: '{"Host":"private-value"}'),
        custom_configuration.merge(template: '{"body":{"$field":"review_text"}}')
      ].each do |bad|
        assert_no_difference("Analytics::Destination.count") do
          post @destinations_path, params: { destination: bad }
        end
        follow_redirect!
        assert_includes response.body, "Could not save the custom destination"
        assert_not_includes response.body, "private-value"
        assert_not_includes response.body, "Bearer private"
      end
    end
  end

  test "custom failure details show only a sanitized category" do
    with_public_dns do
      post @destinations_path, params: { destination: custom_configuration }
    end
    prototype = prototypes.create(repository: @repository)
    prototype.register!(name: "Welcome")
    delivery = @repository.analytics_destinations.sole.deliveries.sole
    delivery.update!(state: "failed", failure_code: "response_mismatch")
    get @path, headers: { "Accept" => "application/json" }
    card = JSON.parse(response.body).fetch("data").fetch("destinations").sole
    assert_equal I18n.t("analytics.failures.response_mismatch"), card.fetch("failureDetail")
    assert_not_includes response.body, "Bearer private"
    assert_not_includes response.body, "safe-static-value"
  end

  test "loads delivery failures for every destination in a constant number of queries" do
    with_public_dns do
      4.times do |index|
        post @destinations_path, params: {
          destination: custom_configuration.merge(name: "Recipient #{index}")
        }
        assert_response :see_other
      end
    end
    prototypes.create(repository: @repository).register!(name: "Welcome")
    destinations = @repository.analytics_destinations.order(:id).to_a
    destinations.each do |destination|
      destination.deliveries.sole.update!(state: "failed", failure_code: "http_401")
    end
    prototypes.create(repository: @repository, branch_name: "prototype/next").register!(name: "Next")
    destinations.first.deliveries.order(:id).last.update!(state: "failed", failure_code: "response_mismatch")

    queries = []
    subscriber = ActiveSupport::Notifications.subscribe("sql.active_record") do |event|
      queries << event.payload[:sql] if event.payload[:sql].include?("analytics_deliveries")
    end
    get @path, headers: { "Accept" => "application/json" }
    assert_response :success
    cards = JSON.parse(response.body).fetch("data").fetch("destinations")
    assert_equal 4, cards.size
    assert cards.all? { _1.fetch("deliveryFailed") }
    first_card = cards.find { _1.fetch("id") == destinations.first.id.to_s }
    assert_equal I18n.t("analytics.failures.response_mismatch"), first_card.fetch("failureDetail")
    assert_equal 2, queries.size
  ensure
    ActiveSupport::Notifications.unsubscribe(subscriber) if subscriber
  end

  private

  def custom_configuration
    {
      provider: "custom", name: "Data lake",
      endpoint: "https://example.com/collect?version=1",
      headers: '{"Authorization":{"$secret":"api_token"},"X-Channel":"safe-static-value"}',
      template: '{"event":{"$field":"event_name"},"id":{"$field":"event_id"}}',
      secrets: [ { name: "api_token", value: "Bearer private" } ],
      success_pointer: "", success_value: "", history: "new",
      event_types: Analytics::Event::TYPES
    }
  end

  def with_public_dns
    original = Analytics::CustomEndpoint.method(:resolve)
    Analytics::CustomEndpoint.define_singleton_method(:resolve) { |_| [ Addrinfo.tcp("8.8.8.8", 443) ] }
    yield
  ensure
    Analytics::CustomEndpoint.define_singleton_method(:resolve, original)
  end

  def configuration
    {
      provider: "segment", region: "us", history: "new",
      credentials: { write_key: "initial-secret" },
      event_types: Analytics::Event::TYPES
    }
  end
end
