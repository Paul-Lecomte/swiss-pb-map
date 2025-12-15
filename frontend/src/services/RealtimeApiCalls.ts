// call to http://localhost:3000/api/realtime/trip-updates
import axios from "axios";

// Base URL configurable via NEXT_PUBLIC_API_BASE_URL (fallback to localhost)
interface EnvProcess { env?: { NEXT_PUBLIC_API_BASE_URL?: string } }
const maybeProc: EnvProcess | undefined = typeof process !== 'undefined' ? (process as unknown as EnvProcess) : undefined;
const API_BASE_URL = maybeProc?.env?.NEXT_PUBLIC_API_BASE_URL
  ? String(maybeProc.env.NEXT_PUBLIC_API_BASE_URL).replace(/\/$/, '')
  : "http://localhost:3000/api";

export const realtimeUpdatesByTripIds = async (tripIds: string[]) => {
    // Use POST with body to support thousands of IDs
    const response = await axios.post(`${API_BASE_URL}/realtime/trip-updates/by-trip`, { tripIds });
    return response.data;
}
