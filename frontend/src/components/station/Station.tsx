"use client";

import React, { useEffect, useState, useCallback } from "react";
import { Paper, Box, Typography, IconButton, Tabs, Tab, ListItemButton, Divider, CircularProgress, Tooltip } from "@mui/material";
import CloseIcon from "@mui/icons-material/Close";
import StarBorderIcon from "@mui/icons-material/StarBorder";
import StarIcon from "@mui/icons-material/Star";
import RefreshIcon from "@mui/icons-material/Refresh";
import { fetchProcessedStops, fetchStopTimetable } from "../../services/StopsApiCalls";
import { FixedSizeList, ListChildComponentProps } from 'react-window';

interface ProcessedStopRaw { stop_id: string; stop_name?: string; stop_lat?: number; stop_lon?: number; routes?: string[]; route_ids?: string[]; routes_serving?: string[]; }
interface RawTimetableRow { routeShortName?: string; route_short_name?: string; route_id?: string; departureTime?: string; departure_time?: string; arrivalTime?: string; arrival_time?: string; headsign?: string; trip_headsign?: string; delaySecs?: number; delay_secs?: number; departureDelay?: number; arrivalDelay?: number; }

type StopSummary = {
    stop_id: string;
    stop_name?: string;
    stop_lat?: number;
    stop_lon?: number;
    routes?: string[]; // optional list of routes serving stop
};

const FAV_KEY = "swiss:favStops:v1";
const RECENT_KEY = "swiss:recentStops:v1";
const MAX_RECENTS = 30;

interface TimetableEntry {
    routeShortName?: string;
    departureTime?: string; // HH:MM:SS
    arrivalTime?: string;
    headsign?: string;
    delaySecs?: number;
}

// Helper formatters
const formatTime = (hhmmss?: string) => {
    if (!hhmmss) return "--:--";
    const [h,m] = hhmmss.split(":");
    return `${h}:${m}`;
};
const formatDelay = (d?: number) => {
    if (d == null) return "";
    if (d === 0) return "on time";
    const abs = Math.abs(d);
    if (abs < 60) return (d>0?`+${abs}s`:`-${abs}s`);
    const mins = Math.round(abs/60);
    return (d>0?`+${mins}m`:`-${mins}m`);
};

