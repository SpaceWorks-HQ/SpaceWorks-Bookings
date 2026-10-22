-- CreateEnum
CREATE TYPE "LedgerDirection" AS ENUM ('RECEIPT', 'PAYMENT');

-- CreateTable
CREATE TABLE "LedgerEntry" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "direction" "LedgerDirection" NOT NULL,
    "occurredOn" DATE NOT NULL,
    "category" TEXT NOT NULL,
    "party" TEXT NOT NULL DEFAULT '',
    "description" TEXT NOT NULL DEFAULT '',
    "currency" TEXT NOT NULL,
    "amountMinor" INTEGER NOT NULL,
    "method" TEXT NOT NULL,
    "reference" TEXT,
    "recordedById" TEXT,
    "voidedAt" TIMESTAMP(3),
    "voidedById" TEXT,
    "voidReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LedgerEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OpeningBalance" (
    "organisationId" TEXT NOT NULL,
    "financialYear" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "cashMinor" INTEGER NOT NULL DEFAULT 0,
    "bankMinor" INTEGER NOT NULL DEFAULT 0,
    "updatedById" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OpeningBalance_pkey" PRIMARY KEY ("organisationId","financialYear","currency")
);

-- CreateIndex
CREATE INDEX "LedgerEntry_organisationId_occurredOn_idx" ON "LedgerEntry"("organisationId", "occurredOn");

-- CreateIndex
CREATE UNIQUE INDEX "LedgerEntry_organisationId_id_key" ON "LedgerEntry"("organisationId", "id");

-- AddForeignKey
ALTER TABLE "LedgerEntry" ADD CONSTRAINT "LedgerEntry_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OpeningBalance" ADD CONSTRAINT "OpeningBalance_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- ── Hand-written constraints (accounts) ────────────────────────────────────

ALTER TABLE "LedgerEntry"
  ADD CONSTRAINT "LedgerEntry_amount_positive" CHECK ("amountMinor" > 0),
  ADD CONSTRAINT "LedgerEntry_currency_format" CHECK ("currency" ~ '^[A-Z]{3}$'),
  ADD CONSTRAINT "LedgerEntry_method" CHECK ("method" IN ('cash', 'bank_transfer', 'upi', 'cheque', 'card', 'other')),
  ADD CONSTRAINT "LedgerEntry_category_present" CHECK (char_length("category") BETWEEN 1 AND 60),
  ADD CONSTRAINT "LedgerEntry_void_complete" CHECK (("voidedAt" IS NULL) = ("voidReason" IS NULL));

ALTER TABLE "OpeningBalance"
  ADD CONSTRAINT "OpeningBalance_currency_format" CHECK ("currency" ~ '^[A-Z]{3}$'),
  ADD CONSTRAINT "OpeningBalance_fy_format" CHECK ("financialYear" ~ '^[0-9]{4}(-[0-9]{2})?$');

-- Ledger entries are the organisation's books: never deleted, and once written only voided (once).
CREATE FUNCTION ledger_entry_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Ledger entries are never deleted; void them instead' USING ERRCODE = 'check_violation';
  END IF;
  IF OLD."voidedAt" IS NOT NULL
    OR NEW."organisationId" IS DISTINCT FROM OLD."organisationId"
    OR NEW."direction" IS DISTINCT FROM OLD."direction"
    OR NEW."occurredOn" IS DISTINCT FROM OLD."occurredOn"
    OR NEW."category" IS DISTINCT FROM OLD."category"
    OR NEW."party" IS DISTINCT FROM OLD."party"
    OR NEW."description" IS DISTINCT FROM OLD."description"
    OR NEW."currency" IS DISTINCT FROM OLD."currency"
    OR NEW."amountMinor" IS DISTINCT FROM OLD."amountMinor"
    OR NEW."method" IS DISTINCT FROM OLD."method"
    OR NEW."reference" IS DISTINCT FROM OLD."reference"
    OR NEW."recordedById" IS DISTINCT FROM OLD."recordedById"
    OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt"
  THEN
    RAISE EXCEPTION 'A ledger entry can only be voided' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER "LedgerEntry_guard" BEFORE UPDATE OR DELETE ON "LedgerEntry" FOR EACH ROW EXECUTE FUNCTION ledger_entry_guard();
