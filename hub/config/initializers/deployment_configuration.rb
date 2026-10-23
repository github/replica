require Rails.root.join("app/models/preview_origin")
require Rails.root.join("app/models/share_preview_origin")
require Rails.root.join("lib/analytics_outbound_hosts")
require Rails.root.join("lib/share_link_lifetime")
require Rails.root.join("lib/private_storage_root")

Rails.configuration.x.analytics_outbound_hosts = AnalyticsOutboundHosts.parse(
  ENV["REPLICA_ANALYTICS_OUTBOUND_HOSTS"]
)
Rails.configuration.x.share_link_maximum_lifetime = ShareLinkLifetime.parse(
  ENV["REPLICA_SHARE_LINK_MAX_DAYS"]
)

Rails.application.config.after_initialize do
  next if ENV["SECRET_KEY_BASE_DUMMY"].present?

  # Prepare the schema before shortening stored deadlines.
  maintenance = defined?(Rake.application) && Rake.application.top_level_tasks.any? do |task|
    task.start_with?("db:")
  end
  next if maintenance

  ShareLink.enforce_maximum_lifetime!
end

if ENV["REPLICA_LOCAL_MODE"] == "1" && !Rails.env.development?
  raise "REPLICA_LOCAL_MODE is available only in development"
end

if !%w[token_owner organization].include?(Rails.configuration.x.copilot_billing)
  raise \
    "REPLICA_COPILOT_BILLING must be token_owner or organization: #{Rails.configuration.x.copilot_billing.inspect}"
end

azure_uuid_format = /\A[0-9a-fA-F]{8}-(?:[0-9a-fA-F]{4}-){3}[0-9a-fA-F]{12}\z/
build_action_format = \
  %r{\A[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+(?:/[A-Za-z0-9_.-]+)*@[0-9a-fA-F]{40}\z}

if ENV["SECRET_KEY_BASE_DUMMY"].blank?
  front_door_id = ENV["REPLICA_AZURE_FRONT_DOOR_ID"]
  if front_door_id.present? && !front_door_id.match?(azure_uuid_format)
    raise "REPLICA_AZURE_FRONT_DOOR_ID must be a UUID"
  end

  begin
    origin = URI(Rails.configuration.x.hub_origin)
  rescue URI::InvalidURIError
    raise \
      "REPLICA_HUB_ORIGIN must be an absolute #{Rails.env.production? ? "HTTPS" : "HTTP or HTTPS"} origin"
  end
  valid_schemes = Rails.env.production? ? %w[https] : %w[http https]
  if !valid_schemes.include?(origin.scheme) || origin.host.blank? || origin.userinfo.present? ||
      origin.query.present? || origin.fragment.present?
    raise \
      "REPLICA_HUB_ORIGIN must be an absolute #{Rails.env.production? ? "HTTPS" : "HTTP or HTTPS"} " \
        "origin without credentials, a query, or a fragment"
  end

  if ENV["REPLICA_LOCAL_MODE"] == "1"
    loopback_host = origin.host == "localhost" || origin.host.end_with?(".localhost") ||
      %w[127.0.0.1 ::1].include?(origin.host)
    raise "REPLICA_LOCAL_MODE requires a localhost REPLICA_HUB_ORIGIN" if !loopback_host
  end

  raise "REPLICA_HUB_ORIGIN must not contain a path" if origin.path.present? && origin.path != "/"

  preview_origins = {
    "REPLICA_PREVIEW_ORIGIN_TEMPLATE" => PreviewOrigin.current,
    "REPLICA_SHARE_PREVIEW_ORIGIN_TEMPLATE" => SharePreviewOrigin.current
  }
  preview_origins.each do |name, preview_origin|
    raise "#{name} must use HTTPS in production" if Rails.env.production? && preview_origin.scheme != "https"
    raise "REPLICA_HUB_ORIGIN must not use a host matched by #{name}" if preview_origin.build_id(origin.host)
    if !preview_origin.same_site_with?(Rails.configuration.x.hub_origin)
      raise "#{name} must use the same scheme and a subdomain of REPLICA_HUB_ORIGIN"
    end
  end
  if PreviewOrigin.current.host_for(1) == SharePreviewOrigin.current.host_for(1)
    raise \
      "REPLICA_PREVIEW_ORIGIN_TEMPLATE and REPLICA_SHARE_PREVIEW_ORIGIN_TEMPLATE " \
        "must use different hosts"
  end

  build_action = Rails.configuration.x.build_action
  if build_action.present? && !build_action.match?(build_action_format)
    raise \
      "REPLICA_BUILD_ACTION must name an action pinned to a 40-character commit SHA"
  end
end

PrivateStorageRoot.validate! \
  Rails.configuration.x.learning_root,
  name: "REPLICA_LEARNING_ROOT",
  application_root: Rails.root,
  public_root: Rails.public_path

case Rails.configuration.x.artifact_store
when "local"
  PrivateStorageRoot.validate! \
    Rails.configuration.x.artifact_root,
    name: "REPLICA_ARTIFACT_ROOT",
    application_root: Rails.root,
    public_root: Rails.public_path
when "azure"
  account = Rails.configuration.x.azure_storage_account
  container = Rails.configuration.x.azure_storage_container

  # Azure storage account naming rules:
  # https://learn.microsoft.com/azure/azure-resource-manager/management/resource-name-rules#microsoftstorage
  if !account.to_s.match?(/\A[a-z0-9]{3,24}\z/)
    raise "REPLICA_AZURE_STORAGE_ACCOUNT must contain 3 to 24 lowercase letters or numbers"
  end

  # Azure Blob container naming rules:
  # https://learn.microsoft.com/rest/api/storageservices/naming-and-referencing-containers--blobs--and-metadata#container-names
  if !container.to_s.match?(/\A[a-z0-9](?!.*--)[a-z0-9-]{1,61}[a-z0-9]\z/)
    raise \
      "REPLICA_AZURE_STORAGE_CONTAINER must contain 3 to 63 lowercase letters, numbers, or single dashes"
  end

  client_id = Rails.configuration.x.azure_managed_identity_client_id

  # Azure managed identity client ID reference:
  # https://learn.microsoft.com/azure/container-apps/managed-identity#rest-endpoint-reference
  if client_id.present? && !client_id.match?(azure_uuid_format)
    raise "REPLICA_AZURE_MANAGED_IDENTITY_CLIENT_ID must be a UUID"
  end
else
  raise \
    "REPLICA_ARTIFACT_STORE must be local or azure: #{Rails.configuration.x.artifact_store.inspect}"
end
