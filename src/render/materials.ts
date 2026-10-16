import {
  AdditiveBlending, Color, DoubleSide, MeshBasicMaterial, MeshPhysicalMaterial, MeshStandardMaterial, type Texture,
} from 'three';
import { withFog } from './fog.ts';
import { beamMaterial, contactShadowMaterial } from '../vfx/atmosphere.ts';
import type { ShaderMaterial } from 'three';
import { makeNoiseTexture, makeRadialTexture } from './textures.ts';

/** Global uniforms driven by time-of-day and weather. */
export const envUniforms = {
  uTime: { value: 0 },
  uWet: { value: 0 },
  uNight: { value: 0 },
  uSnow: { value: 0 },
  uRain: { value: 0 },
  /** 1 = baked ambient occlusion on. */
  uAO: { value: 1 },
  uNoise: { value: null as Texture | null },
  uHasTex: { value: 0 },
  uFacadeAlb: { value: null as Texture | null },
  uFacadeNor: { value: null as Texture | null },
  uAsphaltAlb: { value: null as Texture | null },
  uAsphaltNor: { value: null as Texture | null },
};

type Shader = { uniforms: Record<string, { value: unknown }>; vertexShader: string; fragmentShader: string };

function addUniforms(shader: Shader) {
  Object.assign(shader.uniforms, envUniforms);
  shader.fragmentShader = `uniform float uTime; uniform float uWet; uniform float uNight; uniform float uSnow; uniform float uRain; uniform float uAO; uniform sampler2D uNoise;
uniform float uHasTex; uniform sampler2D uFacadeAlb; uniform sampler2D uFacadeNor; uniform sampler2D uAsphaltAlb; uniform sampler2D uAsphaltNor;\n` + shader.fragmentShader;
  shader.vertexShader = `uniform float uTime;\n` + shader.vertexShader;
}

function worldPosVarying(shader: Shader) {
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', '#include <common>\nvarying vec3 vWPos;\nvarying vec3 vWNrm;')
    .replace('#include <begin_vertex>', `#include <begin_vertex>
      vec4 cdW = vec4(transformed, 1.0);
      #ifdef USE_INSTANCING
        cdW = instanceMatrix * cdW;
      #endif
      vWPos = (modelMatrix * cdW).xyz;
      vWNrm = normalize(mat3(modelMatrix) * objectNormal);`);
  shader.fragmentShader = shader.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vWPos;\nvarying vec3 vWNrm;');
}

/** Install loaded CC0 textures into the shared uniforms (all materials pick them up). */
export function setMaterialAssets(a: { facadeAlb: Texture; facadeNor: Texture; asphaltAlb: Texture; asphaltNor: Texture } | null) {
  if (!a) return;
  envUniforms.uFacadeAlb.value = a.facadeAlb;
  envUniforms.uFacadeNor.value = a.facadeNor;
  envUniforms.uAsphaltAlb.value = a.asphaltAlb;
  envUniforms.uAsphaltNor.value = a.asphaltNor;
  envUniforms.uHasTex.value = 1;
}

export class Materials {
  readonly noise = makeNoiseTexture(256, 11);
  readonly radial = makeRadialTexture(64, 2.2);
  readonly road: MeshStandardMaterial;
  readonly sidewalk: MeshStandardMaterial;
  readonly marking: MeshStandardMaterial;
  readonly terrain: MeshStandardMaterial;
  readonly building: MeshStandardMaterial;
  readonly roof: MeshStandardMaterial;
  readonly structure: MeshStandardMaterial;
  readonly water: MeshStandardMaterial;
  readonly tunnelLight: MeshBasicMaterial;
  readonly pole: MeshStandardMaterial;
  readonly lampHead: MeshStandardMaterial;
  readonly lightPool: MeshBasicMaterial;
  readonly foliage: MeshStandardMaterial;
  readonly bark: MeshStandardMaterial;
  readonly signalHead: MeshStandardMaterial;
  readonly signalLamp: MeshBasicMaterial;
  readonly sign: MeshStandardMaterial;
  readonly landmark: MeshStandardMaterial;
  readonly landmarkGlass: MeshPhysicalMaterial;
  readonly marker: MeshBasicMaterial;
  readonly parkedBody: MeshStandardMaterial;
  readonly vehicleLights: MeshBasicMaterial;
  readonly neon: MeshBasicMaterial;
  readonly lampBeam: ShaderMaterial;
  readonly headBeam: ShaderMaterial;
  readonly contactShadow: MeshBasicMaterial;
  readonly decal: MeshStandardMaterial;
  readonly pedestrian: MeshStandardMaterial;

