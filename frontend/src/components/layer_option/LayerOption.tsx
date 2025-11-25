import React from "react";
import { Box, Typography, IconButton, Switch, FormControlLabel, Paper, Divider } from "@mui/material";
import CloseIcon from "@mui/icons-material/Close";

type LayerKeys =
    | "railway"
    | "stations"
    | "tram"
    | "bus"
    | "trolleybus"
    | "ferry"
    | "backgroundPois"
    | "showRoutes"
    | "showVehicles";

export type LayerState = Record<LayerKeys, boolean>;

type Props = {
  onClose?: () => void;
  state: LayerState;
  onChange: (key: LayerKeys, value: boolean) => void;
};

export default function LayerOption({ onClose, state, onChange }: Props) {
  const labels: string[] = [
    "Railway lines",
    "Stations",
    "Tram",
    "Bus",
    "Trolleybus",
    "Ferry",
    "Background POIs",
    "Show all route lines",
    "Show all vehicles",
  ];

  const labelToKey: Record<string, LayerKeys> = {
    "Railway lines": "railway",
    "Stations": "stations",
    "Tram": "tram",
    "Bus": "bus",
    "Trolleybus": "trolleybus",
    "Ferry": "ferry",
    "Background POIs": "backgroundPois",
    "Show all route lines": "showRoutes",
    "Show all vehicles": "showVehicles",
  };

  const handleToggle = (key: LayerKeys) => (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.checked;
    onChange(key, value);

    // Optional: dispatch event for legacy listeners
    try {
      window.dispatchEvent(new CustomEvent("app:layer-visibility", { detail: { key, value } }));
    } catch {}
  };

  return (
      <Paper elevation={6} sx={{ width: 280, borderRadius: 3, p: 2 }}>
        <Box display="flex" alignItems="center" justifyContent="space-between" mb={1}>
          <Typography variant="subtitle1" fontWeight={700}>Layer options</Typography>
          <IconButton onClick={onClose} size="small" aria-label="Fermer">
            <CloseIcon />
          </IconButton>
        </Box>
        <Divider sx={{ mb: 2 }} />
        <Box display="flex" flexDirection="column" gap={1}>
          {labels.map((label) => {
            const key = labelToKey[label];
            return (
                <FormControlLabel
                    key={label}
                    control={
                      <Switch
                          checked={state[key]}
                          onChange={handleToggle(key)}
                          color="primary"
                      />
                    }
                    label={label}
                />
            );
          })}
        </Box>
      </Paper>
  );
}