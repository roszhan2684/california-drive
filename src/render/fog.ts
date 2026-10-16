// "Karl the Fog": global height fog + rolling marine layer, injected into every built-in
// material by replacing three's fog shader chunks. Extra uniforms are shared objects that
// materials opt into via `withFog(material)`; materials without them fall back to plain exp2 fog.

import { Color, ShaderChunk, Vector3, type Material } from 'three';

export const fogUniforms = {
  uFogHeightFalloff: { value: 0.012 },
  uFogBase: { value: 0 },
  uMarine: { value: 0 },
  uMarineFront: { value: -400 },
  uMarineTop: { value: 140 },
  uFogTime: { value: 0 },
  uSunDir: { value: new Vector3(0, 1, 0) },
  uSunFogColor: { value: new Color(1, 0.8, 0.6) },
  uSunFogAmt: { value: 0 },
  uMarineColor: { value: new Color(0.8, 0.83, 0.86) },
};

let installed = false;

export function installFogChunks() {
  if (installed) return;
  installed = true;
  ShaderChunk.fog_pars_vertex = /* glsl */ `
#ifdef USE_FOG
  varying float vFogDepth;
  varying vec3 vFogWorld;
#endif
`;
  ShaderChunk.fog_vertex = /* glsl */ `
#ifdef USE_FOG
  vFogDepth = - mvPosition.z;
  vFogWorld = ( inverse( viewMatrix ) * vec4( mvPosition.xyz, 1.0 ) ).xyz;
#endif
`;
  ShaderChunk.fog_pars_fragment = /* glsl */ `
#ifdef USE_FOG
  uniform vec3 fogColor;
  varying float vFogDepth;
  varying vec3 vFogWorld;
  #ifdef FOG_EXP2
    uniform float fogDensity;
  #else
    uniform float fogNear;
    uniform float fogFar;
  #endif
  uniform float uFogHeightFalloff;
  uniform float uFogBase;
  uniform float uMarine;
  uniform float uMarineFront;
  uniform float uMarineTop;
  uniform float uFogTime;
  uniform vec3 uSunDir;
  uniform vec3 uSunFogColor;
  uniform float uSunFogAmt;
  uniform vec3 uMarineColor;
  float cdHash( vec2 p ) { return fract( sin( dot( p, vec2( 127.1, 311.7 ) ) ) * 43758.5453 ); }
  float cdNoise( vec2 p ) {
    vec2 i = floor( p ); vec2 f = fract( p );
    vec2 u = f * f * ( 3.0 - 2.0 * f );
    return mix( mix( cdHash( i ), cdHash( i + vec2( 1.0, 0.0 ) ), u.x ), mix( cdHash( i + vec2( 0.0, 1.0 ) ), cdHash( i + vec2( 1.0, 1.0 ) ), u.x ), u.y );
  }
#endif
`;
  ShaderChunk.fog_fragment = /* glsl */ `
#ifdef USE_FOG
  vec3 cdRay = vFogWorld - cameraPosition;
  float cdDist = length( cdRay );
  #ifdef FOG_EXP2
    float cdHeight = 1.0;
    if ( uFogHeightFalloff > 0.0 ) {
      float k = uFogHeightFalloff * cdRay.y;
      float camTerm = exp( - uFogHeightFalloff * ( cameraPosition.y - uFogBase ) );
      cdHeight = clamp( camTerm * ( abs( k ) > 1e-3 ? ( 1.0 - exp( - k ) ) / k : 1.0 ), 0.05, 8.0 );
    }
    float cdOptical = fogDensity * fogDensity * cdDist * cdDist * cdHeight;
    float cdMarine = 0.0;
    if ( uMarine > 0.0 ) {
      vec2 mp = vFogWorld.xz * 0.0035 + vec2( uFogTime * 0.012, uFogTime * 0.004 );
      float n = cdNoise( mp ) * 0.55 + cdNoise( mp * 2.3 + 4.1 ) * 0.3 + cdNoise( mp * 5.1 - 2.0 ) * 0.15;
      float bank = smoothstep( uMarineFront + 260.0, uMarineFront - 260.0, vFogWorld.x - vFogWorld.z * 0.35 + n * 220.0 );
      float hmask = smoothstep( uMarineTop + 30.0, uMarineTop - 50.0, vFogWorld.y + n * 30.0 );
      float camIn = smoothstep( uMarineFront + 200.0, uMarineFront - 200.0, cameraPosition.x - cameraPosition.z * 0.35 ) * smoothstep( uMarineTop + 30.0, uMarineTop - 40.0, cameraPosition.y );
      cdMarine = uMarine * ( bank * hmask * ( 0.25 + n ) * min( cdDist, 900.0 ) * 0.0026 + camIn * cdDist * 0.0016 );
    }
    float fogFactor = 1.0 - exp( - cdOptical - cdMarine );
    vec3 cdCol = mix( fogColor, uMarineColor, clamp( cdMarine / ( cdOptical + cdMarine + 1e-4 ), 0.0, 1.0 ) * 0.7 );
    float cdSun = pow( max( dot( cdRay / max( cdDist, 1e-3 ), uSunDir ), 0.0 ), 8.0 ) * uSunFogAmt;
    cdCol = mix( cdCol, uSunFogColor, cdSun );
  #else
    float fogFactor = smoothstep( fogNear, fogFar, vFogDepth );
    vec3 cdCol = fogColor;
  #endif
  gl_FragColor.rgb = mix( gl_FragColor.rgb, cdCol, fogFactor );
#endif
`;
}

type Patch = (shader: { uniforms: Record<string, { value: unknown }>; vertexShader: string; fragmentShader: string }) => void;

/** Attach the shared fog uniforms (and optionally another patch) to a material. */
export function withFog<M extends Material>(m: M, extra?: Patch, cacheKey?: string): M {
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, fogUniforms);
    extra?.(shader as any);
  };
  const key = 'cdfog:' + (cacheKey ?? (extra ? extra.toString() : 'plain'));
  m.customProgramCacheKey = () => key;
  return m;
}
