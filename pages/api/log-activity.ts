import type { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '@/lib/supabase';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).end('Method Not Allowed');

  const { email, department, status, timestamp } = req.body;

  // Validate input
  if (!email || !department || !status || !timestamp) {
    return res.status(400).json({ message: 'Missing required fields.' });
  }

  try {
    const { error } = await supabase.from('activity_logs').insert({
      email,
      department,
      status,
      timestamp: new Date(timestamp).toISOString(),
    });

    if (error) throw error;

    return res.status(200).json({ message: 'Activity logged successfully.' });
  } catch (error) {
    console.error("log-activity error:", error);
    return res.status(500).json({ message: 'Error logging activity.' });
  }
}
