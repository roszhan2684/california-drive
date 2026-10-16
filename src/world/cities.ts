// Data-driven city/region registry. Shared by the runtime and the import tool.
// Coordinates are WGS84 lat/lon; the import tool projects them into local meters.

export type Biome = 'urban' | 'coastal' | 'alpine';
export type TimePreset = 'dawn' | 'day' | 'golden' | 'dusk' | 'night';
export type WeatherKind = 'clear' | 'overcast' | 'fog' | 'rain' | 'snow';

export interface LatLon { lat: number; lon: number }

export type LandmarkKind = 'fluted-tower' | 'pyramid' | 'clock-tower' | 'crown-tower' | 'dome' | 'stepped-tower' | 'lighthouse' | 'ferris-wheel';

export interface LandmarkDef {
  id: string;
  name: string;
  kind: LandmarkKind;
  at: LatLon;
  height: number;
  radius: number; // footprint radius in meters; OSM buildings inside are replaced
  color?: string;
  /** Facing (degrees clockwise from north), for directional landmarks such as the Ferris wheel. */
  heading?: number;
}

export interface PhotoSpotDef { id: string; name: string; at: LatLon; lookAt: LatLon }

export interface ActivityDefs {
  scenicRoute?: { name: string; waypoints: LatLon[] };
  timeTrial?: { name: string; waypoints: LatLon[] };
  driftZone?: { name: string; at: LatLon; radius: number };
  speedTrap?: { name: string; at: LatLon };
  parking?: { name: string; at: LatLon };
  slalom?: { name: string; at: LatLon };
  photoSpots?: PhotoSpotDef[];
}

export interface CityDef {
  id: string;
  name: string;
  district: string;
  tagline: string;
  mood: string;
  biome: Biome;
  /** south, west, north, east */
  bbox: [number, number, number, number];
  /** Map node position on the stylized California map. */
  mapAt: LatLon;
  /** Elevation grid cell size (m). */
  cell: number;
  /** Sea/lake level in meters above MSL, or null when there is no water body. */
  waterLevel: number | null;
  /** Elevation (m above MSL) that becomes world y=0. */
  baseElevation: number;
  spawn: LatLon;
  spawnHeading?: LatLon;
  defaultTime: TimePreset;
  defaultWeather: WeatherKind;
  trafficProfile: { density: number; speedFactor: number };
  palette: { building: string[]; ground: string; accent: string };
  fogColor?: string;
  landmarks: LandmarkDef[];
  activities: ActivityDefs;
  /** Karl the Fog: rolling marine layer. */
  marineLayer?: boolean;
  districts: { name: string; at: LatLon }[];
}

