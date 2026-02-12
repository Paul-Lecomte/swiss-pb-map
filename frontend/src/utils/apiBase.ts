export function getApiBaseUrl(): string {
  const raw = process.env.NEXT_PUBLIC_API_BASE_URL;
  if (!raw) {
    throw new Error('NEXT_PUBLIC_API_BASE_URL manquant dans .env');
  }
  return raw.replace(/\/$/, '');
}

