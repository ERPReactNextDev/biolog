import { NextApiRequest, NextApiResponse } from "next";
import { serialize, parse } from "cookie";
import { connectToDatabase } from "./MongoDB";

// Function to destroy session
export async function destroySession(req: NextApiRequest, res: NextApiResponse) {
  const cookies = req.headers.cookie ? parse(req.headers.cookie) : {};
  const sessionToken = cookies.session;

  if (sessionToken) {
    try {
      const db = await connectToDatabase();
      const sessionsCollection = db.collection("sessions");
      await sessionsCollection.deleteOne({ token: sessionToken });
    } catch (e) {
    }
  }

  res.setHeader("Set-Cookie", serialize("session", "", { maxAge: -1, path: "/" }));
}

// Function to get session
export async function getSession(req: NextApiRequest) {
  const cookies = req.headers.cookie ? parse(req.headers.cookie) : {};
  const session = cookies.session;

  if (!session) {
    return null;
  }

  return session;
}

// Function to create session
export async function createSession(res: NextApiResponse, sessionData: string) {
  const cookieOptions = {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    maxAge: 60 * 60 * 24 * 7, 
    path: "/",
  };

  res.setHeader("Set-Cookie", serialize("session", sessionData, cookieOptions));
}
