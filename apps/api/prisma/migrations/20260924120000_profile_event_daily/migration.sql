-- Суточные счётчики событий анкеты: быстрый обзор рекламодателей за 90 дней
-- и «всё время» без обхода сырого журнала.

-- CreateTable
CREATE TABLE "ProfileEventDaily" (
    "profileId" TEXT NOT NULL,
    "day" DATE NOT NULL,
    "kind" "ProfileEventKind" NOT NULL,
    "registered" INTEGER NOT NULL DEFAULT 0,
    "anonymous" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "ProfileEventDaily_pkey" PRIMARY KEY ("profileId","day","kind")
);

-- CreateIndex
CREATE INDEX "ProfileEventDaily_day_idx" ON "ProfileEventDaily"("day");

-- AddForeignKey
ALTER TABLE "ProfileEventDaily" ADD CONSTRAINT "ProfileEventDaily_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "Profile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
