import { describe, expect, it } from 'vitest';
import { MAX_OPEN_REPORTS, reportDecision } from './dedupe';

describe('сдерживание жалоб на анкету', () => {
  it('первая жалоба сохраняется', () => {
    expect(reportDecision({ urgent: false, senderHasOpen: false, openCount: 0 })).toBe('store');
  });

  it('повторная от того же отправителя — нет', () => {
    expect(reportDecision({ urgent: false, senderHasOpen: true, openCount: 1 })).toBe('duplicate');
    expect(reportDecision({ urgent: true, senderHasOpen: true, openCount: 1 })).toBe('duplicate');
  });

  it('сверх потолка анкеты жалобы не копятся', () => {
    const at = MAX_OPEN_REPORTS.regular;
    expect(reportDecision({ urgent: false, senderHasOpen: false, openCount: at - 1 })).toBe(
      'store',
    );
    expect(reportDecision({ urgent: false, senderHasOpen: false, openCount: at })).toBe('full');
  });

  it('у срочных потолок выше обычного', () => {
    expect(
      reportDecision({ urgent: true, senderHasOpen: false, openCount: MAX_OPEN_REPORTS.regular }),
    ).toBe('store');
    expect(
      reportDecision({ urgent: true, senderHasOpen: false, openCount: MAX_OPEN_REPORTS.urgent }),
    ).toBe('full');
  });
});
