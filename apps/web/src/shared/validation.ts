import type { ZodError, ZodType } from 'zod';

/** Ключ поля формы → ключ строки в словаре `auth`. */
export type FieldErrors = Record<string, string>;

/**
 * Переводит issue от zod в ключ словаря. Сообщения самого zod не показываем:
 * они на английском и не переводятся, а нам нужны все языки интерфейса.
 */
function messageKeyFor(field: string, code: string): string {
  switch (field) {
    case 'email':
      return 'validationEmail';
    case 'password':
      return 'validationPasswordShort';
    case 'nickname':
      return code === 'invalid_format' ? 'validationNicknameChars' : 'validationNicknameLength';
    case 'birthYear':
      // Верхняя граница года = «моложе 18», нижняя — заведомая опечатка.
      return code === 'too_big' ? 'validationBirthYearTooYoung' : 'validationBirthYearInvalid';
    case 'name':
      return 'validationNameLong';
    default:
      return 'validationInvalid';
  }
}

function toFieldErrors(error: ZodError): FieldErrors {
  const result: FieldErrors = {};
  for (const issue of error.issues) {
    const field = String(issue.path[0] ?? '');
    // Первая ошибка по полю важнее последующих: показываем одну, а не список.
    if (field && !result[field]) {
      result[field] = messageKeyFor(field, issue.code);
    }
  }
  return result;
}

/**
 * Проверяет ввод той же схемой, что и бэкенд. Смысл не в том, чтобы заменить
 * серверную валидацию (её обойти нельзя), а в том, чтобы пользователь увидел
 * причину сразу и под нужным полем, а не общее «не удалось» после запроса.
 */
/** Тот же разбор, но для ошибок, пришедших от сервера. */
export function fieldErrorsFromIssues(issues: { field?: string; code?: string }[]): FieldErrors {
  const result: FieldErrors = {};
  for (const issue of issues) {
    if (issue.field && !result[issue.field]) {
      result[issue.field] = messageKeyFor(issue.field, issue.code ?? '');
    }
  }
  return result;
}

export function validate<T>(
  schema: ZodType<T>,
  input: unknown,
): { ok: true; data: T } | { ok: false; errors: FieldErrors } {
  const parsed = schema.safeParse(input);
  return parsed.success
    ? { ok: true, data: parsed.data }
    : { ok: false, errors: toFieldErrors(parsed.error) };
}
