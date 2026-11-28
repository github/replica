# == Schema Information
#
# Table name: session_revocations
# Database name: primary
#
#  id            :integer          not null, primary key
#  ended_at      :datetime
#  generation    :bigint           default(0), not null
#  singleton_key :integer          default(1), not null
#  created_at    :datetime         not null
#  updated_at    :datetime         not null
#
# Indexes
#
#  index_session_revocations_on_singleton_key  (singleton_key) UNIQUE
#
# Check Constraints
#
#  session_revocations_generation  (generation >= 0)
#  session_revocations_singleton   (singleton_key = 1)
#
# Stores the deployment cutoff so late OAuth callbacks cannot create new Sessions.
class SessionRevocation < ApplicationRecord
  class Superseded < StandardError; end

  attr_readonly :singleton_key
  validates :singleton_key, inclusion: { in: [ 1 ] }
  validates :generation, numericality: { only_integer: true, greater_than_or_equal_to: 0 }

  # Reads the persisted cutoff even during an in-flight request.
  def self.current
    uncached { find_or_create_by!(singleton_key: 1) }
  end

  # Serializes issuance with revocation, including callbacks delayed by GitHub.
  def self.with_generation!(generation)
    transaction do
      raise Superseded if !generation.is_a?(Integer) || current.generation != generation

      yield
    end
  end

  # Ends only authentication records after rereading the actor and same browser proof.
  def self.end_all!(actor:, browser_session:)
    transaction do
      live_actor = User.where(hub_admin: true).where.not(github_id: nil).find_by(id: actor&.id)
      live_session = Session.find_by(id: browser_session&.id, user_id: live_actor&.id)
      raise User::AdminRoleChangeDenied, :not_authorized if live_actor.nil? || live_session.nil?
      raise FreshAuthorization::Invalid if !FreshAuthorization.fresh?(live_session)

      cutoff = current
      sessions = Session.includes(:user).to_a
      canvas_grants = CanvasGrant.where(revoked_at: nil).includes(:user).to_a
      now = Time.current
      cutoff.update!(generation: cutoff.generation + 1, ended_at: now)
      CanvasGrant.where(revoked_at: nil).update_all(revoked_at: now, updated_at: now)
      CanvasPairing.delete_all
      TaskConnection.where(revoked_at: nil).update_all(
        revoked_at: now, device_code_digest: nil, updated_at: now
      )
      TaskConnection.where(approved_at: nil).delete_all
      FreshAuthorization.delete_all
      HubAdminEnrollment.delete_all
      Session.delete_all
      SecurityAuditEvent.record! \
        action: "session_revocation.end_all", outcome: "succeeded", actor: live_actor,
        context: (Current.security_audit_context || {}).merge(session_id: live_session.id)
      { sessions:, canvas_grants: }
    end
  end

  # Targets only old credentials; a new sign-in is not disconnected after the cutoff.
  def self.disconnect!(credentials)
    failure = nil
    (credentials.fetch(:sessions) + credentials.fetch(:canvas_grants)).each do |credential|
      connection = ActionCable.server.remote_connections.where \
        current_user: credential.user, credential_identity: credential.to_gid_param
      connection.disconnect(reconnect: false)
    rescue ActiveRecord::ActiveRecordError, IOError, SystemCallError, Timeout::Error => error
      failure ||= error
    end
    raise failure if failure
  end
end
