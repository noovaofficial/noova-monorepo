-- ТОП анкет: агентствам он доступен только там, где страна это разрешила.
-- По умолчанию выключено — индивидуалки и салоны покупают как раньше.
-- Уже купленные агентствами места не трогаем: они доживают свой срок.
ALTER TABLE "CountryTopSetting" ADD COLUMN "agencyProfilesAllowed" BOOLEAN NOT NULL DEFAULT false;
