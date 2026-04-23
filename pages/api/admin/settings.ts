import { NextApiRequest, NextApiResponse } from "next";
import { connectToDatabase } from "@/lib/MongoDB";
import { recordAuditLog } from "@/utils/audit-logger";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
    const { method } = req;
    const db = await connectToDatabase();
    const collection = db.collection("system_settings");

    switch (method) {
        case "GET":
            try {
                const settings = await collection.findOne({ type: "global" });
                if (!settings) {
                    // Default settings if none exist
                    const defaultSettings = {
                        type: "global",
                        officeStartTime: "08:00",
                        officeEndTime: "17:00",
                        lunchStart: "12:00",
                        lunchEnd: "13:00",
                        gracePeriod: 15,
                        themeColor: "red", // red, blue, black, green
                        logoUrl: "",
                        announcement: "",
                        updatedAt: new Date()
                    };
                    return res.status(200).json(defaultSettings);
                }
                res.status(200).json(settings);
            } catch (error) {
                res.status(500).json({ error: "Failed to fetch settings" });
            }
            break;

        case "POST":
            try {
                const { 
                    officeStartTime, 
                    officeEndTime, 
                    lunchStart, 
                    lunchEnd, 
                    gracePeriod, 
                    themeColor,
                    logoUrl,
                    announcement,
                    geofenceLat,
                    geofenceLng,
                    geofenceRadius,
                    adminId, 
                    adminName 
                } = req.body;

                const result = await collection.updateOne(
                    { type: "global" },
                    { 
                        $set: { 
                            officeStartTime,
                            officeEndTime,
                            lunchStart,
                            lunchEnd,
                            gracePeriod, 
                            themeColor,
                            logoUrl,
                            announcement,
                            geofenceLat:    geofenceLat    ?? null,
                            geofenceLng:    geofenceLng    ?? null,
                            geofenceRadius: geofenceRadius ?? null,
                            updatedAt: new Date() 
                        } 
                    },
                    { upsert: true }
                );

                if (adminId && adminName) {
                    await recordAuditLog(adminId, adminName, "UPDATE_SETTINGS", "SYSTEM", "Global Config", `Updated work rules and announcement`);
                }

                res.status(200).json({ message: "Settings updated successfully" });
            } catch (error) {
                res.status(500).json({ error: "Failed to update settings" });
            }
            break;

        default:
            res.setHeader("Allow", ["GET", "POST"]);
            res.status(405).end(`Method ${method} Not Allowed`);
    }
}
