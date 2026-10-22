# Retains only known browser operations, never an arbitrary request or OAuth credential.
class FreshAuthorization::Continuation < ActiveRecord::AssociatedObject
  LIMIT = 128.kilobytes
  OPERATIONS = {
    "hub_admins" => { "create" => "hub_admin_management", "update" => "hub_admin_management" },
    "analytics_destinations" => {
      "create" => "analytics_destination", "update" => "analytics_destination",
      "destroy" => "analytics_destination"
    },
    "sharing_settings" => { "update" => "sharing_settings" },
    "session_revocations" => { "create" => "session_revocation" },
    "github_apps" => { "destroy" => "github_app_reset" },
    "github_app_credentials" => { "update" => "github_app_credentials" },
    "github_app_webhook_rotations" => {
      "create" => "github_app_webhook", "destroy" => "github_app_finish_webhook"
    },
    "copilot_connections" => {
      "create" => "copilot_connection", "destroy" => "copilot_disconnection"
    }
  }.freeze

  class Invalid < StandardError; end

  # Saves a bounded selection of fields; files become encrypted contents, not paths.
  def self.capture(request, params, purpose:)
    controller, action = request.path_parameters.values_at(:controller, :action)
    return if purpose.to_s == "never_expiring_share"

    raise Invalid if OPERATIONS.dig(controller, action) != purpose.to_s ||
      !request.path.match?(%r{\A/(?!/)[^\x00-\x20\\]*\z})

    fields = case controller
    when "hub_admins" then [ :confirmed, :operation, { user_ids: [] } ]
    when "analytics_destinations"
      [ :operation, { destination: [
        :provider, :region, :history, :name, :endpoint, :template, :headers,
        :success_pointer, :success_value, :keep_pending,
        { event_types: [], credentials: %i[write_key service_account_username service_account_secret project_id],
          secrets: %i[name value] }
      ] } ]
    when "github_app_credentials" then %i[confirmed configuration_id expected_version client_secret]
    when "github_apps" then %i[confirmed configuration_id expected_version confirmation]
    when "github_app_webhook_rotations" then %i[confirmed configuration_id expected_version operation]
    else %i[confirmed operation]
    end
    attributes = params.permit(*fields).to_h
    if controller == "github_app_credentials"
      upload = params[:private_key]
      limit = GithubAppConfiguration::Administration::PRIVATE_KEY_LIMIT
      raise Invalid if !upload.is_a?(ActionDispatch::Http::UploadedFile) || upload.size > limit

      contents = upload.read(limit + 1)
      upload.rewind
      raise Invalid if contents.bytesize > limit || !contents.dup.force_encoding(Encoding::UTF_8).valid_encoding?

      attributes["private_key"] = contents.force_encoding(Encoding::UTF_8)
    end
    payload = {
      "controller" => controller, "action" => action, "path" => request.path,
      "method" => request.request_method.downcase, "parameters" => attributes
    }
    raise Invalid if payload.to_json.bytesize > LIMIT

    payload
  end

  # Only the original live browser can continue a verified, unexpired operation.
  def available_to?(browser_session)
    record.pending_action.present? && record.verified_at.present? && record.continued_at.nil? &&
      record.expires_at > Time.current && record.credential_type == "Session" &&
      browser_session&.id == record.credential_id &&
      browser_session.user.github_id == record.github_id && FreshAuthorization.fresh?(browser_session)
  end

  # Claims one attempt before returning fields to the normal controller and its guards.
  def claim!(request, browser_session:)
    attributes = nil
    record.with_lock do
      payload = record.pending_action
      controller, action = request.path_parameters.values_at(:controller, :action)
      raise Invalid if record.credential_type != "Session" || browser_session&.id != record.credential_id

      if !available_to?(browser_session)
        record.update!(pending_action: nil)
        next
      end
      raise Invalid if
        OPERATIONS.dig(controller, action) != record.purpose ||
        payload.values_at("controller", "action", "path", "method") !=
          [ controller, action, request.path, request.request_method.downcase ]

      record.update!(continued_at: Time.current, pending_action: nil)
      attributes = payload.fetch("parameters")
    end
    raise Invalid if attributes.nil?

    attributes
  end

  # Drops secrets as soon as verification fails or the person cancels.
  def discard!
    record.update!(pending_action: nil) if record.persisted?
  end
end
