import {describe,it,expect} from 'vitest';
import {Guidance,metres} from './guidance';
import type {PreviewRoute} from './mapboxPreview';
const route:PreviewRoute={distanceMeters:1000,durationSeconds:200,geometry:[[0,0],[0.001,0],[0.002,0]],steps:[{instruction:'Continue',location:[0.001,0],distanceMeters:110}]};
describe('Guidance safety and distance',()=>{
 it('computes approximate distances',()=>expect(metres({lat:0,lng:0},{lat:0,lng:0.001})).toBeGreaterThan(100));
 it('announces a maneuver once',()=>{const g=new Guidance(route,{lat:0,lng:0.002});expect(g.update({lat:0,lng:0},10,1000).announce).toBe('Continue');expect(g.update({lat:0,lng:0},10,2000).announce).toBeUndefined()});
 it('does not reroute on low accuracy',()=>{const g=new Guidance(route,{lat:0,lng:0.002});g.update({lat:1,lng:1},150,1000);expect(g.update({lat:1,lng:1},150,30000).reroute).toBe(false)});
 it('requires a sustained reliable off-route position',()=>{const g=new Guidance(route,{lat:0,lng:0.002});g.update({lat:1,lng:1},5,1000);expect(g.update({lat:1,lng:1},5,20000).reroute).toBe(true)});
});