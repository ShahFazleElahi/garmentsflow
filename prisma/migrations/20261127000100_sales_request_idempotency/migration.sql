CREATE TABLE "SalesRequest" (
    "key" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "resourceId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SalesRequest_pkey" PRIMARY KEY ("key")
);

CREATE INDEX "SalesRequest_action_idx"
ON "SalesRequest"("action");
