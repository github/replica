require "test_helper"
require "tempfile"

class FreshAuthorization::ContinuationTest < ActiveSupport::TestCase
  test "capture accepts exactly 128 KiB of serialized JSON and rejects one additional byte" do
    request = action_request \
      "/repositories/2001/analytics/destinations", controller: "analytics_destinations", action: "create"
    parameters = ActionController::Parameters.new(destination: { template: "" })
    empty = FreshAuthorization::Continuation.capture(request, parameters, purpose: "analytics_destination")
    content = "é" + "a" * (128.kilobytes - empty.to_json.bytesize - "é".bytesize)
    parameters[:destination][:template] = content

    payload = FreshAuthorization::Continuation.capture(request, parameters, purpose: "analytics_destination")

    assert_equal 128.kilobytes, payload.to_json.bytesize
    assert_equal content, payload.fetch("parameters").fetch("destination").fetch("template")
    parameters[:destination][:template] += "a"
    assert_raises(FreshAuthorization::Continuation::Invalid) do
      FreshAuthorization::Continuation.capture(request, parameters, purpose: "analytics_destination")
    end
  end

  test "credential capture accepts a 16 KiB upload but rejects an additional byte" do
    request = action_request "/github_app/credentials", controller: "github_app_credentials", action: "update"
    contents = "a" * 16.kilobytes
    with_upload(contents) do |upload|
      payload = FreshAuthorization::Continuation.capture \
        request, ActionController::Parameters.new(private_key: upload), purpose: "github_app_credentials"

      assert_equal contents, payload.fetch("parameters").fetch("private_key")
    end
    with_upload(contents + "a") do |upload|
      assert_raises(FreshAuthorization::Continuation::Invalid) do
        FreshAuthorization::Continuation.capture \
          request, ActionController::Parameters.new(private_key: upload), purpose: "github_app_credentials"
      end
    end
  end

  test "credential capture rejects missing uploads and invalid UTF-8 contents" do
    request = action_request "/github_app/credentials", controller: "github_app_credentials", action: "update"
    assert_raises(FreshAuthorization::Continuation::Invalid) do
      FreshAuthorization::Continuation.capture \
        request, ActionController::Parameters.new, purpose: "github_app_credentials"
    end
    with_upload("\xFF".b) do |upload|
      assert_raises(FreshAuthorization::Continuation::Invalid) do
        FreshAuthorization::Continuation.capture \
          request, ActionController::Parameters.new(private_key: upload), purpose: "github_app_credentials"
      end
    end
  end

  test "capture rejects unsafe request paths and unapproved controller action or purpose combinations" do
    parameters = ActionController::Parameters.new(operation: "enable", confirmed: "1")
    [ "//elsewhere.example/sharing_settings", "/\\elsewhere.example/sharing_settings" ].each do |path|
      request = action_request path, controller: "sharing_settings", action: "update"
      assert_raises(FreshAuthorization::Continuation::Invalid) do
        FreshAuthorization::Continuation.capture(request, parameters, purpose: "sharing_settings")
      end
    end
    [
      [ "unapproved_controller", "update", "sharing_settings" ],
      [ "sharing_settings", "destroy", "sharing_settings" ],
      [ "sharing_settings", "update", "analytics_destination" ],
      [ "sharing_settings", "update", "unapproved_purpose" ]
    ].each do |controller, action, purpose|
      request = action_request "/sharing_settings", controller: controller, action: action
      assert_raises(FreshAuthorization::Continuation::Invalid) do
        FreshAuthorization::Continuation.capture(request, parameters, purpose:)
      end
    end
  end

  test "legacy never-expiring sharing retains its verification-only behavior" do
    request = action_request \
      "/repositories/2001/prototypes/1/share_links", controller: "share_links", action: "create"
    parameters = ActionController::Parameters.new(share_link: { expiration: "never" })

    assert_nil FreshAuthorization::Continuation.capture(request, parameters, purpose: "never_expiring_share")
  end

  private

  def action_request(path, controller:, action:)
    environment = Rack::MockRequest.env_for("/", method: "POST")
    environment["PATH_INFO"] = path
    ActionDispatch::Request.new(environment).tap do |request|
      request.path_parameters = { controller:, action: }
    end
  end

  def with_upload(contents)
    Tempfile.create([ "authorization-key", ".pem" ], Rails.root.join("storage")) do |file|
      file.binmode
      file.write(contents)
      file.rewind
      yield ActionDispatch::Http::UploadedFile.new \
        tempfile: file, filename: "private-key.pem", type: "application/x-pem-file"
    end
  end
end