  /** The shared noise uniform's previous value, restored on dispose (another Materials set may still use it). */
  private prevNoise: Texture | null = null;

  constructor() {
    this.prevNoise = envUniforms.uNoise.value as Texture | null;
    envUniforms.uNoise.value = this.noise;

    this.road = withFog(new MeshStandardMaterial({ color: 0x3a3a3a, roughness: 0.92, metalness: 0, envMapIntensity: 0.45, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 }), (s) => {
      addUniforms(s);
      worldPosVarying(s);
      s.fragmentShader = s.fragmentShader
        .replace('#include <common>', `#include <common>
          float cdH2(vec2 p) { return fract(sin(dot(p, vec2(41.3, 289.1))) * 45758.5453); }`)
        .replace('#include <color_fragment>', `#include <color_fragment>
          vec4 cdA = texture2D(uNoise, vWPos.xz / 7.0);
          vec4 cdB = texture2D(uNoise, vWPos.xz / 53.0);
          float cdPuddle = smoothstep(0.6, 0.68, cdB.b) * uWet;
          if (uHasTex > 0.5) {
            vec3 cdAs = texture2D(uAsphaltAlb, vWPos.xz / 4.5).rgb;
            diffuseColor.rgb = cdAs * 0.62 * (0.82 + (cdB.g - 0.5) * 0.35);
          } else {
            diffuseColor.rgb *= 0.74 + cdA.r * 0.4 + (cdB.g - 0.5) * 0.3;
          }
          diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * 0.45, cdA.a * 0.6);
          diffuseColor.rgb *= mix(1.0, 0.5, uWet);`)
        .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
          roughnessFactor = mix(roughnessFactor * (0.86 + cdA.r * 0.25), 0.22, uWet * 0.75);
          roughnessFactor = mix(roughnessFactor, 0.03, cdPuddle);`)
        .replace('#include <normal_fragment_begin>', `#include <normal_fragment_begin>
          {
            vec3 cdNm = vec3(0.0, 0.0, 1.0);
            if (uHasTex > 0.5) { cdNm = texture2D(uAsphaltNor, vWPos.xz / 4.5).xyz * 2.0 - 1.0; cdNm.xy *= (1.0 - uWet * 0.5) * (1.0 - cdPuddle); }
            // rain ripples in puddles and on wet asphalt
            vec2 cdRg = vec2(0.0);
            if (uRain > 0.01) {
              for (int k = 0; k < 2; k++) {
                vec2 rp = vWPos.xz * (1.7 + float(k) * 0.9) + float(k) * 7.3;
                vec2 ci = floor(rp);
                vec2 cf = fract(rp) - 0.5 - (vec2(cdH2(ci), cdH2(ci + 3.1)) - 0.5) * 0.6;
                float ph = fract(uTime * 0.9 + cdH2(ci + 9.7));
                float d = length(cf);
                float ring = sin((d - ph * 0.45) * 55.0) * smoothstep(ph * 0.45 + 0.08, ph * 0.45, d) * smoothstep(ph * 0.45 - 0.12, ph * 0.45, d) * (1.0 - ph);
                cdRg += (cf / max(d, 1e-3)) * ring;
              }
              cdRg *= uRain * (0.25 + cdPuddle * 0.75) * 0.6;
            }
            vec3 cdNW = normalize(vec3(cdNm.x + cdRg.x, max(cdNm.z, 0.2), cdNm.y + cdRg.y));
            normal = normalize((viewMatrix * vec4(cdNW, 0.0)).xyz);
          }`);
    }, 'road');

    this.sidewalk = withFog(new MeshStandardMaterial({ vertexColors: true, roughness: 0.88, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 }), (s) => {
      addUniforms(s);
      worldPosVarying(s);
      s.fragmentShader = s.fragmentShader
        .replace('#include <color_fragment>', `#include <color_fragment>
          vec4 cdA = texture2D(uNoise, vWPos.xz / 3.0);
          float cdJoint = step(0.94, fract(vWPos.x / 1.5)) + step(0.94, fract(vWPos.z / 1.5));
          diffuseColor.rgb *= (0.86 + cdA.r * 0.22) * (1.0 - min(cdJoint, 1.0) * 0.12) * 0.78;
          diffuseColor.rgb *= mix(1.0, 0.62, uWet);
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.92), uSnow * smoothstep(0.6, 0.9, vWNrm.y) * 0.8);`)
        .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
          roughnessFactor = mix(roughnessFactor, 0.3, uWet * 0.7);`);
    }, 'sidewalk');

    this.marking = withFog(new MeshStandardMaterial({ vertexColors: true, roughness: 0.65, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -6 }), (s) => {
      addUniforms(s);
      worldPosVarying(s);
      s.fragmentShader = s.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
        vec4 cdA = texture2D(uNoise, vWPos.xz / 2.0);
        diffuseColor.rgb *= 0.7 + cdA.r * 0.45;
        diffuseColor.rgb *= mix(1.0, 0.7, uWet);`).replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        roughnessFactor = mix(roughnessFactor, 0.25, uWet);`);
    }, 'marking');

    this.terrain = withFog(new MeshStandardMaterial({ vertexColors: true, roughness: 0.96 }), (s) => {
      addUniforms(s);
      worldPosVarying(s);
      s.fragmentShader = s.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
        vec4 cdA = texture2D(uNoise, vWPos.xz / 11.0);
        vec4 cdB = texture2D(uNoise, vWPos.xz / 97.0);
        diffuseColor.rgb *= 0.78 + cdA.r * 0.3 + (cdB.g - 0.5) * 0.35;
        diffuseColor.rgb *= mix(1.0, 0.7, uWet);
        float cdSnow = uSnow * smoothstep(0.62, 0.86, vWNrm.y + (cdA.g - 0.5) * 0.2);
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.93, 0.95, 0.98), cdSnow);`)
        .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        roughnessFactor = mix(roughnessFactor, 0.5, uWet * 0.6);`);
    }, 'terrain');

    this.building = withFog(new MeshStandardMaterial({ vertexColors: true, roughness: 0.82, metalness: 0.0 }), (s) => {
      addUniforms(s);
      worldPosVarying(s);
      s.vertexShader = s.vertexShader
        .replace('#include <common>', '#include <common>\nattribute vec2 facade;\nattribute float facadeType;\nvarying vec2 vFacade;\nvarying float vFType;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvFacade = facade;\nvFType = facadeType;');
      s.fragmentShader = s.fragmentShader
        .replace('#include <common>', `#include <common>
          varying vec2 vFacade;
          varying float vFType;
          float cdH(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }`)
        .replace('#include <color_fragment>', `#include <color_fragment>
          float cdType = floor(vFType + 0.5);
          float cdCurtain = step(3.5, cdType);
          float cdMat = mod(cdType, 4.0);
          vec3 cdN = normalize(vWNrm);
          vec3 cdT = normalize(vec3(-cdN.z, 0.0, cdN.x) + 1e-5);
          // facade material from the CC0 atlas (brick / stucco / concrete / siding)
          vec2 cdTile = vec2(mod(cdMat, 2.0), floor(cdMat / 2.0));
          float cdScale = cdMat < 0.5 ? 2.2 : cdMat < 1.5 ? 3.0 : cdMat < 2.5 ? 3.2 : 1.5;
          vec2 cdTuv = vFacade / cdScale;
          vec2 cdAuv = (cdTile + 0.01 + fract(cdTuv) * 0.98) * 0.5;
          vec2 cdDx = dFdx(cdTuv) * 0.49;
          vec2 cdDy = dFdy(cdTuv) * 0.49;
          vec3 cdTex = uHasTex > 0.5 ? textureGrad(uFacadeAlb, cdAuv, cdDx, cdDy).rgb : vec3(0.62);
          vec3 cdTint = diffuseColor.rgb;
          float cdLum = dot(cdTex, vec3(0.299, 0.587, 0.114));
          // tile-average luminance from a coarse mip, so painted materials keep their tint
          vec3 cdAvgC = uHasTex > 0.5 ? textureLod(uFacadeAlb, (cdTile + 0.5) * 0.5, 7.0).rgb : vec3(0.62);
          float cdDetail = clamp(cdLum / max(0.04, dot(cdAvgC, vec3(0.299, 0.587, 0.114))), 0.35, 1.7);
          vec3 cdWall;
          if (cdMat < 0.5) cdWall = mix(cdTex, cdTex * cdTint * 1.8, 0.25) * 0.75;
          else if (cdMat > 2.5) cdWall = cdTint * mix(1.0, cdDetail, 0.7) * 0.82;
          else if (cdMat > 1.5) cdWall = mix(cdTex, cdTint * cdDetail * 0.8, 0.35) * 0.85;
          else cdWall = cdTint * mix(1.0, cdDetail, 0.6) * 0.85;
          // window layout by facade style
          vec2 cdCellSize = vec2(3.1, 3.4);
          vec4 cdWinR = vec4(0.2, 0.8, 0.22, 0.82);
          float cdV0 = 4.4;
          if (cdCurtain > 0.5) { cdCellSize = vec2(1.6, 3.6); cdWinR = vec4(0.03, 0.97, 0.06, 0.96); }
          else if (cdMat > 1.5 && cdMat < 2.5) { cdCellSize = vec2(3.0, 3.6); cdWinR = vec4(0.03, 0.97, 0.3, 0.84); }
          else if (cdMat > 2.5) { cdCellSize = vec2(2.4, 3.2); cdWinR = vec4(0.26, 0.74, 0.2, 0.86); cdV0 = 0.5; }
          float cdGround = cdMat > 2.5 ? 0.0 : step(vFacade.y, cdV0);
          vec2 cdCell = vec2(vFacade.x / cdCellSize.x, (vFacade.y - cdV0) / cdCellSize.y);
          vec2 cdCi = floor(cdCell);
          vec2 cdCf = fract(cdCell);
          vec2 cdRoomSize = cdCellSize;
          float cdWin;
          if (cdGround > 0.5) {
            float gx = fract(vFacade.x / 5.5);
            cdWin = step(0.06, gx) * step(gx, 0.94) * step(0.4, vFacade.y) * step(vFacade.y, cdV0 - 0.7);
            cdCi = vec2(floor(vFacade.x / 5.5), -1.0);
            cdCf = vec2(gx, (vFacade.y - 0.4) / (cdV0 - 1.1));
            cdRoomSize = vec2(5.5, cdV0 - 1.1);
          } else {
            cdWin = step(cdWinR.x, cdCf.x) * step(cdCf.x, cdWinR.y) * step(cdWinR.z, cdCf.y) * step(cdCf.y, cdWinR.w) * step(cdV0, vFacade.y);
            cdCf = vec2((cdCf.x - cdWinR.x) / (cdWinR.y - cdWinR.x), (cdCf.y - cdWinR.z) / (cdWinR.w - cdWinR.z));
            cdRoomSize = cdCellSize * vec2(cdWinR.y - cdWinR.x, cdWinR.w - cdWinR.z);
          }
          float cdR = cdH(cdCi + floor(vFacade.x / 400.0));
          // interior mapping: ray-cast a fake room behind every window
          vec3 cdRoom = vec3(0.0);
          if (cdWin > 0.5) {
            vec3 cdV = normalize(vWPos - cameraPosition);
            vec3 rd = vec3(dot(cdV, cdT), cdV.y, min(dot(cdV, cdN), -0.03));
            vec3 ro = vec3(cdCf * cdRoomSize, 0.0);
            float D = 3.5 + cdR * 2.0;
            float tx = rd.x > 0.0 ? (cdRoomSize.x - ro.x) / rd.x : -ro.x / min(rd.x, -1e-4);
            float ty = rd.y > 0.0 ? (cdRoomSize.y + 0.6 - ro.y) / rd.y : (-0.4 - ro.y) / min(rd.y, -1e-4);
            float tz = D / -rd.z;
            float tt = min(min(tx, ty), tz);
            vec3 hp = ro + rd * tt;
            vec3 wallC = mix(vec3(0.62, 0.56, 0.48), vec3(0.45, 0.5, 0.56), cdR);
            if (tt == tz) {
              cdRoom = wallC * 0.85;
              float shelf = step(hp.y, 1.0) * step(0.15 * cdRoomSize.x, hp.x) * step(hp.x, (0.45 + cdR * 0.4) * cdRoomSize.x);
              float art = step(1.5, hp.y) * step(hp.y, 2.2) * step(0.6 * cdRoomSize.x, hp.x) * step(hp.x, 0.85 * cdRoomSize.x);
              cdRoom = mix(cdRoom, vec3(0.16, 0.12, 0.1), shelf * 0.85);
              cdRoom = mix(cdRoom, vec3(0.5, 0.3, 0.25) * (0.6 + cdR), art * 0.7);
            } else if (tt == ty) {
              cdRoom = rd.y > 0.0 ? vec3(0.82, 0.8, 0.76) : mix(vec3(0.32, 0.22, 0.15), vec3(0.4, 0.4, 0.42), step(0.5, cdR));
            } else cdRoom = wallC * 0.7;
            cdRoom *= 0.4 + 0.6 * exp(-tt * 0.16);
          }
          float cdSlab = (cdGround > 0.5 || cdCurtain > 0.5) ? 0.0 : (1.0 - step(0.05, fract(cdCell.y))) * 0.2;
          vec3 cdGlass = mix(vec3(0.045, 0.06, 0.075), cdRoom * 0.55, 0.5);
          diffuseColor.rgb = mix(cdWall * (1.0 - cdSlab), cdGlass, cdWin);
          // baked AO: darker where the facade meets the street, softer under the roof line
          float cdBaseAO = mix(1.0, 0.45 + 0.55 * smoothstep(-1.5, 2.2, vFacade.y), uAO);
          diffuseColor.rgb *= cdBaseAO;
          diffuseColor.rgb *= mix(1.0, 0.78, uWet);`)
        .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
          float cdWallR = cdMat < 0.5 ? 0.88 : cdMat > 2.5 ? 0.62 : cdMat > 1.5 ? 0.8 : 0.9;
          roughnessFactor = mix(mix(cdWallR, 0.35, uWet * 0.6), 0.05, cdWin);`)
        .replace('#include <metalnessmap_fragment>', `#include <metalnessmap_fragment>
          metalnessFactor = mix(metalnessFactor, cdCurtain > 0.5 ? 0.55 : 0.3, cdWin);`)
        .replace('#include <normal_fragment_begin>', `#include <normal_fragment_begin>
          if (uHasTex > 0.5 && cdWin < 0.5) {
            vec3 cdNm = textureGrad(uFacadeNor, cdAuv, cdDx, cdDy).xyz * 2.0 - 1.0;
            vec3 cdNW = normalize(cdT * cdNm.x * 0.9 + vec3(0.0, 1.0, 0.0) * cdNm.y * 0.9 + cdN * cdNm.z);
            normal = normalize((viewMatrix * vec4(cdNW, 0.0)).xyz);
          }`)
        .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
          float cdLitR = cdH(cdCi * 1.37 + 3.1 + floor(vFacade.x / 400.0));
          float cdLit = step(cdLitR, 0.08 + 0.2 * uNight + cdGround * 0.25);
          vec3 cdWarm = mix(vec3(1.0, 0.72, 0.42), vec3(0.62, 0.72, 0.9), step(0.82, cdR));
          float cdDim = 0.35 + 0.65 * fract(cdLitR * 7.13);
          totalEmissiveRadiance += cdWin * cdLit * (cdRoom * 0.95 + 0.03) * cdWarm * cdDim * uNight * (0.7 + cdGround * 0.5);`);
    }, 'building');

    this.roof = withFog(new MeshStandardMaterial({ vertexColors: true, roughness: 0.9 }), (s) => {
      addUniforms(s);
      worldPosVarying(s);
      s.fragmentShader = s.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.93), uSnow * smoothstep(0.5, 0.9, vWNrm.y));`);
    }, 'roof');
    this.structure = withFog(new MeshStandardMaterial({ vertexColors: true, roughness: 0.8 }), undefined, 'structure');
    this.water = withFog(new MeshStandardMaterial({ color: 0x0b2630, roughness: 0.12, metalness: 0.0 }), (s) => {
      addUniforms(s);
      worldPosVarying(s);
      s.fragmentShader = s.fragmentShader.replace('#include <normal_fragment_begin>', `#include <normal_fragment_begin>
        {
          vec2 p = vWPos.xz;
          float t = uTime;
          vec2 g = vec2(0.0);
          g += vec2(0.30, 0.18) * cos(dot(p, vec2(0.30, 0.18)) + t * 1.3) * 0.18;
          g += vec2(-0.21, 0.37) * cos(dot(p, vec2(-0.21, 0.37)) + t * 1.7) * 0.12;
          g += vec2(0.53, -0.41) * cos(dot(p, vec2(0.53, -0.41)) + t * 2.3) * 0.07;
          vec4 cdN = texture2D(uNoise, p / 61.0 + vec2(t * 0.004, t * 0.003));
          g += (vec2(cdN.b, cdN.g) - 0.5) * 0.12;
          float fade = clamp(1.0 - length(vWPos - cameraPosition) / 1500.0, 0.15, 1.0);
          vec3 nW = normalize(vec3(-g.x * fade, 1.0, -g.y * fade));
          normal = normalize((viewMatrix * vec4(nW, 0.0)).xyz);
        }`).replace('#include <color_fragment>', `#include <color_fragment>
          diffuseColor.rgb *= 1.0 + uNight * 0.0;`);
    }, 'water');

    this.tunnelLight = withFog(new MeshBasicMaterial({ color: new Color(1.0, 0.82, 0.55).multiplyScalar(3) }), undefined, 'tunnelLight');
    this.pole = withFog(new MeshStandardMaterial({ color: 0x5b5e60, roughness: 0.55, metalness: 0.6 }), undefined, 'pole');
    this.lampHead = withFog(new MeshStandardMaterial({ color: 0x222222, emissive: new Color(1.0, 0.75, 0.45), emissiveIntensity: 0, roughness: 0.4 }), undefined, 'lamp');
    this.lightPool = new MeshBasicMaterial({ map: this.radial, color: new Color(1.0, 0.68, 0.38), transparent: true, opacity: 0, blending: AdditiveBlending, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -8 });
    this.foliage = withFog(new MeshStandardMaterial({ vertexColors: true, roughness: 0.9, side: DoubleSide }), (s) => {
      addUniforms(s);
      worldPosVarying(s);
      s.vertexShader = s.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
        float cdSway = sin(uTime * 1.3 + (instanceMatrix[3].x + instanceMatrix[3].z) * 0.2) * 0.04 * max(position.y - 2.0, 0.0) / 6.0;
        transformed.x += cdSway;`);
      s.fragmentShader = s.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.9, 0.92, 0.95), uSnow * smoothstep(0.2, 0.8, vWNrm.y) * 0.85);`);
    }, 'foliage');
    this.bark = withFog(new MeshStandardMaterial({ color: 0x4a3b2f, roughness: 0.95 }), undefined, 'bark');
    this.pedestrian = withFog(new MeshStandardMaterial({ roughness: 0.82, metalness: 0 }), undefined, 'ped');
    this.signalHead = withFog(new MeshStandardMaterial({ color: 0x1d1f1c, roughness: 0.6, metalness: 0.3 }), undefined, 'signalHead');
    this.signalLamp = new MeshBasicMaterial({ color: 0xffffff, toneMapped: false });
    this.sign = withFog(new MeshStandardMaterial({ vertexColors: true, roughness: 0.5 }), undefined, 'sign');
    this.landmark = withFog(new MeshStandardMaterial({ vertexColors: true, roughness: 0.75 }), (s) => {
      addUniforms(s);
      worldPosVarying(s);
      s.fragmentShader = s.fragmentShader.replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        totalEmissiveRadiance += vec3(1.0, 0.85, 0.65) * uNight * 0.25 * smoothstep(0.0, 40.0, vWPos.y) * (1.0 - abs(vWNrm.y));`);
    }, 'landmark');
    this.landmarkGlass = withFog(new MeshPhysicalMaterial({ color: 0x8aa2b4, roughness: 0.18, metalness: 0.3, emissive: new Color(0.35, 0.45, 0.6), emissiveIntensity: 0 }), undefined, 'landmarkGlass');
    this.parkedBody = withFog(new MeshStandardMaterial({ vertexColors: true, roughness: 0.36, metalness: 0.3, envMapIntensity: 0.6 }), (s) => {
      addUniforms(s);
      s.fragmentShader = s.fragmentShader.replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\n roughnessFactor = mix(roughnessFactor, 0.12, uWet);');
    }, 'vehicleBody');
    this.vehicleLights = new MeshBasicMaterial({ vertexColors: true, toneMapped: false });
    this.lampBeam = beamMaterial(8.2, new Color(1.0, 0.72, 0.42));
    this.headBeam = beamMaterial(26, new Color(0.85, 0.9, 1.0));
    this.contactShadow = contactShadowMaterial(this.radial);
    this.neon = withFog(new MeshBasicMaterial({ vertexColors: true, toneMapped: false }), undefined, 'neon');
    this.decal = withFog(new MeshStandardMaterial({ vertexColors: true, roughness: 0.82, metalness: 0.15, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 }), (s) => {
      addUniforms(s);
      s.fragmentShader = s.fragmentShader.replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\n roughnessFactor = mix(roughnessFactor, 0.15, uWet);');
    }, 'decal');
    this.marker = new MeshBasicMaterial({ color: 0xffb347, transparent: true, opacity: 0.55, blending: AdditiveBlending, depthWrite: false, side: DoubleSide, toneMapped: false });
  }

  /** Free this set's textures and materials (shared CC0 asset textures live in envUniforms and are kept). */
  dispose() {
    if (envUniforms.uNoise.value === this.noise) envUniforms.uNoise.value = this.prevNoise;
    this.noise.dispose();
    this.radial.dispose();
    for (const v of Object.values(this)) if (v && typeof v === 'object' && (v as { isMaterial?: boolean }).isMaterial) (v as { dispose(): void }).dispose();
  }

  update(time: number, wet: number, night: number, snow: number, rain = 0) {
    envUniforms.uTime.value = time;
    envUniforms.uRain.value = rain;
    this.neon.color.setScalar(0.25 + night * 2.6);
    envUniforms.uWet.value = wet;
    envUniforms.uNight.value = night;
    envUniforms.uSnow.value = snow;
    this.lampHead.emissiveIntensity = night * 6;
    this.landmarkGlass.emissiveIntensity = night * 0.35;
    this.lightPool.opacity = night * 0.55;
    this.tunnelLight.color.setRGB(1.0, 0.82, 0.55).multiplyScalar(1.3 + night * 0.5);
  }
}
