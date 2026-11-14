CREATE TABLE "prototype_introductions" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "prototype_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "prototype_introductions_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "prototype_introductions_prototype_id_idx" ON "prototype_introductions"("prototype_id");

CREATE UNIQUE INDEX "prototype_introductions_user_id_prototype_id_key" ON "prototype_introductions"("user_id", "prototype_id");

ALTER TABLE "prototype_introductions" ADD CONSTRAINT "prototype_introductions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "prototype_introductions" ADD CONSTRAINT "prototype_introductions_prototype_id_fkey" FOREIGN KEY ("prototype_id") REFERENCES "prototypes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
