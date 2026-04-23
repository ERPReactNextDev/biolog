import { NextResponse } from "next/server";
import { neon } from "@neondatabase/serverless";

const DATABASE_URL = process.env.TASKFLOW_DB;

if (!DATABASE_URL) {
  throw new Error("TASKFLOW_DB_URL is not set");
}

const sql = neon(DATABASE_URL);

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const referenceid = searchParams.get("referenceid");

    if (!referenceid) {
      return NextResponse.json(
        { success: false, error: "Missing referenceid" },
        { status: 400 }
      );
    }

    // ✅ SELECT ONLY WHAT YOU NEED
    const accounts = await sql`
      SELECT
        company_name
      FROM accounts
      WHERE referenceid = ${referenceid};
    `;

    if (accounts.length === 0) {
      return NextResponse.json(
        { success: true, data: [] },
        { status: 200 }
      );
    }

    return NextResponse.json(
      { success: true, data: accounts },
      {
        status: 200,
        headers: {
          // ✅ Reduce repeated public transfers
          "Cache-Control": "private, max-age=60", // 1 minute cache
        },
      }
    );
  } catch (error: any) {

    return NextResponse.json(
      {
        success: false,
        error: "Failed to fetch accounts",
      },
      { status: 500 }
    );
  }
}

// Still dynamic, but lighter
export const dynamic = "force-dynamic";
