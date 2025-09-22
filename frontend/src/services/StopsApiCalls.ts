import axios from "axios";

const API_BASE_URL = "http://localhost:3000/api";

export const fetchProcessedStops = async () => {
    const response = await axios.get(`${API_BASE_URL}/gtfs/all_processed_stop`);
    return response.data;
}

export const fetchStopTimetable = async (stopId: string) => {
    const response = await axios.get(`${API_BASE_URL}/timetable/${stopId}`);
    return response.data;
};

export const searchStopByName = async (name: string) => {
    const response = await axios.get(`${API_BASE_URL}/search`, {
        params: { name }
    });
    return response.data;
};