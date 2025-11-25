"use client";

import React from "react";
import { Paper, Box, Typography, IconButton, Switch, FormControlLabel, Divider } from "@mui/material";
import CloseIcon from "@mui/icons-material/Close";

type Props = { onClose?: () => void; prefs?: { showRealtimeOverlay: boolean; showRouteProgress: boolean }; setPrefs?: React.Dispatch<React.SetStateAction<{ showRealtimeOverlay: boolean; showRouteProgress: boolean }>> };

export default function Option({ onClose, prefs, setPrefs }: Props) {
    const toggle = (key: 'showRealtimeOverlay'|'showRouteProgress') => (e: React.ChangeEvent<HTMLInputElement>) => {
        if (!setPrefs || !prefs) return;
        setPrefs(prev => ({ ...prev, [key]: e.target.checked }));
    };
    return (
        <Paper elevation={6} sx={{ width: 280, borderRadius: 3, p: 2 }}>
            <Box display="flex" alignItems="center" justifyContent="space-between" mb={1}>
                <Typography variant="subtitle1" fontWeight={700}>Options d'affichage</Typography>
                <IconButton onClick={onClose} size="small" aria-label="Fermer">
                    <CloseIcon fontSize="small" />
                </IconButton>
            </Box>
            <Divider sx={{ mb: 2 }} />
            <Box display="flex" flexDirection="column" gap={1}>
                <FormControlLabel
                    control={<Switch checked={!!prefs?.showRealtimeOverlay} onChange={toggle('showRealtimeOverlay')} color="primary" />}
                    label="Overlay temps réel"
                />
                <FormControlLabel
                    control={<Switch checked={!!prefs?.showRouteProgress} onChange={toggle('showRouteProgress')} color="primary" />}
                    label="Progression chargement des routes"
                />
            </Box>
        </Paper>
    );
}