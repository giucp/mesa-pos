-- Store payment operation IDs as data, rather than searching free-form notes.
-- The compound uniqueness prevents one interrupted operation from charging a
-- check twice while allowing independent checks to use their own operation ID.
ALTER TABLE "Payment" ADD COLUMN "clientOpId" TEXT;

CREATE UNIQUE INDEX "Payment_checkId_clientOpId_key"
ON "Payment"("checkId", "clientOpId");
