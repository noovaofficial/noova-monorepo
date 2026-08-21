-- Параметры внешности: свободные строки заменяются перечислениями.
--
-- Prisma по умолчанию генерирует DROP COLUMN + ADD COLUMN, то есть теряет
-- содержимое. Здесь вместо этого преобразование: известные написания
-- переводятся в значения enum, неопознанные становятся NULL. Поля
-- необязательные, поэтому пустое значение — нормальный исход, а не потеря.

CREATE TYPE "HairColor" AS ENUM ('blonde', 'brunette', 'black', 'red', 'brown', 'other');
CREATE TYPE "EyeColor" AS ENUM ('blue', 'green', 'brown', 'grey', 'hazel');
CREATE TYPE "BreastSize" AS ENUM ('a', 'b', 'c', 'd', 'e', 'f_plus');
CREATE TYPE "AppearanceType" AS ENUM ('european', 'asian', 'latin', 'african', 'arab', 'mixed');

ALTER TABLE "Profile"
  ALTER COLUMN "hairColor" TYPE "HairColor"
  USING (
    CASE lower(trim("hairColor"))
      WHEN 'blonde'    THEN 'blonde'
      WHEN 'blond'     THEN 'blonde'
      WHEN 'блондинка' THEN 'blonde'
      WHEN 'brunette'  THEN 'brunette'
      WHEN 'брюнетка'  THEN 'brunette'
      WHEN 'black'     THEN 'black'
      WHEN 'чёрные'    THEN 'black'
      WHEN 'red'       THEN 'red'
      WHEN 'рыжие'     THEN 'red'
      WHEN 'brown'     THEN 'brown'
      WHEN 'русые'     THEN 'brown'
      ELSE NULL
    END
  )::"HairColor";

ALTER TABLE "Profile"
  ALTER COLUMN "eyeColor" TYPE "EyeColor"
  USING (
    CASE lower(trim("eyeColor"))
      WHEN 'blue'    THEN 'blue'
      WHEN 'голубые' THEN 'blue'
      WHEN 'green'   THEN 'green'
      WHEN 'зелёные' THEN 'green'
      WHEN 'brown'   THEN 'brown'
      WHEN 'карие'   THEN 'brown'
      WHEN 'grey'    THEN 'grey'
      WHEN 'gray'    THEN 'grey'
      WHEN 'серые'   THEN 'grey'
      WHEN 'hazel'   THEN 'hazel'
      ELSE NULL
    END
  )::"EyeColor";

ALTER TABLE "Profile" ADD COLUMN "breastSize" "BreastSize";
ALTER TABLE "Profile" ADD COLUMN "appearanceType" "AppearanceType";