export default function Station({ onClose }: { onClose?: () => void }) {
    const [tab, setTab] = useState(0);
    const [allStops, setAllStops] = useState<StopSummary[]>([]);
    const [loadingStops, setLoadingStops] = useState(false);
    const [favStops, setFavStops] = useState<string[]>([]);
    const [recentStops, setRecentStops] = useState<string[]>([]);
    const [timetableLoading, setTimetableLoading] = useState(false);
    const [timetable, setTimetable] = useState<Record<string, TimetableEntry[]>>({});
    const [filter, setFilter] = useState('');
    const [selectedStop, setSelectedStop] = useState<StopSummary | null>(null);

    // Load persisted favs/recents
    useEffect(() => {
        try { const rawFav = localStorage.getItem(FAV_KEY); if (rawFav) setFavStops(JSON.parse(rawFav)); } catch {}
        try { const rawRec = localStorage.getItem(RECENT_KEY); if (rawRec) setRecentStops(JSON.parse(rawRec)); } catch {}
    }, []);

    const persistFav = (next: string[]) => { setFavStops(next); try { localStorage.setItem(FAV_KEY, JSON.stringify(next)); } catch {} };
    const persistRec = (next: string[]) => { setRecentStops(next); try { localStorage.setItem(RECENT_KEY, JSON.stringify(next)); } catch {} };

    // Fetch lists of stops from API
    const loadStops = useCallback(async () => {
        setLoadingStops(true);
        try {
            const data = await fetchProcessedStops();
            if (Array.isArray(data)) {
                const mapped: StopSummary[] = (data as ProcessedStopRaw[]).map((s) => ({
                    stop_id: s.stop_id,
                    stop_name: s.stop_name || s.stop_id,
                    stop_lat: s.stop_lat,
                    stop_lon: s.stop_lon,
                    routes: s.routes || s.route_ids || s.routes_serving || []
                }));
                mapped.sort((a,b) => (a.stop_name||"").localeCompare(b.stop_name||""));
                setAllStops(mapped);
            }
        } catch (e) {
            console.warn("[Station] fetchProcessedStops failed", e);
        } finally {
            setLoadingStops(false);
        }
    }, []);

    useEffect(() => { loadStops(); }, [loadStops]);

    // Listen for external stop selections
    useEffect(() => {
        const handler = (e: CustomEvent | Event) => {
            const anyE = e as CustomEvent;
            const stop = (anyE?.detail as StopSummary) || null;
            if (!stop?.stop_id) return;
            setRecentStops(prev => {
                const next = [stop.stop_id, ...prev.filter(id => id !== stop.stop_id)].slice(0, MAX_RECENTS);
                persistRec(next);
                return next;
            });
        };
        window.addEventListener("app:stop-select", handler as EventListener);
        return () => window.removeEventListener("app:stop-select", handler as EventListener);
    }, []);

    const toggleFav = (stopId: string) => {
        setFavStops(prev => {
            const next = prev.includes(stopId) ? prev.filter(id => id !== stopId) : [...prev, stopId];
            persistFav(next);
            return next;
        });
    };

    const dispatchSelect = (stop: StopSummary) => {
        try {
            window.dispatchEvent(new CustomEvent("app:stop-select", { detail: stop }));
        } catch {}
    };

    const loadTimetable = async (stopId: string) => {
        setTimetableLoading(true);
        try {
            const raw = await fetchStopTimetable(stopId);
            let entries: TimetableEntry[] = [];
            const arr: RawTimetableRow[] | undefined = Array.isArray(raw) ? raw as RawTimetableRow[] : Array.isArray(raw?.timetable) ? raw.timetable as RawTimetableRow[] : undefined;
            if (arr) {
                entries = arr.slice(0, 12).map((r: RawTimetableRow): TimetableEntry => ({
                    routeShortName: r.routeShortName || r.route_short_name || r.route_id,
                    departureTime: r.departureTime || r.departure_time,
                    arrivalTime: r.arrivalTime || r.arrival_time,
                    headsign: r.headsign || r.trip_headsign,
                    delaySecs: r.delaySecs ?? r.delay_secs ?? r.departureDelay ?? r.arrivalDelay,
                }));
            }
            setTimetable(prev => ({ ...prev, [stopId]: entries }));
        } catch (e) {
            console.warn("[Station] fetchStopTimetable failed", e);
            setTimetable(prev => ({ ...prev, [stopId]: [] }));
        } finally {
            setTimetableLoading(false);
        }
    };

    const handleSelect = (stop: StopSummary) => {
        setSelectedStop(stop);
        dispatchSelect(stop);
        if (!timetable[stop.stop_id]) loadTimetable(stop.stop_id);
    };

    useEffect(() => { // reset page when tab changes
        setFilter('');
    }, [tab]);

    // Base list selection (beore filtering)
    const baseList: StopSummary[] = (() => {
        if (tab === 0) return allStops.filter(s => favStops.includes(s.stop_id));
        if (tab === 1) return recentStops.map(id => allStops.find(s => s.stop_id === id)).filter(Boolean) as StopSummary[];
        return allStops;
    })();

    // local filtering
    const filteredList = filter.trim().length === 0 ? baseList : baseList.filter(s => {
        const q = filter.toLowerCase();
        return (s.stop_name || '').toLowerCase().includes(q) || s.stop_id.toLowerCase().includes(q);
    });

    // Row renderer for virtualisation
    const Row: React.FC<ListChildComponentProps> = ({ index, style }) => {
        const stop = filteredList[index];
        if (!stop) return null;
        const isFav = favStops.includes(stop.stop_id);
        return (
            <div style={style}>
                <ListItemButton onClick={() => handleSelect(stop)} sx={{ alignItems:'center', py:0.5 }} selected={selectedStop?.stop_id===stop.stop_id}>
                    <Box display="flex" flexDirection="column" flex={1} pr={1} minWidth={0}>
                        <Typography variant="body2" fontWeight={600} noWrap>{stop.stop_name}</Typography>
                        <Typography variant="caption" color="text.secondary" noWrap>{stop.stop_id}</Typography>
                    </Box>
                    {Array.isArray(stop.routes) && stop.routes.length > 0 && (
                        <Typography variant="caption" color="text.disabled" sx={{ mr:1 }}>{stop.routes.length}</Typography>
                    )}
                    <IconButton size="small" onClick={(e) => { e.stopPropagation(); toggleFav(stop.stop_id); }} aria-label={isFav?"Remove from favorites":"Add to favorites"}>
                        {isFav ? <StarIcon fontSize="small" color="warning" /> : <StarBorderIcon fontSize="small" />}
                    </IconButton>
                </ListItemButton>
                <Divider />
            </div>
        );
    };

    return (
        <Paper elevation={6} sx={{ width: 320, borderRadius: 3, p: 2, display: 'flex', flexDirection: 'column', gap: 1 }}>
            <Box display="flex" alignItems="center" justifyContent="space-between" mb={1}>
                <Typography variant="subtitle1" fontWeight={700}>Stations</Typography>
                <Box display="flex" alignItems="center" gap={1}>
                    <Tooltip title="Refresh list">
                        <IconButton size="small" onClick={() => { loadStops(); }} aria-label="Refresh">
                            <RefreshIcon fontSize="small" />
                        </IconButton>
                    </Tooltip>
                    <IconButton onClick={onClose} size="small" aria-label="Close">
                        <CloseIcon fontSize="small" />
                    </IconButton>
                </Box>
            </Box>
            <Tabs value={tab} onChange={(_,v)=>{setTab(v); setFilter('');}} variant="fullWidth" sx={{ mb: 1 }}>
                <Tab label={`Favorites (${favStops.length})`} />
                <Tab label={`Recent (${recentStops.length})`} />
                <Tab label={`All (${allStops.length})`} />
            </Tabs>
            <Divider sx={{ mb: 1 }} />
            <Box mb={1} display="flex" gap={0.5} alignItems="center">
                <input
                    value={filter}
                    onChange={e => { setFilter(e.target.value); }}
                    placeholder={`Filter (${filteredList.length})`}
                    style={{ flex:1, padding:'6px 8px', fontSize:12, border:'1px solid #ccc', borderRadius:6 }}
                />
                {filter && (
                    <IconButton size="small" aria-label="Clear filter" onClick={() => setFilter('')}>
                        <CloseIcon fontSize="small" />
                    </IconButton>
                )}
            </Box>
            <Box flex={1} sx={{ maxHeight:'55vh' }}>
                {loadingStops ? (
                    <Box display="flex" justifyContent="center" alignItems="center" height={180}><CircularProgress size={28} /></Box>
                ) : filteredList.length === 0 ? (
                    <Typography variant="body2" color="text.secondary" px={1} py={2}>No stops.</Typography>
                ) : (
                    <FixedSizeList
                        height={Math.min(300, Math.max(240, filteredList.length * 50))}
                        itemCount={filteredList.length}
                        itemSize={50}
                        width={296}
                    >
                        {Row}
                    </FixedSizeList>
                )}
            </Box>
            {/* Detailed menu */}
            <Divider sx={{ mt:1, mb:1 }} />
            {selectedStop ? (
                <Box display="flex" flexDirection="column" gap={0.75} sx={{ maxHeight:'30vh', overflowY:'auto' }}>
                    <Box display="flex" alignItems="center" justifyContent="space-between">
                        <Typography variant="subtitle2" fontWeight={600}>{selectedStop.stop_name}</Typography>
                        <IconButton size="small" onClick={() => toggleFav(selectedStop.stop_id)} aria-label="Favorites">
                            {favStops.includes(selectedStop.stop_id) ? <StarIcon fontSize="small" color="warning" /> : <StarBorderIcon fontSize="small" />}
                        </IconButton>
                    </Box>
                    <Typography variant="caption" color="text.secondary">ID: {selectedStop.stop_id}</Typography>
                    {Array.isArray(selectedStop.routes) && selectedStop.routes.length > 0 && (
                        <Typography variant="caption" color="text.secondary">Routes: {selectedStop.routes.length}</Typography>
                    )}
                    <Box display="flex" alignItems="center" gap={1}>
                        <Typography variant="caption" fontWeight={600}>Upcoming departures</Typography>
                        <IconButton size="small" onClick={() => loadTimetable(selectedStop.stop_id)} aria-label="Refresh timetable">
                            <RefreshIcon fontSize="inherit" />
                        </IconButton>
                    </Box>
                    {timetableLoading && !timetable[selectedStop.stop_id] && (
                        <Box display="flex" alignItems="center" gap={1}><CircularProgress size={16} /><Typography variant="caption">Loading…</Typography></Box>
                    )}
                    {timetable[selectedStop.stop_id] && timetable[selectedStop.stop_id].length > 0 ? (
                        <Box display="flex" flexDirection="column" gap={0.4}>
                            {timetable[selectedStop.stop_id].map((t, i) => (
                                <Box key={i} display="flex" justifyContent="space-between" sx={{ fontSize:11, borderBottom:'1px dotted rgba(0,0,0,0.1)', py:0.25 }}>
                                    <Box flex={1} pr={1} minWidth={0}>
                                        <strong>{t.routeShortName || '–'}</strong> <span style={{ color:'#666' }}>{t.headsign || ''}</span>
                                    </Box>
                                    <Box display="flex" alignItems="center" gap={0.5}>
                                        <span>{formatTime(t.departureTime)}</span>
                                        {t.delaySecs!=null && (<span style={{ color: t.delaySecs>0? '#d32f2f':'#1976d2', fontWeight:500 }}>{formatDelay(t.delaySecs)}</span>)}
                                    </Box>
                                </Box>
                            ))}
                        </Box>
                    ) : (!timetableLoading && (
                        <Typography variant="caption" color="text.secondary">No timetable data.</Typography>
                    ))}
                </Box>
            ) : (
                <Typography variant="caption" color="text.secondary">Select a stop to view its timetable.</Typography>
            )}
            <Divider sx={{ mt:1, mb:1 }} />
            <Typography variant="caption" color="text.secondary" sx={{ lineHeight:1.4, mt:0.5 }}>
                {filteredList.length} filtered stop(s) · Favorites: {favStops.length} · Recent: {recentStops.length}
            </Typography>
        </Paper>
    );
}