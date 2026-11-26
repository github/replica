# Operators may install a separate server-only adapter without distributing it in Hub.
Rails.application.config.to_prepare do
  path = ENV["REPLICA_NOTIFICATION_PROVIDER_PATH"]
  if path.present?
    raise ArgumentError, "REPLICA_NOTIFICATION_PROVIDER_PATH must be an absolute Ruby file path" if
      !Pathname.new(path).absolute? || !File.file?(path)

    load path
    adapter = NotificationDelivery.provider
    methods = %i[key label eligible? deliver!]
    if adapter.nil? || !methods.all? { adapter.respond_to?(_1) } ||
      !adapter.key.is_a?(String) || !adapter.key.match?(/\A[!-~]{1,255}\z/) ||
      !adapter.label.is_a?(String) || adapter.label.blank? || adapter.label.length > 80
      raise ArgumentError, "The notification adapter must register the documented delivery interface"
    end
  end
end
