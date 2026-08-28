import { createClient } from '@supabase/supabase-js';

// Stubbed refund processor (Day 2)
// - Reads refund_requests with status='requested' and marks them 'processed' for Day 2
// - Does not call external payment provider in stub mode; merely records the processing in DB

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

export default async function handler(req: any, res: any) {
  try {
    const { data, error } = await supabase
      .from('refund_requests')
      .select('*')
      .eq('status', 'requested')
      .order('created_at', { ascending: true })
      .limit(20);

    if (error) {
      console.error('process-refunds: fetch error', error.message);
      return res.status(500).send('db error');
    }

    if (!data || data.length === 0) {
      return res.status(200).send('no refunds');
    }

    const ids = data.map((r: any) => r.id);

    const { error: upserr } = await supabase
      .from('refund_requests')
      .update({ status: 'processed', processed_at: new Date().toISOString() })
      .in('id', ids as any[]);

    if (upserr) {
      console.error('process-refunds: update error', upserr.message);
      return res.status(500).send('update error');
    }

    return res.status(200).send(`marked ${ids.length} refunds as processed (stub)`);
  } catch (err: any) {
    console.error('process-refunds unexpected error', err && err.message ? err.message : err);
    return res.status(500).send('internal error');
  }
}
