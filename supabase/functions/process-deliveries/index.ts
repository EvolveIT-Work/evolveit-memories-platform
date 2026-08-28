import { createClient } from '@supabase/supabase-js';

// Stubbed delivery processor (Day 2)
// - Runs in STUB mode: reads pending delivery_queue entries and marks them as 'sent'
// - Writes no external network calls; useful for local/dev and Day 2 acceptance

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

export default async function handler(req: any, res: any) {
  try {
    // Fetch a small batch of pending deliveries
    const { data, error } = await supabase
      .from('delivery_queue')
      .select('*')
      .eq('status', 'pending')
      .order('created_at', { ascending: true })
      .limit(50);

    if (error) {
      console.error('process-deliveries: fetch error', error.message);
      return res.status(500).send('db error');
    }

    if (!data || data.length === 0) {
      return res.status(200).send('no deliveries');
    }

    // Mark each as sent (stub) using update by id to avoid race conditions
    const ids = data.map((r: any) => r.id);
    const { error: upserr } = await supabase
      .from('delivery_queue')
      .update({ status: 'sent', attempts: supabase.raw('attempts + 1'), last_attempt_at: new Date().toISOString() })
      .in('id', ids as any[]);

    if (upserr) {
      console.error('process-deliveries: update error', upserr.message);
      return res.status(500).send('update error');
    }

    return res.status(200).send(`marked ${ids.length} deliveries as sent (stub)`);
  } catch (err: any) {
    console.error('process-deliveries unexpected error', err && err.message ? err.message : err);
    return res.status(500).send('internal error');
  }
}
