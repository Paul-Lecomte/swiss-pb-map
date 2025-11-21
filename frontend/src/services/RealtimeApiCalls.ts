// call to http://localhost:3000/api/realtime/trip-updates
import axios from "axios";

export const realtimeUpdates = async () => {
    const response = await axios.get(`http://localhost:3000/api/realtime/trip-updates`);
    return response.data;
}

export const realtimeUpdatesByTripIds = async (tripIds: string[]) => {
    const response = await axios.post(`http://localhost:3000/api/realtime/trip-updates/by-trip`, { tripIds });
    return response.data;
}
