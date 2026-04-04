import { NextApiRequest, NextApiResponse } from "next";

/*
  GET /api/auth/google
  ────────────────────
  Redirects the user to Google's OAuth consent screen.
  After consent, Google will call /api/auth/google/callback.
*/
export default function handler(req: NextApiRequest, res: NextApiResponse) {
  const clientId = process.env.GOOGLE_CLIENT_ID;

  if (!clientId) {
    return res.status(500).json({ message: "Google OAuth is not configured." });
  }

  const redirectUri = `${process.env.NEXT_PUBLIC_APP_URL}/api/auth/google/callback`;

  const params = new URLSearchParams({
    client_id:     clientId,
    redirect_uri:  redirectUri,
    response_type: "code",
    scope:         "openid email profile",
    access_type:   "offline",
    prompt:        "select_account",
  });

  return res.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`);
}