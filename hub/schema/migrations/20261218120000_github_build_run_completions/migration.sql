-- CreateTable
CREATE TABLE "github_build_run_completions" (
    "id" UUID NOT NULL,
    "build_id" UUID NOT NULL,
    "github_workflow_run_id" BIGINT NOT NULL,
    "run_attempt" INTEGER NOT NULL,
    "completed_at" TIMESTAMPTZ(3) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "github_build_run_completions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "github_build_run_completions_build_id_github_workflow_run_i_key" ON "github_build_run_completions"("build_id", "github_workflow_run_id");

-- AddForeignKey
ALTER TABLE "github_build_run_completions" ADD CONSTRAINT "github_build_run_completions_build_id_fkey" FOREIGN KEY ("build_id") REFERENCES "builds"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
