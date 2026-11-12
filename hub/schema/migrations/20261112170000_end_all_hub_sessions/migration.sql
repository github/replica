ALTER TYPE "SensitiveAuthorizationOperation" ADD VALUE 'END_ALL_HUB_SESSIONS';

ALTER TABLE "sensitive_authorizations"
  DROP CONSTRAINT "sensitive_authorizations_targets_check";

ALTER TABLE "sensitive_authorizations"
  ADD CONSTRAINT "sensitive_authorizations_targets_check" CHECK (
    (
      "operation" = 'END_ALL_HUB_SESSIONS'
      AND cardinality("target_membership_ids") = 0
    )
    OR (
      "operation" = 'DESIGNATE_ADMINISTRATORS'
      AND cardinality("target_membership_ids") BETWEEN 1 AND 50
    )
    OR (
      "operation" = 'REVOKE_ADMINISTRATOR'
      AND cardinality("target_membership_ids") = 1
    )
  );
