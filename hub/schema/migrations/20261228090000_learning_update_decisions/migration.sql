-- AlterTable
ALTER TABLE "learning_decision_operations" ADD COLUMN     "proposal_id" VARCHAR(255);

ALTER TABLE "learning_decision_operations"
DROP CONSTRAINT "learning_decision_operations_decision_check";

ALTER TABLE "learning_decision_operations"
ADD CONSTRAINT "learning_decision_operations_decision_check"
CHECK ("decision" IN ('accept', 'reject', 'retire', 'edit', 'reinstate', 'apply_update', 'dismiss_update'));
