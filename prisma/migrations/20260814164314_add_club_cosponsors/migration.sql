-- CreateTable
CREATE TABLE "_ClubCosponsor" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_ClubCosponsor_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateIndex
CREATE INDEX "_ClubCosponsor_B_index" ON "_ClubCosponsor"("B");

-- AddForeignKey
ALTER TABLE "_ClubCosponsor" ADD CONSTRAINT "_ClubCosponsor_A_fkey" FOREIGN KEY ("A") REFERENCES "Club"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_ClubCosponsor" ADD CONSTRAINT "_ClubCosponsor_B_fkey" FOREIGN KEY ("B") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
