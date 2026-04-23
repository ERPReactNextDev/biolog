import { NextResponse } from "next/server";
import { neon } from "@neondatabase/serverless";

const DATABASE_URL = process.env.TASKFLOW_DB;

if (!DATABASE_URL) {
    throw new Error("TASKFLOW_DB is not set");
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

        // Query accounts where tsm = referenceid passed in
        const accounts = await sql`
      SELECT company_name
      FROM accounts
      WHERE manager = ${referenceid};
    `;

        return NextResponse.json(
            { success: true, data: accounts || [] },
            {
                status: 200,
                headers: { "Cache-Control": "private, max-age=60" },
            }
        );
    } catch (error) {
        return NextResponse.json(
            { success: false, error: "Failed to fetch accounts" },
            { status: 500 }
        );
    }
}

export const dynamic = "force-dynamic";
