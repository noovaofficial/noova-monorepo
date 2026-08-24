'use client';

import {
  type AdminService,
  type AdminServiceGroup,
  DEFAULT_LOCALE,
  type ListingKind,
  LOCALES,
  type Translated,
} from '@noova/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { Button } from '@/design-system/components/Button';
import { useSession } from '@/modules/auth/components/SessionProvider';
import {
  createGroup,
  createService,
  fetchCatalog,
  ServiceCatalogError,
  updateGroup,
  updateService,
} from '@/modules/service-catalog/api';
import { queryKeys } from '@/shared/query-keys';
import styles from '../ServiceCatalog.module.css';

const KINDS: ListingKind[] = ['escort', 'massage'];

const emptyNames = (): Translated =>
  Object.fromEntries(LOCALES.map((locale) => [locale, ''])) as Translated;

type Runner = <T>(action: () => Promise<T>, after?: () => void) => Promise<T | undefined>;
type Translate = ReturnType<typeof useTranslations<'services'>>;

/** Поля названия на все языки: неполный набор API не примет (N-35). */
function NameFields({
  value,
  onChange,
  idPrefix,
}: {
  value: Translated;
  onChange: (next: Translated) => void;
  idPrefix: string;
}) {
  return (
    <div className={styles.formRow}>
      {LOCALES.map((locale) => (
        <div className={styles.field} key={locale}>
          <label className={styles.label} htmlFor={`${idPrefix}-${locale}`}>
            {locale.toUpperCase()}
          </label>
          <input
            className={styles.input}
            id={`${idPrefix}-${locale}`}
            value={value[locale]}
            onChange={(event) => onChange({ ...value, [locale]: event.target.value })}
            required
          />
        </div>
      ))}
    </div>
  );
}

/** Кому предлагается услуга. Ничего не отмечено — всем видам анкет. */
function KindPicker({
  value,
  onChange,
  idPrefix,
  t,
}: {
  value: ListingKind[];
  onChange: (next: ListingKind[]) => void;
  idPrefix: string;
  t: Translate;
}) {
  return (
    <div className={styles.checks}>
      {KINDS.map((kind) => (
        <label className={styles.check} key={kind} htmlFor={`${idPrefix}-${kind}`}>
          <input
            id={`${idPrefix}-${kind}`}
            type="checkbox"
            checked={value.includes(kind)}
            onChange={(event) =>
              onChange(
                event.target.checked ? [...value, kind] : value.filter((item) => item !== kind),
              )
            }
          />
          {t(kind === 'escort' ? 'kindEscort' : 'kindMassage')}
        </label>
      ))}
      {value.length === 0 ? <span className={styles.hint}>{t('kindAll')}</span> : null}
    </div>
  );
}

export function ServiceManager() {
  const t = useTranslations('services');
  const { user, status } = useSession();
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);

  const isAdmin = user?.role === 'admin';

  const catalog = useQuery({
    queryKey: queryKeys.adminServices(),
    queryFn: fetchCatalog,
    enabled: isAdmin,
  });

  // Мутации возвращают каталог целиком: правка порядка или группы меняет
  // раскладку остальных, и точечное обновление разошлось бы с сервером.
  const run: Runner = (action, after) => {
    setError(null);
    return action()
      .then((result) => {
        queryClient.setQueryData(queryKeys.adminServices(), result);
        after?.();
        return result;
      })
      .catch((cause: unknown) => {
        setError(
          cause instanceof ServiceCatalogError && cause.message ? cause.message : t('failed'),
        );
        return undefined;
      });
  };

  if (status === 'loading') return <p className={styles.empty}>…</p>;
  if (!isAdmin) return <p className={styles.empty}>{t('onlyAdmins')}</p>;

  const groups = catalog.data ?? [];

  return (
    <div className={styles.wrap}>
      <div className={styles.head}>
        <h1 className={styles.title}>{t('title')}</h1>
        <span className={styles.hint}>{t('subtitle')}</span>
      </div>

      {error ? <p className={`${styles.notice} ${styles.noticeError}`}>{error}</p> : null}

      {groups.map((group) => (
        <GroupBlock key={group.key} group={group} groups={groups} run={run} t={t} />
      ))}

      <NewGroupForm run={run} t={t} />
      {groups.length > 0 ? <NewServiceForm groups={groups} run={run} t={t} /> : null}
    </div>
  );
}

