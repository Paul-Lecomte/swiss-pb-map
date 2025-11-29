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
    const onMaxRoutesChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (!setPrefs) return;
        const val = Math.max(1, Math.min(Number(e.target.value || 0), 500));
        setPrefs(prev => ({ ...prev, maxRoutes: val }));
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
                    value={prefs?.maxRoutes ?? 100}
                    onChange={onMaxRoutesChange}
                    size="small"
                />
            </Box>
        </Paper>
    );
}