ALTER TABLE "learning_decision_operations"
DROP CONSTRAINT "learning_decision_operations_decision_check";

ALTER TABLE "learning_decision_operations"
ADD CONSTRAINT "learning_decision_operations_decision_check"
CHECK ("decision" IN ('accept', 'reject', 'retire', 'edit', 'reinstate'));