function GroupBlock({
  group,
  groups,
  run,
  t,
}: {
  group: AdminServiceGroup;
  groups: AdminServiceGroup[];
  run: Runner;
  t: Translate;
}) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState<Translated>(group.name);

  const save = useMutation({
    mutationFn: () =>
      run(
        () => updateGroup(group.key, { name }),
        () => setEditing(false),
      ),
  });

  return (
    <section className={styles.group}>
      <div className={styles.groupHead}>
        <h2 className={styles.groupTitle}>
          {group.name[DEFAULT_LOCALE]} <span className={styles.groupKey}>· {group.key}</span>
        </h2>
        <Button variant="secondary" onClick={() => setEditing((value) => !value)}>
          {editing ? t('cancel') : t('renameGroup')}
        </Button>
      </div>

      {editing ? (
        <form
          className={styles.form}
          onSubmit={(event) => {
            event.preventDefault();
            save.mutate();
          }}
        >
          <NameFields value={name} onChange={setName} idPrefix={`g-${group.key}`} />
          <div className={styles.actions}>
            <Button type="submit" disabled={save.isPending}>
              {t('save')}
            </Button>
          </div>
        </form>
      ) : null}

      {group.services.length === 0 ? (
        <p className={styles.hint}>{t('groupEmpty')}</p>
      ) : (
        <div className={styles.list}>
          {group.services.map((service) => (
            <ServiceRow key={service.id} service={service} groups={groups} run={run} t={t} />
          ))}
        </div>
      )}
    </section>
  );
}

function ServiceRow({
  service,
  groups,
  run,
  t,
}: {
  service: AdminService;
  groups: AdminServiceGroup[];
  run: Runner;
  t: Translate;
}) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState<Translated>(service.name);
  const [group, setGroup] = useState(service.group);
  const [appliesTo, setAppliesTo] = useState<ListingKind[]>(service.appliesTo);
  const [position, setPosition] = useState(String(service.position));
  const [isActive, setIsActive] = useState(service.isActive);

  const save = useMutation({
    mutationFn: () =>
      run(
        () =>
          updateService(service.id, {
            group,
            name,
            appliesTo,
            position: Number(position),
            isActive,
          }),
        () => setEditing(false),
      ),
  });

  if (!editing) {
    return (
      <div className={`${styles.row} ${service.isActive ? '' : styles.rowOff}`}>
        <div className={styles.rowMain}>
          <span className={styles.rowName}>{service.name[DEFAULT_LOCALE]}</span>
          <span className={styles.rowMeta}>
            {service.key} · {t('positionShort')} {service.position} ·{' '}
            {service.appliesTo.length === 0
              ? t('kindAll')
              : service.appliesTo
                  .map((kind) => t(kind === 'escort' ? 'kindEscort' : 'kindMassage'))
                  .join(', ')}
            {service.profileCount > 0
              ? ` · ${t('inProfiles', { count: service.profileCount })}`
              : ''}
          </span>
        </div>
        <Button variant="secondary" onClick={() => setEditing(true)}>
          {t('edit')}
        </Button>
      </div>
    );
  }

  return (
    <form
      className={styles.form}
      onSubmit={(event) => {
        event.preventDefault();
        save.mutate();
      }}
    >
      <div className={styles.formRow}>
        <div className={styles.field}>
          {/* Ключ не меняется: он лежит в анкетах и в адресах фильтров. */}
          <span className={styles.label}>{t('key')}</span>
          <input className={styles.input} value={service.key} readOnly />
        </div>
        <div className={styles.field}>
          <label className={styles.label} htmlFor={`s-group-${service.id}`}>
            {t('group')}
          </label>
          <select
            className={styles.select}
            id={`s-group-${service.id}`}
            value={group}
            onChange={(event) => setGroup(event.target.value)}
          >
            {groups.map((item) => (
              <option key={item.key} value={item.key}>
                {item.name[DEFAULT_LOCALE]}
              </option>
            ))}
          </select>
        </div>
        <div className={styles.field}>
          <label className={styles.label} htmlFor={`s-pos-${service.id}`}>
            {t('position')}
          </label>
          <input
            className={styles.input}
            id={`s-pos-${service.id}`}
            value={position}
            onChange={(event) => setPosition(event.target.value)}
            required
          />
        </div>
      </div>

      <NameFields value={name} onChange={setName} idPrefix={`s-name-${service.id}`} />
      <KindPicker
        value={appliesTo}
        onChange={setAppliesTo}
        idPrefix={`s-kind-${service.id}`}
        t={t}
      />

      <label className={styles.check} htmlFor={`s-active-${service.id}`}>
        <input
          id={`s-active-${service.id}`}
          type="checkbox"
          checked={isActive}
          onChange={(event) => setIsActive(event.target.checked)}
        />
        {t('active')}
      </label>
      {service.profileCount > 0 ? (
        <p className={styles.hint}>{t('cannotDelete', { count: service.profileCount })}</p>
      ) : null}

      <div className={styles.actions}>
        <Button type="submit" disabled={save.isPending}>
          {t('save')}
        </Button>
        <Button type="button" variant="secondary" onClick={() => setEditing(false)}>
          {t('cancel')}
        </Button>
      </div>
    </form>
  );
}

