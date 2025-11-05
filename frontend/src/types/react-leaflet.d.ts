declare module 'react-leaflet' {
  import type { ComponentType } from 'react';
  export const MapContainer: ComponentType<any>;
  export const TileLayer: ComponentType<any>;
  export const Marker: ComponentType<any>;
  export const Popup: ComponentType<any>;
  export const CircleMarker: ComponentType<any>;
  export const Polyline: ComponentType<any>;
  export function useMap(): any;
  export function useMapEvents(_: any): any;
}

declare module '@react-leaflet/core' {
  export function createControlComponent(factory: any): any;
}
