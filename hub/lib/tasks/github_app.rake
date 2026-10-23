namespace :replica do
  namespace :github do
    desc "Report GitHub App configuration health without printing secrets"
    task diagnose: :environment do
      configuration = GithubAppConfiguration.current
      if configuration.nil?
        secret_ready = ENV.fetch("REPLICA_BOOTSTRAP_SECRET", "").present?
        puts "Configuration: not configured"
        puts "Bootstrap: #{secret_ready ? "ready" : "missing"}"
        next
      end

      result = configuration.diagnostics.call
      puts "Configuration: #{result.configuration}"
      puts "GitHub App: #{result.app}"
      puts "Installation: #{result.installation}"
    rescue GithubClient::Error
      abort "GitHub diagnostics failed. Check the configured App and installation."
    end

    desc "Synchronize repositories and discover current prototype branches now"
    task poll: :environment do
      configuration = GithubAppConfiguration.current
      abort "GitHub App: not configured" if configuration.nil?

      configuration.discover_builds!
      puts "Repositories synchronized: #{Repository.active.count} active"
      puts "Builds discovered: #{Build.count} total"
    rescue GithubClient::Error,
      GithubAppConfiguration::Installation::OwnerMismatch,
      GithubAppConfiguration::Superseded, ActiveRecord::StaleObjectError
      abort "GitHub polling failed. Check the current App and installation."
    end

    desc "Emergency same-App credential repair from protected host files"
    task recover_credentials: :environment do
      Current.set(session: nil, canvas_grant: nil, security_audit_context: { source: "command" }) do
        configuration = GithubAppConfiguration.current
        raise GithubAppConfiguration::Administration::Denied, :not_configured if configuration.nil?

        configuration.recovery.call! \
          confirmation: ENV["REPLICA_CONFIRM_APP_RECOVERY"],
          client_secret_path: ENV["REPLICA_GITHUB_CLIENT_SECRET_FILE"],
          private_key_path: ENV["REPLICA_GITHUB_PRIVATE_KEY_FILE"]
        puts "Same-App credentials saved. Verify GitHub sign-in before retiring old credentials."
      rescue GithubAppConfiguration::Administration::Denied
        context = configuration ? { github_app_configuration_id: configuration.id } : {}
        SecurityAuditEvent.record! \
          action: "github_app.recover_credentials", outcome: "denied", actor: nil, context: context

        abort "Recovery denied. Check the existing App, exact confirmation, and operation status."
      rescue GithubAppConfiguration::Administration::InvalidCredentials,
        GithubAppConfiguration::Rotator::IdentityMismatch, GithubClient::Error,
        ActiveRecord::RecordNotFound, ActiveRecord::StaleObjectError,
        GithubAppConfiguration::Superseded
        SecurityAuditEvent.record! \
          action: "github_app.recover_credentials", outcome: "failed", actor: nil,
          context: { github_app_configuration_id: configuration.id }

        abort "Recovery failed. Check protected replacement files and same-App GitHub credentials."
      rescue ActiveRecord::RecordInvalid => error
        raise error if error.record.is_a?(SecurityAuditEvent)

        SecurityAuditEvent.record! \
          action: "github_app.recover_credentials", outcome: "failed", actor: nil,
          context: { github_app_configuration_id: configuration.id }

        abort "Recovery failed. Local credentials were not replaced."
      end
    end
  end
end
