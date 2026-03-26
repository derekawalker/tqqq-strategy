export async function GET() {
  return Response.json({
    clientId: process.env.SCHWAB_CLIENT_ID,
    redirectUri: process.env.SCHWAB_REDIRECT_URI,
    appUrl: process.env.NEXT_PUBLIC_APP_URL,
  });
}
