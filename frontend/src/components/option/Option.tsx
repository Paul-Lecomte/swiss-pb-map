"use client";

import React from "react";
import { Paper, Box, Typography, IconButton, Switch, FormControlLabel, Divider, TextField } from "@mui/material";
import CloseIcon from "@mui/icons-material/Close";

type Props = { onClose?: () => void; prefs?: { showRealtimeOverlay: boolean; showRouteProgress: boolean; maxRoutes?: number }; setPrefs?: React.Dispatch<React.SetStateAction<{ showRealtimeOverlay: boolean; showRouteProgress: boolean; maxRoutes?: number }>> };

export default function Option({ onClose, prefs, setPrefs }: Props) {
    const toggle = (key: 'showRealtimeOverlay'|'showRouteProgress') => (e: React.ChangeEvent<HTMLInputElement>) => {
        if (!setPrefs || !prefs) return;
        setPrefs(prev => ({ ...prev, [key]: e.target.checked }));
    };
    // Local state to avoid applying on every keystroke
    const [localMaxRoutes, setLocalMaxRoutes] = React.useState<number>(prefs?.maxRoutes ?? 40);
    React.useEffect(() => {
        // sync when prefs change externally
        if (typeof prefs?.maxRoutes === 'number') {
            setLocalMaxRoutes(prefs.maxRoutes);
        }
    }, [prefs?.maxRoutes]);

    const onMaxRoutesChangeLocal = (e: React.ChangeEvent<HTMLInputElement>) => {
        const raw = e.target.value;
        const num = Number(raw);
        if (!Number.isFinite(num)) {
            setLocalMaxRoutes(100);
            return;
        }
        // Do not update prefs yet — just local state
        setLocalMaxRoutes(num);
    };
    const clamp = (v: number) => Math.max(1, Math.min(v, 500));
    const applyMaxRoutes = (nextVal?: number) => {
        if (!setPrefs) return;
        const val = clamp(typeof nextVal === 'number' ? nextVal : localMaxRoutes);
        setLocalMaxRoutes(val);
        setPrefs(prev => ({ ...prev, maxRoutes: val }));
    };
    const onMaxRoutesBlur = () => applyMaxRoutes();
    const onMaxRoutesKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
        if (e.key === 'Enter') applyMaxRoutes();
    };

    return (
        <Paper elevation={6} sx={{ width: 280, borderRadius: 3, p: 2 }}>
            <Box display="flex" alignItems="center" justifyContent="space-between" mb={1}>
                <Typography variant="subtitle1" fontWeight={700}>Options</Typography>
                <IconButton onClick={onClose} size="small" aria-label="Close">
                    <CloseIcon fontSize="small" />
                </IconButton>
            </Box>
            <Divider sx={{ mb: 2 }} />
            <Box display="flex" flexDirection="column" gap={1}>
                <FormControlLabel
                    control={<Switch checked={!!prefs?.showRealtimeOverlay} onChange={toggle('showRealtimeOverlay')} color="primary" />}
                    label="Realtime overlay"
                />
                <FormControlLabel
                    control={<Switch checked={!!prefs?.showRouteProgress} onChange={toggle('showRouteProgress')} color="primary" />}
                    label="Routes load progress"
                />
                <TextField
                    label="Max routes to fetch"
                    type="number"
                    inputProps={{ min: 1, max: 500 }}
                    value={localMaxRoutes}
                    onChange={onMaxRoutesChangeLocal}
                    onBlur={onMaxRoutesBlur}
                    onKeyDown={onMaxRoutesKeyDown}
                    size="small"
                />
            </Box>
        </Paper>
    );
}