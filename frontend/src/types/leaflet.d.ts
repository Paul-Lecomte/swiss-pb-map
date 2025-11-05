declare module 'leaflet' {
  const L: any;
  export default L;
  export type LatLngTuple = [number, number];
  // minimal namespace for L types used in code
  export as namespace L;
  namespace L {
    type Map = any;
    type TileLayer = any;
    type CircleMarker = any;
    type Marker = any;
    interface IconOptions { [key: string]: any }
    class Icon { constructor(opts?: IconOptions); }
    class Control { constructor(); }
    function DomUtil(): any;
    function DomEvent(): any;
  }
}

