import fs from "fs";
import path from "path";

export interface TokenSet {
  accessToken: string;
  refreshToken: string;
  expiresAt: number; // Unix ms
}

const TOKEN_FILE = path.join(process.cwd(), "tokens.json");

export function readTokens(): TokenSet | null {
  try {
    const raw = fs.readFileSync(TOKEN_FILE, "utf-8");
    return JSON.parse(raw) as TokenSet;
  } catch {
    return null;
  }
}

export function writeTokens(tokens: TokenSet): void {
  fs.writeFileSync(TOKEN_FILE, JSON.stringify(tokens, null, 2), "utf-8");
}

export function clearTokens(): void {
  try {
    fs.unlinkSync(TOKEN_FILE);
  } catch {
    // already gone
  }
}

export function isExpired(tokens: TokenSet): boolean {
  // Treat as expired 60s before actual expiry to avoid edge cases
  return Date.now() >= tokens.expiresAt - 60_000;
}
