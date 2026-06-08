import { NextApiRequest, NextApiResponse } from "next";
import { supabase } from '@/lib/supabase';

export default async function fetchAccounts(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    res.status(405).end(`Method ${req.method} Not Allowed`);
    return;
  }

  try {
    const { data, error } = await supabase.from('users').select('*');
    if (error) throw error;
    res.status(200).json(data);
  } catch (error) {
    console.error("fetchuser error:", error);
    res.status(500).json({ error: 'Failed to fetch data' });
  }
}
