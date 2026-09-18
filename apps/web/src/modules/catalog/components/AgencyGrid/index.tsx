import type { AgencyCard as AgencyCardData } from '@noova/shared';
import { AgencyCard } from '../AgencyCard';
import styles from './AgencyGrid.module.css';

export function AgencyGrid({ agencies }: { agencies: AgencyCardData[] }) {
  return (
    <div className={styles.grid}>
      {agencies.map((agency) => (
        <AgencyCard key={agency.slug} agency={agency} />
      ))}
    </div>
  );
}
