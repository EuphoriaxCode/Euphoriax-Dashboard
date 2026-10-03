import { config } from '../config.js';
import { db, now, recordMetric } from '../db.js';
import { getJson, type Connector } from './types.js';

const API = 'https://www.patreon.com/api/oauth2/v2';

export const patreon: Connector = {
  name: 'Patreon',
  platform: 'patreon',
  setup: 'Patreon creator access token on the Setup page',
  configured: () => !!config.patreon.token,
  async collect() {
    const headers = { authorization: `Bearer ${config.patreon.token}` };
    const camp = await getJson(`${API}/campaigns?fields%5Bcampaign%5D=patron_count,paid_member_count`, { headers });
    const c = camp.data?.[0];
    if (!c) throw new Error('no campaign');
    recordMetric('patreon', 'patrons', c.attributes.patron_count);
    recordMetric('patreon', 'paid_members', c.attributes.paid_member_count);

    // Walk all members to compute per-tier counts and monthly revenue.
    const tiers = new Map<string, { name: string; price: number; members: number; revenue: number }>();
    let monthly = 0;
    let url: string | undefined =
      `${API}/campaigns/${c.id}/members?include=currently_entitled_tiers&page%5Bcount%5D=500` +
      `&fields%5Bmember%5D=patron_status,currently_entitled_amount_cents&fields%5Btier%5D=title,amount_cents`;
    while (url) {
      const page: any = await getJson(url, { headers });
      for (const inc of page.included ?? []) {
        if (inc.type === 'tier' && !tiers.has(inc.id)) {
          tiers.set(inc.id, { name: inc.attributes.title, price: inc.attributes.amount_cents, members: 0, revenue: 0 });
        }
      }
      for (const m of page.data ?? []) {
        if (m.attributes.patron_status !== 'active_patron') continue;
        monthly += m.attributes.currently_entitled_amount_cents ?? 0;
        for (const t of m.relationships?.currently_entitled_tiers?.data ?? []) {
          const tier = tiers.get(t.id);
          if (tier) { tier.members++; tier.revenue += m.attributes.currently_entitled_amount_cents ?? 0; }
        }
      }
      url = page.links?.next;
    }
    recordMetric('patreon', 'monthly_revenue_cents', monthly);
    const upsert = db.prepare(`INSERT INTO products (id, platform, name, price_cents, members, revenue_cents, updated_at)
      VALUES (?, 'patreon', ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET name = excluded.name,
      price_cents = excluded.price_cents, members = excluded.members, revenue_cents = excluded.revenue_cents,
      updated_at = excluded.updated_at`);
    for (const [id, t] of tiers) upsert.run(`patreon:${id}`, t.name, t.price, t.members, t.revenue, now());
    return `${c.attributes.patron_count} patrons, $${(monthly / 100).toFixed(0)}/mo`;
  },
};
