import React from "react";
import { Box, Typography, IconButton, Switch, FormControlLabel, Paper, Divider } from "@mui/material";
import CloseIcon from "@mui/icons-material/Close";

type Props = { onClose?: () => void };

type LayerKeys = "railway" | "stations" | "tram" | "bus" | "trolleybus" | "ferry" | "backgroundPois";
type LayerState = Record<LayerKeys, boolean>;

const labelToKey: Record<string, LayerKeys> = {
  "Railway lines": "railway",
  "Stations": "stations",
  "Tram": "tram",
  "Bus": "bus",
  "Trolleybus": "trolleybus",
  "Ferry": "ferry",
  "Background POIs": "backgroundPois",
};

export default function LayerOption({ onClose }: Props) {
  const [state, setState] = React.useState<LayerState>({
    railway: true,
    stations: true,
    tram: true,
    bus: true,
    trolleybus: true,
    ferry: true,
    backgroundPois: true,
  });

  const toggle = (key: LayerKeys) => (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.checked;
    setState((prev) => ({ ...prev, [key]: value }));
    try {
      window.dispatchEvent(
          new CustomEvent("app:layer-visibility", { detail: { key, value } })
      );
    } catch {}
  };

  const labels = [
    "Railway lines",
    "Stations",
    "Tram",
    "Bus",
    "Trolleybus",
    "Ferry",
    "Background POIs",
  ];

  return (
      <Paper elevation={6} sx={{ width: 280, borderRadius: 3, p: 2 }}>
        <Box display="flex" alignItems="center" justifyContent="space-between" mb={1}>
          <Typography variant="subtitle1" fontWeight={700}>Options de couches</Typography>
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
                          onChange={toggle(key)}
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