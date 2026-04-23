import { connectToDatabase } from "@/lib/MongoDB";

export async function recordAuditLog(adminId: string, adminName: string, action: string, targetId: string, targetName: string, details?: string) {
    try {
        const db = await connectToDatabase();
        const collection = db.collection("audit_logs");
        
        await collection.insertOne({
            adminId,
            adminName,
            action,
            targetId,
            targetName,
            details,
            date_created: new Date()
        });
    } catch (error) {
    }
}
