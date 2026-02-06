import axios from "axios";

// Base URL configurable via NEXT_PUBLIC_API_BASE_URL (fallback to localhost)
const API_BASE_URL = (typeof process !== 'undefined' && (process as any).env && (process as any).env.API_BASE_URL)
  ? (process as any).env.API_BASE_URL.replace(/\/$/, '')
  : "http://localhost:3000/api";

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

export async function fetchStopsInBbox(bbox: number[], zoom: number) {
    const bboxStr = bbox.join(",");
    const res = await fetch(`${API_BASE_URL}/stops/stops-in-bbox?bbox=${bboxStr}&zoom=${zoom}`);
    return res.json();
}

export const searchProcessedStops = async (q: string, type?: string) => {
    const params: any = { q };
    if (type) params.type = type;
    const response = await axios.get(`${API_BASE_URL}/stops/search-stops`, { params });
    return response.data;
};