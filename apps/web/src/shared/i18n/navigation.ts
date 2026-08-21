import { createNavigation } from 'next-intl/navigation';
import { routing } from './routing';

/** Локале-осведомлённые обёртки: Link сам подставляет текущий языковой префикс. */
export const { Link, redirect, usePathname, useRouter, getPathname } = createNavigation(routing);