export const CITIES: CityDef[] = [
  {
    id: 'sf',
    name: 'San Francisco',
    district: 'Embarcadero · North Beach · Russian Hill',
    tagline: 'Steep streets, fog and the bay',
    mood: 'Fog rolling over the hills, cable-car grades, bay lights.',
    biome: 'coastal',
    bbox: [37.788, -122.424, 37.8095, -122.3885],
    mapAt: { lat: 37.7749, lon: -122.4194 },
    cell: 8,
    waterLevel: 0,
    baseElevation: 0,
    spawn: { lat: 37.7990, lon: -122.3977 },
    spawnHeading: { lat: 37.8045, lon: -122.4030 },
    defaultTime: 'golden',
    defaultWeather: 'clear',
    trafficProfile: { density: 1.0, speedFactor: 0.9 },
    palette: { building: ['#c9b9a2', '#b5a690', '#a29483', '#c2a283', '#8a959e', '#d4c7b1', '#9c7a62', '#7c868d', '#b8b0a0'], ground: '#7f7c76', accent: '#ff7a3d' },
    fogColor: '#c9d2da',
    marineLayer: true,
    landmarks: [
      { id: 'coit', name: 'Telegraph Hill Tower', kind: 'fluted-tower', at: { lat: 37.80239, lon: -122.40583 }, height: 64, radius: 9, color: '#e9e3d3' },
      { id: 'pyramid', name: 'Financial District Pyramid', kind: 'pyramid', at: { lat: 37.79518, lon: -122.40279 }, height: 260, radius: 27, color: '#f1efe8' },
      { id: 'ferry', name: 'Ferry Clock Tower', kind: 'clock-tower', at: { lat: 37.79555, lon: -122.39348 }, height: 75, radius: 9, color: '#e4dccb' },
    ],
    activities: {
      scenicRoute: {
        name: 'Hills & Bay Loop',
        waypoints: [
          { lat: 37.8065, lon: -122.4045 }, { lat: 37.8045, lon: -122.4170 }, { lat: 37.7980, lon: -122.4190 },
          { lat: 37.7935, lon: -122.4060 }, { lat: 37.7920, lon: -122.3940 }, { lat: 37.7990, lon: -122.3977 },
        ],
      },
      timeTrial: {
        name: 'Embarcadero Sprint',
        waypoints: [{ lat: 37.7925, lon: -122.3925 }, { lat: 37.7990, lon: -122.3972 }, { lat: 37.8070, lon: -122.4060 }],
      },
      driftZone: { name: 'Pier Lot Drift', at: { lat: 37.8000, lon: -122.4010 }, radius: 70 },
      speedTrap: { name: 'Embarcadero Trap', at: { lat: 37.7965, lon: -122.3950 } },
      parking: { name: 'Columbus Ave Park', at: { lat: 37.7990, lon: -122.4080 } },
      slalom: { name: 'Battery St Slalom', at: { lat: 37.7980, lon: -122.4010 } },
      photoSpots: [
        { id: 'tower-view', name: 'Telegraph Hill Overlook', at: { lat: 37.8020, lon: -122.4070 }, lookAt: { lat: 37.80239, lon: -122.40583 } },
        { id: 'pyramid-view', name: 'Pyramid From Columbus', at: { lat: 37.7975, lon: -122.4055 }, lookAt: { lat: 37.79518, lon: -122.40279 } },
        { id: 'bay-view', name: 'Clock Tower Plaza', at: { lat: 37.7945, lon: -122.3955 }, lookAt: { lat: 37.79555, lon: -122.39348 } },
      ],
    },
    districts: [
      { name: 'Embarcadero', at: { lat: 37.7990, lon: -122.3977 } },
      { name: 'North Beach', at: { lat: 37.8010, lon: -122.4100 } },
      { name: 'Russian Hill', at: { lat: 37.8010, lon: -122.4180 } },
      { name: 'Financial District', at: { lat: 37.7935, lon: -122.4010 } },
      { name: 'Telegraph Hill', at: { lat: 37.8015, lon: -122.4045 } },
    ],
  },
  {
    id: 'la',
    name: 'Los Angeles',
    district: 'Downtown · Bunker Hill · Historic Core',
    tagline: 'Boulevards, freeways and neon',
    mood: 'Wide boulevards, freeway ramps, sodium-orange nights.',
    biome: 'urban',
    bbox: [34.036, -118.268, 34.062, -118.234],
    mapAt: { lat: 34.0522, lon: -118.2437 },
    cell: 8,
    waterLevel: null,
    baseElevation: 70,
    spawn: { lat: 34.0480, lon: -118.2560 },
    spawnHeading: { lat: 34.0530, lon: -118.2500 },
    defaultTime: 'dusk',
    defaultWeather: 'clear',
    trafficProfile: { density: 1.2, speedFactor: 1.0 },
    palette: { building: ['#d8c6a8', '#c9b28f', '#9fa8ad', '#e3d5bd', '#7d8a92', '#b5a184', '#efe1c6'], ground: '#94897a', accent: '#ff4fa3' },
    landmarks: [
      { id: 'crown', name: 'Bunker Hill Crown Tower', kind: 'crown-tower', at: { lat: 34.05101, lon: -118.25446 }, height: 310, radius: 26, color: '#c9d1d6' },
      { id: 'hall', name: 'Civic Center Stepped Tower', kind: 'stepped-tower', at: { lat: 34.05366, lon: -118.24274 }, height: 138, radius: 22, color: '#ece6d8' },
    ],
    activities: {
      scenicRoute: { name: 'Downtown Neon Loop', waypoints: [{ lat: 34.0560, lon: -118.2470 }, { lat: 34.0450, lon: -118.2440 }, { lat: 34.0420, lon: -118.2560 }, { lat: 34.0480, lon: -118.2560 }] },
      timeTrial: { name: 'Grand Ave Sprint', waypoints: [{ lat: 34.0450, lon: -118.2600 }, { lat: 34.0520, lon: -118.2510 }, { lat: 34.0580, lon: -118.2440 }] },
      driftZone: { name: 'Arts District Drift', at: { lat: 34.0430, lon: -118.2380 }, radius: 80 },
      speedTrap: { name: 'Figueroa Trap', at: { lat: 34.0480, lon: -118.2620 } },
      parking: { name: 'Broadway Parallel Park', at: { lat: 34.0470, lon: -118.2510 } },
      photoSpots: [{ id: 'crown-view', name: 'Crown Tower From 5th', at: { lat: 34.0490, lon: -118.2530 }, lookAt: { lat: 34.05101, lon: -118.25446 } }],
    },
    districts: [
      { name: 'Bunker Hill', at: { lat: 34.0520, lon: -118.2520 } },
      { name: 'Historic Core', at: { lat: 34.0470, lon: -118.2500 } },
      { name: 'Little Tokyo', at: { lat: 34.0500, lon: -118.2400 } },
      { name: 'South Park', at: { lat: 34.0410, lon: -118.2620 } },
    ],
  },
  {
    id: 'sd',
    name: 'San Diego',
    district: 'Gaslamp · Marina · Little Italy',
    tagline: 'Palms, harbor and golden hour',
    mood: 'Clean coastal light, palms and harbor reflections.',
    biome: 'coastal',
    bbox: [32.703, -117.178, 32.727, -117.148],
    mapAt: { lat: 32.7157, lon: -117.1611 },
    cell: 8,
    waterLevel: 0,
    baseElevation: 0,
    spawn: { lat: 32.7110, lon: -117.1600 },
    spawnHeading: { lat: 32.7160, lon: -117.1600 },
    defaultTime: 'golden',
    defaultWeather: 'clear',
    trafficProfile: { density: 0.8, speedFactor: 0.95 },
    palette: { building: ['#efe6d2', '#d9c7a4', '#b7c4c9', '#f4ede0', '#c6a989', '#a0b1b8'], ground: '#a39b8c', accent: '#ffb347' },
    landmarks: [{ id: 'sd-dome', name: 'Harbor Dome Hall', kind: 'dome', at: { lat: 32.7155, lon: -117.1700 }, height: 40, radius: 24, color: '#efe6d2' }],
    activities: {
      scenicRoute: { name: 'Harbor Drive Cruise', waypoints: [{ lat: 32.7080, lon: -117.1650 }, { lat: 32.7200, lon: -117.1730 }, { lat: 32.7240, lon: -117.1660 }] },
      timeTrial: { name: 'Gaslamp Dash', waypoints: [{ lat: 32.7080, lon: -117.1600 }, { lat: 32.7170, lon: -117.1580 }] },
      driftZone: { name: 'Marina Drift', at: { lat: 32.7085, lon: -117.1680 }, radius: 70 },
      speedTrap: { name: 'Harbor Trap', at: { lat: 32.7180, lon: -117.1720 } },
      parking: { name: 'Little Italy Park', at: { lat: 32.7230, lon: -117.1680 } },
      photoSpots: [{ id: 'harbor', name: 'Harbor Overlook', at: { lat: 32.7150, lon: -117.1725 }, lookAt: { lat: 32.7155, lon: -117.1760 } }],
    },
    districts: [{ name: 'Gaslamp', at: { lat: 32.7110, lon: -117.1600 } }, { name: 'Little Italy', at: { lat: 32.7230, lon: -117.1680 } }, { name: 'Marina', at: { lat: 32.7085, lon: -117.1680 } }],
  },
  {
    id: 'sj',
    name: 'San Jose',
    district: 'Downtown · SoFA · Guadalupe',
    tagline: 'Broad roads and clean night light',
    mood: 'Modern low-rise valley city, wide arterials, crisp LED nights.',
    biome: 'urban',
    bbox: [37.322, -121.905, 37.345, -121.875],
    mapAt: { lat: 37.3382, lon: -121.8863 },
    cell: 8,
    waterLevel: null,
    baseElevation: 25,
    spawn: { lat: 37.3330, lon: -121.8890 },
    defaultTime: 'night',
    defaultWeather: 'clear',
    trafficProfile: { density: 0.8, speedFactor: 1.05 },
    palette: { building: ['#d4d8db', '#b3bcc2', '#e6e2da', '#8e9ba3', '#c9bba4'], ground: '#9a958c', accent: '#3dd6ff' },
    landmarks: [],
    activities: {
      scenicRoute: { name: 'Downtown Circuit', waypoints: [{ lat: 37.3400, lon: -121.8930 }, { lat: 37.3380, lon: -121.8820 }, { lat: 37.3330, lon: -121.8890 }] },
      timeTrial: { name: 'Santa Clara St Sprint', waypoints: [{ lat: 37.3360, lon: -121.9000 }, { lat: 37.3390, lon: -121.8800 }] },
      driftZone: { name: 'SoFA Drift', at: { lat: 37.3280, lon: -121.8860 }, radius: 70 },
      speedTrap: { name: 'Almaden Trap', at: { lat: 37.3270, lon: -121.8890 } },
      parking: { name: 'Plaza Park', at: { lat: 37.3320, lon: -121.8880 } },
      photoSpots: [],
    },
    districts: [{ name: 'Downtown', at: { lat: 37.3330, lon: -121.8890 } }, { name: 'SoFA', at: { lat: 37.3280, lon: -121.8860 } }],
  },
  {
    id: 'oak',
    name: 'Oakland',
    district: 'Downtown · Lake Merritt · Jack London',
    tagline: 'Port lights and skyline views',
    mood: 'Urban/industrial contrast, lake reflections, port glow.',
    biome: 'urban',
    bbox: [37.795, -122.285, 37.815, -122.255],
    mapAt: { lat: 37.8044, lon: -122.2712 },
    cell: 8,
    waterLevel: 0.5,
    baseElevation: 0,
    spawn: { lat: 37.8040, lon: -122.2720 },
    defaultTime: 'dusk',
    defaultWeather: 'overcast',
    trafficProfile: { density: 0.9, speedFactor: 1.0 },
    palette: { building: ['#c9c1b4', '#a59c90', '#d8d2c7', '#8d8a86', '#b78f6f'], ground: '#8f8a82', accent: '#ffd23d' },
    landmarks: [],
    activities: {
      scenicRoute: { name: 'Lake Merritt Loop', waypoints: [{ lat: 37.8100, lon: -122.2600 }, { lat: 37.8000, lon: -122.2600 }, { lat: 37.8040, lon: -122.2720 }] },
      timeTrial: { name: 'Broadway Sprint', waypoints: [{ lat: 37.7980, lon: -122.2760 }, { lat: 37.8120, lon: -122.2680 }] },
      driftZone: { name: 'Jack London Drift', at: { lat: 37.7975, lon: -122.2770 }, radius: 70 },
      speedTrap: { name: 'Harrison Trap', at: { lat: 37.8080, lon: -122.2660 } },
      parking: { name: 'Uptown Park', at: { lat: 37.8090, lon: -122.2690 } },
      photoSpots: [],
    },
    districts: [{ name: 'Downtown', at: { lat: 37.8040, lon: -122.2720 } }, { name: 'Lake Merritt', at: { lat: 37.8060, lon: -122.2600 } }],
  },
  {
    id: 'sac',
    name: 'Sacramento',
    district: 'Capitol · Midtown · Riverfront',
    tagline: 'Flat grid, trees and warm light',
    mood: 'Tree-lined grid, capitol dome, warm inland evenings.',
    biome: 'urban',
    bbox: [38.570, -121.512, 38.590, -121.480],
    mapAt: { lat: 38.5816, lon: -121.4944 },
    cell: 8,
    waterLevel: 2,
    baseElevation: 5,
    spawn: { lat: 38.5780, lon: -121.4960 },
    defaultTime: 'golden',
    defaultWeather: 'clear',
    trafficProfile: { density: 0.7, speedFactor: 1.0 },
    palette: { building: ['#e2d6c2', '#c9b79d', '#d6cfc4', '#a99a86', '#bfae96'], ground: '#9b9484', accent: '#ffcf6b' },
    landmarks: [{ id: 'capitol', name: 'State Capitol Dome', kind: 'dome', at: { lat: 38.57666, lon: -121.49344 }, height: 64, radius: 30, color: '#f2ede2' }],
    activities: {
      scenicRoute: { name: 'Capitol Grid Cruise', waypoints: [{ lat: 38.5850, lon: -121.4900 }, { lat: 38.5800, lon: -121.5040 }, { lat: 38.5780, lon: -121.4960 }] },
      timeTrial: { name: 'Capitol Mall Sprint', waypoints: [{ lat: 38.5770, lon: -121.5040 }, { lat: 38.5770, lon: -121.4960 }] },
      driftZone: { name: 'Riverfront Drift', at: { lat: 38.5800, lon: -121.5050 }, radius: 70 },
      speedTrap: { name: 'J Street Trap', at: { lat: 38.5800, lon: -121.4900 } },
      parking: { name: 'Midtown Park', at: { lat: 38.5760, lon: -121.4880 } },
      photoSpots: [{ id: 'capitol-view', name: 'Capitol Mall', at: { lat: 38.5768, lon: -121.4980 }, lookAt: { lat: 38.57666, lon: -121.49344 } }],
    },
    districts: [{ name: 'Capitol', at: { lat: 38.5770, lon: -121.4940 } }, { name: 'Riverfront', at: { lat: 38.5800, lon: -121.5050 } }],
  },
  {
    id: 'smc',
    name: 'Santa Monica',
    district: 'Coast Highway · Ocean Ave · Palisades',
    tagline: 'Ocean reflections and long sunsets',
    mood: 'Pacific sunset, cliffs, beach streets and coast highway.',
    biome: 'coastal',
    bbox: [34.008, -118.518, 34.034, -118.486],
    mapAt: { lat: 34.0195, lon: -118.4912 },
    cell: 8,
    waterLevel: 0,
    baseElevation: 0,
    spawn: { lat: 34.0160, lon: -118.4960 },
    defaultTime: 'golden',
    defaultWeather: 'clear',
    trafficProfile: { density: 0.8, speedFactor: 1.0 },
    palette: { building: ['#f1e7d4', '#e0cfb2', '#cfd8db', '#f7f0e2', '#d9b896'], ground: '#b1a58f', accent: '#ff8a5c' },
    landmarks: [
      // generic stylization of the pier's solar-LED Ferris wheel (no park branding)
      { id: 'pier-wheel', name: 'Pier Ferris Wheel', kind: 'ferris-wheel', at: { lat: 34.00838, lon: -118.49795 }, height: 27, radius: 6, color: '#f2f0ea', heading: 62 },
    ],
    activities: {
      scenicRoute: { name: 'Coast Highway Cruise', waypoints: [{ lat: 34.0130, lon: -118.4980 }, { lat: 34.0260, lon: -118.5120 }, { lat: 34.0300, lon: -118.5000 }] },
      timeTrial: { name: 'PCH Sprint', waypoints: [{ lat: 34.0100, lon: -118.4960 }, { lat: 34.0300, lon: -118.5160 }] },
      driftZone: { name: 'Beach Lot Drift', at: { lat: 34.0110, lon: -118.4960 }, radius: 70 },
      speedTrap: { name: 'PCH Trap', at: { lat: 34.0220, lon: -118.5060 } },
      parking: { name: 'Ocean Ave Park', at: { lat: 34.0170, lon: -118.4980 } },
      photoSpots: [{ id: 'cliffs', name: 'Palisades Cliffs', at: { lat: 34.0230, lon: -118.5040 }, lookAt: { lat: 34.0170, lon: -118.5100 } }],
    },
    districts: [{ name: 'Ocean Ave', at: { lat: 34.0160, lon: -118.4960 } }, { name: 'Palisades', at: { lat: 34.0260, lon: -118.5050 } }],
  },
  {
    id: 'tahoe',
    name: 'Lake Tahoe',
    district: 'Emerald Bay · Highway 89',
    tagline: 'Pine forest switchbacks over the lake',
    mood: 'Alpine lake, granite, pine forest; winter preset available.',
    biome: 'alpine',
    bbox: [38.935, -120.125, 38.968, -120.07],
    mapAt: { lat: 39.0968, lon: -120.0324 },
    cell: 12,
    waterLevel: 1897,
    baseElevation: 1897,
    spawn: { lat: 38.9464, lon: -120.10056 },
    defaultTime: 'day',
    defaultWeather: 'clear',
    trafficProfile: { density: 0.35, speedFactor: 1.0 },
    palette: { building: ['#7a6450', '#8f7a61', '#6b5a4a'], ground: '#6f7356', accent: '#7fe0ff' },
    landmarks: [],
    activities: {
      scenicRoute: { name: 'Emerald Bay Rim', waypoints: [{ lat: 38.9400, lon: -120.0800 }, { lat: 38.9520, lon: -120.1010 }, { lat: 38.9620, lon: -120.1150 }] },
      timeTrial: { name: 'Highway 89 Hillclimb', waypoints: [{ lat: 38.9400, lon: -120.0800 }, { lat: 38.9600, lon: -120.1120 }] },
      speedTrap: { name: 'Lakeview Trap', at: { lat: 38.9450, lon: -120.0880 } },
      photoSpots: [{ id: 'emerald', name: 'Emerald Bay Lookout', at: { lat: 38.9520, lon: -120.1010 }, lookAt: { lat: 38.9540, lon: -120.1000 } }],
    },
    districts: [{ name: 'Emerald Bay', at: { lat: 38.9520, lon: -120.1010 } }],
  },
  {
    id: 'yosemite',
    name: 'Yosemite Valley',
    district: 'Valley Floor · Northside & Southside Drives',
    tagline: 'Granite walls and forest roads',
    mood: 'Cinematic nature driving under sheer granite cliffs.',
    biome: 'alpine',
    bbox: [37.716, -119.65, 37.75, -119.57],
    mapAt: { lat: 37.8651, lon: -119.5383 },
    cell: 12,
    waterLevel: null,
    baseElevation: 1200,
    spawn: { lat: 37.7270, lon: -119.6240 },
    defaultTime: 'golden',
    defaultWeather: 'clear',
    trafficProfile: { density: 0.3, speedFactor: 0.85 },
    palette: { building: ['#6d5a47', '#7d6a55'], ground: '#6e7052', accent: '#ffd38a' },
    landmarks: [],
    activities: {
      scenicRoute: { name: 'Valley Loop', waypoints: [{ lat: 37.7400, lon: -119.5900 }, { lat: 37.7310, lon: -119.6000 }, { lat: 37.7270, lon: -119.6240 }] },
      timeTrial: { name: 'Northside Drive', waypoints: [{ lat: 37.7230, lon: -119.6400 }, { lat: 37.7420, lon: -119.5850 }] },
      speedTrap: { name: 'Meadow Trap', at: { lat: 37.7300, lon: -119.6100 } },
      photoSpots: [{ id: 'valley', name: 'Valley View', at: { lat: 37.7180, lon: -119.6450 }, lookAt: { lat: 37.7340, lon: -119.6380 } }],
    },
    districts: [{ name: 'Valley Floor', at: { lat: 37.7270, lon: -119.6240 } }],
  },
];

export function getCity(id: string): CityDef | undefined {
  return CITIES.find((c) => c.id === id);
}
