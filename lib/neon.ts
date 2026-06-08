import { neon } from '@neondatabase/serverless';

if (!process.env.TASKFLOW_DB) {
  console.error("CRITICAL: Missing TASKFLOW_DB environment variable.");
}

export const sql = process.env.TASKFLOW_DB ? neon(process.env.TASKFLOW_DB) : (null as any);
