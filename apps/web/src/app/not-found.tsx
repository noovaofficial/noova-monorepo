import { DEFAULT_LOCALE } from '@noova/shared';
import { DEFAULT_THEME } from '@/design-system/theme';
import messages from '../../messages/de.json';
import '@/design-system/globals.css';

/**
 * Корневая граница 404. Корневой layout сквозной, поэтому <html>/<body>
 * задаём здесь. Язык запроса на этом уровне недоступен — берём язык
 * основного рынка.
 */
export default function RootNotFound() {
  return (
    <html lang={DEFAULT_LOCALE} data-theme={DEFAULT_THEME}>
      <body>
        <div
          style={{
            minHeight: '100vh',
            display: 'grid',
            placeContent: 'center',
            textAlign: 'center',
            gap: '12px',
            padding: '32px',
          }}
        >
          <h1 style={{ fontSize: '30px', fontWeight: 700 }}>{messages.error.notFoundTitle}</h1>
          <p style={{ color: 'var(--secondaryText)' }}>{messages.error.notFoundBody}</p>
          <p>
            <a href={`/${DEFAULT_LOCALE}`} style={{ color: 'var(--primary)', fontWeight: 600 }}>
              {messages.error.backHome}
            </a>
          </p>
        </div>
      </body>
    </html>
  );
}
