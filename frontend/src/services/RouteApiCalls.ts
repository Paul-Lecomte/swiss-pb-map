import axios from "axios";

const API_BASE_URL = "http://localhost:3000/api";

export async function fetchRoutesInBbox(bbox: number[], zoom: number) {
    const bboxStr = bbox.join(",");
    const res = await fetch(`${API_BASE_URL}/routes/routes-in-bbox?bbox=${bboxStr}&zoom=${zoom}`);
    return res.json();
}
