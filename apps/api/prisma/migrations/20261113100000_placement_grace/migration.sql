-- Льготный срок при переходе размещения «бесплатно → платно».
ALTER TABLE "User" ADD COLUMN "placementGraceEndsAt" TIMESTAMP(3);
