-- CreateIndex
CREATE INDEX "review_notifications_recipient_key_read_at_idx" ON "review_notifications"("recipient_key", "read_at");