function NewGroupForm({ run, t }: { run: Runner; t: Translate }) {
  const [key, setKey] = useState('');
  const [name, setName] = useState<Translated>(emptyNames);

  const create = useMutation({
    mutationFn: () =>
      run(
        () => createGroup({ key, name }),
        () => {
          setKey('');
          setName(emptyNames());
        },
      ),
  });

  return (
    <form
      className={styles.form}
      onSubmit={(event) => {
        event.preventDefault();
        create.mutate();
      }}
    >
      <h2 className={styles.groupTitle}>{t('addGroup')}</h2>
      <div className={styles.formRow}>
        <div className={styles.field}>
          <label className={styles.label} htmlFor="new-group-key">
            {t('key')}
          </label>
          <input
            className={styles.input}
            id="new-group-key"
            value={key}
            onChange={(event) => setKey(event.target.value)}
            required
          />
        </div>
      </div>
      <NameFields value={name} onChange={setName} idPrefix="new-group" />
      <div className={styles.actions}>
        <Button type="submit" disabled={create.isPending}>
          {t('addGroup')}
        </Button>
      </div>
    </form>
  );
}

function NewServiceForm({
  groups,
  run,
  t,
}: {
  groups: AdminServiceGroup[];
  run: Runner;
  t: Translate;
}) {
  const [key, setKey] = useState('');
  const [group, setGroup] = useState(groups[0]?.key ?? '');
  const [name, setName] = useState<Translated>(emptyNames);
  const [appliesTo, setAppliesTo] = useState<ListingKind[]>([]);
  const [position, setPosition] = useState('');

  const create = useMutation({
    mutationFn: () =>
      run(
        () =>
          createService({
            key,
            group: group || (groups[0]?.key ?? ''),
            name,
            appliesTo,
            position: Number(position || 0),
            isActive: true,
          }),
        () => {
          setKey('');
          setName(emptyNames());
          setPosition('');
          setAppliesTo([]);
        },
      ),
  });

  return (
    <form
      className={styles.form}
      onSubmit={(event) => {
        event.preventDefault();
        create.mutate();
      }}
    >
      <h2 className={styles.groupTitle}>{t('addService')}</h2>
      <div className={styles.formRow}>
        <div className={styles.field}>
          <label className={styles.label} htmlFor="new-service-key">
            {t('key')}
          </label>
          <input
            className={styles.input}
            id="new-service-key"
            value={key}
            onChange={(event) => setKey(event.target.value)}
            placeholder="massage_thai"
            required
          />
        </div>
        <div className={styles.field}>
          <label className={styles.label} htmlFor="new-service-group">
            {t('group')}
          </label>
          <select
            className={styles.select}
            id="new-service-group"
            value={group}
            onChange={(event) => setGroup(event.target.value)}
          >
            {groups.map((item) => (
              <option key={item.key} value={item.key}>
                {item.name[DEFAULT_LOCALE]}
              </option>
            ))}
          </select>
        </div>
        <div className={styles.field}>
          <label className={styles.label} htmlFor="new-service-pos">
            {t('position')}
          </label>
          <input
            className={styles.input}
            id="new-service-pos"
            value={position}
            onChange={(event) => setPosition(event.target.value)}
            required
          />
        </div>
      </div>
      <NameFields value={name} onChange={setName} idPrefix="new-service" />
      <KindPicker value={appliesTo} onChange={setAppliesTo} idPrefix="new-service-kind" t={t} />
      <div className={styles.actions}>
        <Button type="submit" disabled={create.isPending}>
          {t('addService')}
        </Button>
      </div>
    </form>
  );
}
